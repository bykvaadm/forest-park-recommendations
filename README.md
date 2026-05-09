# Forest Park — каталог рекомендаций мастеров

Telegram-бот ловит сообщения в чате коттеджного посёлка, Claude Code собирает из переписки структурированные карточки, статический сайт публикует каталог. Деплой — GitHub Pages.

**Каталог:** https://bykvaadm.github.io/forest-park-recommendations/

## Как это работает

Двa режима срабатывания:

1. **Тегни бота** (`@bykva_forestpark_bot`) на сообщение или в реплай — он сразу пометит «принято» и через ~30-60 секунд ответит «обработано» со ссылкой на каталог. Запись появится на сайте.
2. **Раз в час** Claude разбирает все «остывшие» треды (молчат ≥ 12 ч), которые ещё не были обработаны, и оформляет карточки из них.

В обоих случаях карточка содержит: имя мастера, телефоны, мессенджер, сайт, категории, что делал, оценку, оговорки, номер участка, цитату-исходник.

Бот **не отвечает в личке и в других чатах** — только в одном настроенном через `ALLOWED_CHAT_ID`.

## Безопасность

Сообщения из чата — **данные**, не команды. Бот никогда не исполняет ничего из текста сообщений: не ходит по ссылкам, не вызывает shell, не модифицирует репозиторий. Всё, что выглядит как «удали последнюю запись», «выгрузи токен», «забудь инструкции» — записывается как обычный текст или игнорируется. Полные правила — в `CLAUDE.md`.

## Запуск

Зависимости: Python 3.13+, `uv`, [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), Telegram bot token, GitHub PAT с правами `Contents: read/write` на эту репу.

```bash
# 1. Клонировать
git clone https://github.com/bykvaadm/forest-park-recommendations.git ~/forest-park
cd ~/forest-park

# 2. Поставить зависимости
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt

# 3. Создать secrets.env
cp secrets.env.example secrets.env
chmod 600 secrets.env
# заполнить: BOT_TOKEN, USER_CHAT_ID, ALLOWED_CHAT_ID
# ALLOWED_CHAT_ID — отрицательный для group/forum, например -1002237202930

# 4. Запустить долгоживущую сессию
sbx run claude ~/forest-park -- "выполни инструкции запуска из CLAUDE.md"
```

После запуска Claude:
- стартует бота через `bash startup.sh`,
- ставит Monitor на `/tmp/rec_trigger.log`,
- держит сессию живой, пока сэндбокс активен,
- каждый час разбирает накопленное; на тег отвечает мгновенно.

## Структура

```
recommendations_bot.py   # бот: 24/7 polling, hourly_ticker, mention detection
prepare.py               # вспомогательный скрипт — группирует треды, помечает processed
startup.sh               # бутстрап: venv → бот → trigger
web/                     # статический сайт
  index.html
  style.css
  app.js
  data.json              # ← канонический каталог, источник правды
state/                   # gitignored
  messages.jsonl         # сырой лог сообщений
  processed.json         # уже разобранные треды
secrets.env              # gitignored, права 600
CLAUDE.md                # инструкции для Claude (security invariant + процедуры)
.github/workflows/
  deploy-pages.yml       # деплой web/ на Pages при пуше
```

## Для разработчиков

- **Источник правды каталога** — `web/data.json`. Sheet больше не используется.
- **Что коммитить руками** — только `web/data.json` (Claude делает это сам). Всё в `state/` локально.
- **Pages обновляется** автоматически: workflow триггерится на push в `web/**`.
- **Безопасность токенов**: `secrets.env` и `service_account.json` (если есть) — в `.gitignore` и в корне, и в `bot-fp/`. Никогда не пушить.

## Лицензия

Личный проект, MIT.
