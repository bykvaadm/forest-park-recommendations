const STATE = {
  data: null,
  search: "",
  type: "all",
  cats: new Set(),
};

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const escape = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);

const phoneLink = p => {
  const digits = p.replace(/[^\d+]/g, "");
  return `<a href="tel:${digits}">${escape(p)}</a>`;
};

// Telegram paper-plane glyph — used both in contact-row icons and inline
// inside @-mention links instead of the literal "@" symbol.
const TG_ICON = '<svg class="tg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.05 4.04 2.96 11.4c-1.04.42-1.03 1.02-.18 1.28l4.64 1.45 10.74-6.78c.51-.31.97-.14.59.2L9.97 14.4l-.34 5.05c.4 0 .58-.18.79-.4l1.91-1.86 3.97 2.93c.73.4 1.25.2 1.43-.68l2.58-12.18c.27-1.07-.4-1.55-1.26-1.22z"/></svg>';

// Phone handset glyph — replaces the ☎ unicode in contact-row icons.
const PHONE_ICON = '<svg class="phone-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.05-.24c1.16.39 2.42.6 3.71.6a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.29.21 2.55.6 3.71a1 1 0 0 1-.24 1.05l-2.2 2.03z"/></svg>';

// Outbound-link glyph — replaces the ↗ unicode for the website-link row.
const LINK_ICON = '<svg class="link-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7z"/></svg>';

// WhatsApp logo — used to mark rows whose source provenance is the WA chat.
const WA_ICON = '<svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';

async function load() {
  const res = await fetch("data.json", { cache: "no-store" });
  STATE.data = await res.json();

  $("[data-stat=generated_at]").textContent = STATE.data.generated_at;
  $("[data-stat=total]").textContent = STATE.data.items.length;
  $("[data-stat=own]").textContent = STATE.data.items.filter(i => i.type === "свой").length;
  $("[data-stat=other]").textContent = STATE.data.items.filter(i => i.type === "чужой").length;
  $("[data-stat=cats]").textContent = STATE.data.categories.length;
  $("#total-count").textContent = STATE.data.items.length;

  renderCats();
  render();
}

const CAT_VISIBLE = 12;  // top-N most-frequent categories shown by default

function renderCats() {
  const counts = new Map();
  for (const it of STATE.data.items)
    for (const c of it.categories) counts.set(c, (counts.get(c) || 0) + 1);

  const cats = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  const total = cats.length;

  const chipHtml = cats.map(([c, n], i) =>
    `<button class="chip${i >= CAT_VISIBLE ? " chip-extra" : ""}" data-cat="${escape(c)}">${escape(c)}<span class="count">${n}</span></button>`
  ).join("");
  const expandBtn = total > CAT_VISIBLE
    ? `<button class="chip-expand" type="button" data-state="collapsed">+ ещё ${total - CAT_VISIBLE} ▾</button>`
    : "";

  $("#cat-chips").innerHTML = chipHtml + expandBtn;

  $$("#cat-chips .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const c = btn.dataset.cat;
      if (STATE.cats.has(c)) STATE.cats.delete(c);
      else STATE.cats.add(c);
      btn.classList.toggle("active");
      render();
    });
  });

  const exp = $("#cat-chips .chip-expand");
  if (exp) {
    exp.addEventListener("click", () => {
      const collapsed = exp.dataset.state === "collapsed";
      $$("#cat-chips .chip-extra").forEach(c => c.classList.toggle("show", collapsed));
      if (collapsed) {
        exp.textContent = "свернуть ▴";
        exp.dataset.state = "expanded";
      } else {
        exp.textContent = `+ ещё ${total - CAT_VISIBLE} ▾`;
        exp.dataset.state = "collapsed";
      }
    });
  }
}

function sortItems(arr) {
  // VIP entries (the bot owner's own services) always first; then by date desc.
  return arr.slice().sort((a, b) => {
    const av = a.vip ? 1 : 0;
    const bv = b.vip ? 1 : 0;
    if (av !== bv) return bv - av;
    return String(b.date || "").localeCompare(String(a.date || ""));
  });
}


