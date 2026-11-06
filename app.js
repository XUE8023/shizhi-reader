// 拾知 · 交互层（零依赖 ES Module）
// 只读 data/feed.json；所有用户操作只写 localStorage，绝不回写 state.json。

import {rankUnseen} from './feed-policy.mjs';
const STORE_KEY = "shizhi.user.v1";
let readerCard = null;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let feed = null;
let cards = [];
let order = [];
let idx = 0;
let user = loadUser();
let clearArmed = false;

const favView = { q: "", tag: "", source: "", sort: "fav_desc" };
const radarOpen = new Set();
let readerReturnView = null;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

function nowISO() { return new Date().toISOString(); }

function normalize(u) {
  const favorites = Array.isArray(u?.favorites) ? u.favorites.slice() : [];
  const favAt = (u && typeof u.fav_at === "object" && u.fav_at) ? { ...u.fav_at } : {};
  const base = u?.updated_at || nowISO();
  for (const id of favorites) if (!favAt[id]) favAt[id] = base;
  return {
    version: 2,
    refill_paused: u?.refill_paused === true,
    updated_at: u?.updated_at || null,
    favorites,
    fav_at: favAt,
    feedback: {
      liked: Array.isArray(u?.feedback?.liked) ? u.feedback.liked.slice() : [],
      not_interested: Array.isArray(u?.feedback?.not_interested) ? u.feedback.not_interested.slice() : [],
    },
    reads: Array.isArray(u?.reads) ? u.reads.slice() : [],
    consumed: [...new Set(Array.isArray(u?.consumed) ? u.consumed : (u?.reads||[]).map(r=>r.article_id))],
    projects: Array.isArray(u?.projects)
      ? u.projects.map((p) => ({
          id: p.id || `p_${Math.random().toString(36).slice(2)}`,
          topic: p.topic || "",
          question: p.question || "",
          created_at: p.created_at || nowISO(),
        }))
      : [],
    last_export_at: u?.last_export_at || null,
  };
}

function loadUser() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* 忽略损坏的本地记录 */ }
  return normalize({});
}

function saveUser() {
  user.updated_at = nowISO();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(user)); } catch (e) {}
  updateTopStatus();
  
}

function current() { return cards[order[idx]]; }

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("is-on"), 1700);
}

function formatTime(iso) {
  if (!iso) return "尚无记录";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
}

// ---------- 卡片渲染 ----------

function roundLabel(c) {
  return c.round_id.map((r) => {
    const n = c.round_index[r];
    const tail = r === "R2" && feed?.meta?.rounds?.R2?.target ? ` / ${feed.meta.rounds.R2.target}` : "";
    return `${r} · 第 ${n} 张${tail}`;
  }).join("　");
}

function metaHTML(c) {
  const marks = c.editorial_marks.length ? c.editorial_marks.join(" · ") : "无（非精华 / 非中标 / 非风向标）";
  const tags = c.tags.length
    ? c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")
    : `<span class="tag">未标注</span>`;
  return `
    <div class="meta-block">
      <div class="meta-row"><span class="meta-key">来源分区</span><span class="meta-val">${esc(c.source_section)}</span></div>
      <div class="meta-row"><span class="meta-key">发现入口</span><span class="meta-val">${esc(c.discovery_source)}</span></div>
      <div class="meta-row"><span class="meta-key">编辑标记</span><span class="meta-val">${esc(marks)}</span></div>
      <div class="tag-row">${tags}</div>
    </div>`;
}

function isOpinion(label) {
  return /作者|判断|观察|经验|感受|观点/.test(label || "");
}

function blocksHTML(c, full) {
  const blocks = c.card_content.blocks || [];
  let paragraphs = 0;
  let skipped = 0;
  const out = [];

  for (const b of blocks) {
    if (b.type === "paragraph") {
      paragraphs += 1;
      if (!full && paragraphs > 2) { skipped += 1; continue; }
      out.push(`<p>${esc(b.text)}</p>`);
    } else if (b.type === "lede") {
      out.push(`<p class="lede">${esc(b.text)}</p>`);
    } else if (b.type === "quote") {
      out.push(`<p class="quote">${esc(b.text)}</p>`);
    } else if (b.type === "detail") {
      const cls = isOpinion(b.label) ? " fact-label opinion" : "fact-label";
      out.push(`<ul class="detail-list"><li><span class="${cls.trim()}">${esc(b.label)}</span>${esc(b.text)}</li></ul>`);
    } else if (b.type === "editor_note") {
      out.push(`<div class="editor-note"><span class="note-label">${esc(b.label)}</span>${esc(b.text)}</div>`);
    }
  }

  if (!full && (skipped > 0 || !c.card_content.has_full_text)) {
    out.push(`<button class="btn-outline" data-act="deep" style="width:100%;margin-top:10px">展开全文 · 深度阅读</button>`);
  }
  if (!c.card_content.has_full_text) {
    out.push(`<p class="note-hint">${esc(c.card_content.note)}</p>`);
  }
  return out.join("");
}

