const PALETTE = ['#3E5C76', '#7A4E3B', '#4F7A5C', '#8A6D2F', '#5B4B7A', '#2F6F73', '#8C3F4D', '#5E6A3A', '#46505E', '#9A5B2E'];
const PIN = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const CHECK = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1F7A4D" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const RING = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9AA1A9" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ord = n => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th');
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);

const state = { query: '', open: new Set() };
let data;
let places = [];

const game = id => data.games[id] || { name: id };
const colorOf = id => game(id).color || PALETTE[hash(id) % PALETTE.length];

function indexPlaces() {
  places = [];
  const add = (id, key, where) => places.push({ id, key, where });
  const order = (layout, i) => `${ord(i + 1)} from ${layout === 'stacked' ? 'top' : 'left'}`;
  const unit = (u, prefix, label) => {
    for (const c of u.cells) {
      const key = `${prefix}:${c.row}:${c.col}`;
      const pos = `${label} · row ${c.row}, column ${c.col}`;
      if (c.kind === 'drawers') c.drawers.forEach((d, di) => d.forEach(id => add(id, `${key}:${di}`, `${pos} · ${di ? 'bottom' : 'top'} drawer`)));
      else if (c.kind === 'doors') (c.games || []).forEach((id, i) => add(id, key, `${pos} · behind doors, ${order(c.layout, i)}`));
      else (c.games || []).forEach((id, i) => add(id, key, `${pos} · ${order(c.layout, i)}`));
    }
    if (u.top) u.top.games.forEach((id, i) => add(id, `${prefix}:top`, `${label} · on top, ${order(u.top.layout, i)}`));
  };
  for (const s of data.storages) {
    if (s.type === 'kallax') unit(s, s.id, s.name);
    else if (s.type === 'wall') s.stacks.forEach(st => st.units.forEach(u => unit(u, `${s.id}.${u.id}`, `${s.name} · ${u.name}`)));
    else s.shelves.forEach((sh, si) => sh.games.forEach((id, i) => add(id, `${s.id}:${si}`, `${s.name} · shelf ${si + 1} · ${order(sh.layout, i)}`)));
  }
}

function matches(q) {
  return q ? places.filter(p => game(p.id).name.toLowerCase().includes(q)) : [];
}

function box(id, ctx) {
  const g = game(id);
  const cls = ctx.q ? (ctx.hitIds.has(id) ? ' is-hit' : ' is-dim') : '';
  return `<button type="button" class="box box--${g.size || 'standard'}${cls}" style="--c:${colorOf(id)}" data-game="${esc(id)}" title="${esc(g.name)}">${esc(g.name)}</button>`;
}

function cellHtml(prefix, c, ctx) {
  if (!c || c.kind === 'empty') return '<div class="cell cell--empty">empty</div>';
  const key = `${prefix}:${c.row}:${c.col}`;
  const layout = c.layout || 'standing';
  const hit = ctx.hitKeys.has(key) ? ' has-hit' : '';
  if (c.kind === 'drawers') {
    const drawers = c.drawers.map((d, di) => {
      const hits = d.filter(id => ctx.hitKeys.has(`${key}:${di}`) && ctx.hitIds.has(id));
      const label = hits.length ? hits.map(id => game(id).name).join(', ') : `${d.length} game${d.length === 1 ? "" : "s"}`;
      const cls = ctx.q ? (hits.length ? ' is-hit' : ' is-dim') : '';
      return `<div class="drawer${cls}" title="${esc(d.map(id => game(id).name).join(', '))}"><span class="pull"></span><span class="label">${esc(label)}</span></div>`;
    }).join('');
    const dHit = c.drawers.some((_, di) => ctx.hitKeys.has(`${key}:${di}`)) ? ' has-hit' : '';
    return `<div class="cell cell--drawers${dHit}">${drawers}</div>`;
  }
  const boxes = c.games.map(id => box(id, ctx)).join('');
  if (c.kind === 'doors') {
    if (!hit && !state.open.has(key)) {
      return `<div class="cell"><button type="button" class="doors" data-toggle="${key}" aria-label="Open doors, row ${c.row} column ${c.col}"><span class="door"></span><span class="door"></span><span class="badge">${c.games.length} inside</span></button></div>`;
    }
    const edges = `<button type="button" class="door-edge left" data-toggle="${key}" aria-label="Close doors"></button><button type="button" class="door-edge right" data-toggle="${key}" aria-label="Close doors"></button>`;
    return `<div class="cell cell--doors-open ${layout}${hit}">${edges}${boxes}</div>`;
  }
  return `<div class="cell ${layout}${hit}">${boxes}</div>`;
}

