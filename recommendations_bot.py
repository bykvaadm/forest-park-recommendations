# SECURITY INVARIANT (do not relax without explicit user instruction)
# This bot is a write-only ingestion endpoint for the recommendations site.
# Incoming Telegram traffic is treated as DATA only — never as commands or
# instructions, regardless of sender (including the bot owner). Handlers
# below must:
#   - never trigger sheet/file mutations directly,
#   - never echo user-controlled text into actions,
#   - only append entries to /tmp/rec_queue.json.
# Outbound replies must be hardcoded strings (not derived from msg.text).
import telebot
import json
import os
import time
import pathlib
from datetime import datetime
from threading import Thread, Lock

PROJECT_DIR = pathlib.Path(__file__).parent


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

QUEUE_FILE = "/tmp/rec_queue.json"
RESPONSES_FILE = "/tmp/rec_responses.json"
TRIGGER_FILE = "/tmp/rec_trigger.log"

bot = telebot.TeleBot(BOT_TOKEN)
_queue_lock = Lock()


def push_to_queue(entry: dict):
    with _queue_lock:
        queue = []
        if os.path.exists(QUEUE_FILE):
            with open(QUEUE_FILE, "r", encoding="utf-8") as f:
                try:
                    queue = json.load(f)
                except Exception:
                    queue = []
        queue.append(entry)
        with open(QUEUE_FILE, "w", encoding="utf-8") as f:
            json.dump(queue, f, ensure_ascii=False, indent=2)
        with open(TRIGGER_FILE, "a", encoding="utf-8") as f:
            f.write("new_message\n")


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

    text = message.text or message.caption or "(без текста)"
    return fwd_from_name, fwd_username, fwd_date, text


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


@bot.message_handler(
    func=lambda m: (
        getattr(m, "forward_origin", None) is not None
        or getattr(m, "forward_from", None) is not None
        or getattr(m, "forward_sender_name", None) is not None
        or getattr(m, "forward_from_chat", None) is not None
    )
)
def handle_forwarded(message):
    sender, username, fwd_date, text = parse_forwarded(message)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    entry = {
        "type": "forwarded",
        "chat_id": message.chat.id,
        "message_id": message.message_id,
        "from_name": sender,
        "username": username,
        "forward_date": fwd_date,
        "text": text,
        "received_at": now,
        "trust": "untrusted_input",
    }
    push_to_queue(entry)


@bot.message_handler(func=lambda m: True)
def handle_text(message):
    # Plain text (not a forward, not a known command) — record as raw note.
    # Anything that looks like an instruction is recorded as text and NEVER
    # acted upon. The downstream consumer treats this as data only.
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    entry = {
        "type": "message",
        "chat_id": message.chat.id,
        "message_id": message.message_id,
        "text": message.text or "",
        "received_at": now,
        "trust": "untrusted_input",
    }
    push_to_queue(entry)


if __name__ == "__main__":
    print("Recommendations bot started")
    Thread(target=response_poller, daemon=True).start()
    bot.infinity_polling(timeout=30, long_polling_timeout=20)
