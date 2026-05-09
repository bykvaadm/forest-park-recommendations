"""Mechanical helper for the recommendations pipeline.

This script does NO LLM work. It only:
  - reads state/messages.jsonl
  - groups messages into threads (forum topics + reply chains, split by gaps)
  - filters threads that are "closed" (quiet ≥ N hours) and not yet processed
  - prints them in a human-readable form for Claude to read and decide on
  - records processed thread keys

The actual decision "is this a recommendation? what fields?" is made by
Claude (the agent reading this script's output) — not by code.

Usage:
  python prepare.py                              # list pending closed threads
  python prepare.py thread CHAT_ID MESSAGE_ID    # show the thread containing
                                                 # that message (regardless of
                                                 # whether it's "closed") — used
                                                 # when the bot was @-mentioned
  python prepare.py mark KEY1 KEY2 ...           # record threads as processed
  python prepare.py status                       # short summary

Tunables (env vars, all optional):
  BOT_FP_QUIET_HOURS=12   # thread must be silent this long to be "closed"
  BOT_FP_GAP_HOURS=12     # gap inside a topic that splits it into separate threads
"""
import json
import os
import pathlib
import sys
from datetime import datetime, timezone
from typing import Optional

PROJ = pathlib.Path(__file__).parent
STATE = PROJ / "state"
MESSAGES_LOG = STATE / "messages.jsonl"
PROCESSED = STATE / "processed.json"

QUIET_HOURS = int(os.environ.get("BOT_FP_QUIET_HOURS", "12"))
GAP_HOURS = int(os.environ.get("BOT_FP_GAP_HOURS", "12"))


def load_messages() -> list[dict]:
    if not MESSAGES_LOG.exists():
        return []
    out = []
    for line in MESSAGES_LOG.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def load_processed() -> dict:
    if not PROCESSED.exists():
        return {"thread_keys": []}
    try:
        return json.loads(PROCESSED.read_text(encoding="utf-8"))
    except Exception:
        return {"thread_keys": []}


def save_processed(p: dict):
    STATE.mkdir(exist_ok=True)
    PROCESSED.write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def msg_time(m: dict) -> Optional[datetime]:
    return parse_dt(m.get("date") or m.get("received_at"))


def thread_key(msgs: list[dict]) -> str:
    """Stable fingerprint for a thread."""
    return ",".join(sorted(str(m["message_id"]) for m in msgs))


def short_key(k: str) -> str:
    """Short prefix for display."""
    return k[:12] + ("…" if len(k) > 12 else "")


def group_threads(messages: list[dict]) -> list[list[dict]]:
    by_id = {(m.get("chat_id"), m["message_id"]): m for m in messages if "message_id" in m}

    def root_key(m):
        tid = m.get("message_thread_id")
        if tid is not None:
            return ("topic", m.get("chat_id"), tid)
        cur = m
        seen = set()
        while cur.get("reply_to") is not None:
            parent = by_id.get((m.get("chat_id"), cur["reply_to"]))
            if parent is None or parent["message_id"] in seen:
                break
            seen.add(parent["message_id"])
            cur = parent
        return ("msg", m.get("chat_id"), cur["message_id"])

    sorted_msgs = sorted(messages, key=lambda m: (msg_time(m) or datetime.min.replace(tzinfo=timezone.utc), m.get("message_id", 0)))

    raw = {}
    for m in sorted_msgs:
        raw.setdefault(root_key(m), []).append(m)

    threads = []
    for msgs in raw.values():
        msgs.sort(key=lambda m: (msg_time(m) or datetime.min.replace(tzinfo=timezone.utc), m["message_id"]))
        cur = []
        last = None
        for m in msgs:
            t = msg_time(m)
            if last is not None and t is not None and (t - last).total_seconds() > GAP_HOURS * 3600:
                if cur:
                    threads.append(cur)
                cur = []
            cur.append(m)
            if t:
                last = t
        if cur:
            threads.append(cur)
    return threads


def thread_is_closed(thread: list[dict], hours: int) -> bool:
    last = msg_time(thread[-1])
    if not last:
        return False
    return (datetime.now(timezone.utc) - last).total_seconds() / 3600 >= hours


def render_thread(thread: list[dict]) -> str:
    lines = []
    for m in thread:
        who_parts = [m.get("from_name") or "(имя неизвестно)"]
        if m.get("from_username"):
            who_parts.append(f"@{m['from_username']}")
        who = " ".join(who_parts)
        date = m.get("date") or m.get("received_at") or ""
        reply = f"  [reply→ #{m['reply_to']}]" if m.get("reply_to") else ""
        kind = m.get("type", "message")
        text = m.get("text") or ""
        if kind == "forwarded":
            fname = m.get("fwd_from_name") or "?"
            funame = f" @{m['fwd_username']}" if m.get("fwd_username") else ""
            fdate = f" · {m['fwd_date']}" if m.get("fwd_date") else ""
            text = f"⤵ переслано от {fname}{funame}{fdate}\n{text}"
        lines.append(f"#{m['message_id']} · {who} · {date}{reply}\n{text}")
    return "\n\n".join(lines)


