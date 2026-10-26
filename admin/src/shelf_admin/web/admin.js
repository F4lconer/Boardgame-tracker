const PALETTE = ['#3E5C76', '#7A4E3B', '#4F7A5C', '#8A6D2F', '#5B4B7A', '#2F6F73', '#8C3F4D', '#5E6A3A', '#46505E', '#9A5B2E'];
const KINDS = ['open', 'doors', 'drawers', 'empty'];
const LAYOUTS = ['standing', 'stacked'];
const SIZES = ['small', 'standard', 'large'];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
const unique = (base, taken) => { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; return id; };
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || lo));

let doc, version, saved;
let sel = null;
let undoStack = [];
let issues = { errors: [], warnings: [] };
let drag = null;

const games = () => (doc.games ||= {});
const gameName = id => doc.games?.[id]?.name || id;
const colorOf = id => doc.games?.[id]?.color || PALETTE[hash(id) % PALETTE.length];
const dirty = () => JSON.stringify(doc) !== saved;

function change(fn) {
  const before = JSON.stringify(doc);
  fn();
  if (JSON.stringify(doc) === before) return;
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  render();
  queueValidate();
}

function undo() {
  if (!undoStack.length) return;
  doc = JSON.parse(undoStack.pop());
  render();
  queueValidate();
}

/* ---------- slots: places that hold a list of games ---------- */

const slotKey = (s, st, u, part) => `${s}/${st ?? '-'}/${u ?? '-'}/${part}`;

function slot(key) {
  const [s, st, u, part] = key.split('/');
  const storage = doc.storages?.[+s];
  if (!storage) return null;
  const unit = st === '-' ? storage : storage.stacks?.[+st]?.units?.[+u];
  if (!unit) return null;
  const out = { key, s: +s, st: st === '-' ? null : +st, u: u === '-' ? null : +u, storage, unit };
  let m;
  if ((m = part.match(/^c(\d+),(\d+)(?:d(\d))?$/))) Object.assign(out, { type: m[3] ? 'drawer' : 'cell', r: +m[1], c: +m[2], d: m[3] ? +m[3] : null });
  else if (part === 'top') out.type = 'top';
  else if ((m = part.match(/^l(\d+)$/)) && storage.shelves?.[+m[1]]) Object.assign(out, { type: 'level', l: +m[1] });
  else return null;
  if (out.type === 'drawer' && cellAt(unit, out.r, out.c)?.kind !== 'drawers') return null;
  return out;
}

const cellAt = (unit, r, c) => (unit.cells || []).find(x => x.at?.[0] === r && x.at?.[1] === c);

function gamesOf(sl, create = false) {
  if (sl.type === 'level') {
    const sh = sl.storage.shelves[sl.l];
    if (create) sh.games ||= [];
    return sh.games || [];
  }
  if (sl.type === 'top') {
    if (create) { sl.unit.top ||= { layout: 'standing', games: [] }; sl.unit.top.games ||= []; }
    return sl.unit.top?.games || [];
  }
  let cell = cellAt(sl.unit, sl.r, sl.c);
  if (sl.type === 'drawer') return cell.drawers[sl.d];
  if (create) {
    if (!cell || cell.kind === 'empty') {
      const next = { at: [sl.r, sl.c], kind: 'open', layout: 'standing', games: [] };
      const cells = (sl.unit.cells ||= []);
      cell ? cells.splice(cells.indexOf(cell), 1, next) : cells.push(next);
      cell = next;
    }
    cell.games ||= [];
  }
  return cell?.games || [];
}

function unitSlots(u, si, st, ui) {
  const out = [];
  for (const c of u.cells || []) {
    const key = slotKey(si, st, ui, `c${c.at[0]},${c.at[1]}`);
    if (c.kind === 'drawers') (c.drawers || []).forEach((d, di) => out.push([`${key}d${di}`, d]));
    else out.push([key, c.games || []]);
  }
  if (u.top) out.push([slotKey(si, st, ui, 'top'), u.top.games || []]);
  return out;
}

function storageSlots(s, si) {
  if (s.type === 'kallax') return unitSlots(s, si, null, null);
  if (s.type === 'wall') return (s.stacks || []).flatMap((st, sti) => (st.units || []).flatMap((u, ui) => unitSlots(u, si, sti, ui)));
  return (s.shelves || []).map((sh, l) => [slotKey(si, null, null, `l${l}`), sh.games || []]);
}

