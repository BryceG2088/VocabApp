(() => {
  "use strict";
  const MIN = 60e3, DAY = 864e5;
  const $ = (id) => document.getElementById(id);

  // ---------- persistence (localStorage, tolerant of Safari private mode) ----------
  const KEY = "vocab.v1";
  const mem = {};
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return mem[KEY] || null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) { mem[KEY] = v; } },
  };
  let db = { cards: {}, settings: { newPerDay: 20, autoSpeak: false, guide: "all" }, daily: {} };
  try { const s = JSON.parse(store.get()); if (s) db = { ...db, ...s, settings: { ...db.settings, ...s.settings } }; } catch (e) {}
  const save = () => store.set(JSON.stringify(db));

  // ---------- scheduler ----------
  // card: {s:'new'|'learn'|'review', due, ivl (days), ease, step}
  const fresh = () => ({ s: "new", due: 0, ivl: 0, ease: 2.5, step: 0 });
  const round1 = (x) => Math.round(x * 10) / 10;

  // returns {due, next card state} for each rating: 0 repeat, 1 hard, 2 okay, 3 easy
  function schedule(c, r, now) {
    c = { ...c };
    if (c.s === "new" || c.s === "learn") {
      if (r === 0) { c.s = "learn"; c.step = 0; c.due = now + 1 * MIN; }
      else if (r === 1) { c.s = "learn"; c.due = now + 5 * MIN; }
      else if (r === 2) {
        if (c.step >= 1) { c.s = "review"; c.ivl = 1; c.due = now + DAY; }
        else { c.s = "learn"; c.step = 1; c.due = now + 10 * MIN; }
      } else { c.s = "review"; c.ivl = 4; c.due = now + 4 * DAY; }
    } else {
      if (r === 0) { c.s = "learn"; c.step = 0; c.ease = Math.max(1.3, round1(c.ease - 0.2)); c.ivl = Math.max(1, Math.round(c.ivl * 0.5)); c.due = now + 1 * MIN; }
      else {
        let ivl;
        if (r === 1) { ivl = c.ivl * 1.2; c.ease = Math.max(1.3, round1(c.ease - 0.15)); }
        else if (r === 2) { ivl = c.ivl * c.ease; }
        else { ivl = c.ivl * c.ease * 1.3; c.ease = round1(c.ease + 0.15); }
        c.ivl = Math.max(c.ivl + 1, Math.round(ivl));
        c.due = now + c.ivl * DAY;
      }
    }
    return c;
  }
  function label(c, r, now) {
    const n = schedule(c, r, now);
    const mins = Math.round((n.due - now) / MIN);
    if (n.s === "learn") return "≤" + mins + " min";
    const d = n.ivl;
    if (d >= 365) return round1(d / 365) + " yr";
    if (d >= 30) return round1(d / 30) + " mo";
    return d + (d === 1 ? " day" : " days");
  }

  // ---------- data / session ----------
  let vocab = [];
  let current = null, flipped = false, sessionTotal = 0, sessionDone = 0, ended = false;
  const today = () => new Date().toDateString();
  const newToday = () => (db.daily.date === today() ? db.daily.n : 0);
  const bumpNew = () => { db.daily = { date: today(), n: newToday() + 1 }; };
  const card = (h) => db.cards[h] || fresh();
  const deckOf = (v) => v.deck || (v.guide != null ? "Study guide " + v.guide : "Other");
  if (/^\d+$/.test(db.settings.guide)) db.settings.guide = "Study guide " + db.settings.guide; // older saved value
  const pool = () => vocab.filter((v) => db.settings.guide === "all" || deckOf(v) === db.settings.guide);

  function counts(now = Date.now()) {
    let learn = 0, due = 0, fresh_ = 0;
    for (const v of pool()) {
      const c = card(v.hanzi);
      if (c.s === "learn") { if (c.due <= now + 20 * MIN) learn++; }
      else if (c.s === "review") { if (c.due <= now) due++; }
      else fresh_++;
    }
    const newLeft = Math.min(fresh_, Math.max(0, db.settings.newPerDay - newToday()));
    return { learn, due, newLeft };
  }

  function pick(now = Date.now()) {
    const items = pool().map((v) => [v, card(v.hanzi)]);
    const byDue = (a, b) => a[1].due - b[1].due;
    const learning = items.filter(([, c]) => c.s === "learn" && c.due <= now + 20 * MIN).sort(byDue);
    const ready = learning.filter(([, c]) => c.due <= now);
    if (ready.length) return ready[0][0];
    const reviews = items.filter(([, c]) => c.s === "review" && c.due <= now).sort(byDue);
    if (reviews.length) return reviews[0][0];
    if (newToday() < db.settings.newPerDay) {
      const n = items.find(([, c]) => c.s === "new");
      if (n) return n[0];
    }
    return learning.length ? learning[0][0] : null;
  }

  function startSession() {
    ended = false; sessionDone = 0;
    const c = counts();
    sessionTotal = c.learn + c.due + c.newLeft;
    next();
  }

  function next() {
    current = ended ? null : pick();
    flipped = false;
    render();
    if (current && db.settings.autoSpeak) speak();
  }

  function rate(r) {
    const now = Date.now();
    const c = card(current.hanzi);
    if (c.s === "new") bumpNew();
    db.cards[current.hanzi] = schedule(c, r, now);
    save();
    sessionDone++;
    // cards that come straight back (learning steps) extend the session length
    const n = db.cards[current.hanzi];
    if (n.s === "learn") sessionTotal++;
    next();
  }

  // ---------- speech ----------
  function speak() {
    if (!current || !("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(current.hanzi.replace(/[()+/…：]/g, " "));
      u.lang = "zh-CN"; u.rate = 0.85;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ---------- render ----------
  const esc = (s) => s.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
  function render() {
    const face = $("face"), actions = $("actions"), pill = $("pill");
    const bar = $("bar");
    const pct = sessionTotal ? Math.min(1, sessionDone / sessionTotal) : 0;
    bar.style.width = `calc(${pct} * (100% - var(--dot)) + var(--dot))`;

    if (!current) {
      const c = counts();
      pill.classList.add("hide"); $("speak").style.visibility = "hidden";
      face.className = "face";
      face.innerHTML = `<div class="done">${sessionDone ? "Session complete 🎉" : "All caught up 🎉"}<small>${sessionDone} cards reviewed</small><small>${pool().length} cards in deck</small></div>`;
      actions.innerHTML = `<button class="flip" id="again">Study more</button>`;
      $("again").onclick = () => { db.daily = { date: today(), n: Math.max(0, newToday() - 5) }; startSession(); };
      return;
    }
    $("speak").style.visibility = "visible";
    const c = card(current.hanzi);
    pill.classList.toggle("hide", c.s === "new" ? false : true);
    if (c.s === "learn") { pill.textContent = "Learning"; pill.classList.remove("hide"); }
    else pill.textContent = "New";

    if (!flipped) {
      face.className = "face front";
      face.textContent = current.hanzi;
      actions.innerHTML = `<button class="flip" id="flip">Flip</button>`;
      $("flip").onclick = flip;
    } else {
      face.className = "face back";
      face.innerHTML = `<span class="py">${esc(current.pinyin)}</span><span class="en">${esc(current.english)}</span>`;
      const now = Date.now();
      const names = ["Repeat", "Hard", "Okay", "Easy"];
      actions.innerHTML = `<div class="rate">${names.map((n, i) =>
        `<div class="c"><button data-r="${i}">${n}</button><span>${label(c, i, now)}</span></div>`).join("")}</div>`;
      actions.querySelectorAll("button").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); rate(+b.dataset.r); }));
    }
  }
  function flip() { if (current) { flipped = !flipped; render(); } }

  // ---------- sheets ----------
  function openSheet(html, bind) {
    $("panel").innerHTML = html;
    $("sheet").classList.remove("hidden");
    bind && bind($("panel"));
  }
  const closeSheet = () => $("sheet").classList.add("hidden");

  function deckSheet() {
    const decks = [...new Set(vocab.map(deckOf))];
    const row = (val, name, n) => `<button class="opt ${db.settings.guide === val ? "sel" : ""}" data-g="${esc(val)}"><span>${esc(name)}<small>${n} terms</small></span></button>`;
    openSheet(`<h2>Deck</h2>${row("all", "All terms", vocab.length)}${decks.map((d) =>
      row(d, d, vocab.filter((v) => deckOf(v) === d).length)).join("")}`, (p) =>
      p.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { db.settings.guide = b.dataset.g; save(); closeSheet(); startSession(); })));
  }

  function settingsSheet() {
    const c = counts();
    openSheet(`<h2>Settings</h2>
      <label>New cards per day <input id="npd" type="number" min="0" max="500" value="${db.settings.newPerDay}"></label>
      <label>Speak card when shown <input id="auto" type="checkbox" ${db.settings.autoSpeak ? "checked" : ""}></label>
      <label><span>Due now</span><span>${c.due + c.learn} review · ${c.newLeft} new</span></label>
      <button class="pbtn" id="exp">Export progress</button>
      <button class="pbtn" id="imp">Import progress</button>
      <textarea id="io" placeholder="Exported progress appears here; paste to import" hidden></textarea>
      <button class="pbtn danger" id="reset">Reset all progress</button>
      <button class="pbtn" id="ok">Done</button>`, (p) => {
      const io = p.querySelector("#io");
      p.querySelector("#npd").onchange = (e) => { db.settings.newPerDay = Math.max(0, +e.target.value || 0); save(); };
      p.querySelector("#auto").onchange = (e) => { db.settings.autoSpeak = e.target.checked; save(); };
      p.querySelector("#exp").onclick = () => { io.hidden = false; io.value = JSON.stringify(db); io.select(); try { navigator.clipboard.writeText(io.value); } catch (e) {} };
      p.querySelector("#imp").onclick = () => {
        if (io.hidden) { io.hidden = false; io.value = ""; io.focus(); return; }
        try { const d = JSON.parse(io.value); if (!d.cards) throw 0; db = { ...db, ...d, settings: { ...db.settings, ...d.settings } }; save(); closeSheet(); startSession(); }
        catch (e) { alert("That doesn't look like exported progress."); }
      };
      p.querySelector("#reset").onclick = () => { if (confirm("Erase all progress?")) { db.cards = {}; db.daily = {}; save(); closeSheet(); startSession(); } };
      p.querySelector("#ok").onclick = () => { closeSheet(); startSession(); };
    });
  }

  // ---------- wiring ----------
  $("card").addEventListener("click", (e) => { if (!e.target.closest("#speak")) flip(); });
  $("card").addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); } });
  $("speak").onclick = (e) => { e.stopPropagation(); speak(); };
  $("deckBtn").onclick = deckSheet;
  $("gearBtn").onclick = settingsSheet;
  $("closeBtn").onclick = () => { ended = true; current = null; render(); };
  $("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) { closeSheet(); } });
  document.addEventListener("keydown", (e) => {
    if (!$("sheet").classList.contains("hidden")) return;
    if (!flipped && (e.key === " " || e.key === "Enter")) return;
    if (flipped && "1234".includes(e.key)) rate(+e.key - 1);
  });

  fetch("vocab.json").then((r) => r.json()).then((v) => { vocab = v; startSession(); })
    .catch(() => { $("face").textContent = "Could not load vocab.json"; });
})();