function cardHTML(c) {
  return `
    <div class="card-head">
      <span class="round-badge">${esc(roundLabel(c))}</span>
      <span class="read-badge">${esc(c.reading_status)}</span>
    </div>
    ${metaHTML(c)}
    <h2 class="headline">${esc(c.card_content.headline)}</h2>
    <div class="card-body">${blocksHTML(c, false)}</div>
    <div class="source-foot">
      <span>${esc(c.author)}　·　${esc(c.published_at)}</span>
      <span>ID ${esc(c.article_id)}</span>
    </div>`;
}

function updateFavUI(c) {
  if(!c) return;
  const on = user.favorites.includes(c.article_id);
  $("#favBtn").classList.toggle("is-on", on);
  $("#favIco").textContent = on ? "✓" : "＋";
  $("#favLabel").textContent = on ? "已收藏" : "收藏";
  $("#favBtn").setAttribute("aria-pressed", String(on));
}

function updateLikeUI(c) {
  const on = user.feedback.liked.includes(c.article_id);
  $("#likeBtn").classList.toggle("is-on", on);
  $("#likeBtn").textContent = on ? "✓ 有意思" : "有意思";
}

function recordRead(articleId) {
  user.reads.push({ article_id: articleId, at: nowISO() });
  saveUser();
}

function updateTopStatus() {
  const n = feed ? feed.meta.total_cards : 0;
  $("#topStatus").textContent = `待刷 ${order.length} 张 · ${user.favorites.length} 收藏`;
}

function render() {
  const c = current();
  if (!c) {
    $('#card').innerHTML='<h2>这批看完了</h2><p>后台正在准备新内容。已看内容可在「我的」历史记录中重读。</p>';
    $('#feedPos').textContent='待刷 0 张'; $('#feedEnd').textContent='精华 / 中标 · 新卡准备好会自动出现';
    $('#openOriginal').removeAttribute('href');
    updateTopStatus(); return;
  }
  $("#card").innerHTML = cardHTML(c);
  $("#feedPos").textContent = `第 ${idx + 1} / ${order.length} 张`;
  $("#feedEnd").textContent = c.card_content.has_full_text
    ? `内容来自 ${c.card_content.card_file}`
    : "完整正文未存档 · 点深读看笔记与元数据";
  $("#openOriginal").href = c.original_url || "#";
  $("#openOriginal").style.opacity = c.original_url ? "1" : ".4";
  updateFavUI(c);
  updateLikeUI(c);
  $("#feedScroll").scrollTop = 0;
  updateTopStatus();
}

function go(delta) {
  if(delta<0) { toast('已看卡片请在「我的」历史记录查看'); return; }
  const c=current(); if(!c) return;
  if(!user.consumed.includes(c.article_id)) user.consumed.push(c.article_id);
  recordRead(c.article_id);
  order=rankUnseen(cards,user); idx=0;
  render();
}

// ---------- 深度阅读 ----------

function openReaderById(articleId) {
  const card=cards.find(c=>c.article_id===articleId);
  if (!card) return;
  const active = document.querySelector(".tab.is-active");
  readerReturnView = active ? active.dataset.view : "feed";
  readerCard=card; openReader();
}

function openReader() {
  const c = readerCard || current();
  if(!c) return;
  $("#readerBody").innerHTML = `
    <h2 class="headline">${esc(c.card_content.headline)}</h2>
    <div class="card-head">
      <span class="round-badge">${esc(roundLabel(c))}</span>
      <span class="read-badge">${esc(c.reading_status)}</span>
    </div>
    ${metaHTML(c)}
    <div class="card-body">${blocksHTML(c, true)}</div>
    <div class="source-foot" style="display:block">
      <div>作者：${esc(c.author)}　·　发布于 ${esc(c.published_at)}</div>
      <div style="margin-top:6px">文章 ID：${esc(c.article_id)}</div>
      <div style="margin-top:6px">原文：<a href="${esc(c.original_url)}" target="_blank" rel="noopener">${esc(c.original_url || "未记录")}</a></div>
      <div style="margin-top:6px">原始标题：${esc(c.title)}</div>
      <p class="note-hint">${esc(c.card_content.note)}</p>
    </div>`;
  $("#reader").hidden = false;
  $("#readerBody").scrollTop = 0;
}