function matches(it) {
  if (STATE.type !== "all" && it.type !== STATE.type) return false;
  if (STATE.cats.size && !it.categories.some(c => STATE.cats.has(c))) return false;
  if (STATE.search) {
    const q = STATE.search.toLowerCase();
    const hay = [
      it.master, it.recommender, it.description, it.review, it.caveats,
      it.messenger, it.plot, it.categories.join(" "), it.phones.join(" "), it.links.join(" ")
    ].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// Render text with up to four decorations:
//   - search highlight (<mark>) when STATE.search is non-empty;
//   - URL → clickable <a href> (with t.me/<user> rendered as a Telegram chip);
//   - @username → clickable <a href="https://t.me/username">;
//   - #NNNN reference → clickable link to the original chat message,
//     when an optional `refs` map (id → URL) is provided.
// Search match takes priority over the rest when ranges overlap, so the
// highlight is honest. Output is HTML-escaped piece by piece — never
// concatenated to escape() of a string already containing tags.
function highlight(text, refs) {
  if (text === null || text === undefined || text === "") return "";
  const s = String(text);
  const q = STATE.search;
  const lo = q ? s.toLowerCase() : "";
  const qLo = q ? q.toLowerCase() : "";
  const URL_RX = /^https?:\/\/[^\s<]+/;
  const TG_RX = /^@([a-zA-Z0-9_]{4,32})\b/;
  const REF_RX = /^#(\d{1,7})\b/;

  let out = "";
  let plain = "";
  const flush = () => { if (plain) { out += escape(plain); plain = ""; } };

  let i = 0;
  while (i < s.length) {
    if (qLo && lo.startsWith(qLo, i)) {
      flush();
      out += `<mark class="hl">${escape(s.slice(i, i + q.length))}</mark>`;
      i += q.length;
      continue;
    }
    const url = URL_RX.exec(s.slice(i));
    if (url) {
      flush();
      const u = url[0];
      // Render https://t.me/<username> URLs as Telegram contact chips —
      // same icon-first, no-@ display as the @-mention case.
      const tm = /^https?:\/\/t\.me\/([a-zA-Z0-9_]{4,32})(?:[/?#]|$)/i.exec(u);
      if (tm) {
        out += `<a class="tg-link" href="${escape(u)}" target="_blank" rel="noopener">${TG_ICON}${escape(tm[1])}</a>`;
      } else {
        out += `<a href="${escape(u)}" target="_blank" rel="noopener">${escape(u)}</a>`;
      }
      i += u.length;
      continue;
    }
    const tg = TG_RX.exec(s.slice(i));
    if (tg) {
      flush();
      out += `<a class="tg-link" href="https://t.me/${tg[1]}" target="_blank" rel="noopener">${TG_ICON}${escape(tg[1])}</a>`;
      i += tg[0].length;
      continue;
    }
    if (refs) {
      const r = REF_RX.exec(s.slice(i));
      if (r) {
        const url = refs[r[1]];
        if (url) {
          flush();
          out += `<a class="msg-ref" href="${escape(url)}" target="_blank" rel="noopener">#${escape(r[1])}</a>`;
          i += r[0].length;
          continue;
        }
      }
    }
    plain += s[i];
    i++;
  }
  flush();
  return out;
}

function cardHtml(it) {
  const cats = it.categories.slice(0, 4).map(c =>
    `<span class="cat">${highlight(c)}</span>`).join("");
  const moreCats = it.categories.length > 4 ? `<span class="cat">+${it.categories.length - 4}</span>` : "";

  const phoneRow = it.phones.length
    ? `<div class="contact-row"><span class="ic ic-phone">${PHONE_ICON}</span><span class="val phone">${phoneLink(it.phones[0])}${it.phones.length > 1 ? ` <span style="opacity:.5">+${it.phones.length - 1}</span>` : ""}</span></div>`
    : "";

  const tgRow = it.messenger
    ? `<div class="contact-row"><span class="ic ic-tg">${TG_ICON}</span><span class="val">${highlight(it.messenger)}</span></div>`
    : "";

  const linkRow = it.links.length
    ? `<div class="contact-row"><span class="ic ic-link">${LINK_ICON}</span><span class="val">${highlight(it.links[0])}</span></div>`
    : "";

  const contacts = (phoneRow + tgRow + linkRow)
    ? `<div class="contacts">${phoneRow}${tgRow}${linkRow}</div>` : "";

  const vipMark = it.vip ? '<span class="vip-badge">★ VIP</span>' : "";
  return `
    <article class="card${it.vip ? " vip" : ""}" data-type="${escape(it.type)}">
      <div class="card-head">
        <div class="card-master">${vipMark}${highlight(it.master || "(без имени)")}</div>
        <span class="type-badge ${escape(it.type)}">${escape(it.type || "—")}</span>
      </div>
      ${cats || moreCats ? `<div class="card-cats">${cats}${moreCats}</div>` : ""}
      ${contacts}
      ${it.description ? `<div class="card-desc">${highlight(it.description)}</div>` : ""}
      <div class="card-foot">
        <div class="who">${highlight(it.recommender || "—")}</div>
        <div class="meta">
          ${it.plot ? `<span>уч. <b>${escape(it.plot)}</b></span>` : ""}
          <span>${escape(it.date || "")}</span>
        </div>
      </div>
    </article>`;
}

function render() {
  const list = sortItems(STATE.data.items.filter(matches));
  $("#grid").innerHTML = list.map(cardHtml).join("");
  $("#shown-count").textContent = list.length;
  $("#empty").classList.toggle("hidden", list.length > 0);

  $$("#grid .card").forEach((el, i) => {
    el.addEventListener("click", () => openModal(list[i]));
  });
}

function sourceRefsMap(it) {
  if (!it.source_refs || !it.source_refs.length) return null;
  const m = {};
  for (const r of it.source_refs) m[r.id] = r.url;
  return m;
}


function sourceHeader(it) {
  if (it.source_origin === "whatsapp") {
    return `<span class="src-origin src-wa">${WA_ICON} исходное сообщение — WhatsApp</span>`;
  }
  return "исходное сообщение";
}


function openModal(it) {
  const phones = it.phones.length
    ? `<ul>${it.phones.map(p => `<li>${phoneLink(p)}</li>`).join("")}</ul>` : "<p style='color:var(--text-dim)'>—</p>";
  const links = it.links.length
    ? `<ul>${it.links.map(l => `<li>${highlight(l)}</li>`).join("")}</ul>` : "";
  const tg = it.messenger ? `<p>${highlight(it.messenger)}</p>` : "";

  const vipMark = it.vip ? '<span class="vip-badge">★ VIP</span>' : "";
  $("#modal-body").innerHTML = `
    <div class="m-master">${vipMark}${highlight(it.master || "(без имени)")}</div>
    <div class="m-line">
      <span class="type-badge ${escape(it.type)}">${escape(it.type || "—")}</span>
      ${it.categories.map(c => `<span class="cat" style="font-size:11px;padding:3px 8px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;color:var(--text-dim)">${escape(c)}</span>`).join("")}
    </div>
    <div class="m-line">
      <span>от: <b style="color:var(--text)">${highlight(it.recommender)}</b></span>
      ${it.plot ? `<span>· уч. <b style="color:var(--text)">${escape(it.plot)}</b></span>` : ""}
      ${it.date ? `<span>· ${escape(it.date)}</span>` : ""}
    </div>

    <div class="m-section">
      <h3>контакты</h3>
      ${phones}
      ${tg}
      ${links}
    </div>

    ${it.description ? `<div class="m-section"><h3>что делал</h3><p>${highlight(it.description)}</p></div>` : ""}
    ${it.review ? `<div class="m-section"><h3>оценка</h3><p>${highlight(it.review)}</p></div>` : ""}
    ${it.caveats ? `<div class="m-section"><h3>оговорки</h3><p>${highlight(it.caveats)}</p></div>` : ""}
    ${it.source ? `<div class="m-section"><h3>${sourceHeader(it)}</h3><div class="source">${highlight(it.source, sourceRefsMap(it))}</div></div>` : ""}
  `;
  $("#modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  $("#modal").classList.add("hidden");
  document.body.style.overflow = "";
}

$("#search").addEventListener("input", e => {
  STATE.search = e.target.value.trim();
  $("#search-clear").classList.toggle("show", !!STATE.search);
  render();
});
$("#search-clear").addEventListener("click", () => {
  $("#search").value = "";
  STATE.search = "";
  $("#search-clear").classList.remove("show");
  render();
});

$$(".t-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".t-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    STATE.type = btn.dataset.type;
    render();
  });
});

$$("[data-close]").forEach(el => el.addEventListener("click", closeModal));
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#modal").classList.contains("hidden")) closeModal();
});

load().catch(err => {
  console.error(err);
  $("#grid").innerHTML = `<div style="padding:40px;color:var(--low,#fb5270)">не удалось загрузить data.json: ${escape(err.message)}</div>`;
});