const allSlots = () => (doc.storages || []).flatMap(storageSlots);
const countGames = slots => slots.reduce((n, [, g]) => n + g.length, 0);

function label(sl) {
  const parts = [sl.storage.name];
  if (sl.st !== null) parts.push(sl.unit.name || sl.unit.id);
  if (sl.type === 'level') parts.push(`shelf ${sl.l + 1}`);
  else if (sl.type === 'top') parts.push('on top');
  else parts.push(`row ${sl.r}, column ${sl.c}`);
  return parts.join(' · ');
}

/* ---------- shelves ---------- */

function boxHtml(id, key, i) {
  const g = doc.games?.[id] || {};
  return `<button type="button" class="box box--${g.size || 'standard'}" style="--c:${colorOf(id)}" draggable="true" data-game="${esc(id)}" data-from="${key}" data-idx="${i}" title="${esc(gameName(id))}">${esc(gameName(id))}</button>`;
}

const selCls = key => (sel?.key === key ? ' is-selected' : '');

function cellHtml(u, si, st, ui, r, c) {
  const key = slotKey(si, st, ui, `c${r},${c}`);
  const cell = cellAt(u, r, c);
  const kind = cell?.kind || 'empty';
  if (kind === 'empty') return `<div class="cell cell--empty slot${selCls(key)}" data-slot="${key}">empty</div>`;
  if (kind === 'drawers') {
    const drawers = (cell.drawers || [[], []]).map((d, di) => {
      const names = d.map(gameName).join(', ');
      return `<div class="drawer slot" data-slot="${key}d${di}" title="${esc(names)}"><span class="pull"></span><span class="label">${esc(names || 'empty')}</span></div>`;
    }).join('');
    return `<div class="cell cell--drawers${selCls(key)}" data-cell="${key}">${drawers}</div>`;
  }
  const list = cell.games || [];
  const doors = kind === 'doors' ? '<span class="door-edge left"></span><span class="door-edge right"></span><span class="kind-tag">doors</span>' : '';
  return `<div class="cell ${cell.layout || 'standing'}${kind === 'doors' ? ' cell--doors-open' : ''} slot${selCls(key)}" data-slot="${key}">${doors}${list.map((id, i) => boxHtml(id, key, i)).join('')}</div>`;
}

function frameHtml(u, si, st, ui) {
  const rows = int(u.rows, 1, 20), cols = int(u.cols, 1, 20);
  const cells = [];
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) cells.push(cellHtml(u, si, st, ui, r, c));
  return `<div class="frame" style="--cols:${cols}">${cells.join('')}</div>`;
}

function topHtml(u, si, st, ui, [from, to]) {
  if (to <= from) return '';
  const key = slotKey(si, st, ui, 'top');
  const t = u.top || {};
  const list = t.games || [];
  const boxes = list.map((id, i) => boxHtml(id, key, i)).join('') || '<span class="hint">top</span>';
  return `<div class="top-surface ${t.layout || 'standing'} slot${list.length ? '' : ' is-blank'}${selCls(key)}" data-slot="${key}" style="--from:${from};--span:${to - from}">${boxes}</div>`;
}

function headHtml(s, si, meta) {
  return `<div class="storage-head"><h2><button type="button" class="storage-name" data-storage="${si}">${esc(s.name || s.id)}<span>edit</span></button></h2><span class="meta">${esc(meta)}</span></div>`;
}

const current = si => (sel?.kind === 'storage' && sel.s === si) || (sel?.kind === 'slot' && slot(sel.key)?.s === si);

function kallaxHtml(s, si) {
  const rows = int(s.rows, 1, 20), cols = int(s.cols, 1, 20);
  const labels = n => Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join('');
  return `<section class="storage${current(si) ? ' is-current' : ''}">
    ${headHtml(s, si, `Kallax ${rows} × ${cols}`)}
    <div class="scroll has-top"><div class="grid-wrap" style="--cols:${cols};--rows:${rows}">
      <div class="labels cols">${labels(cols)}</div><div class="labels rows">${labels(rows)}</div>
      <div class="unit">${topHtml(s, si, null, null, [0, cols])}${frameHtml(s, si, null, null)}</div>
    </div></div></section>`;
}