function closeReader() {
  readerCard=null;
  $("#reader").hidden = true;
  if (readerReturnView) {
    const target = document.querySelector(`#view-${readerReturnView}`);
    if (target && !target.classList.contains("is-active")) switchView(readerReturnView);
    readerReturnView = null;
  }
}

// ---------- 用户操作 ----------

function toggleFav() {
  const c = current();
  if(!c) return;
  const i = user.favorites.indexOf(c.article_id);
  if (i >= 0) {
    user.favorites.splice(i, 1);
    delete user.fav_at[c.article_id];
    toast("已取消收藏");
  } else {
    user.favorites.push(c.article_id);
    user.fav_at[c.article_id] = nowISO();
    toast("已收藏");
  }
  saveUser();
  updateFavUI(c);
  renderFavFilters();
  renderFavList();
}

function toggleLike() {
  const c = current();
  if(!c) return;
  const arr = user.feedback.liked;
  const i = arr.indexOf(c.article_id);
  if (i >= 0) { arr.splice(i, 1); toast("已取消标记"); }
  else { arr.push(c.article_id); toast("记下了：有意思"); }
  saveUser();
  updateLikeUI(c);
  renderPrefs();
}

function notInterested() {
  const c = current();
  if(!c) return;
  const arr = user.feedback.not_interested;
  if (!arr.includes(c.article_id)) arr.push(c.article_id);
  saveUser();
  toast("记下了：不感兴趣");
  go(1);
}

// ---------- 收藏页 ----------

function sourceGroup(section) {
  return String(section || "未标注").split("›")[0].split("（")[0].trim();
}

function favCards() {
  return user.favorites
    .map((id) => cards.find((c) => c.article_id === id))
    .filter(Boolean);
}

function favSourceOptions() {
  const set = new Set(favCards().map((c) => sourceGroup(c.source_section)));
  return [...set].sort((a, b) => a.localeCompare(b, "zh"));
}

function favTagOptions() {
  const count = new Map();
  favCards().forEach((c) => c.tags.forEach((t) => count.set(t, (count.get(t) || 0) + 1)));
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12);
}

function renderFavFilters() {
  const srcBox = $("#favSources");
  const tagBox = $("#favTags");
  const sources = favSourceOptions();
  const tags = favTagOptions();

  srcBox.innerHTML = [
    `<button class="chip-btn${favView.source ? "" : " is-on"}" data-fav-source="">全部</button>`,
    ...sources.map((s) => `<button class="chip-btn${favView.source === s ? " is-on" : ""}" data-fav-source="${esc(s)}">${esc(s)}</button>`),
  ].join("");

  tagBox.innerHTML = [
    `<button class="chip-btn${favView.tag ? "" : " is-on"}" data-fav-tag="">全部</button>`,
    ...tags.map((t) => `<button class="chip-btn${favView.tag === t ? " is-on" : ""}" data-fav-tag="${esc(t)}">${esc(t)}</button>`),
  ].join("");

  const emptyHint = !user.favorites.length ? "还没有收藏，标签筛选会在收藏后出现" : "";
  if (emptyHint) tagBox.innerHTML = `<span class="filter-empty">${emptyHint}</span>`;
}

function sortFavList(list) {
  const arr = list.slice();
  if (favView.sort === "fav_desc") {
    arr.sort((a, b) => String(user.fav_at[b.article_id] || "").localeCompare(String(user.fav_at[a.article_id] || "")));
  } else if (favView.sort === "fav_asc") {
    arr.sort((a, b) => String(user.fav_at[a.article_id] || "").localeCompare(String(user.fav_at[b.article_id] || "")));
  } else if (favView.sort === "pub_desc") {
    arr.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  } else if (favView.sort === "round") {
    const num = (c) => c.round_index.R2 ?? c.round_index.R1 ?? 0;
    arr.sort((a, b) => num(b) - num(a));
  }
  return arr;
}

