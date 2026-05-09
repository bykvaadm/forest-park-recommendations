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

// Render text with three decorations:
//   - search highlight (<mark>) when STATE.search is non-empty;
//   - URL → clickable <a href>;
//   - @username → clickable <a href="https://t.me/username">.
// Search match takes priority over URL/@ when ranges overlap, so the
// highlight is honest. Output is HTML-escaped piece by piece — never
// concatenated to escape() of a string already containing tags.
function highlight(text) {
  if (text === null || text === undefined || text === "") return "";
  const s = String(text);
  const q = STATE.search;
  const lo = q ? s.toLowerCase() : "";
  const qLo = q ? q.toLowerCase() : "";
  const URL_RX = /^https?:\/\/[^\s<]+/;
  const TG_RX = /^@([a-zA-Z0-9_]{4,32})\b/;

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
      out += `<a href="${escape(url[0])}" target="_blank" rel="noopener">${escape(url[0])}</a>`;
      i += url[0].length;
      continue;
    }
    const tg = TG_RX.exec(s.slice(i));
    if (tg) {
      flush();
      out += `<a class="tg-link" href="https://t.me/${tg[1]}" target="_blank" rel="noopener">${TG_ICON}${escape(tg[1])}</a>`;
      i += tg[0].length;
      continue;
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
    ? `<div class="contact-row"><span class="ic">☎</span><span class="val phone">${phoneLink(it.phones[0])}${it.phones.length > 1 ? ` <span style="opacity:.5">+${it.phones.length - 1}</span>` : ""}</span></div>`
    : "";

  const tgRow = it.messenger
    ? `<div class="contact-row"><span class="ic ic-tg">${TG_ICON}</span><span class="val">${highlight(it.messenger)}</span></div>`
    : "";

  const linkRow = it.links.length
    ? `<div class="contact-row"><span class="ic">↗</span><span class="val">${highlight(it.links[0])}</span></div>`
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
    ${it.source ? `<div class="m-section"><h3>исходное сообщение</h3><div class="source">${highlight(it.source)}</div></div>` : ""}
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