function wallHtml(s, si) {
  const stacks = (s.stacks || []).filter(st => st.units?.length);
  const html = (s.stacks || []).map((st, sti) => {
    const units = (st.units || []).map((u, ui) => {
      const cols = int(u.cols, 1, 20);
      const above = st.units[ui + 1];
      const ac = above ? int(above.cols, 1, 20) : 0;
      const span = !above ? [0, cols] : above.align === 'right' ? [0, cols - ac] : [ac, cols];
      return `<div class="unit unit--${u.align === 'right' ? 'right' : 'left'}" style="--cols:${cols}" title="${esc(u.name || u.id)}">${topHtml(u, si, sti, ui, span)}${frameHtml(u, si, sti, ui)}</div>`;
    });
    return `<div class="stack">${units.reverse().join('')}</div>`;
  }).join('');
  const count = stacks.reduce((n, st) => n + st.units.length, 0);
  const cols = stacks.reduce((n, st) => n + Math.max(...st.units.map(u => int(u.cols, 1, 20))), 0) || 1;
  const extra = (cols + stacks.length) * 8 + 3 * Math.max(0, stacks.length - 1) + 8;
  return `<section class="storage storage--wall${current(si) ? ' is-current' : ''}" style="--wc:${cols};--wx:${extra}px">
    ${headHtml(s, si, `Wall · ${count} Kallax unit${count === 1 ? '' : 's'}`)}
    <div class="scroll"><div class="wall">${html}</div></div></section>`;
}

function shelfHtml(s, si) {
  const shelves = s.shelves || [];
  const levels = shelves.map((sh, l) => {
    const key = slotKey(si, null, null, `l${l}`);
    return `<div class="shelf ${sh.layout || 'standing'} slot${selCls(key)}" data-slot="${key}">${(sh.games || []).map((id, i) => boxHtml(id, key, i)).join('')}</div>`;
  }).join('');
  const rows = shelves.map((_, i) => `<span>${i + 1}</span>`).join('');
  return `<section class="storage${current(si) ? ' is-current' : ''}">
    ${headHtml(s, si, `Shelf · ${shelves.length} level${shelves.length === 1 ? '' : 's'}`)}
    <div class="scroll"><div class="grid-wrap" style="--rows:${shelves.length}">
      <div></div><div class="labels shelf-rows">${rows}</div>
      <div class="bookcase" style="--w:${int(s.width, 1, 20)}">${levels}</div>
    </div></div></section>`;
}

const addStorageHtml = `<section class="storage add-storage"><div class="eyebrow">Add storage</div>
  <div class="row"><button type="button" class="mini" data-act="add-storage" data-v="kallax">+ Kallax</button>
  <button type="button" class="mini" data-act="add-storage" data-v="wall">+ Wall</button>
  <button type="button" class="mini" data-act="add-storage" data-v="shelf">+ Shelf</button></div></section>`;

/* ---------- panel ---------- */

function seg(act, values, cur, attrs) {
  return `<div class="seg">${values.map(v => `<button type="button" data-act="${act}" data-v="${v}" ${attrs} class="${v === cur ? 'on' : ''}">${v}</button>`).join('')}</div>`;
}

function listEditor(key, title) {
  const sl = slot(key);
  const list = gamesOf(sl);
  const items = list.map((id, i) => `<li><span class="sw-box" style="--c:${colorOf(id)}"></span><span class="name" title="${esc(gameName(id))}">${esc(gameName(id))}</span>
    <button type="button" class="icon" data-act="up" data-key="${key}" data-i="${i}" ${i ? '' : 'disabled'} aria-label="Move earlier">↑</button>
    <button type="button" class="icon" data-act="down" data-key="${key}" data-i="${i}" ${i < list.length - 1 ? '' : 'disabled'} aria-label="Move later">↓</button>
    <button type="button" class="icon" data-act="remove" data-key="${key}" data-i="${i}" aria-label="Take off the shelf">×</button></li>`).join('');
  return `<div class="block"><div class="block-head">${esc(title)}<span class="meta">${list.length}</span></div>
    ${items ? `<ol class="glist">${items}</ol>` : '<p class="small">Nothing here yet.</p>'}
    <form class="add-game" data-key="${key}"><input name="game" list="game-names" placeholder="Add a game…" autocomplete="off" aria-label="Game name">
      <select name="size" aria-label="Box size for a new game"><option value="">size (new)</option>${SIZES.map(s => `<option>${s}</option>`).join('')}</select>
      <button type="submit" class="mini">Add</button></form></div>`;
}

const order = layout => (layout === 'stacked' ? 'top → bottom' : 'left → right');