function renderFavList() {
  const box = $("#favList");
  const q = favView.q.trim().toLowerCase();
  let list = favCards();

  if (favView.source) list = list.filter((c) => sourceGroup(c.source_section) === favView.source);
  if (favView.tag) list = list.filter((c) => c.tags.includes(favView.tag));
  if (q) {
    list = list.filter((c) =>
      `${c.title} ${c.card_content.headline} ${c.author} ${c.tags.join(" ")}`.toLowerCase().includes(q));
  }
  list = sortFavList(list);

  const total = user.favorites.length;
  $("#favCount").textContent = total === 0
    ? "还没有收藏"
    : q || favView.source || favView.tag
      ? `共 ${total} 张 · 命中 ${list.length} 张`
      : `共 ${total} 张`;

  if (!list.length) {
    box.innerHTML = `<div class="empty">${total ? "没有符合条件的收藏，试试重置筛选。" : "还没有收藏。回到「刷一刷」点收藏即可。"}</div>`;
    return;
  }

  box.innerHTML = list.map((c) => `
    <div class="list-item">
      <div class="list-title">${esc(c.card_content.headline)}</div>
      <div class="list-meta">${esc(roundLabel(c))}　·　${esc(sourceGroup(c.source_section))}　·　${esc(c.author)}</div>
      <div class="list-meta">收藏于 ${esc(formatTime(user.fav_at[c.article_id]))}</div>
      <div class="tag-row">${c.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      <div class="list-actions">
        <button data-fav-deep="${esc(c.article_id)}">进入详情</button>
        <a href="${esc(c.original_url)}" target="_blank" rel="noopener">打开原文</a>
        <button class="danger" data-fav-remove="${esc(c.article_id)}">取消收藏</button>
      </div>
    </div>`).join("");
}

function renderFavorites() {
  renderFavFilters();
  renderFavList();
}

// ---------- 项目雷达 ----------

function cardText(c) {
  const body = (c.card_content.blocks || []).map((b) => b.text).join(" ");
  return `${c.title} ${c.card_content.headline} ${c.tags.join(" ")} ${body} ${c.author}`.toLowerCase();
}

function matchCards(project) {
  const q = `${project.topic} ${project.question}`.trim().toLowerCase();
  if (!q) return [];
  const terms = [q, ...q.split(/[\s,，。;；、]+/).filter((t) => t.length > 1)];
  const STOP = /[的了是在和与我你他这那就都也很更把被从到对为]/;

  const scored = cards.map((c) => {
    const title = `${c.title} ${c.card_content.headline}`.toLowerCase();
    const tags = c.tags.join(" ").toLowerCase();
    const body = cardText(c);
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 8;
      if (tags.includes(t)) score += 6;
      if (body.includes(t)) score += 2;
    }
    for (let i = 0; i < q.length - 1; i++) {
      const bg = q.slice(i, i + 2);
      if (STOP.test(bg)) continue;
      if (title.includes(bg)) score += 2.5;
      else if (tags.includes(bg)) score += 2;
    }
    return { c, score };
  }).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}

function renderProjects() {
  const box = $("#projectList");
  if (!user.projects.length) {
    box.innerHTML = `<div class="empty">还没有项目。新增后会先在已有卡片里做本地匹配。</div>`;
    return;
  }

  box.innerHTML = user.projects.slice().reverse().map((p) => {
    const matches = matchCards(p);
    const open = radarOpen.has(p.id);
    const listHTML = open
      ? (matches.length
          ? `<div class="match-list">${matches.map(({ c, score }) => `
              <div class="match-item">
                <div class="match-title" data-radar-open="${esc(c.article_id)}">${esc(c.card_content.headline)}</div>
                <div class="list-meta">${esc(roundLabel(c))}　·　相关度 ${score.toFixed(0)}</div>
              </div>`).join("")}</div>`
          : `<div class="empty">已有卡片里没有匹配，试试导出检索请求。</div>`)
      : "";

    return `<div class="project-card">
      <div class="list-title">${esc(p.topic)}</div>
      <div class="list-meta">${esc(p.question || "未填写问题")}</div>
      <div class="list-meta">创建于 ${esc(formatTime(p.created_at))}　·　本地匹配 ${matches.length} 张</div>
      <div class="list-actions">
        <button data-radar-toggle="${esc(p.id)}">${open ? "收起匹配" : "查看匹配"}</button>
        <button data-radar-search="${esc(p.id)}">雷达搜索新内容</button>
        ${jobHTML(p.id)}
        <button data-radar-export="${esc(p.id)}">导出检索请求</button>
        <button class="danger" data-project-remove="${esc(p.id)}">删除</button>
      </div>
      ${listHTML}
    </div>`;
  }).join("");
}

