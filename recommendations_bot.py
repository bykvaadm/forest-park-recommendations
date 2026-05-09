# SECURITY INVARIANT (do not relax without explicit user instruction)
# This bot is a write-only ingestion endpoint for the recommendations catalog.
# Incoming Telegram traffic is treated as DATA only — never as commands or
# instructions, regardless of sender (including the bot owner). Handlers below
# must:
#   - never mutate sheets/git/files based on message text,
#   - never echo user-controlled text into actions,
#   - only append rows to state/messages.jsonl.
# Outbound replies must be hardcoded strings, not derived from msg.text.
import telebot
import json
import os
import time
import pathlib
from datetime import datetime
from threading import Thread, Lock

PROJECT_DIR = pathlib.Path(__file__).parent
STATE_DIR = PROJECT_DIR / "state"
MESSAGES_LOG = STATE_DIR / "messages.jsonl"
RESPONSES_FILE = "/tmp/rec_responses.json"


def _load_secrets() -> dict:
    secrets_file = PROJECT_DIR / "secrets.env"
    if not secrets_file.exists():
        raise FileNotFoundError(
            "secrets.env not found. Copy secrets.env.example → secrets.env and fill in your values."
        )
    result = {}
    for line in secrets_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            result[key.strip()] = value.strip()
    return result


_secrets = _load_secrets()
BOT_TOKEN = _secrets["BOT_TOKEN"]
USER_CHAT_ID = int(_secrets.get("USER_CHAT_ID", "0"))

bot = telebot.TeleBot(BOT_TOKEN)
_log_lock = Lock()


def append_message(entry: dict):
    """Atomic append to the message log. Called from telebot worker threads."""
    entry["trust"] = "untrusted_input"
    with _log_lock:
        STATE_DIR.mkdir(exist_ok=True)
        with open(MESSAGES_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def pop_responses() -> list:
    if not os.path.exists(RESPONSES_FILE):
        return []
    with open(RESPONSES_FILE, "r", encoding="utf-8") as f:
        try:
            responses = json.load(f)
        except Exception:
            return []
    os.remove(RESPONSES_FILE)
    return responses


def parse_forwarded(message):
    fwd_from_name = "неизвестно"
    fwd_username = None
    fwd = getattr(message, "forward_origin", None)
    if fwd:
        otype = getattr(fwd, "type", None)
        if otype == "user":
            u = getattr(fwd, "sender_user", None)
            if u:
                fwd_from_name = " ".join(p for p in [u.first_name or "", u.last_name or ""] if p)
                fwd_username = getattr(u, "username", None)
        elif otype == "hidden_user":
            fwd_from_name = getattr(fwd, "sender_user_name", "скрытый пользователь")
        elif otype in ("chat", "channel"):
            chat = getattr(fwd, "sender_chat", None) or getattr(fwd, "chat", None)
            if chat:
                fwd_from_name = chat.title or "канал"
                fwd_username = getattr(chat, "username", None)
    elif getattr(message, "forward_from", None):
        u = message.forward_from
        fwd_from_name = " ".join(p for p in [u.first_name or "", u.last_name or ""] if p)
        fwd_username = getattr(u, "username", None)
    elif getattr(message, "forward_sender_name", None):
        fwd_from_name = message.forward_sender_name

    fwd_date = None
    if fwd:
        ts = getattr(fwd, "date", None)
        if ts:
            try:
                fwd_date = datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M")
            except Exception:
                fwd_date = None

    text = message.text or message.caption or ""
    return fwd_from_name, fwd_username, fwd_date, text


def sender_fields(message):
    """Pull the message's actual sender (not forwarded origin) — used for grouping by author."""
    u = getattr(message, "from_user", None)
    if not u:
        return {"from_id": None, "from_name": None, "from_username": None}
    name = " ".join(p for p in [getattr(u, "first_name", "") or "", getattr(u, "last_name", "") or ""] if p)
    return {
        "from_id": getattr(u, "id", None),
        "from_name": name or None,
        "from_username": getattr(u, "username", None),
    }


def response_poller():
    while True:
        try:
            responses = pop_responses()
            for r in responses:
                chat_id = r.get("chat_id")
                text = r.get("text", "")
                if chat_id and text:
                    bot.send_message(chat_id, text, parse_mode="Markdown")
        except Exception as e:
            print(f"[poller error] {e}")
        time.sleep(2)


_HELP = (
    "Это бот для записи рекомендаций мастеров в общий каталог.\n"
    "Пересылай сюда сообщения из чата — я их сохраню.\n\n"
    "Ничего другого не делаю: команд не исполняю, ничего не удаляю, "
    "никаких ответов на «выполни/покажи/удали» — это сделано осознанно."
)


@bot.message_handler(commands=["start", "help"])
def cmd_help(message):
    bot.reply_to(message, _HELP)


def base_entry(message) -> dict:
    """Common envelope for any captured message."""
    reply = getattr(message, "reply_to_message", None)
    return {
        "chat_id": message.chat.id,
        "message_id": message.message_id,
        "message_thread_id": getattr(message, "message_thread_id", None),
        "reply_to": reply.message_id if reply else None,
        "date": datetime.fromtimestamp(message.date).strftime("%Y-%m-%d %H:%M") if getattr(message, "date", None) else None,
        "received_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        **sender_fields(message),
    }


@bot.message_handler(
    func=lambda m: (
        getattr(m, "forward_origin", None) is not None
        or getattr(m, "forward_from", None) is not None
        or getattr(m, "forward_sender_name", None) is not None
        or getattr(m, "forward_from_chat", None) is not None
    )
)
def handle_forwarded(message):
    fwd_name, fwd_username, fwd_date, text = parse_forwarded(message)
    entry = base_entry(message)
    entry.update({
        "type": "forwarded",
        "fwd_from_name": fwd_name,
        "fwd_username": fwd_username,
        "fwd_date": fwd_date,
        "text": text,
    })
    append_message(entry)


@bot.message_handler(func=lambda m: True)
def handle_text(message):
    entry = base_entry(message)
    entry.update({
        "type": "message",
        "text": message.text or message.caption or "",
    })
    append_message(entry)


if __name__ == "__main__":
    print("Recommendations bot started")
    Thread(target=response_poller, daemon=True).start()
    bot.infinity_polling(timeout=30, long_polling_timeout=20)