function frameHtml(u, prefix, ctx) {
  const byPos = new Map(u.cells.map(c => [`${c.row}:${c.col}`, c]));
  const cells = [];
  for (let r = 1; r <= u.rows; r++) for (let c = 1; c <= u.cols; c++) cells.push(cellHtml(prefix, byPos.get(`${r}:${c}`), ctx));
  return `<div class="frame">${cells.join('')}</div>`;
}

function topHtml(u, prefix, ctx, [from, to]) {
  if (!u.top || !u.top.games.length || to <= from) return '';
  const hit = ctx.hitKeys.has(`${prefix}:top`) ? ' has-hit' : '';
  return `<div class="top-surface ${u.top.layout || 'standing'}${hit}" style="--from:${from};--span:${to - from}">${u.top.games.map(id => box(id, ctx)).join('')}</div>`;
}

function kallaxHtml(s, ctx) {
  const cols = Array.from({ length: s.cols }, (_, i) => `<span>${i + 1}</span>`).join('');
  const rows = Array.from({ length: s.rows }, (_, i) => `<span>${i + 1}</span>`).join('');
  const top = s.top && s.top.games.length ? ' has-top' : '';
  return `<section class="storage">
    <div class="storage-head"><h2>${esc(s.name)}</h2><span class="meta">Kallax ${s.rows} × ${s.cols}</span></div>
    <div class="scroll${top}"><div class="grid-wrap" style="--cols:${s.cols};--rows:${s.rows}">
      <div class="labels cols">${cols}</div><div class="labels rows">${rows}</div>
      <div class="unit">${topHtml(s, s.id, ctx, [0, s.cols])}${frameHtml(s, s.id, ctx)}</div>
    </div></div></section>`;
}

function wallHtml(s, ctx) {
  const stacks = s.stacks.map(st => {
    const units = st.units.map((u, i) => {
      const above = st.units[i + 1];
      const span = !above ? [0, u.cols] : above.align === 'right' ? [0, u.cols - above.cols] : [above.cols, u.cols];
      const prefix = `${s.id}.${u.id}`;
      return `<div class="unit unit--${u.align === 'right' ? 'right' : 'left'}" style="--cols:${u.cols}" title="${esc(u.name)}">${topHtml(u, prefix, ctx, span)}${frameHtml(u, prefix, ctx)}</div>`;
    });
    return `<div class="stack">${units.reverse().join('')}</div>`;
  }).join('');
  const count = s.stacks.reduce((n, st) => n + st.units.length, 0);
  const cols = s.stacks.reduce((n, st) => n + Math.max(...st.units.map(u => u.cols)), 0);
  const extra = (cols + s.stacks.length) * 8 + 3 * (s.stacks.length - 1) + 8;
  return `<section class="storage storage--wall" style="--wc:${cols};--wx:${extra}px">
    <div class="storage-head"><h2>${esc(s.name)}</h2><span class="meta">Wall · ${count} Kallax units</span></div>
    <div class="scroll"><div class="wall">${stacks}</div></div></section>`;
}

function shelfHtml(s, ctx) {
  const shelves = s.shelves.map((sh, si) => {
    const hit = ctx.hitKeys.has(`${s.id}:${si}`) ? ' has-hit' : '';
    return `<div class="shelf ${sh.layout || 'standing'}${hit}">${sh.games.map(id => box(id, ctx)).join('')}</div>`;
  }).join('');
  const rows = s.shelves.map((_, i) => `<span>${i + 1}</span>`).join('');
  return `<section class="storage">
    <div class="storage-head"><h2>${esc(s.name)}</h2><span class="meta">Shelf · ${s.shelves.length} levels</span></div>
    <div class="scroll"><div class="grid-wrap" style="--rows:${s.shelves.length}">
      <div></div><div class="labels shelf-rows">${rows}</div>
      <div class="bookcase" style="--w:${s.width || 3}">${shelves}</div>
    </div></div></section>`;
}