function exportRadarRequest(project) {
  const payload = {
    type: "shizhi_radar_request",
    version: 1,
    product: "拾知",
    created_at: nowISO(),
    project: { id: project.id, topic: project.topic, question: project.question },
    instruction: "在生财有术 MCP 中按 project.topic / project.question 检索，读全文并核验身份后生成知识卡片；结果以 feed 卡片格式导入拾知。此请求只服务该项目，不改变全局「刷一刷」推荐偏好。",
    expected_fields: [
      "article_id", "title", "author", "published_at", "source_section",
      "editorial_marks", "tags", "reading_status", "card_content", "original_url",
      "round_id", "round_index",
    ],
  };
  downloadJSON(payload, `shizhi-radar-${project.id}.json`);
  toast("检索请求已导出");
}

// ---------- 我的 ----------

function prefStats() {
  const pos = new Map();
  const neg = new Map();
  const add = (map, ids) => ids.forEach((id) => {
    const c = cards.find((x) => x.article_id === id);
    if (c) c.tags.forEach((t) => map.set(t, (map.get(t) || 0) + 1));
  });
  add(pos, user.favorites);
  add(pos, user.feedback.liked);
  add(neg, user.feedback.not_interested);

  const top = [...pos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = top.length ? top[0][1] : 1;
  const down = [...neg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { top, max, down };
}

function renderPrefs() {
  const box = $("#prefBox");
  if (!box) return;
  const { top, max, down } = prefStats();
  if (!top.length) {
    box.innerHTML = `<div class="empty">收藏或标记「有意思」后，这里会出现你的兴趣分布。</div>`;
    return;
  }
  box.innerHTML = `
    ${top.map(([t, n]) => `
      <div class="pref-row">
        <span class="pref-name">${esc(t)}</span>
        <span class="pref-track"><span class="pref-fill" style="width:${Math.round((n / max) * 100)}%"></span></span>
        <span class="pref-num">${n}</span>
      </div>`).join("")}
    ${down.length ? `<p class="pref-down">较少推荐：${down.map(([t]) => esc(t)).join("、")}</p>` : ""}`;
}

function renderMe() {
  const uniqueReads = new Set(user.reads.map((r) => r.article_id)).size;
  $("#statGrid").innerHTML = `
    <div class="stat"><div class="stat-num">${uniqueReads}</div><div class="stat-label">浏览过的卡片</div></div>
    <div class="stat"><div class="stat-num">${user.favorites.length}</div><div class="stat-label">收藏</div></div>
    <div class="stat"><div class="stat-num">${user.feedback.liked.length}</div><div class="stat-label">有意思</div></div>
    <div class="stat"><div class="stat-num">${feed ? feed.meta.total_cards : 0}</div><div class="stat-label">卡片总量</div></div>`;

  $("#syncLine").textContent = `最后同步：${formatTime(user.updated_at)}　·　本地存储（未连接远程）`;
  $("#exportLine").textContent = `最近导出：${formatTime(user.last_export_at)}`;

  renderPrefs();

  const list = $("#readList");
  const recent = [...new Map(user.reads.slice().reverse().map(r=>[r.article_id,r])).values()];
  list.innerHTML = recent.length
    ? recent.map((r) => {
        const c = cards.find((x) => x.article_id === r.article_id);
        const saved=user.favorites.includes(r.article_id);
        return `<div class="list-item"><button class="list-title" data-radar-open="${esc(r.article_id)}">${esc(c ? c.card_content.headline : r.article_id)}</button>
          ${c ? `<button class="btn-outline" data-history-favorite="${esc(r.article_id)}" aria-pressed="${saved}">${saved?'取消收藏':'收藏'}</button>` : ''}
          <div class="list-meta">${esc(formatTime(r.at))}　·　ID ${esc(r.article_id)}</div></div>`;
      }).join("")
    : `<div class="empty">还没有阅读记录。</div>`;
}

// ---------- 视图切换 ----------

function switchView(v) {
  $$(".view").forEach((el) => el.classList.toggle("is-active", el.id === `view-${v}`));
  $$(".tab").forEach((el) => el.classList.toggle("is-active", el.dataset.view === v));
  if (v === "favorites") renderFavorites();
  if (v === "me") renderMe();
  if (v === "radar") renderProjects();
}

// ---------- 导入 / 导出 ----------

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  user.last_export_at = nowISO();
  saveUser();
  downloadJSON({
    product: "拾知",
    version: 2,
    exported_at: nowISO(),
    feed_meta: feed ? { generated_at: feed.meta.generated_at, total_cards: feed.meta.total_cards } : null,
    user_state: user,
  }, `shizhi-backup-${nowISO().slice(0, 10)}.json`);
  renderMe();
  toast("备份已导出");
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (data && data.type === "shizhi_radar_request") {
        toast("这是检索请求文件，请在生成器侧执行");
        return;
      }
      const incoming = data.user_state || data;
      if (!incoming || typeof incoming !== "object") throw new Error("格式不对");
      user = normalize(incoming);
      saveUser();
      render();
      renderFavorites();
      renderProjects();
      renderMe();
      toast("备份已导入");
    } catch (e) {
      toast("导入失败：不是有效的拾知备份");
    }
  };
  reader.readAsText(file);
}

