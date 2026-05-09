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

const linkify = s => escape(s).replace(/(https?:\/\/[^\s<]+)/g,
  '<a href="$1" target="_blank" rel="noopener">$1</a>');

const tgLink = handle => {
  const m = String(handle).match(/^@?([a-zA-Z0-9_]{4,32})$/);
  return m ? `<a href="https://t.me/${m[1]}" target="_blank" rel="noopener">@${m[1]}</a>` : escape(handle);
};

const phoneLink = p => {
  const digits = p.replace(/[^\d+]/g, "");
  return `<a href="tel:${digits}">${escape(p)}</a>`;
};

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

function renderCats() {
  const counts = new Map();
  for (const it of STATE.data.items)
    for (const c of it.categories) counts.set(c, (counts.get(c) || 0) + 1);

  const cats = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  $("#cat-chips").innerHTML = cats.map(([c, n]) =>
    `<button class="chip" data-cat="${escape(c)}">${escape(c)}<span class="count">${n}</span></button>`
  ).join("");

  $$("#cat-chips .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const c = btn.dataset.cat;
      if (STATE.cats.has(c)) STATE.cats.delete(c);
      else STATE.cats.add(c);
      btn.classList.toggle("active");
      render();
    });
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

function highlight(text) {
  if (!STATE.search) return escape(text);
  const q = STATE.search;
  const parts = String(text).split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((p, i) =>
    i % 2 ? `<mark class="hl">${escape(p)}</mark>` : escape(p)
  ).join("");
}

function cardHtml(it) {
  const cats = it.categories.slice(0, 4).map(c =>
    `<span class="cat">${highlight(c)}</span>`).join("");
  const moreCats = it.categories.length > 4 ? `<span class="cat">+${it.categories.length - 4}</span>` : "";

  const phoneRow = it.phones.length
    ? `<div class="contact-row"><span class="ic">☎</span><span class="val phone">${phoneLink(it.phones[0])}${it.phones.length > 1 ? ` <span style="opacity:.5">+${it.phones.length - 1}</span>` : ""}</span></div>`
    : "";

  const tgRow = it.messenger
    ? `<div class="contact-row"><span class="ic">✦</span><span class="val">${tgLink(it.messenger)}</span></div>`
    : "";

  const linkRow = it.links.length
    ? `<div class="contact-row"><span class="ic">↗</span><span class="val">${linkify(it.links[0])}</span></div>`
    : "";

  const contacts = (phoneRow + tgRow + linkRow)
    ? `<div class="contacts">${phoneRow}${tgRow}${linkRow}</div>` : "";

  return `
    <article class="card" data-type="${escape(it.type)}">
      <div class="card-head">
        <div class="card-master">${highlight(it.master || "(без имени)")}</div>
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
  const list = STATE.data.items.filter(matches);
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
    ? `<ul>${it.links.map(l => `<li>${linkify(l)}</li>`).join("")}</ul>` : "";
  const tg = it.messenger ? `<p>${tgLink(it.messenger)}</p>` : "";

  $("#modal-body").innerHTML = `
    <div class="m-master">${escape(it.master || "(без имени)")}</div>
    <div class="m-line">
      <span class="type-badge ${escape(it.type)}">${escape(it.type || "—")}</span>
      ${it.categories.map(c => `<span class="cat" style="font-size:11px;padding:3px 8px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;color:var(--text-dim)">${escape(c)}</span>`).join("")}
    </div>
    <div class="m-line">
      <span>от: <b style="color:var(--text)">${escape(it.recommender)}</b></span>
      ${it.plot ? `<span>· уч. <b style="color:var(--text)">${escape(it.plot)}</b></span>` : ""}
      ${it.date ? `<span>· ${escape(it.date)}</span>` : ""}
    </div>

    <div class="m-section">
      <h3>контакты</h3>
      ${phones}
      ${tg}
      ${links}
    </div>

    ${it.description ? `<div class="m-section"><h3>что делал</h3><p>${escape(it.description)}</p></div>` : ""}
    ${it.review ? `<div class="m-section"><h3>оценка</h3><p>${escape(it.review)}</p></div>` : ""}
    ${it.caveats ? `<div class="m-section"><h3>оговорки</h3><p>${escape(it.caveats)}</p></div>` : ""}
    ${it.source ? `<div class="m-section"><h3>исходное сообщение</h3><div class="source">${linkify(it.source)}</div></div>` : ""}
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