function panelHtml(ctx) {
  const legend = `<div class="block"><div class="block-head">Cell types</div><div class="legend">
    <div><span class="sw sw-open"></span>Open cube</div><div><span class="sw sw-doors"></span>Doors</div>
    <div><span class="sw sw-drawers"></span>Two drawers</div><div><span class="sw sw-shelf"></span>Plain shelf</div>
    <div><span class="sw sw-top"></span>On top of a unit</div></div></div>`;
  const head = '<div class="eyebrow">Where is it?</div>';
  if (!ctx.q) return `${head}<p>Type a game name or tap any box. Doors open and drawers light up when the game is inside.</p>${legend}`;
  if (!ctx.found.length) return `${head}<p>No game matches “${esc(state.query)}”.</p>${legend}`;

  const topId = ctx.found[0].id;
  const g = game(topId);
  const wheres = ctx.found.filter(p => p.id === topId).map(p => `<div class="where">${PIN}<span>${esc(p.where)}</span></div>`).join('');
  const link = g.bgg ? `<a class="bgg-link" href="https://boardgamegeek.com/boardgame/${g.bgg}" target="_blank" rel="noopener">Open on BoardGameGeek ↗</a>` : '';

  const ex = g.expansions || { owned: [], notOwned: [] };
  const total = ex.owned.length + ex.notOwned.length;
  const exp = total ? `<div class="block"><div class="block-head">Expansions<span class="meta">${ex.owned.length} of ${total} owned</span></div>
    ${ex.owned.map(n => `<div class="exp">${CHECK}<span>${esc(n)}</span></div>`).join('')}
    ${ex.notOwned.map(n => `<div class="exp missing">${RING}<span>${esc(n)} · not owned</span></div>`).join('')}</div>` : '';

  const others = ctx.found.filter(p => p.id !== topId);
  const more = others.length ? `<div class="block"><div class="block-head">Also matching</div>
    ${others.map(p => `<button type="button" class="match" data-game="${esc(p.id)}"><strong>${esc(game(p.id).name)}</strong><span>${esc(p.where)}</span></button>`).join('')}</div>` : '';

  return `${head}<div><div class="result-name">${esc(g.name)}</div>${wheres}${link}</div>${exp}${more}${legend}`;
}

function render() {
  const q = state.query.trim().toLowerCase();
  const found = matches(q);
  const ctx = { q, found, hitIds: new Set(found.map(p => p.id)), hitKeys: new Set() };
  for (const p of found) {
    ctx.hitKeys.add(p.key);
    if (p.key.split(':').length === 4) ctx.hitKeys.add(p.key.split(':').slice(0, 3).join(':'));
  }
  $('#storages').innerHTML = data.storages.map(s => s.type === 'kallax' ? kallaxHtml(s, ctx) : s.type === 'wall' ? wallHtml(s, ctx) : shelfHtml(s, ctx)).join('');
  $('#panel').innerHTML = panelHtml(ctx);
  const peek = $('#peek');
  peek.hidden = !q;
  if (q) {
    const top = found[0];
    const more = top ? new Set(found.map(p => p.id)).size - 1 : 0;
    peek.innerHTML = top ? `${PIN}<span><strong>${esc(game(top.id).name)}</strong> · ${esc(top.where)}${more ? ` <em>+${more} more</em>` : ''}</span>` : '<span>No match</span>';
  }
}

let revealTimer;
function revealHit(force = false) {
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    const el = document.querySelector('.box.is-hit, .drawer.is-hit');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const barBottom = Math.max(0, $('.search').getBoundingClientRect().bottom);
    const visible = r.top >= barBottom && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    if (force || !visible) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, force ? 0 : 400);
}

function setQuery(v, reveal = false) {
  state.query = v;
  $('#q').value = v;
  history.replaceState(null, '', v ? `#q=${encodeURIComponent(v)}` : location.pathname + location.search);
  render();
  if (reveal && state.query.trim()) revealHit();
}

function bind() {
  $('#q').addEventListener('input', e => setQuery(e.target.value, true));
  $('#peek').addEventListener('click', () => revealHit(true));
  $('#q').addEventListener('keydown', e => { if (e.key === 'Escape') setQuery(''); });
  $('#clear').addEventListener('click', () => { setQuery(''); $('#q').focus(); });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); }
  });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-game], [data-toggle]');
    if (!t) return;
    if (t.dataset.game) return setQuery(game(t.dataset.game).name);
    const k = t.dataset.toggle;
    state.open.has(k) ? state.open.delete(k) : state.open.add(k);
    render();
  });
}

async function init() {
  try {
    const res = await fetch('collection.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $('#storages').innerHTML = `<div class="error">Couldn't load collection.json (${esc(err.message)}). Opening index.html directly from disk blocks this; serve the folder over HTTP instead.</div>`;
    return;
  }
  indexPlaces();
  const unique = new Set(places.map(p => p.id)).size;
  $('#stats').textContent = `${unique} games · ${data.storages.length} storages`;
  const m = location.hash.match(/^#q=(.*)$/);
  setQuery(m ? decodeURIComponent(m[1]) : '', true);
  bind();
}

init();