// ---------- 事件绑定 ----------

function bind() {
  document.addEventListener("click", (e) => {
    const historyFavorite=e.target.closest('[data-history-favorite]');
    if(historyFavorite){
      const id=historyFavorite.dataset.historyFavorite;
      if(user.favorites.includes(id)){
        user.favorites=user.favorites.filter(value=>value!==id);
        delete user.fav_at[id];
      }else{
        user.favorites.push(id);
        user.fav_at[id]=nowISO();
      }
      saveUser(); updateFavUI(current()); renderFavorites(); renderMe();
      return;
    }
    const radarSearch = e.target.closest('[data-radar-search]');
    if (radarSearch) {
      const p=user.projects.find(p=>p.id===radarSearch.dataset.radarSearch);
      if (p) submitGeneration({kind:'radar',project_id:p.id,topic:p.topic,question:p.question});
      return;
    }
    const act = e.target.closest("[data-act]");
    if (act) {
      const a = act.dataset.act;
      if (a === "prev") go(-1);
      else if (a === "next") go(1);
      else if (a === "fav") toggleFav();
      else if (a === "deep") openReader();
      else if (a === "like") toggleLike();
      else if (a === "skip") notInterested();
      return;
    }

    const tab = e.target.closest(".tab");
    if (tab) { switchView(tab.dataset.view); return; }

    const srcBtn = e.target.closest("[data-fav-source]");
    if (srcBtn) {
      favView.source = srcBtn.dataset.favSource;
      renderFavFilters(); renderFavList();
      return;
    }
    const tagBtn = e.target.closest("[data-fav-tag]");
    if (tagBtn) {
      favView.tag = tagBtn.dataset.favTag;
      renderFavFilters(); renderFavList();
      return;
    }
    const deep = e.target.closest("[data-fav-deep]");
    if (deep) { openReaderById(deep.dataset.favDeep); return; }

    const rm = e.target.closest("[data-fav-remove]");
    if (rm) {
      const id = rm.dataset.favRemove;
      const i = user.favorites.indexOf(id);
      if (i >= 0) user.favorites.splice(i, 1);
      delete user.fav_at[id];
      saveUser();
      updateFavUI(current());
      renderFavorites();
      toast("已取消收藏");
      return;
    }

    const toggle = e.target.closest("[data-radar-toggle]");
    if (toggle) {
      const id = toggle.dataset.radarToggle;
      if (radarOpen.has(id)) radarOpen.delete(id); else radarOpen.add(id);
      renderProjects();
      return;
    }
    const exp = e.target.closest("[data-radar-export]");
    if (exp) {
      const p = user.projects.find((x) => x.id === exp.dataset.radarExport);
      if (p) exportRadarRequest(p);
      return;
    }
    const openCard = e.target.closest("[data-radar-open]");
    if (openCard) { openReaderById(openCard.dataset.radarOpen); return; }

    const prm = e.target.closest("[data-project-remove]");
    if (prm) {
      user.projects = user.projects.filter((p) => p.id !== prm.dataset.projectRemove);
      saveUser(); renderProjects();
      toast("项目已删除");
    }
  });

  $("#readerClose").addEventListener("click", closeReader);

  $("#favSearch").addEventListener("input", (e) => {
    favView.q = e.target.value;
    renderFavList();
  });
  $("#favSort").addEventListener("change", (e) => {
    favView.sort = e.target.value;
    renderFavList();
  });
  $("#favReset").addEventListener("click", () => {
    favView.q = ""; favView.tag = ""; favView.source = ""; favView.sort = "fav_desc";
    $("#favSearch").value = "";
    $("#favSort").value = "fav_desc";
    renderFavorites();
    toast("已重置筛选");
  });

  $("#projectAdd").addEventListener("click", () => {
    const topic = $("#projectTopic").value.trim();
    const question = $("#projectQuestion").value.trim();
    if (!topic) { toast("先填项目主题"); return; }
    user.projects.push({
      id: `p_${Date.now()}`,
      topic,
      question,
      created_at: nowISO(),
    });
    saveUser();
    $("#projectTopic").value = "";
    $("#projectQuestion").value = "";
    renderProjects();
    toast("项目已保存，不影响刷一刷");
  });

  $("#exportBtn").addEventListener("click", exportBackup);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importBackup(f);
    e.target.value = "";
  });

  $("#clearBtn").addEventListener("click", () => {
    const btn = $("#clearBtn");
    if (!clearArmed) {
      clearArmed = true;
      btn.textContent = "再点一次确认清空";
      setTimeout(() => {
        clearArmed = false;
        btn.textContent = "清空本机记录";
      }, 4000);
      return;
    }
    clearArmed = false;
    btn.textContent = "清空本机记录";
    user = normalize({});
    saveUser();
    render();
    renderFavorites();
    renderProjects();
    renderMe();
    toast("已清空本机记录");
  });

  // Only a NEW gesture starting at an edge may navigate; reading scroll never does.
  const fs = $("#feedScroll");
  let startY = 0, startX = 0, startT = 0;
  let startedAtBottom = false, startedAtTop = false;
  const atBottom = () => fs.scrollTop + fs.clientHeight >= fs.scrollHeight - 14;
  const atTop = () => fs.scrollTop <= 4;

  fs.addEventListener("touchstart", (e) => {
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    startT = Date.now();
    startedAtBottom = atBottom();
    startedAtTop = atTop();
  }, { passive: true });

  fs.addEventListener("touchend", (e) => {
    const dy = startY - e.changedTouches[0].clientY;
    const dx = Math.abs(startX - e.changedTouches[0].clientX);
    const dt = Date.now() - startT;
    if (Math.abs(dy) < 65 || dx > 55 || dt > 350) return;
    if (dy > 0 && startedAtBottom && atBottom()) go(1);
    else if (dy < 0 && startedAtTop && atTop()) go(-1);
  }, { passive: true });

  let wheelLock = false;
  fs.addEventListener("wheel", (e) => {
    if (wheelLock) return;
    // Wheel momentum must not navigate between cards; use the explicit buttons.
  }, { passive: true });

  document.addEventListener("keydown", (e) => {
    if (!$("#reader").hidden && e.key === "Escape") { closeReader(); return; }
    if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); go(1); }
    if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); go(-1); }
  });
}