def cmd_list():
    messages = load_messages()
    if not messages:
        print("[prepare] no messages in log yet.")
        return 0

    processed = load_processed()
    seen = set(processed.get("thread_keys", []))

    threads = group_threads(messages)
    closed = [t for t in threads if thread_is_closed(t, QUIET_HOURS)]
    pending = [t for t in closed if thread_key(t) not in seen]

    print(f"[prepare] threads total={len(threads)} closed={len(closed)} processed={len(seen)} pending={len(pending)}")
    if not pending:
        print("[prepare] nothing to process.")
        return 0

    print()
    print("=" * 78)
    for i, t in enumerate(pending, 1):
        k = thread_key(t)
        chat = t[0].get("chat_id")
        topic = t[0].get("message_thread_id")
        topic_part = f" · topic={topic}" if topic else ""
        first = msg_time(t[0])
        last = msg_time(t[-1])
        span = ""
        if first and last:
            span = f" · {first.strftime('%Y-%m-%d %H:%M')} → {last.strftime('%H:%M')}"
        print(f"\n--- THREAD {i}/{len(pending)} ({len(t)} msgs) · chat={chat}{topic_part}{span}")
        print(f"    KEY: {k}")
        print()
        print(render_thread(t))
    print()
    print("=" * 78)
    print()
    print("Per closed thread above, decide: recommendation or noise.")
    print("Append recommendations to web/data.json (use existing items as schema reference).")
    print("Then mark processed with:")
    print(f"    python prepare.py mark {' '.join(thread_key(t) for t in pending[:3])}{' ...' if len(pending) > 3 else ''}")
    return 0


def cmd_mark(keys: list[str]):
    if not keys:
        print("[prepare] no keys provided.", file=sys.stderr)
        return 1
    processed = load_processed()
    seen = set(processed.get("thread_keys", []))
    added = 0
    for k in keys:
        if k not in seen:
            seen.add(k)
            added += 1
    processed["thread_keys"] = sorted(seen)
    save_processed(processed)
    print(f"[prepare] marked {added} new thread(s) as processed (total: {len(seen)})")
    return 0


def cmd_thread(chat_id_s: str, msg_id_s: str):
    """Find the thread containing (chat_id, message_id) and print it.
    Used when the bot was @-mentioned — we want to look at that thread now,
    even if it isn't "closed" by the silence criterion.
    """
    try:
        chat_id = int(chat_id_s)
        msg_id = int(msg_id_s)
    except ValueError:
        print(f"[prepare] chat_id and message_id must be ints; got {chat_id_s!r} {msg_id_s!r}", file=sys.stderr)
        return 2

    messages = load_messages()
    if not messages:
        print("[prepare] log is empty.")
        return 0

    threads = group_threads(messages)
    target = None
    for t in threads:
        if any(m.get("chat_id") == chat_id and m.get("message_id") == msg_id for m in t):
            target = t
            break

    if target is None:
        print(f"[prepare] no thread contains chat_id={chat_id} message_id={msg_id}")
        return 1

    processed = load_processed()
    seen = set(processed.get("thread_keys", []))
    k = thread_key(target)

    chat = target[0].get("chat_id")
    topic = target[0].get("message_thread_id")
    topic_part = f" · topic={topic}" if topic else ""
    first = msg_time(target[0])
    last = msg_time(target[-1])
    span = ""
    if first and last:
        span = f" · {first.strftime('%Y-%m-%d %H:%M')} → {last.strftime('%H:%M')}"
    closed = thread_is_closed(target, QUIET_HOURS)
    is_seen = k in seen

    print(f"[prepare] thread for chat={chat} msg={msg_id}: {len(target)} msg(s) · closed={closed} · processed={is_seen}{topic_part}{span}")
    print(f"    KEY: {k}")
    print()
    print(render_thread(target))
    print()
    if is_seen:
        print(f"[prepare] note: this thread was already marked processed.")
    return 0


def cmd_status():
    messages = load_messages()
    processed = load_processed()
    seen = set(processed.get("thread_keys", []))
    if not messages:
        print("messages: 0")
        print(f"processed threads: {len(seen)}")
        return 0
    threads = group_threads(messages)
    closed = [t for t in threads if thread_is_closed(t, QUIET_HOURS)]
    pending = sum(1 for t in closed if thread_key(t) not in seen)
    print(f"messages: {len(messages)}")
    print(f"threads:  total={len(threads)} closed={len(closed)} pending={pending}")
    print(f"processed threads: {len(seen)}")
    return 0


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] == "list":
        sys.exit(cmd_list())
    if argv[0] == "status":
        sys.exit(cmd_status())
    if argv[0] == "mark":
        sys.exit(cmd_mark(argv[1:]))
    if argv[0] == "thread":
        if len(argv) != 3:
            print("usage: prepare.py thread CHAT_ID MESSAGE_ID", file=sys.stderr)
            sys.exit(2)
        sys.exit(cmd_thread(argv[1], argv[2]))
    print(f"unknown command: {argv[0]}", file=sys.stderr)
    print("usage: prepare.py [list | mark KEY ... | status | thread CHAT_ID MSG_ID]", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
