#!/bin/bash
# Recommendations bot + queue setup

PROJ="$(cd "$(dirname "$0")" && pwd)"
PYTHON="$PROJ/.venv/bin/python"
BOT="$PROJ/recommendations_bot.py"
LOG="$PROJ/bot.log"

if [ ! -f "$PROJ/secrets.env" ]; then
    echo "[startup] ERROR: secrets.env not found."
    exit 1
fi

if [ ! -f "$PROJ/service_account.json" ]; then
    echo "[startup] ERROR: service_account.json not found."
    exit 1
fi

if [ ! -f "$PYTHON" ]; then
    echo "[startup] Creating venv and installing dependencies..."
    uv venv "$PROJ/.venv"
    uv pip install --python "$PYTHON" -r "$PROJ/requirements.txt"
fi

if ! "$PYTHON" -c "import telebot, gspread, google.auth" 2>/dev/null; then
    echo "[startup] Installing missing dependencies..."
    uv pip install --python "$PYTHON" -r "$PROJ/requirements.txt"
fi

PGREP_PATTERN="bin/python.*recommendations_bot\.py$"
if ! pgrep -f "$PGREP_PATTERN" > /dev/null; then
    "$PYTHON" "$BOT" >> "$LOG" 2>&1 &
    sleep 2
    echo "[startup] Bot started (PID $(pgrep -f "$PGREP_PATTERN"))"
else
    echo "[startup] Bot already running (PID $(pgrep -f "$PGREP_PATTERN"))"
fi

touch /tmp/rec_trigger.log
echo "[startup] Ready."