async function boot() {
  try {
    try {
      const remote=await fetch('/api/user',{cache:'no-store'});
      if(remote.ok){
        const shared=await remote.json();
        if(shared.updated_at){
          const merged=normalize(shared.updated_at>(user.updated_at||'')?shared:user);
          merged.consumed=[...new Set([...(user.consumed||[]),...(shared.consumed||[])])];
          user=merged; localStorage.setItem(STORE_KEY,JSON.stringify(user));
        }
      }
    }catch(_){}
    const res = await fetch("./data/feed.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    feed = await res.json();
    cards = feed.cards;
    order = rankUnseen(cards,user);
    renderPause();
    idx = 0;
    render();
    bind();
    renderFavorites();
    renderProjects();
    renderMe();
  } catch (e) {
    $("#card").innerHTML = `<div class="editor-note">卡片数据加载失败：${esc(e.message)}<br>请通过本地服务打开（不要直接双击 index.html）。</div>`;
    $("#topStatus").textContent = "数据未载入";
  }

  if ("serviceWorker" in navigator) {
    const ok = location.protocol === "https:" ||
      ["localhost", "127.0.0.1"].includes(location.hostname);
    if (ok) navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

let refreshing = false;
async function refreshFeed() {
  if (refreshing || !feed || document.hidden) return;
  refreshing = true;
  try {
    const response = await fetch('./data/feed.json', {cache:'no-store'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const incoming = await response.json();
    if (!Array.isArray(incoming.cards) || !incoming.cards.length) throw new Error('Invalid feed');
    const ids = incoming.cards.map(c => c.article_id);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate ID');
    const known = new Map(cards.map(c => [c.article_id, c]));
    for (const c of incoming.cards) {
      if (!c.card_content || !Array.isArray(c.card_content.blocks)) throw new Error('Invalid card');
    }
    const added = incoming.cards.filter(c => !known.has(c.article_id)).length;
    if (!added) return;
    const activeId = current()?.article_id;
    feed = incoming;
    cards = incoming.cards;
    order = rankUnseen(cards,user);
    idx = order.findIndex(i => cards[i].article_id === activeId);
    if (idx < 0) idx = 0;
    if(!activeId) render();
    // Keep the displayed DOM and scroll position; new cards are before the current card.
    $('#feedPos').textContent = `第 ${idx + 1} / ${order.length} 张`;
    updateTopStatus();
    renderFavorites(); renderProjects(); renderMe();
    toast(`新增 ${added} 张，已加入待刷队列`);
  } catch (e) {
    // Retain the last valid feed and every local user record on network failure.
  } finally { refreshing = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFeed(); });
window.addEventListener('online', refreshFeed);
setInterval(refreshFeed, 30000);
let generationJobs = [];
let submittingGeneration = false;
const seenJobs = new Set();
function jobHTML(projectId) {
  const j=generationJobs.find(j=>j.project_id===projectId);
  if (!j) return '';
  return `<span class="list-meta" role="status">${esc(jobMessage(j))}${(j.article_ids||[]).map(id=>` <button data-radar-open="${esc(id)}">查看新卡</button>`).join('')}</span>`;
}
function jobMessage(j) {
  if (!['queued','running'].includes(j.status)) return j.message;
  const seconds=Math.max(0,Math.floor(Date.now()/1000-j.created_at));
  return `${j.message} · ${Math.floor(seconds/60)}分${seconds%60}秒`;
}
async function pollJobs() {
  try {
    const r=await fetch('/api/jobs',{cache:'no-store'});
    if (!r.ok) return;
    const data=await r.json(); generationJobs=data.jobs;
    const latest=generationJobs.find(j=>j.kind==='feed');
    if (latest) $('#generationStatus').textContent=jobMessage(latest);
    for (const j of generationJobs) {
      if (j.status==='done' && !seenJobs.has(j.id)) {
        await refreshFeed(); seenJobs.add(j.id);
      }
    }
    if (document.querySelector('#view-radar.is-active')) renderProjects();
  } catch (_) { $('#generationStatus').textContent='本机服务暂不可达'; }
}
async function submitGeneration(data) {
  if (submittingGeneration) return;
  submittingGeneration=true;
  try {
    const r=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,request_id:`${Date.now()}-${Math.random()}`})});
    const result=await r.json();
    if (!r.ok) throw new Error(result.error||'提交失败');
    toast('已提交，电脑正在处理'); await pollJobs();
  } catch(e) { toast(e.message); }
  finally { submittingGeneration=false; }
}
function renderPause(){
  $('#pauseRefill').textContent=user.refill_paused?'恢复补充':'暂停补充';
  $('#pauseRefill').setAttribute('aria-pressed',String(user.refill_paused));
  $('#generateBtn').disabled=user.refill_paused;
}
$('#pauseRefill').addEventListener('click',async()=>{
  const button=$('#pauseRefill');
  button.disabled=true;
  try{
    const next={...user,refill_paused:!user.refill_paused,updated_at:nowISO()};
    const response=await fetch('/api/user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
    if(!response.ok) throw new Error('保存失败');
    user.refill_paused=next.refill_paused;
    user.updated_at=next.updated_at;
    localStorage.setItem(STORE_KEY,JSON.stringify(user));
    renderPause();
    toast(user.refill_paused?'暂停已保存，正在生成的一张会收尾':'已恢复补充');
  }catch(_){toast('暂停设置未保存，请重试');}
  finally{button.disabled=false;}
});
$('#generateBtn').addEventListener('click',()=>submitGeneration({kind:'feed'}));

boot();
