"""Read 'Рекомендации' tab and write web/data.json for the static site."""
import json
import pathlib
import re
import gspread
from google.oauth2.service_account import Credentials

PROJ = pathlib.Path(__file__).parent
WEB = PROJ / "web"


def load_secrets():
    out = {}
    for line in (PROJ / "secrets.env").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip()
    return out


def split_csv(s: str) -> list[str]:
    if not s:
        return []
    parts = re.split(r"\s*[,;]\s*", s.strip())
    return [p for p in parts if p]


def split_phones(s: str) -> list[str]:
    if not s:
        return []
    found = re.findall(r"(\+?\d[\d\s()\-]{7,}\d)", s)
    return [re.sub(r"\s+", " ", p).strip() for p in found] or ([s.strip()] if s.strip() else [])


def split_links(s: str) -> list[str]:
    if not s:
        return []
    return re.findall(r"https?://\S+", s) or ([s.strip()] if s.strip() else [])


def main():
    s = load_secrets()
    creds = Credentials.from_service_account_file(
        str(PROJ / "service_account.json"),
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(s["GOOGLE_SHEETS_ID"])
    ws = sh.worksheet("Рекомендации")
    rows = ws.get_all_values()
    if not rows:
        raise SystemExit("empty sheet")

    headers = rows[0]
    items = []
    for raw in rows[1:]:
        if not any(c.strip() for c in raw):
            continue
        raw = raw + [""] * (len(headers) - len(raw))
        item = {
            "date": raw[0].strip(),
            "recommender": raw[1].strip(),
            "type": raw[2].strip().lower(),
            "master": raw[3].strip(),
            "phones": split_phones(raw[4]),
            "messenger": raw[5].strip(),
            "links": split_links(raw[6]),
            "categories": split_csv(raw[7]),
            "description": raw[8].strip(),
            "review": raw[9].strip(),
            "caveats": raw[10].strip(),
            "plot": raw[11].strip(),
            "source": raw[12].strip(),
        }
        items.append(item)

    items.sort(key=lambda x: x["date"], reverse=True)

    all_cats = sorted({c for it in items for c in it["categories"]})

    out = {
        "generated_at": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M"),
        "items": items,
        "categories": all_cats,
    }
    WEB.mkdir(exist_ok=True)
    (WEB / "data.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(items)} items, {len(all_cats)} categories → {WEB / 'data.json'}")


if __name__ == "__main__":
    main()