function slotPanel(sl) {
  const head = `<div><div class="eyebrow">${sl.type === 'level' ? 'Shelf level' : sl.type === 'top' ? 'On top of unit' : 'Cube'}</div><h3>${esc(label(sl))}</h3></div>`;
  const a = `data-key="${sl.key}"`;
  if (sl.type === 'level') {
    const sh = sl.storage.shelves[sl.l];
    return `${head}${seg('layout', LAYOUTS, sh.layout || 'standing', a)}${listEditor(sl.key, `Games, ${order(sh.layout)}`)}`;
  }
  if (sl.type === 'top') {
    const t = sl.unit.top || {};
    return `${head}${seg('layout', LAYOUTS, t.layout || 'standing', a)}${listEditor(sl.key, `Games, ${order(t.layout)}`)}`;
  }
  const cell = cellAt(sl.unit, sl.r, sl.c);
  const kind = cell?.kind || 'empty';
  let body = '';
  if (kind === 'drawers') body = listEditor(`${sl.key}d0`, 'Top drawer') + listEditor(`${sl.key}d1`, 'Bottom drawer');
  else if (kind === 'empty') body = '<p class="small">Empty cube. Pick a type above, or drop a game here.</p>';
  else body = seg('layout', LAYOUTS, cell.layout || 'standing', a) + listEditor(sl.key, `Games, ${order(cell.layout)}`);
  return `${head}${seg('kind', KINDS, kind, a)}${body}`;
}

