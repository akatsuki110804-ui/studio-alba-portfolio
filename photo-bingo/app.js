(() => {
  "use strict";

  const CONFIG = window.BINGO_CONFIG;
  const MISSIONS = CONFIG.missions;
  const SIZE = 5;
  const MAX_EDGE = 1600; // 保存時に長辺をこのピクセルまで縮小
  const LINES = buildLines();

  const view = document.getElementById("view");
  const toastEl = document.getElementById("toast");
  document.getElementById("subtitle").textContent = `〜 ${CONFIG.subtitle} 〜`;

  // ---------- 保存（IndexedDB） ----------
  // entries: Map<id, { id, blob, memo, at }>
  const entries = new Map();
  const urls = new Map();
  let db = null;

  function openDb() {
    return new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(CONFIG.storageKey, 1);
      } catch {
        return resolve(null);
      }
      req.onupgradeneeded = () => req.result.createObjectStore("entries", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  function tx(mode, fn) {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = db.transaction("entries", mode);
      const result = fn(t.objectStore("entries"));
      t.oncomplete = () => resolve(result && result.result);
      t.onerror = () => reject(t.error);
    });
  }

  async function loadAll() {
    const all = (await tx("readonly", (s) => s.getAll())) || [];
    for (const e of all) setEntry(e);
  }

  function setEntry(e) {
    if (urls.has(e.id)) URL.revokeObjectURL(urls.get(e.id));
    urls.delete(e.id);
    entries.set(e.id, e);
    if (e.blob) urls.set(e.id, URL.createObjectURL(e.blob));
  }

  async function saveEntry(e) {
    setEntry(e);
    await tx("readwrite", (s) => s.put(e));
  }

  async function removeEntry(id) {
    if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
    urls.delete(id);
    entries.delete(id);
    await tx("readwrite", (s) => s.delete(id));
  }

  // ---------- 達成・ビンゴ判定 ----------
  function isDone(id) {
    return !!MISSIONS[id].free || !!(entries.get(id) && entries.get(id).blob);
  }

  function buildLines() {
    const lines = [];
    for (let r = 0; r < SIZE; r++) lines.push([...Array(SIZE)].map((_, c) => r * SIZE + c));
    for (let c = 0; c < SIZE; c++) lines.push([...Array(SIZE)].map((_, r) => r * SIZE + c));
    lines.push([...Array(SIZE)].map((_, i) => i * SIZE + i));
    lines.push([...Array(SIZE)].map((_, i) => i * SIZE + (SIZE - 1 - i)));
    return lines;
  }

  function completedLines() {
    return LINES.filter((line) => line.every(isDone));
  }

  // ---------- 画像の縮小 ----------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("この画像は読み込めませんでした"));
      };
      img.src = url;
    });
  }

  async function shrink(file) {
    const { img, url } = await loadImage(file);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), "image/jpeg", 0.85));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- 表示 ----------
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function tabs(active) {
    const t = (href, key, label) =>
      `<a href="${href}" class="tab${active === key ? " is-active" : ""}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`;
    return `<nav class="tabs">${t("#/", "card", "カード")}${t("#/album", "album", "アルバム")}${t("#/how", "how", "遊び方")}</nav>`;
  }

  function renderCard() {
    const lines = completedLines();
    const inLine = new Set(lines.flat());
    const done = MISSIONS.filter((_, i) => isDone(i)).length;

    const cells = MISSIONS.map((m, i) => {
      const photo = urls.get(i);
      const cls = ["cell", `tone-${m.tone || "blue"}`];
      if (m.free) cls.push("is-free");
      if (isDone(i)) cls.push("is-done");
      if (inLine.has(i)) cls.push("in-line");
      if (photo) cls.push("has-photo");
      const label = m.free ? "FREE" : `${m.text}${isDone(i) ? "（達成）" : ""}`;
      return `<a class="${cls.join(" ")}" href="#/m/${i + 1}" aria-label="${esc(label)}">
        ${photo ? `<img class="cell-photo" src="${photo}" alt="" loading="lazy" />` : ""}
        <span class="cell-icon" aria-hidden="true">${m.icon}</span>
        <span class="cell-text">${esc(m.text)}</span>
        ${isDone(i) && !m.free ? `<span class="cell-stamp" aria-hidden="true">OK</span>` : ""}
      </a>`;
    }).join("");

    view.innerHTML = `
      ${tabs("card")}
      <section class="status">
        <div class="status-item"><span class="status-num">${done}</span><span class="status-label">/ ${MISSIONS.length} マス</span></div>
        <div class="status-item ${lines.length ? "is-bingo" : ""}"><span class="status-num">${lines.length}</span><span class="status-label">BINGO</span></div>
        <div class="status-bar" aria-hidden="true"><span style="width:${(done / MISSIONS.length) * 100}%"></span></div>
      </section>
      <p class="hint">マスをタップして、ミッションの写真を入れよう！</p>
      <section class="grid" aria-label="ビンゴカード">${cells}</section>
    `;
  }

  function renderMission(id) {
    const m = MISSIONS[id];
    if (!m) return go("#/");
    const e = entries.get(id);
    const photo = urls.get(id);
    const prev = id > 0 ? `#/m/${id}` : null;
    const next = id < MISSIONS.length - 1 ? `#/m/${id + 2}` : null;

    view.innerHTML = `
      <div class="detail-top">
        <a href="#/" class="back">← カードにもどる</a>
        <span class="detail-no">No.${String(id + 1).padStart(2, "0")}</span>
      </div>
      <article class="detail tone-${m.tone || "blue"} ${isDone(id) ? "is-done" : ""}">
        <div class="detail-head">
          <span class="detail-icon" aria-hidden="true">${m.icon}</span>
          <h2 class="detail-title">${m.free ? "FREE マス" : esc(m.text)}</h2>
          <span class="badge ${isDone(id) ? "badge-done" : ""}">${isDone(id) ? "達成！" : "チャレンジ中"}</span>
        </div>

        ${m.free ? `<p class="note">このマスは最初から達成済み。好きな写真を入れてもOKです。</p>` : ""}

        ${
          photo
            ? `<figure class="photo">
                 <img src="${photo}" alt="${esc(m.text)}の写真" />
                 <figcaption>${fmtTime(e.at)} に登録</figcaption>
               </figure>
               <label class="memo-label" for="memo">ひとことメモ</label>
               <textarea id="memo" class="memo" rows="3" maxlength="200" placeholder="誰と？どうだった？">${esc(e.memo || "")}</textarea>
               <div class="actions">
                 <label class="btn btn-ghost">写真を変える<input type="file" accept="image/*" class="file" /></label>
                 <button type="button" class="btn btn-danger" id="remove">写真を消す</button>
               </div>`
            : `<label class="upload">
                 <input type="file" accept="image/*" class="file" />
                 <span class="upload-icon" aria-hidden="true">📷</span>
                 <span class="upload-main">写真を撮る ／ 選ぶ</span>
                 <span class="upload-sub">写真を入れるとマスが達成になります</span>
               </label>`
        }
      </article>
      <nav class="pager">
        ${prev ? `<a href="${prev}" class="btn btn-ghost">‹ 前のマス</a>` : "<span></span>"}
        ${next ? `<a href="${next}" class="btn btn-ghost">次のマス ›</a>` : "<span></span>"}
      </nav>
    `;

    view.querySelectorAll(".file").forEach((input) =>
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        await addPhoto(id, file);
      })
    );

    const memo = view.querySelector("#memo");
    if (memo) {
      let timer;
      memo.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => saveEntry({ ...entries.get(id), memo: memo.value }), 400);
      });
    }

    const remove = view.querySelector("#remove");
    if (remove) {
      remove.addEventListener("click", async () => {
        if (!confirm("この写真を消しますか？")) return;
        await removeEntry(id);
        renderMission(id);
      });
    }
  }

  async function addPhoto(id, file) {
    const before = completedLines().length;
    const label = view.querySelector(".upload-main");
    if (label) label.textContent = "保存中…";
    try {
      const blob = await shrink(file);
      const old = entries.get(id);
      await saveEntry({ id, blob, memo: old ? old.memo || "" : "", at: Date.now() });
    } catch (err) {
      toast(err.message || "保存できませんでした");
      return renderMission(id);
    }
    const after = completedLines().length;
    if (after > before) {
      celebrate();
      toast(`BINGO！ ${after}列そろいました 🎉`);
    } else if (!MISSIONS[id].free) {
      toast("ミッション達成！");
    }
    renderMission(id);
  }

  function renderAlbum() {
    const items = MISSIONS.map((m, i) => ({ m, i, url: urls.get(i), e: entries.get(i) }))
      .filter((x) => x.url)
      .sort((a, b) => a.e.at - b.e.at);

    view.innerHTML = `
      ${tabs("album")}
      ${
        items.length
          ? `<section class="album">${items
              .map(
                ({ m, i, url, e }) => `<a class="album-item" href="#/m/${i + 1}">
                  <img src="${url}" alt="" loading="lazy" />
                  <span class="album-cap"><b>${m.icon} ${esc(m.free ? "FREE" : m.text)}</b>${
                    e.memo ? `<span>${esc(e.memo)}</span>` : ""
                  }</span>
                </a>`
              )
              .join("")}</section>`
          : `<p class="empty">まだ写真がありません。<br/>カードのマスから写真を入れてみよう！</p>`
      }
    `;
  }

  function renderHow() {
    const steps = [
      ["マスのミッションをクリアしよう！", "園内を楽しみながら、各マスのミッションにチャレンジしてみてください。"],
      ["写真を入れよう！", "マスをタップして、ミッション達成の写真を撮るか選んでください。写真を入れたマスが達成になります。"],
      ["委員に見せよう！", "達成したマスの写真を担当の委員に見せて「OK！」をもらいましょう。"],
      ["BINGOを目指そう！", "縦・横・斜めのいずれか1列がそろったら達成です！ぜひ委員に見せてください♪"],
    ];
    view.innerHTML = `
      ${tabs("how")}
      <section class="how">
        <h2 class="how-title">HOW TO PLAY</h2>
        <ol class="how-list">${steps
          .map(([t, d], n) => `<li><span class="how-num">${n + 1}</span><div><b>${t}</b><p>${d}</p></div></li>`)
          .join("")}</ol>
        <p class="how-banner">たくさんの出会いと<br/>楽しい思い出をつくろう！</p>
        <button type="button" class="btn btn-danger btn-small" id="reset">すべてリセット</button>
      </section>
    `;
    view.querySelector("#reset").addEventListener("click", async () => {
      if (!confirm("すべての写真とメモを消します。よろしいですか？")) return;
      for (const id of [...entries.keys()]) await removeEntry(id);
      toast("リセットしました");
      go("#/");
    });
  }

  // ---------- 演出 ----------
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-show"), 2600);
  }

  function celebrate() {
    const colors = ["#f2a7b4", "#7fb3e0", "#f5cf6b", "#1f4e7a", "#a9d8c4"];
    const box = document.createElement("div");
    box.className = "confetti";
    for (let i = 0; i < 60; i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.6 + "s";
      p.style.animationDuration = 1.8 + Math.random() * 1.2 + "s";
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3600);
  }

  // ---------- ルーティング（#/m/3 のように各マスに個別リンク） ----------
  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function route() {
    const h = location.hash || "#/";
    const m = h.match(/^#\/m\/(\d+)$/);
    if (m) renderMission(Number(m[1]) - 1);
    else if (h === "#/album") renderAlbum();
    else if (h === "#/how") renderHow();
    else renderCard();
    window.scrollTo(0, m ? document.querySelector(".hero").offsetHeight - 8 : 0);
  }

  window.addEventListener("hashchange", route);

  (async () => {
    db = await openDb();
    if (!db) toast("この環境では写真を保存できません（プライベートモード等）");
    await loadAll().catch(() => {});
    route();
  })();
})();