function unitFields(u, attrs, withAlign) {
  return `<div class="fields">
    <label class="field">Rows<input type="number" min="1" max="20" value="${esc(u.rows)}" data-field="rows" ${attrs}></label>
    <label class="field">Columns<input type="number" min="1" max="20" value="${esc(u.cols)}" data-field="cols" ${attrs}></label>
    ${withAlign ? `<label class="field">Sits on below<select data-field="align" ${attrs}>${['left', 'right'].map(v => `<option ${(u.align || 'left') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
  </div>`;
}

function storagePanel(si) {
  const s = doc.storages[si];
  const a = `data-s="${si}"`;
  let body = '';
  if (s.type === 'kallax') body = unitFields(s, a, false);
  else if (s.type === 'shelf') {
    const levels = (s.shelves || []).map((sh, l) => `<li><span class="name">Shelf ${l + 1} · ${(sh.games || []).length} games</span>
      <select data-field="layout" ${a} data-l="${l}" aria-label="Layout">${LAYOUTS.map(v => `<option ${(sh.layout || 'standing') === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button type="button" class="icon" data-act="level-up" ${a} data-i="${l}" ${l ? '' : 'disabled'} aria-label="Move up">↑</button>
      <button type="button" class="icon" data-act="level-down" ${a} data-i="${l}" ${l < s.shelves.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button>
      <button type="button" class="icon" data-act="level-del" ${a} data-i="${l}" aria-label="Remove level">×</button></li>`).join('');
    body = `<label class="field">Width (in cube widths)<input type="number" min="1" max="20" value="${esc(s.width ?? 3)}" data-field="width" ${a}></label>
      <div class="block"><div class="block-head">Levels<span class="meta">top → bottom</span></div><ol class="glist">${levels}</ol>
      <div class="row"><button type="button" class="mini" data-act="level-add" ${a}>+ Add level at bottom</button></div></div>`;
  } else {
    const stacks = (s.stacks || []).map((st, sti) => {
      const units = (st.units || []).map((u, ui) => ({ u, ui })).reverse().map(({ u, ui }) => {
        const ua = `${a} data-st="${sti}" data-u="${ui}"`;
        return `<div class="card"><div class="card-head"><span class="grow">${ui ? `Unit ${ui + 1} from bottom` : 'Bottom unit'}</span>
          <button type="button" class="icon" data-act="unit-del" ${ua} aria-label="Remove unit">×</button></div>
          <div class="fields two"><label class="field">Name<input value="${esc(u.name || '')}" data-field="name" ${ua}></label>
          <label class="field">Id<input value="${esc(u.id || '')}" data-field="id" ${ua}></label></div>
          ${unitFields(u, ua, ui > 0)}</div>`;
      }).join('');
      const sa = `${a} data-st="${sti}"`;
      return `<div class="card"><div class="card-head"><span class="grow">Stack ${sti + 1}</span>
        <button type="button" class="icon" data-act="stack-left" ${sa} ${sti ? '' : 'disabled'} aria-label="Move left">←</button>
        <button type="button" class="icon" data-act="stack-right" ${sa} ${sti < s.stacks.length - 1 ? '' : 'disabled'} aria-label="Move right">→</button>
        <button type="button" class="icon" data-act="stack-del" ${sa} aria-label="Remove stack">×</button></div>
        <button type="button" class="mini" data-act="unit-add" ${sa}>+ Add unit on top</button>${units}</div>`;
    }).join('');
    body = `<div class="block"><div class="block-head">Stacks<span class="meta">left → right, units listed top first</span></div>${stacks}
      <div class="row"><button type="button" class="mini" data-act="stack-add" ${a}>+ Add stack on the right</button></div></div>`;
  }
  return `<div><div class="eyebrow">${esc(s.type)} storage</div><h3>${esc(s.name || s.id)}</h3></div>
    <div class="fields two"><label class="field">Name<input value="${esc(s.name || '')}" data-field="name" ${a}></label>
    <label class="field">Id<input value="${esc(s.id || '')}" data-field="id" ${a}></label></div>
    ${body}
    <div class="block"><div class="row">
      <button type="button" class="mini" data-act="storage-up" ${a} ${si ? '' : 'disabled'}>Move earlier</button>
      <button type="button" class="mini" data-act="storage-down" ${a} ${si < doc.storages.length - 1 ? '' : 'disabled'}>Move later</button>
      <button type="button" class="mini danger" data-act="storage-del" ${a}>Delete storage</button></div></div>`;
}

const intro = `<div><div class="eyebrow">Edit</div><h3>Drag boxes to move them</h3></div>
  <p>Drop on any cube, drawer, shelf or the dashed area on top of a unit. Click a cube to change its type or add games; click a storage name to change its layout.</p>
  <p class="small">Ctrl+S saves · Ctrl+Z undoes · Esc deselects</p>`;

function trayHtml() {
  const placed = new Set(allSlots().flatMap(([, g]) => g));
  const ids = Object.keys(doc.games || {}).filter(id => !placed.has(id)).sort((a, b) => gameName(a).localeCompare(gameName(b)));
  const chips = ids.map(id => `<span class="chip" draggable="true" data-game="${esc(id)}" data-from="" data-idx="-1">${esc(gameName(id))}<button type="button" data-act="game-del" data-v="${esc(id)}" aria-label="Delete ${esc(gameName(id))}">×</button></span>`).join('');
  return `<div class="block tray slot" data-slot="unplaced"><div class="block-head">Not on a shelf<span class="meta">${ids.length}</span></div>
    ${chips ? `<div class="chips">${chips}</div>` : '<p class="small">Drop a box here to take it off the shelves.</p>'}</div>`;
}

function issuesHtml() {
  const warnings = issues.warnings.filter(w => !/not placed anywhere/.test(w));
  if (!issues.errors.length && !warnings.length) return '';
  return `<div class="block"><div class="block-head">Problems<span class="meta">${issues.errors.length} error${issues.errors.length === 1 ? '' : 's'}</span></div>
    ${issues.errors.map(e => `<div class="issue err">${esc(e)}</div>`).join('')}${warnings.map(w => `<div class="issue warn">${esc(w)}</div>`).join('')}</div>`;
}

function renderStatus() {
  const n = Object.keys(doc.games || {}).length;
  const st = $('#status');
  const d = dirty(), bad = issues.errors.length;
  st.textContent = `${n} games · ${(doc.storages || []).length} storages · ${bad ? `${bad} error${bad === 1 ? '' : 's'}` : d ? 'unsaved changes' : 'saved'}`;
  st.className = `stats${bad ? ' bad' : d ? ' dirty' : ''}`;
  $('#save').disabled = !d || !!bad;
  $('#undo').disabled = !undoStack.length;
  $('#issues').innerHTML = issuesHtml();
}

function render() {
  if (sel?.kind === 'slot' && !slot(sel.key)) sel = null;
  if (sel?.kind === 'storage' && !doc.storages?.[sel.s]) sel = null;
  const storages = (doc.storages || []).map((s, si) => s.type === 'kallax' ? kallaxHtml(s, si) : s.type === 'wall' ? wallHtml(s, si) : shelfHtml(s, si));
  $('#storages').innerHTML = storages.join('') + addStorageHtml;
  $('#panel').innerHTML = sel?.kind === 'slot' ? slotPanel(slot(sel.key)) : sel?.kind === 'storage' ? storagePanel(sel.s) : intro;
  $('#tray').innerHTML = trayHtml();
  $('#game-names').innerHTML = Object.values(doc.games || {}).map(g => `<option value="${esc(g.name)}">`).join('');
  renderStatus();
}

/* ---------- edits ---------- */

function moveGame(d, to, at) {
  if (!d.from && !to) return;
  if (d.from && d.from === to && (at === d.idx || at === d.idx + 1)) return;
  change(() => {
    if (d.from) gamesOf(slot(d.from)).splice(d.idx, 1);
    if (!to) return;
    const dst = gamesOf(slot(to), true);
    if (d.from === to && d.idx < at) at--;
    dst.splice(at ?? dst.length, 0, d.id);
  });
}

function setKind(key, kind) {
  const sl = slot(key);
  change(() => {
    const cells = (sl.unit.cells ||= []);
    const cell = cellAt(sl.unit, sl.r, sl.c);
    const list = cell ? (cell.kind === 'drawers' ? (cell.drawers || []).flat() : cell.games || []) : [];
    if (kind === 'empty') {
      if (cell) cells.splice(cells.indexOf(cell), 1);
      return;
    }
    const next = kind === 'drawers'
      ? { at: [sl.r, sl.c], kind, drawers: [list, []] }
      : { at: [sl.r, sl.c], kind, layout: cell?.layout || 'standing', games: list };
    cell ? cells.splice(cells.indexOf(cell), 1, next) : cells.push(next);
  });
}

function setLayout(key, layout) {
  const sl = slot(key);
  change(() => {
    if (sl.type === 'level') sl.storage.shelves[sl.l].layout = layout;
    else if (sl.type === 'top') (sl.unit.top ||= { layout, games: [] }).layout = layout;
    else cellAt(sl.unit, sl.r, sl.c).layout = layout;
  });
}

function addGame(key, name, size) {
  const existing = Object.entries(doc.games || {}).find(([, g]) => g.name?.toLowerCase() === name.toLowerCase());
  change(() => {
    let id = existing?.[0];
    if (!id) {
      id = unique(slug(name), new Set(Object.keys(games())));
      games()[id] = size ? { name, size } : { name };
    }
    gamesOf(slot(key), true).push(id);
  });
}

function unitGameCount(u) {
  return countGames(unitSlots(u, 0, null, null));
}

function confirmLoss(n, what) {
  return !n || confirm(`${n} game${n === 1 ? '' : 's'} in ${what} will move to "Not on a shelf". Continue?`);
}

function resize(unit, rows, cols) {
  const out = (unit.cells || []).filter(c => c.at[0] > rows || c.at[1] > cols);
  const n = countGames(unitSlots({ cells: out }, 0, null, null));
  if (!confirmLoss(n, `cubes outside ${rows} × ${cols}`)) return render();
  change(() => {
    unit.rows = rows;
    unit.cols = cols;
    if (unit.cells) unit.cells = unit.cells.filter(c => !out.includes(c));
  });
}

const swap = (arr, i, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };

function newStorage(type) {
  const ids = new Set((doc.storages || []).map(s => s.id));
  const name = { kallax: 'New Kallax', wall: 'New wall', shelf: 'New shelf' }[type];
  const id = unique(slug(name), ids);
  if (type === 'kallax') return { id, name, type, rows: 4, cols: 4, cells: [] };
  if (type === 'wall') return { id, name, type, stacks: [{ units: [{ id: 'unit-1', name: 'Unit 1', rows: 5, cols: 5, cells: [] }] }] };
  return { id, name, type, width: 3, shelves: [1, 2, 3].map(() => ({ layout: 'standing', games: [] })) };
}

function newUnit(wall, rows, cols, align) {
  const ids = new Set((wall.stacks || []).flatMap(st => (st.units || []).map(u => u.id)));
  let n = 1;
  while (ids.has(`unit-${n}`)) n++;
  return { id: `unit-${n}`, name: `Unit ${n}`, rows, cols, ...(align ? { align } : {}), cells: [] };
}

const ACTIONS = {
  up: d => change(() => { const l = gamesOf(slot(d.key)); swap(l, +d.i, +d.i - 1); }),
  down: d => change(() => { const l = gamesOf(slot(d.key)); swap(l, +d.i, +d.i + 1); }),
  remove: d => change(() => { gamesOf(slot(d.key)).splice(+d.i, 1); }),
  kind: d => setKind(d.key, d.v),
  layout: d => setLayout(d.key, d.v),
  'game-del': d => change(() => { delete doc.games[d.v]; }),
  'add-storage': d => change(() => {
    (doc.storages ||= []).push(newStorage(d.v));
    sel = { kind: 'storage', s: doc.storages.length - 1 };
  }),
  'storage-up': d => change(() => { swap(doc.storages, +d.s, +d.s - 1); sel = { kind: 'storage', s: +d.s - 1 }; }),
  'storage-down': d => change(() => { swap(doc.storages, +d.s, +d.s + 1); sel = { kind: 'storage', s: +d.s + 1 }; }),
  'storage-del': d => {
    const s = doc.storages[+d.s];
    if (!confirm(`Delete "${s.name}"?${countGames(storageSlots(s, +d.s)) ? ' Its games move to "Not on a shelf".' : ''}`)) return;
    change(() => { doc.storages.splice(+d.s, 1); sel = null; });
  },
  'level-add': d => change(() => { (doc.storages[+d.s].shelves ||= []).push({ layout: 'standing', games: [] }); }),
  'level-del': d => {
    const sh = doc.storages[+d.s].shelves;
    if (!confirmLoss((sh[+d.i].games || []).length, `shelf ${+d.i + 1}`)) return;
    change(() => { sh.splice(+d.i, 1); });
  },
  'level-up': d => change(() => swap(doc.storages[+d.s].shelves, +d.i, +d.i - 1)),
  'level-down': d => change(() => swap(doc.storages[+d.s].shelves, +d.i, +d.i + 1)),
  'stack-add': d => change(() => {
    const w = doc.storages[+d.s];
    (w.stacks ||= []).push({ units: [newUnit(w, 5, 5)] });
  }),
  'stack-del': d => {
    const st = doc.storages[+d.s].stacks[+d.st];
    if (!confirmLoss((st.units || []).reduce((n, u) => n + unitGameCount(u), 0), `stack ${+d.st + 1}`)) return;
    change(() => { doc.storages[+d.s].stacks.splice(+d.st, 1); });
  },
  'stack-left': d => change(() => swap(doc.storages[+d.s].stacks, +d.st, +d.st - 1)),
  'stack-right': d => change(() => swap(doc.storages[+d.s].stacks, +d.st, +d.st + 1)),
  'unit-add': d => change(() => {
    const w = doc.storages[+d.s];
    const units = (w.stacks[+d.st].units ||= []);
    units.push(newUnit(w, 2, units.length ? int(units.at(-1).cols, 1, 20) : 4, units.length ? 'left' : null));
  }),
  'unit-del': d => {
    const units = doc.storages[+d.s].stacks[+d.st].units;
    if (!confirmLoss(unitGameCount(units[+d.u]), `"${units[+d.u].name || units[+d.u].id}"`)) return;
    change(() => { units.splice(+d.u, 1); });
  },
};

function fieldTarget(d) {
  const s = doc.storages[+d.s];
  if (d.l !== undefined) return s.shelves[+d.l];
  if (d.st !== undefined) return s.stacks[+d.st].units[+d.u];
  return s;
}

function onField(el) {
  const d = el.dataset;
  const target = fieldTarget(d);
  const f = d.field;
  let v = el.value.trim();
  if (f === 'rows' || f === 'cols') {
    v = int(v, 1, 20);
    return resize(target, f === 'rows' ? v : int(target.rows, 1, 20), f === 'cols' ? v : int(target.cols, 1, 20));
  }
  if (f === 'width') v = int(v, 1, 20);
  if (f === 'id') v = slug(v);
  if ((f === 'name' || f === 'id') && !v) return render();
  change(() => {
    if (f === 'align' && v === 'left') delete target.align;
    else target[f] = v;
  });
}

/* ---------- server ---------- */

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

let validateTimer, validateSeq = 0;
function queueValidate() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(async () => {
    const seq = ++validateSeq;
    const { body } = await api('POST', '/api/validate', { data: doc });
    if (seq !== validateSeq) return;
    issues = body;
    renderStatus();
  }, 250);
}

function normalized() {
  const out = structuredClone(doc);
  const tidy = u => {
    if (u.top && !(u.top.games || []).length) delete u.top;
    (u.cells || []).sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
  };
  for (const s of out.storages || []) {
    if (s.type === 'kallax') tidy(s);
    if (s.type === 'wall') (s.stacks || []).forEach(st => (st.units || []).forEach(tidy));
  }
  return out;
}

function notice(text, err = false) {
  const n = $('#notice');
  n.hidden = !text;
  n.className = `notice${err ? ' err' : ''}`;
  n.innerHTML = text || '';
}

function load(snap) {
  doc = snap.data;
  doc.storages ||= [];
  version = snap.version;
  saved = JSON.stringify(doc);
  issues = { errors: [], warnings: snap.warnings || [] };
  render();
  queueValidate();
}

async function save() {
  if (!dirty() || issues.errors.length) return;
  $('#save').disabled = true;
  const { status, body } = await api('PUT', '/api/collection', { data: normalized(), version });
  if (status === 200) {
    const keep = sel;
    load(body);
    sel = keep;
    render();
    notice('Saved <code>collection.yaml</code> and rebuilt <code>site/collection.json</code>. Commit and push to publish.');
    setTimeout(() => notice(''), 5000);
  } else if (status === 409) {
    notice('<code>collection.yaml</code> changed on disk since this page loaded. Use <b>Revert</b> to load it (your unsaved edits here will be lost).', true);
  } else if (status === 422) {
    issues = body;
    renderStatus();
    notice('Not saved: fix the problems listed in the panel.', true);
  } else {
    notice(`Not saved: ${esc(body.error || status)}`, true);
  }
  renderStatus();
}

async function revert() {
  if (dirty() && !confirm('Discard unsaved changes?')) return;
  const { body } = await api('GET', '/api/collection');
  undoStack = [];
  notice('');
  load(body);
}

/* ---------- events ---------- */

function bind() {
  $('#save').addEventListener('click', save);
  $('#undo').addEventListener('click', undo);
  $('#revert').addEventListener('click', revert);

  document.addEventListener('click', e => {
    const t = e.target;
    const act = t.closest('[data-act]');
    if (act) return ACTIONS[act.dataset.act]?.(act.dataset);
    const st = t.closest('[data-storage]');
    if (st) { sel = { kind: 'storage', s: +st.dataset.storage }; return render(); }
    const sl = t.closest('#storages [data-slot], #storages [data-cell]');
    if (sl) { sel = { kind: 'slot', key: (sl.dataset.slot || sl.dataset.cell).replace(/d\d$/, '') }; return render(); }
    if (t.closest('#storages') && !t.closest('button, input, select, a')) { sel = null; render(); }
  });

  document.addEventListener('change', e => { if (e.target.dataset.field) onField(e.target); });

  document.addEventListener('submit', e => {
    const f = e.target.closest('form.add-game');
    if (!f) return;
    e.preventDefault();
    const name = f.elements.game.value.trim();
    if (!name) return;
    addGame(f.dataset.key, name, f.elements.size.value);
    document.querySelector(`form.add-game[data-key="${f.dataset.key}"] input`)?.focus();
  });

  document.addEventListener('keydown', e => {
    const typing = e.target.closest('input, select, textarea');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (typing) typing.blur(); save(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
    else if (e.key === 'Escape' && !typing) { sel = null; render(); }
  });

  document.addEventListener('dragstart', e => {
    const b = e.target.closest?.('[data-game][draggable]');
    if (!b) return;
    drag = { id: b.dataset.game, from: b.dataset.from || null, idx: +b.dataset.idx };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', drag.id);
    requestAnimationFrame(() => b.classList.add('is-dragging'));
  });
  const clearOver = () => document.querySelectorAll('.is-over').forEach(x => x.classList.remove('is-over'));
  document.addEventListener('dragend', () => { drag = null; clearOver(); document.querySelectorAll('.is-dragging').forEach(x => x.classList.remove('is-dragging')); });
  document.addEventListener('dragover', e => {
    const t = drag && e.target.closest?.('[data-slot]');
    if (!t) return;
    e.preventDefault();
    if (!t.classList.contains('is-over')) { clearOver(); t.classList.add('is-over'); }
  });
  document.addEventListener('drop', e => {
    const t = drag && e.target.closest?.('[data-slot]');
    if (!t) return;
    e.preventDefault();
    const to = t.dataset.slot === 'unplaced' ? null : t.dataset.slot;
    const boxes = [...t.querySelectorAll(':scope > .box')];
    const stacked = t.classList.contains('stacked');
    const i = boxes.findIndex(b => { const r = b.getBoundingClientRect(); return stacked ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2; });
    const d = drag;
    drag = null;
    clearOver();
    moveGame(d, to, i < 0 ? boxes.length : i);
  });

  addEventListener('beforeunload', e => { if (dirty()) e.preventDefault(); });
}

async function init() {
  try {
    const { body } = await api('GET', '/api/collection');
    bind();
    load(body);
  } catch (err) {
    $('#storages').innerHTML = `<div class="error">Couldn't reach the admin server (${esc(err.message)}). Start it with <code>uv run shelf-admin admin</code>.</div>`;
  }
}

init();
