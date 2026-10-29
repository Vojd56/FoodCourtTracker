/* ============================================================
   Food Court Tracker — Forum Nová Karolina Ostrava
   Mapový engine (SVG pan/zoom), seznam, detail, ukládání.
   ============================================================ */
(() => {
'use strict';

const LS_KEY = 'fnk-foodcourt-v1';
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SVGNS = 'http://www.w3.org/2000/svg';

/* Bezpečnostní a pomocné funkce */
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

const safeUrl = url => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
};

const getSavedAuthorId = () => {
  try {
    const s = localStorage.getItem('fnk_active_author_v2');
    if (s && s !== '__proto__' && s !== 'constructor') return s;
  } catch {}
  return 'vojta';
};

const setSavedAuthorId = id => {
  if (!id || id === '__proto__' || id === 'constructor') return;
  ui.reviewAuthorId = id;
  try {
    localStorage.setItem('fnk_active_author_v2', id);
  } catch {}
  if (window.DB) {
    window.DB.setActiveAuthorId(id);
  }
};

function setStorageStatus(shared) {
  const el = $('#storageStatus');
  const badge = $('#cloudStatusBadge');
  const isCloud = (typeof shared === 'boolean') ? shared : (window.DB && window.DB.isCloud());

  if (el) {
    if (isCloud) {
      el.innerHTML = '<span class="text-yes font-semibold flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-yes"></span>Supabase Cloud (Online)</span>';
    } else {
      el.innerHTML = '<span class="text-ink3 flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-no"></span>Lokální režim (Offline)</span>';
    }
  }

  if (badge) {
    if (isCloud) {
      badge.className = 'flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold border border-yes/40 bg-yes/10 text-yes cursor-pointer shrink-0 transition-colors';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-yes animate-pulse"></span><span class="font-bold">Cloud</span>';
      badge.title = 'Databáze je online (Supabase Cloud). Kliknutím otevřete přehled.';
    } else {
      badge.className = 'flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold border border-line bg-paper text-ink3 cursor-pointer shrink-0 transition-colors';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-ink3"></span><span class="font-bold">Offline</span>';
      badge.title = 'Lokální režim. Kliknutím otevřete nastavení.';
    }
  }
}

/* Pomocné funkce pro zobrazení osob a hodnocení */
function starsMarkup(rating) {
  const r = Math.round(rating || 0);
  return `<span class="text-[#c98a1e] tracking-tight">${'★'.repeat(r)}${'☆'.repeat(5 - r)}</span>`;
}

function memberPillMarkup(member, isSelected = false) {
  if (!member) return '';
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(member.color) ? member.color : '#2563eb';
  const activeStyle = isSelected
    ? `background-color:${safeColor}; border-color:${safeColor}; color:#fff;`
    : `border-color:var(--line-2); background:#fff; color:var(--ink);`;
  return `
    <button type="button" class="author-pill ${isSelected ? 'active' : ''}" data-author="${esc(member.id)}" style="${activeStyle}">
      <span class="author-logo">${esc(member.logo || '👤')}</span>
      <span>${esc(member.name)}</span>
    </button>`;
}

/* ---------- STAV & SYNCHRONIZACE ---------- */
let state = load();
let ui = {
  floor: 'p2',
  filter: 'all',
  cats: new Set(),
  q: '',
  sel: null,
  viewMemberId: 'all', // 'all' = všichni, nebo konkrétní osoba 'vojta', 'peta', 'adel'
  reviewAuthorId: getSavedAuthorId() // profil, za který se ukládá a hodnotí
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return (raw && typeof raw === 'object' && raw.venues) ? raw : { venues: {} };
  } catch { return { venues: {} }; }
}

function save(venueId = null, authorId = null, recordData = null, silent = false) {
  if (venueId && window.DB) {
    const aId = authorId || ui.reviewAuthorId;
    const r = recordData || rec(venueId, aId);
    window.DB.saveReview(venueId, aId, r, silent);
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {}
}

/* Synchronizace s cloudovou Supabase databází */
let isSyncing = false;
async function syncFromCloud() {
  if (isSyncing || !window.DB || !window.DB.isConfigured()) return;
  isSyncing = true;
  try {
    const success = await window.DB.init();
    renderMemberNavTabs();
    renderAll();
    setStorageStatus(success);
  } catch (err) {
    console.warn('[Sync] Chyba synchronizace:', err);
    setStorageStatus(false);
  } finally {
    isSyncing = false;
  }
}

const rec = (id, authorId = null) => {
  const aId = authorId || ui.reviewAuthorId || (window.DB ? window.DB.getActiveAuthorId() : 'vojta');
  if (window.DB) {
    const rev = window.DB.getReview(id, aId);
    if (rev) return rev;
  }
  return { visited: false, rating: 0, note: '', date: null };
};

const isVisited = (id, memberId = null) => {
  const mId = memberId || ui.viewMemberId;
  if (window.DB) {
    return window.DB.isVisitedBy(id, mId);
  }
  return false;
};

/* ---------- KATEGORIE ---------- */
const CATS = {
  fastfood:  { label: 'Fast food' },
  restaurant:{ label: 'Restaurace' },
  asian:     { label: 'Asijská' },
  pizza:     { label: 'Pizza' },
  cafe:      { label: 'Kavárna' },
  bakery:    { label: 'Pekárna' },
  sweet:     { label: 'Sladké' },
  drinks:    { label: 'Nápoje' },
  healthy:   { label: 'Zdravé' },
};
const cat = c => CATS[c] || { label: c };

/* Barvy neevidovaných jednotek půdorysu */
const KIND_FILL = { shop: '#e6e1d8', service: '#ece8e1', vert: '#d9d2c6', area: '#eae6df' };
const FC_FILL = '#efe0c6';

/* Stav podniku: červená = zatím ne, zelená = navštíveno
   (v pohledu „Všichni“: oranžová = byl tu jen někdo z party, zelená = byli všichni) */
const NOPE = '#c0453a', YES = '#3b8559', SOME = '#d4892a';

/* Kdo z party podnik navštívil a kdo ne */
function venueParty(venueId) {
  const members = window.DB ? window.DB.getMembers() : [];
  const visited = members.filter(m => window.DB.isVisitedBy(venueId, m.id));
  const missing = members.filter(m => !window.DB.isVisitedBy(venueId, m.id));
  const state = !visited.length ? 'none' : (missing.length ? 'some' : 'all');
  return { members, visited, missing, state, color: state === 'all' ? YES : state === 'some' ? SOME : NOPE };
}

const logoMarkup = (v, cls = '') => {
  const url = typeof logoUrl === 'function' ? logoUrl(v.id) : null;
  return url
    ? `<img src="${esc(url)}" alt="${esc(v.name)}" class="${cls} venue-logo logo-${esc(v.id)}" loading="lazy">`
    : `<span class="${cls} brand-word">${esc(v.id === 'frankiespub' ? "FRANKIE'S" : v.name.slice(0, 2).toUpperCase())}</span>`;
};

/* Podniky v okolí centra (extra.js) */
const OUT_ID = 'out';
if (typeof EXTRA !== 'undefined') {
  FLOORS.push(EXTRA.floor);
  VENUES.push(...EXTRA.venues);
}
const isOutside = f => !!(f && f.outside);

const VEN_BY_ID = new Map(VENUES.map(v => [v.id, v]));
const FLOOR_BY_ID = new Map(FLOORS.map(f => [f.id, f]));
const venue = id => VEN_BY_ID.get(id) || null;
const floorOf = id => FLOOR_BY_ID.get(id);

const GEO = {};
FLOORS.forEach(f => f.units.forEach(u => { if (u.v) GEO[u.v] = u; }));
VENUES.forEach(v => { v.geo = GEO[v.id]; });

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-sm text-paper ' + (bad ? 'bg-no' : 'bg-ink');
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ============================================================
   PAN / ZOOM ENGINE
   ============================================================ */
const FR = typeof SURROUND !== 'undefined' ? SURROUND.frame : { size: 1640, scale: 4 };
const ctxBox = () => ({ x: 0, y: 0, w: FR.size, h: FR.size });

const view = { x: 0, y: 0, k: 1, min: 0.2, max: 12 };
const svg = $('#map'), vp = $('#viewport'), wrap = $('#mapWrap');

let lodRaf = 0, lastScaleK = -1;
function applyView() {
  vp.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  if (view.k !== lastScaleK) {
    lastScaleK = view.k;
    updateScale();
    if (!lodRaf) lodRaf = requestAnimationFrame(() => { lodRaf = 0; updateLOD(); });
  }
}

const NICE = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
function updateScale() {
  const bar = $('#scaleBar'); if (!bar) return;
  const pxPerM = view.k * (FR.scale || 4);
  const target = 90;
  const m = NICE.find(v => v * pxPerM >= 45) || NICE[NICE.length - 1];
  bar.style.width = Math.round(Math.min(target * 1.6, m * pxPerM)) + 'px';
  $('#scaleLabel').textContent = m >= 1000 ? (m / 1000) + ' km' : m + ' m';
}

function zoomAt(cx, cy, factor) {
  const k2 = Math.min(view.max, Math.max(view.min, view.k * factor));
  if (k2 === view.k) return;
  view.x = cx - (cx - view.x) * (k2 / view.k);
  view.y = cy - (cy - view.y) * (k2 / view.k);
  view.k = k2;
  applyView();
}

function fit(animate = true) {
  const f = floorOf(ui.floor), r = wrap.getBoundingClientRect();
  const b = fitBox(f);
  const pad = r.width < 640 ? 10 : 20;
  let k = Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h);
  k = Math.min(view.max, Math.max(view.min, k));
  animateTo((r.width - b.w * k) / 2 - b.x * k, (r.height - b.h * k) / 2 - b.y * k, k, animate);
}

function focusOn(v, mult = 3.2) {
  const g = v.geo; if (!g) return;
  const r = wrap.getBoundingClientRect();
  const k = Math.min(view.max, Math.max(view.k, Math.min(
    (r.width * 0.45) / Math.max(g.w, 1), (r.height * 0.45) / Math.max(g.h, 1), mult)));
  animateTo(r.width / 2 - (g.x + g.w / 2) * k, r.height / 2 - (g.y + g.h / 2) * k, k, true);
}

function ensureVisible(v, pad = 60) {
  const g = v.geo; if (!g) return;
  const r = wrap.getBoundingClientRect();
  const x1 = view.x + g.x * view.k, y1 = view.y + g.y * view.k;
  const x2 = x1 + g.w * view.k, y2 = y1 + g.h * view.k;
  let dx = 0, dy = 0;
  if (x1 < pad) dx = pad - x1; else if (x2 > r.width - pad) dx = (r.width - pad) - x2;
  if (y1 < pad) dy = pad - y1; else if (y2 > r.height - pad) dy = (r.height - pad) - y2;
  if (dx || dy) animateTo(view.x + dx, view.y + dy, view.k, true);
}

function animateTo(x, y, k, animate) {
  if (!animate) { view.x = x; view.y = y; view.k = k; return applyView(); }
  const s = { ...view }, t0 = performance.now(), D = 420;
  cancelAnimationFrame(animateTo._r);
  const ease = p => p < .5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
  (function step(now) {
    const p = Math.min(1, (now - t0) / D), e = ease(p);
    view.x = s.x + (x - s.x) * e; view.y = s.y + (y - s.y) * e; view.k = s.k + (k - s.k) * e;
    applyView();
    if (p < 1) animateTo._r = requestAnimationFrame(step);
  })(t0);
}

/* Ukazatel (myš + dotyk) */
let drag = null, moved = 0;
wrap.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  drag = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y, id: e.pointerId };
  moved = 0;
  wrap.setPointerCapture(e.pointerId);
});

wrap.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
  moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
  view.x = drag.ox + dx; view.y = drag.oy + dy;
  applyView();
});

const endDrag = e => { if (drag && drag.id === e.pointerId) drag = null; };
wrap.addEventListener('pointerup', endDrag);
wrap.addEventListener('pointercancel', endDrag);

wrap.addEventListener('pointerup', e => {
  const tapThreshold = e.pointerType === 'touch' ? 18 : 6;
  if (moved > tapThreshold) return;
  const t = document.elementFromPoint(e.clientX, e.clientY);
  if (!t || !t.closest('#map')) return;
  const info = hitInfo(t);
  if (info && info.v) select(info.v.id, 'keep');
  else select(null);
});

wrap.addEventListener('wheel', e => {
  e.preventDefault();
  const r = wrap.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
}, { passive: false });

wrap.addEventListener('dblclick', e => {
  const info = hitInfo(document.elementFromPoint(e.clientX, e.clientY));
  if (info && info.v) { toggle(info.v.id); return; }
  const r = wrap.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8);
});

let pinch = null;
wrap.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    drag = null;
    const [a, b] = e.touches;
    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), k: view.k,
              cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2, x: view.x, y: view.y };
  }
}, { passive: true });

wrap.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const r = wrap.getBoundingClientRect();
    const k2 = Math.min(view.max, Math.max(view.min, pinch.k * (d / pinch.d)));
    const cx = pinch.cx - r.left, cy = pinch.cy - r.top;
    view.x = cx - (cx - pinch.x) * (k2 / pinch.k);
    view.y = cy - (cy - pinch.y) * (k2 / pinch.k);
    view.k = k2;
    applyView();
  }
}, { passive: false });

wrap.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; }, { passive: true });

$('#zIn').onclick  = () => { const r = wrap.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.4); };
$('#zOut').onclick = () => { const r = wrap.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.4); };
$('#zFit').onclick = () => fit();

addEventListener('keydown', e => {
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
  const step = 70;
  if (e.key === '+' || e.key === '=') $('#zIn').click();
  else if (e.key === '-') $('#zOut').click();
  else if (e.key === '0') fit();
  else if (e.key === 'ArrowLeft')  { view.x += step; applyView(); }
  else if (e.key === 'ArrowRight') { view.x -= step; applyView(); }
  else if (e.key === 'ArrowUp')    { view.y += step; applyView(); }
  else if (e.key === 'ArrowDown')  { view.y -= step; applyView(); }
  else if (e.key === 'Escape')     { closeModal(); select(null); }
  else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
});

let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => fit(false), 150); });

/* ============================================================
   VYKRESLENÍ PŮDORYSU A OKOLÍ
   ============================================================ */
function el(name, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

let labelNodes = [], markNodes = [], trackedNodes = [], ctxLabels = [];
const UNIT_INFO = new WeakMap();

function fitBox(f) {
  const m = Math.max(f.bw, f.bh) * 0.11;
  return { x: f.bx - m, y: f.by - m, w: f.bw + 2 * m, h: f.bh + 2 * m };
}

const BLD_FILL = { com: '#e0dacf', res: '#e6e1d8', civ: '#dcd5c9', aux: '#ebe7df', gen: '#e0dacf' };

function drawOrganica(parent) {
  if (typeof ORGANICA === 'undefined') return;
  const O = ORGANICA;
  const g = el('g', {}, parent);
  el('path', { d: O.base, fill: '#f6f3ee' }, g);
  const zones = el('g', { fill: '#d9c9b9' }, g);
  O.zones.forEach(z => el('path', { d: z.d }, zones));
  el('path', { d: O.outline, fill: 'none', stroke: '#8c7a66', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, g);

  const lab = (n, x, y, cls) => {
    const t = el('text', { class: 'ctx-lab org ' + cls, x, y, 'text-anchor': 'middle' }, g);
    t.textContent = n;
    return t;
  };
  const title = lab('Organica', O.center[0], O.center[1] + 5, 'big');
  ctxLabels.push({ node: title, minK: 0.5 });
  const tracked = new Set(['kanteen', 'cokafe']);
  O.zones.filter(z => !tracked.has(z.id)).forEach(z => ctxLabels.push({ node: lab(z.n, z.lx, z.ly, ''), minK: 1.3 }));
  O.notes.forEach(o => ctxLabels.push({ node: lab(o.n, o.lx, o.ly, ''), minK: 1.6 }));
}

function drawContext(parent) {
  if (typeof SURROUND === 'undefined') return;
  const g = el('g', { class: 'ctx' }, parent);
  const S = SURROUND;

  const gg = el('g', { fill: '#dde4cf' }, g);
  S.green.forEach(o => el('path', { d: o.d }, gg));

  const gw = el('g', { fill: '#d2dde2' }, g);
  S.water.forEach(o => el('path', { d: o.d }, gw));

  const gp = el('g', { fill: '#e9e5dd', stroke: '#dcd6cb', 'stroke-width': 1.5 }, g);
  S.parking.forEach(o => el('path', { d: o.d }, gp));

  const cas = el('g', { fill: 'none', stroke: '#d6cfc3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  S.roads.filter(r => !r.f).forEach(r => el('path', { d: r.d, 'stroke-width': r.w + 4 }, cas));
  const rd = el('g', { fill: 'none', stroke: '#fff', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  S.roads.filter(r => !r.f).forEach(r => el('path', { d: r.d, 'stroke-width': r.w }, rd));

  const fw = el('g', { fill: 'none', stroke: '#c9c1b3', 'stroke-width': 3, 'stroke-dasharray': '9 7', 'stroke-linecap': 'round' }, g);
  S.roads.filter(r => r.f).forEach(r => el('path', { d: r.d }, fw));

  const rlBase = el('g', { fill: 'none', stroke: '#d6cfc3', 'stroke-width': 14, 'stroke-linecap': 'round' }, g);
  const rlTie = el('g', { fill: 'none', stroke: '#bfb7a9', 'stroke-width': 11, 'stroke-dasharray': '3 9' }, g);
  const rlTop = el('g', { fill: 'none', stroke: '#8f887c', 'stroke-width': 2 }, g);
  S.rails.forEach(r => {
    el('path', { d: r.d }, rlBase);
    el('path', { d: r.d }, rlTie);
    el('path', { d: r.d, 'stroke-dasharray': r.t === 'tram' ? '14 10' : null }, rlTop);
  });

  const gb = el('g', { stroke: '#c9c1b3', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, g);
  S.buildings.forEach(b => {
    if (b.n === 'Organica') return;
    el('path', { d: b.d, fill: BLD_FILL[b.k] || BLD_FILL.gen }, gb);
  });
  drawOrganica(g);

  S.streets.forEach(s => {
    const t = el('text', { class: 'ctx-lab', x: s.x, y: s.y, 'text-anchor': 'middle', transform: `rotate(${s.r} ${s.x} ${s.y})` }, g);
    t.textContent = s.n;
    ctxLabels.push({ node: t, minK: 0.55 });
  });

  S.buildings.forEach(b => {
    if (!b.n || b.a < 2600 || b.n === 'Organica') return;
    const t = el('text', { class: 'ctx-lab big', x: b.lx, y: b.ly, 'text-anchor': 'middle' }, g);
    t.textContent = b.n.length > 28 ? b.n.slice(0, 27) + '…' : b.n;
    ctxLabels.push({ node: t, minK: Math.min(2.4, Math.max(0.5, (b.n.length * 6.5) / Math.max(b.w, 30))) });
  });
}

let staticLayer = null;
function buildStatic() {
  if (staticLayer) return staticLayer;
  const g = el('g', { class: 'layer-static' });
  drawContext(g);

  const mall = typeof SURROUND !== 'undefined' && SURROUND.mall;
  if (mall) {
    el('path', { d: mall.d, fill: '#fbfaf7', stroke: '#a39b8e', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, g);
  }
  staticLayer = g;
  return g;
}

const floorCache = new Map();

function buildFloorLayer(f) {
  const cached = floorCache.get(f.id);
  if (cached) return cached;

  const g = el('g', { class: 'layer-floor' + (isOutside(f) ? ' layer-out' : '') });
  const labels = [], marks = [], tracked = [];

  const hasMall = typeof SURROUND !== 'undefined' && !!SURROUND.mall;
  if (isOutside(f)) {
    const pad = el('g', { fill: '#e6e1d8', stroke: '#a39b8e', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, g);
    f.units.filter(u => !u.org).forEach(u => el('path', { d: u.d }, pad));
  } else {
    if (!hasMall) {
      const edge = el('g', { fill: '#cfc8bc', stroke: '#cfc8bc', 'stroke-width': 31, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
      f.units.forEach(u => el('path', { d: u.d }, edge));
    }
    const slab = el('g', { fill: '#fbfaf7', stroke: '#fbfaf7', 'stroke-width': hasMall ? 14 : 26, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
    f.units.forEach(u => el('path', { d: u.d }, slab));
  }

  const fcu = f.units.filter(u => u.fc);
  if (fcu.length) {
    let cx = 0, cy = 0;
    for (const u of fcu) { cx += u.lx; cy += u.ly; }
    const t = el('text', { class: 'fc-title', x: cx / fcu.length, y: cy / fcu.length, 'text-anchor': 'middle', 'letter-spacing': 7 }, g);
    t.textContent = 'FOOD COURT';
  }

  const gUnits = el('g', {}, g);
  f.units.forEach(u => drawUnit(u, gUnits, tracked));
  const gLab = el('g', {}, g);
  f.units.forEach(u => drawLabel(u, gLab, labels, marks));

  const entry = { g, labels, marks, tracked };
  floorCache.set(f.id, entry);
  return entry;
}

function drawFloor() {
  const f = floorOf(ui.floor);
  if (!vp.firstChild) vp.appendChild(buildStatic());

  const entry = buildFloorLayer(f);
  if (!entry.g.parentNode) vp.appendChild(entry.g);

  const outF = floorOf(OUT_ID);
  const out = outF ? buildFloorLayer(outF) : null;
  if (out && !out.g.parentNode) vp.appendChild(out.g);

  for (const [id, e] of floorCache) e.g.style.display = (id === f.id || id === OUT_ID) ? '' : 'none';

  labelNodes = out ? entry.labels.concat(out.labels) : entry.labels;
  markNodes  = out ? entry.marks.concat(out.marks)   : entry.marks;
  trackedNodes = out ? entry.tracked.concat(out.tracked) : entry.tracked;

  refreshMap();
  updateLOD(true);
}

function drawUnit(u, parent, tracked) {
  const v = u.v ? venue(u.v) : null;
  const g = el('g', { class: 'unit' + (v ? ' tracked' : ''), 'data-poi': u.poi, 'data-v': u.v || null }, parent);
  const sh = el('path', { class: 'u-shape', d: u.d, fill: v ? NOPE : (u.fc ? FC_FILL : KIND_FILL[u.k] || KIND_FILL.shop) }, g);
  UNIT_INFO.set(g, { u, v });
  if (v) tracked.push({ node: g, shape: sh, v });
}

const MAP_LOGO_SCALE = {
  mcdonalds: .64,
  ugosalaterie: .72,
  coloseum: .72
};

function drawLabel(u, parent, labels, marks) {
  const v = u.v ? venue(u.v) : null;
  if (!u.n && !v) return;

  const g = el('g', { class: 'lab', transform: `translate(${u.lx} ${u.ly})` }, parent);
  const minK = v
    ? Math.min(3, Math.max(0.5, (v.name.length * 5.6) / Math.max(u.w, 24)))
    : Math.min(3.2, Math.max(0.7, Math.sqrt(9000 / Math.max(u.a, 40))));
  let base = 4;

  if (v) {
    const url = typeof logoUrl === 'function' ? logoUrl(v.id) : null;
    const ar = url ? Math.max(.45, Math.min(4.2, logoAspect(v.id))) : 1;
    const rotate = ar > 1.7 && u.h > u.w * 1.15;
    // Calculate the badge in the logo's natural orientation, then rotate it
    // inside portrait-shaped units so it follows the unit's long axis.
    const unitW = rotate ? u.h : u.w;
    const unitH = rotate ? u.w : u.h;
    const logoScale = MAP_LOGO_SCALE[v.id] || 1;
    const maxW = Math.max(4, unitW * .92 * logoScale);
    const maxH = Math.max(4, unitH * .84 * logoScale);
    const bw = Math.min(maxW, maxH * ar);
    const bh = Math.min(maxH, bw / ar);
    const hw = bw / 2, hh = bh / 2, pad = Math.min(3.5, bw * .12, bh * .12);

    const mk = el('g', { class: 'mark' }, g);
    const bg = el('rect', { class: 'm-bg', x: -hw, y: -hh, width: bw, height: bh, rx: Math.min(4, hh), fill: '#fff', stroke: NOPE, 'stroke-width': 3 }, mk);
    if (url) {
      el('image', { class: `m-logo logo-${v.id}`, href: url, x: -hw + pad, y: -hh + pad, width: Math.max(1, bw - 2 * pad), height: Math.max(1, bh - 2 * pad), preserveAspectRatio: 'xMidYMid meet', decoding: 'async' }, mk);
    } else {
      const word = v.id === 'frankiespub' ? "FRANKIE'S" : v.name.slice(0, 2).toUpperCase();
      const ic = el('text', { class: 'm-ic m-word', y: 4, 'text-anchor': 'middle', 'font-size': 8, fill: '#26231f' }, mk);
      ic.textContent = word;
    }
    const ck = el('g', { class: 'm-ck', display: 'none' }, mk);
    el('circle', { r: 7.4, cx: hw - 1, cy: -hh + 1, fill: YES, stroke: '#fff', 'stroke-width': 1.8 }, ck);
    el('path', { d: `M${hw - 4.4} ${-hh + 0.8} L${hw - 1.9} ${-hh + 3.4} L${hw + 2.6} ${-hh - 2.2}`, fill: 'none', stroke: '#fff', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, ck);

    // Tečky členů party pod logem (pohled „Všichni“): plná = byl/a, prázdná = nebyl/a
    const dots = el('g', { class: 'm-dots', display: 'none' }, g);

    const maxS = 1;
    marks.push({ node: mk, wrap: g, bg, ck, dots, dotY: rotate ? hw : hh, dotW: rotate ? bh : bw, v, maxS, rotate, last: -1 });
    UNIT_INFO.set(mk, { u, v });
    base = hh + 13;
  }

  if (!v) {
    const t = el('text', { class: 'u-label', y: base, 'text-anchor': 'middle' }, g);
    const name = u.n;
    t.textContent = name.length > 26 ? name.slice(0, 25) + '…' : name;
    labels.push({ node: g, lab: t, minK, base, shown: null, last: -1 });
  }
}

let lastLOD = -1, lastCtxLOD = -1;
function updateLOD(force) {
  const k = view.k;
  if (!force && k === lastLOD) return;

  const s = vp.style;
  s.setProperty('--fs', (10.5 / k).toFixed(2) + 'px');
  s.setProperty('--fs-big', (26 / k).toFixed(2) + 'px');
  s.setProperty('--fs-ctx', (11 / k).toFixed(2) + 'px');
  s.setProperty('--fs-ctx-big', (15 / k).toFixed(2) + 'px');
  s.setProperty('--sw', (1.1 / k).toFixed(3));

  for (const m of markNodes) {
    const sc = +Math.min(1, m.maxS).toFixed(3);
    const transform = `${m.rotate ? 'rotate(90) ' : ''}scale(${sc})`;
    if (transform !== m.last) { m.node.setAttribute('transform', transform); m.last = transform; }
  }
  for (const l of labelNodes) {
    const show = k >= l.minK || l.node.classList.contains('force');
    if (show !== l.shown) { l.lab.style.display = show ? '' : 'none'; l.shown = show; }
    if (!show) continue;
    const y = +(l.base / k).toFixed(1);
    if (y !== l.last) { l.lab.setAttribute('y', y); l.last = y; }
  }
  if (k !== lastCtxLOD) {
    for (const c of ctxLabels) {
      const show = k >= c.minK;
      if (show !== c.shown) { c.node.style.display = show ? '' : 'none'; c.shown = show; }
    }
    lastCtxLOD = k;
  }
  lastLOD = k;
}

/* Tooltip */
function showTip(e, u, v) {
  const t = $('#tip');
  if (v) {
    const c = cat(v.cat);
    const st = window.DB ? window.DB.getVenueStats(v.id) : null;
    const currentMember = ui.viewMemberId !== 'all' && window.DB ? window.DB.getMember(ui.viewMemberId) : null;

    let visStatus = false;
    let statusText = '';

    if (currentMember) {
      visStatus = window.DB.isVisitedBy(v.id, currentMember.id);
      const rev = window.DB.getReview(v.id, currentMember.id);
      statusText = `<span class="w-2 h-2 shrink-0 ${visStatus ? 'bg-yes' : 'bg-no'}"></span>${esc(v.name)} ` +
        `<span class="text-[10px] opacity-75">(${esc(currentMember.logo)} ${esc(currentMember.name)}: ${visStatus ? 'byl/a' + (rev && rev.rating ? ' ' + rev.rating + '★' : '') : 'nebyl/a'})</span>`;
    } else if (window.DB) {
      const party = venueParty(v.id);
      statusText = `<span class="w-2 h-2 shrink-0" style="background:${party.color}"></span>${esc(v.name)} ` +
        `<span class="text-[10px] opacity-75">(${party.visited.length}/${party.members.length} z party)</span>`;
    }

    let visitorsLine = '';
    if (!currentMember && window.DB) {
      const party = venueParty(v.id);
      const who = list => list.map(m => `${esc(m.logo)} <b>${esc(m.name)}</b>`).join(', ');
      visitorsLine =
        (party.visited.length ? `<div class="text-[11px] text-[#9fd8a6] mt-1">✓ Byli: ${party.visited.map(m => {
          const r = window.DB.getReview(v.id, m.id);
          return `${esc(m.logo)} <b>${esc(m.name)}</b>${r && r.rating ? ' (' + r.rating + '★)' : ''}`;
        }).join(', ')}</div>` : '') +
        (party.missing.length ? `<div class="text-[11px] text-[#f2a49b] mt-0.5">✗ Nebyli: ${who(party.missing)}</div>` : '');
    } else if (st && st.visitors.length > 0) {
      visitorsLine = `<div class="text-[11px] text-[#f4d28d] mt-1 flex items-center gap-1.5 flex-wrap">` +
        `<span>Byli zde:</span> ` +
        st.visitors.map(vis => `<span title="${esc(vis.name)}: ${vis.rating ? vis.rating + '★' : 'navštíveno'}">${esc(vis.logo)} <b>${esc(vis.name)}</b>${vis.rating ? ' (' + vis.rating + '★)' : ''}</span>`).join(' · ') +
        `</div>`;
    }

    t.innerHTML = `<div class="font-medium flex items-center gap-2">${statusText}</div>` +
      `<div class="text-[11px] opacity-70 mt-0.5">${esc(c.label)}${v.desc ? ' · ' + esc(v.desc.length > 90 ? v.desc.slice(0, 89) + '…' : v.desc) : ''}</div>` +
      visitorsLine;
  } else {
    if (!u.n) return;
    t.innerHTML = esc(u.n) +
      (u.k === 'vert' ? ' <span class="opacity-60">· schody / výtah</span>' :
       u.k === 'service' ? ' <span class="opacity-60">· služby</span>' : '');
  }
  t.classList.remove('hidden');
  moveTip(e);
}

function moveTip(e) {
  const t = $('#tip'), r = wrap.getBoundingClientRect();
  let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
  const b = t.getBoundingClientRect();
  if (x + b.width > r.width - 8) x = e.clientX - r.left - b.width - 14;
  if (y + b.height > r.height - 8) y = e.clientY - r.top - b.height - 14;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
const hideTip = () => $('#tip').classList.add('hidden');

const HIT = '.unit, .mark';
const hitInfo = t => {
  const n = t && t.closest ? t.closest(HIT) : null;
  return n ? UNIT_INFO.get(n) : null;
};

let hoverUnit = null;
vp.addEventListener('pointerover', e => {
  const g = e.target.closest ? e.target.closest(HIT) : null;
  if (g === hoverUnit) return;
  hoverUnit = g;
  if (!g) return hideTip();
  const info = UNIT_INFO.get(g);
  if (info) showTip(e, info.u, info.v); else hideTip();
});
vp.addEventListener('pointerout', e => {
  const to = e.relatedTarget;
  if (to && to.closest && to.closest(HIT) === hoverUnit) return;
  hoverUnit = null; hideTip();
});
vp.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && hoverUnit) moveTip(e); });

/* ============================================================
   FILTROVÁNÍ & SYNCHRONIZACE MAPY
   ============================================================ */
function matches(v) {
  if (ui.filter === 'visited' && !isVisited(v.id)) return false;
  if (ui.filter === 'todo' && isVisited(v.id)) return false;
  if (ui.cats.size && !ui.cats.has(v.cat)) return false;
  if (ui.q) {
    const q = ui.q.toLowerCase();
    if (!(v.name + ' ' + (v.desc || '') + ' ' + (v.tags || []).join(' ') + ' ' + cat(v.cat).label).toLowerCase().includes(q)) return false;
  }
  return true;
}
const filterActive = () => ui.filter !== 'all' || ui.cats.size > 0 || !!ui.q;

function refreshMap() {
  const active = filterActive();
  const activeMember = ui.viewMemberId !== 'all' && window.DB ? window.DB.getMember(ui.viewMemberId) : null;

  for (const t of trackedNodes) {
    let vis = false;
    let fillColor = NOPE;

    if (activeMember) {
      vis = window.DB ? window.DB.isVisitedBy(t.v.id, activeMember.id) : false;
      fillColor = vis ? (activeMember.color || YES) : NOPE;
    } else if (window.DB) {
      const party = venueParty(t.v.id);
      vis = party.state !== 'none';
      fillColor = party.color;
    }

    const ok = !active || matches(t.v);
    const cl = t.node.classList;
    cl.toggle('visited', vis);
    cl.toggle('sel', ui.sel === t.v.id);
    cl.toggle('dim', active && !ok);

    if (t.fill !== fillColor) {
      t.shape.setAttribute('fill', fillColor);
      t.fill = fillColor;
    }
  }

  for (const m of markNodes) {
    let vis = false;
    let strokeColor = NOPE;

    if (activeMember) {
      vis = window.DB ? window.DB.isVisitedBy(m.v.id, activeMember.id) : false;
      strokeColor = vis ? (activeMember.color || YES) : NOPE;
    } else if (window.DB) {
      const party = venueParty(m.v.id);
      vis = party.state !== 'none';
      strokeColor = party.color;
      drawPartyDots(m, party);
    }
    if (activeMember) drawPartyDots(m, null);

    // Fajfka v rohu: u konkrétní osoby = byl/a, ve „Všichni“ = byli úplně všichni
    const showCk = activeMember ? vis : strokeColor === YES;
    const ok = !active || matches(m.v);
    if (m.vis !== showCk || m.lastStroke !== strokeColor) {
      m.bg.setAttribute('stroke', strokeColor);
      m.ck.setAttribute('display', showCk ? '' : 'none');
      m.vis = showCk;
      m.lastStroke = strokeColor;
    }
    const cl = m.wrap.classList;
    cl.toggle('dim', active && !ok);
    cl.toggle('sel', ui.sel === m.v.id);
    cl.toggle('force', ui.sel === m.v.id || (active && ok));
  }
  renderLegend(activeMember);
  updateLOD(true);
}

function drawPartyDots(m, party) {
  const sig = party ? party.members.map(x => x.id + x.color + (party.visited.includes(x) ? 1 : 0)).join('|') : '';
  if (sig === m.dotSig) return;
  m.dotSig = sig;
  m.dots.replaceChildren();
  if (!party || !party.members.length) { m.dots.setAttribute('display', 'none'); return; }

  const n = party.members.length;
  const r = Math.max(1.5, Math.min(2.6, m.dotW / (n * 3)));
  const gap = r * 2.6;
  const w = (n - 1) * gap;
  const cy = m.dotY; // tečky sedí na spodní hraně loga, aby nezasahovaly do sousedních podniků
  el('rect', { class: 'm-dots-bg', x: -w / 2 - r - 1.6, y: cy - r - 1.6, width: w + 2 * r + 3.2, height: 2 * r + 3.2, rx: r + 1.6 }, m.dots);
  party.members.forEach((x, i) => {
    const on = party.visited.includes(x);
    const c = el('circle', { cx: -w / 2 + i * gap, cy, r: on ? r : r - 0.45, fill: on ? x.color : '#fff', stroke: on ? '#fff' : '#8c8478', 'stroke-width': 0.8 }, m.dots);
    const t = el('title', {}, c);
    t.textContent = `${x.name}: ${on ? 'byl/a' : 'nebyl/a'}`;
  });
  m.dots.setAttribute('display', '');
}

function renderLegend(activeMember) {
  const lg = $('#mapLegend');
  if (!lg) return;
  const key = activeMember ? 'm:' + activeMember.id + activeMember.color : 'all:' + (window.DB ? window.DB.getMembers().map(x => x.id + x.color).join() : '');
  if (lg.dataset.key === key) return;
  lg.dataset.key = key;
  const row = (color, text) => `<div class="flex items-center gap-2"><span class="w-3 h-3 shrink-0" style="background:${esc(color)}"></span>${text}</div>`;
  if (activeMember) {
    lg.innerHTML = row(activeMember.color || YES, `${esc(activeMember.name)} tu byl/a`) + row(NOPE, 'Zatím ne');
    return;
  }
  const members = window.DB ? window.DB.getMembers() : [];
  lg.innerHTML = row(YES, 'Byli všichni') + row(SOME, 'Byl tu jen někdo') + row(NOPE, 'Nikdo zatím') +
    (members.length ? `<div class="pt-1.5 mt-1 border-t border-line flex flex-wrap gap-x-2.5 gap-y-1 max-w-[220px]">
      ${members.map(x => `<span class="flex items-center gap-1"><span class="member-dot" style="background:${esc(x.color)}"></span>${esc(x.name)}</span>`).join('')}
    </div><div class="text-[10px] text-ink3">Plná tečka = byl/a, prázdná = nebyl/a</div>` : '');
}

/* ============================================================
   SEZNAM A DETAILNÍ PANEL (CAD UI)
   ============================================================ */
function renderChips() {
  const used = [...new Set(VENUES.map(v => v.cat))];
  $('#catChips').innerHTML = used.map(c => {
    const o = cat(c), n = VENUES.filter(v => v.cat === c).length;
    return `<button class="chip ${ui.cats.has(c) ? 'on' : ''}" data-cat="${c}">${esc(o.label)} <small>${n}</small></button>`;
  }).join('');
  $$('#catChips .chip').forEach(b => b.onclick = () => {
    const c = b.dataset.cat;
    ui.cats.has(c) ? ui.cats.delete(c) : ui.cats.add(c);
    renderAll();
  });
}

function renderList() {
  const items = VENUES.filter(matches);
  const byFloor = {};
  items.forEach(v => (byFloor[v.floor] ||= []).push(v));

  let html = items.length ? '' : `<div class="px-4 py-10 text-sm text-ink2">Nic nenalezeno.${filterActive() ? ' Zkuste změnit filtr nebo hledání.' : ''}</div>`;

  FLOORS.forEach(f => {
    const arr = byFloor[f.id];
    if (!arr) return;
    const done = arr.filter(v => isVisited(v.id)).length;
    html += `<div class="list-head"><span>${esc(f.name)}</span><span>${done} / ${arr.length}</span></div>`;

    html += arr.map(v => {
      const on = isVisited(v.id);
      const st = window.DB ? window.DB.getVenueStats(v.id) : null;
      let visitorsBadges = '';
      if (window.DB && ui.viewMemberId === 'all') {
        const party = venueParty(v.id);
        const title = (party.visited.length ? 'Byli: ' + party.visited.map(x => x.name).join(', ') : 'Zatím nikdo') +
          (party.missing.length && party.visited.length ? ' · Nebyli: ' + party.missing.map(x => x.name).join(', ') : '');
        visitorsBadges = `<div class="flex items-center gap-0.5 shrink-0" title="${esc(title)}">` +
          party.members.map(x => `<span class="party-logo ${party.visited.includes(x) ? '' : 'off'}">${esc(x.logo)}</span>`).join('') +
          `</div>`;
      } else if (st && st.visitors.length > 0) {
        visitorsBadges = `<div class="flex items-center gap-0.5 shrink-0" title="Navštívili: ${esc(st.visitors.map(x => x.name).join(', '))}">` +
          st.visitors.map(vis => `<span class="party-logo">${esc(vis.logo)}</span>`).join('') +
          `</div>`;
      }

      let ratingBadge = (st && st.avgRating)
        ? `<span class="comm-rating-pill shrink-0" title="Průměrné hodnocení: ${st.avgRating} z 5 (${st.ratingCount} hodnocení)">★ ${st.avgRating}</span>`
        : '';

      return `<div class="row ${ui.sel === v.id ? 'sel' : ''}" data-go="${v.id}">
          <button data-tog="${v.id}" class="check ${on ? 'on' : ''}" aria-pressed="${on}" aria-label="${on ? 'Zrušit označení' : 'Označit jako navštívené'}: ${esc(v.name)}">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="square" d="m5 13 4 4L19 7"/></svg>
          </button>
          <span class="logo-box w-9 h-9 p-1">${logoMarkup(v)}</span>
          <div class="min-w-0 flex-1">
            <div class="row-name truncate flex items-center gap-1.5">
              <span class="truncate">${esc(v.name)}</span>
              ${ratingBadge}
            </div>
            <div class="row-sub truncate">${esc(cat(v.cat).label)}${v.fc ? ' · food court' : ''}</div>
          </div>
          ${visitorsBadges}
        </div>`;
    }).join('');
  });

  $('#list').innerHTML = html;
  $$('#list [data-tog]').forEach(b => b.onclick = e => { e.stopPropagation(); toggle(b.dataset.tog); });
  $$('#list [data-go]').forEach(d => d.onclick = () => {
    const v = venue(d.dataset.go);
    if (v.floor !== ui.floor && v.floor !== OUT_ID) { ui.floor = v.floor; drawFloor(); renderFloors(); }
    select(v.id, true);
  });
}

function renderProgress() {
  const tot = VENUES.length, done = VENUES.filter(v => isVisited(v.id)).length;
  const pct = tot ? Math.round(done / tot * 100) : 0;
  // Kompaktní hlavička má jen počítadlo — progress bar a procenta nemusí v HTML existovat
  const cnt = $('#progCount'), total = $('#progTotal'), bar = $('#progBar'), pctEl = $('#progPct');
  if (cnt) cnt.textContent = done;
  if (total) total.textContent = tot;
  if (bar) bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + ' %';
}

function renderFloors() {
  $('#floorBar').innerHTML = FLOORS.filter(f => !isOutside(f)).map(f => {
    const arr = VENUES.filter(v => v.floor === f.id);
    const done = arr.filter(v => isVisited(v.id)).length;
    return `<button data-f="${f.id}" class="floor-tab ${ui.floor === f.id ? 'active' : ''}">
      ${esc(f.short.replace(/^[^\p{L}\p{N}−-]+/u, ''))}${arr.length ? `<small>${done}/${arr.length}</small>` : ''}</button>`;
  }).join('');
  $$('#floorBar [data-f]').forEach(b => b.onclick = () => {
    if (ui.floor === b.dataset.f) return;
    ui.floor = b.dataset.f; ui.sel = null;
    drawFloor(); renderFloors(); renderDetail(); fit();
  });
}

/* ============================================================
   DETAIL
   ============================================================ */
function select(id, focus) {
  ui.sel = (ui.sel === id && !focus) ? null : id;
  refreshMap(); renderList(); renderDetail(true);
  if (!ui.sel) return;
  const v = venue(ui.sel);
  if (!v) return;
  if (focus === true) focusOn(v);
  else requestAnimationFrame(() => ensureVisible(v));
}

function renderDetail(force = false) {
  const p = $('#detail');
  const dScrim = $('#detailScrim');
  if (!ui.sel) {
    p.classList.add('hidden');
    p.classList.remove('flex');
    if (dScrim) dScrim.classList.add('hidden');
    return;
  }

  // Pokud uživatel zrovna píše v poli poznámky nebo data a není vynuceno překreslení,
  // nepřekreslujeme DOM, aby neztratil fokus a mohl nepřetržitě psát!
  if (!force) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.id === 'dNote' || activeEl.id === 'dDate')) {
      return;
    }
  }

  const v = venue(ui.sel);
  const c = cat(v.cat), f = floorOf(v.floor);

  const members = window.DB ? window.DB.getMembers() : [];
  const currentAuthorId = ui.reviewAuthorId || getSavedAuthorId();
  let activeAuthor = (window.DB ? window.DB.getMember(currentAuthorId) : null)
    || (window.DB ? window.DB.getActiveAuthor() : null)
    || members[0];
  if (activeAuthor) {
    ui.reviewAuthorId = activeAuthor.id;
  }

  const currentRev = (activeAuthor && window.DB)
    ? (window.DB.getReview(v.id, activeAuthor.id) || { visited: false, rating: 0, note: '', date: null })
    : { visited: false, rating: 0, note: '', date: null };

  const allReviews = window.DB ? window.DB.getVenueReviews(v.id) : [];
  const vStats = window.DB ? window.DB.getVenueStats(v.id) : null;

  p.classList.remove('hidden');
  p.classList.add('flex');
  if (dScrim && innerWidth < 1024) dScrim.classList.remove('hidden');
  if (innerWidth < 1024) closeSidebar();

  p.innerHTML = `
    <div class="px-4 py-3 sm:px-5 sm:pt-5 sm:pb-4 border-b border-line flex items-center sm:items-start gap-2.5 sm:gap-3">
      <button id="dCloseMobile" class="sm:hidden btn-icon shrink-0 mr-0.5 border-transparent" aria-label="Zpět na mapu">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
      </button>
      <div class="logo-box w-11 h-11 sm:w-14 sm:h-14 p-1.5 shrink-0">${logoMarkup(v)}</div>
      <div class="min-w-0 flex-1">
        <h2 class="d-title text-base sm:text-xl font-bold truncate">${esc(v.name)}</h2>
        <p class="text-xs text-ink2 mt-0.5 truncate">${esc(c.label)} · ${esc(f.name)}</p>
      </div>
      <button id="dClose" class="hidden sm:inline-flex btn-icon -mt-1 -mr-2 border-transparent" aria-label="Zavřít">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="square" d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5 scroll-thin text-sm">
      ${v.desc ? `<p class="text-ink2 leading-relaxed">${esc(v.desc)}</p>` : ''}
      ${v.open ? `<p class="text-xs text-ink2">${esc(v.open)}${safeUrl(v.web) ? ` · <a href="${esc(safeUrl(v.web))}" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:text-ink">web</a>` : ''}</p>` : ''}
      ${v.tags?.length ? `<div class="flex flex-wrap gap-1.5">${v.tags.map(t => `<span class="chip static">${esc(t)}</span>`).join('')}</div>` : ''}

      <!-- POVINNÝ VÝBĚR: KDO HODNOTÍ / KDO TAM BYL -->
      <div class="space-y-2 border-t border-line pt-4">
        <div class="flex items-center justify-between">
          <label class="d-label !mb-0 font-semibold text-ink flex items-center gap-1">
            <span>Kdo to píše / kdo tam byl:</span>
            <span class="text-no font-bold" title="Povinné pole">*</span>
          </label>
          <button id="btnAddNewMemberInline" class="text-xs text-ink hover:underline font-semibold flex items-center gap-1">
            <span>+ Přidat osobu & logo</span>
          </button>
        </div>
        <div class="flex flex-wrap gap-1.5" id="authorPillsList">
          ${members.map(m => memberPillMarkup(m, activeAuthor && m.id === activeAuthor.id)).join('')}
        </div>
      </div>

      <!-- FORMULÁŘ NÁVŠTĚVY PRO VYBRANOU OSOBU -->
      ${activeAuthor ? `
        <div class="p-3.5 bg-white border border-line space-y-4">
          <div class="flex items-center justify-between">
            <div class="font-semibold text-xs flex items-center gap-1.5" style="color:${esc(activeAuthor.color)}">
              <span>${esc(activeAuthor.logo)}</span>
              <span>Záznam pro: ${esc(activeAuthor.name)}</span>
            </div>
            <div class="status ${currentRev.visited ? 'is-done' : ''}"><i></i>${currentRev.visited ? 'Navštíveno' : 'Zatím nenavštíveno'}</div>
          </div>

          <button id="dTog" class="btn-primary ${currentRev.visited ? 'is-done' : ''}">
            ${currentRev.visited ? 'Zrušit návštěvu pro ' + esc(activeAuthor.name) : 'Označit: ' + esc(activeAuthor.name) + ' zde byl/a'}
          </button>

          <div class="${currentRev.visited ? '' : 'opacity-40 pointer-events-none'} space-y-4 pt-1">
            <div>
              <span class="d-label">Hodnocení (${esc(activeAuthor.name)})</span>
              <div id="stars" class="flex items-center gap-1" role="group" aria-label="Hodnocení od jedné do pěti hvězd">
                ${[1,2,3,4,5].map(i => `<button type="button" data-s="${i}" aria-label="${i} z 5" class="star ${i <= (currentRev.rating || 0) ? 'on' : ''}">★</button>`).join('')}
                ${currentRev.rating ? `<button type="button" data-s="0" class="ml-2 text-xs text-ink3 hover:text-no underline underline-offset-2">Smazat</button>` : ''}
              </div>
            </div>
            <div>
              <label class="d-label" for="dDate">Datum návštěvy</label>
              <input id="dDate" type="date" value="${currentRev.date || ''}" class="field">
            </div>
            <div>
              <label class="d-label" for="dNote">Poznámka / Co jste si dali</label>
              <textarea id="dNote" rows="3" placeholder="Jak vám chutnalo, doporučení…" class="field resize-none leading-relaxed">${esc(currentRev.note || '')}</textarea>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- PŘEHLED VŠECH ČLENŮ: KDO Z PARTY ZDE BYL -->
      <div class="border-t border-line pt-4 space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="d-label !mb-0 font-semibold text-ink">Kdo z party zde byl (${vStats ? vStats.visitorCount : 0}/${members.length})</span>
          ${vStats && vStats.avgRating ? `<span class="comm-rating-pill">★ ${vStats.avgRating} / 5</span>` : ''}
        </div>

        <div class="space-y-1.5">
          ${members.map(m => {
            const rev = window.DB ? window.DB.getReview(v.id, m.id) : null;
            const wasThere = rev && rev.visited;
            if (wasThere) {
              return `
                <div class="p-2.5 bg-white border border-line space-y-1">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5 font-medium text-xs text-ink">
                      <span>${esc(m.logo)}</span>
                      <span>${esc(m.name)}</span>
                      <span class="text-yes text-[11px] font-semibold">✓ byl/a</span>
                    </div>
                    <div class="flex items-center gap-2">
                      ${rev.rating ? starsMarkup(rev.rating) : ''}
                      ${rev.date ? `<span class="text-[10px] text-ink3 tabular-nums">${esc(rev.date)}</span>` : ''}
                    </div>
                  </div>
                  ${rev.note ? `<p class="text-xs text-ink2 italic leading-relaxed pt-0.5">„${esc(rev.note)}“</p>` : ''}
                </div>`;
            } else {
              return `
                <div class="px-2.5 py-1.5 bg-paper border border-line text-xs text-ink3 flex items-center justify-between opacity-75">
                  <span class="flex items-center gap-1.5">${esc(m.logo)} ${esc(m.name)}</span>
                  <span>zatím nebyl/a</span>
                </div>`;
            }
          }).join('')}
        </div>
      </div>
    </div>

    <div class="px-5 py-3 border-t border-line">
      <button id="dFocus" class="btn-ghost">Zaměřit na mapě</button>
    </div>`;

  const btnClose = $('#dClose');
  if (btnClose) btnClose.onclick = () => select(null);
  const btnCloseMob = $('#dCloseMobile');
  if (btnCloseMob) btnCloseMob.onclick = () => select(null);

  const btnFocus = $('#dFocus');
  if (btnFocus) {
    btnFocus.onclick = () => {
      if (innerWidth < 1024) {
        // Na mobilu po zaměření zavřeme panel, aby byla mapa vidět
        select(null);
      }
      focusOn(v, 5);
    };
  }

  const btnAddInline = $('#btnAddNewMemberInline');
  if (btnAddInline) btnAddInline.onclick = () => openAddMemberModal();

  // Přepínání kdo hodnotí (Vojta / Peťa / Adél ...)
  $$('#authorPillsList [data-author]').forEach(btn => {
    btn.onclick = () => {
      const aId = btn.dataset.author;
      setSavedAuthorId(aId);
      renderDetail(true);
      renderMemberNavTabs();
    };
  });

  if (activeAuthor) {
    const aId = activeAuthor.id;
    const btnTog = $('#dTog');
    if (btnTog) btnTog.onclick = () => toggle(v.id, aId);

    $$('#stars [data-s]').forEach(b => {
      b.onclick = () => {
        const ratingVal = +b.dataset.s;
        const cur = window.DB.getReview(v.id, aId) || { visited: true, rating: 0, note: '', date: null };
        cur.rating = ratingVal;
        cur.visited = true;
        if (!cur.date) cur.date = new Date().toISOString().slice(0, 10);
        save(v.id, aId, cur);
        renderDetail();
        renderList();
      };
    });

    const dateInp = $('#dDate');
    if (dateInp) {
      dateInp.onchange = e => {
        const cur = window.DB.getReview(v.id, aId) || { visited: true, rating: 0, note: '', date: null };
        cur.date = e.target.value || null;
        save(v.id, aId, cur, true);
      };
    }

    const noteInp = $('#dNote');
    if (noteInp) {
      let nt;
      noteInp.oninput = e => {
        clearTimeout(nt);
        const val = e.target.value;
        nt = setTimeout(() => {
          const cur = window.DB.getReview(v.id, aId) || { visited: true, rating: 0, note: '', date: null };
          cur.note = val;
          save(v.id, aId, cur, true); // silent = true: uloží se do cloudu i paměti, ale nepřekreslí detail
        }, 300);
      };

      noteInp.onblur = () => {
        clearTimeout(nt);
        const cur = window.DB.getReview(v.id, aId) || { visited: true, rating: 0, note: '', date: null };
        if (cur.note !== noteInp.value) {
          cur.note = noteInp.value;
          save(v.id, aId, cur, true);
        }
      };
    }
  }
}

function toggle(venueId, authorId = null) {
  const aId = authorId || ui.reviewAuthorId || (window.DB ? window.DB.getActiveAuthorId() : 'vojta');
  const cur = (window.DB ? window.DB.getReview(venueId, aId) : null) || { visited: false, rating: 0, note: '', date: null };
  const newVisited = !cur.visited;

  const updatedRev = {
    visited: newVisited,
    rating: newVisited ? (cur.rating || 0) : 0,
    note: cur.note || '',
    date: newVisited ? (cur.date || new Date().toISOString().slice(0, 10)) : null
  };

  save(venueId, aId, updatedRev);

  const mem = window.DB ? window.DB.getMember(aId) : null;
  const authorName = mem ? mem.name : aId;
  const v = venue(venueId);

  if (newVisited) {
    toast(`${v ? v.name : venueId} — ${authorName} navštívil/a!`);
  }
  renderAll();
}

/* ============================================================
   MODÁLY
   ============================================================ */
const closeModal = () => $('#modal').classList.add('hidden');
function openModal(html) {
  $('#modalBox').innerHTML = html;
  const m = $('#modal');
  m.classList.remove('hidden');
  m.classList.add('flex');
  m.onclick = e => { if (e.target === m) closeModal(); };
  $$('#modalBox [data-close]').forEach(b => b.onclick = closeModal);
}

const modalHead = title => `
  <div class="flex items-center justify-between px-5 h-14 border-b border-line">
    <h2 class="d-title !text-xl uppercase tracking-wider">${title}</h2>
    <button data-close class="btn-icon border-transparent -mr-2" aria-label="Zavřít">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="square" d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>`;

/* MODÁL PRO PŘIDÁNÍ NOVÉHO ČLOVĚKA A LOGA */
function openAddMemberModal() {
  const emojis = ['👑', '🍕', '✨', '🍔', '☕', '🍣', '🌮', '🍩', '🥑', '🥩', '🍜', '🍦', '🍻', '🍟', '🦁', '🚀', '⭐', '🎈'];
  const colors = ['#2563eb', '#e11d48', '#9333ea', '#3b8559', '#ea580c', '#0d9488', '#d97706', '#ec4899'];
  let selectedEmoji = emojis[0];
  let selectedColor = colors[0];

  openModal(`
    ${modalHead('Přidat novou osobu & logo')}
    <form id="addMemberForm" class="p-5 space-y-4">
      <div>
        <label class="d-label" for="newMemName">Jméno osoby <span class="text-no">*</span></label>
        <input id="newMemName" type="text" placeholder="např. Honza, Bára, Kačka..." required autocomplete="off" class="field">
      </div>

      <div>
        <label class="d-label">Logo / Symbol</label>
        <div class="grid grid-cols-6 gap-2 pt-1" id="emojiGrid">
          ${emojis.map(em => `
            <button type="button" class="emoji-btn ${em === selectedEmoji ? 'active' : ''}" data-emoji="${em}">${em}</button>
          `).join('')}
        </div>
        <div class="mt-2.5 flex items-center gap-2">
          <span class="text-xs text-ink2">Nebo zadejte vlastní symbol/emoji:</span>
          <input id="customEmoji" type="text" maxlength="4" placeholder="emoji" class="field !w-20 !py-1 text-center font-bold">
        </div>
      </div>

      <div>
        <label class="d-label">Barva na mapě</label>
        <div class="flex gap-2 pt-1" id="colorGrid">
          ${colors.map(c => `
            <button type="button" class="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${c === selectedColor ? 'border-ink scale-110' : 'border-transparent'}" style="background-color:${c}" data-col="${c}"></button>
          `).join('')}
        </div>
      </div>

      <div id="addMemberError" class="text-xs text-no hidden"></div>

      <button type="submit" class="btn-primary mt-2">Přidat do party</button>
    </form>
  `);

  $$('#emojiGrid .emoji-btn').forEach(b => b.onclick = () => {
    selectedEmoji = b.dataset.emoji;
    $$('#emojiGrid .emoji-btn').forEach(x => x.classList.toggle('active', x.dataset.emoji === selectedEmoji));
    const ce = $('#customEmoji');
    if (ce) ce.value = '';
  });

  const customInput = $('#customEmoji');
  if (customInput) {
    customInput.oninput = e => {
      const v = e.target.value.trim();
      if (v) {
        selectedEmoji = v;
        $$('#emojiGrid .emoji-btn').forEach(x => x.classList.remove('active'));
      }
    };
  }

  $$('#colorGrid button').forEach(b => b.onclick = () => {
    selectedColor = b.dataset.col;
    $$('#colorGrid button').forEach(x => x.classList.toggle('border-ink', x.dataset.col === selectedColor));
    $$('#colorGrid button').forEach(x => x.classList.toggle('scale-110', x.dataset.col === selectedColor));
  });

  $('#addMemberForm').onsubmit = async e => {
    e.preventDefault();
    const name = $('#newMemName').value.trim();
    const errBox = $('#addMemberError');
    errBox.classList.add('hidden');

    try {
      const newM = await window.DB.addMember(name, selectedColor, selectedEmoji);
      setSavedAuthorId(newM.id);
      ui.viewMemberId = newM.id;
      toast(`Přidána nová osoba: ${newM.logo} ${newM.name}`);
      closeModal();
      renderMemberNavTabs();
      renderAll();
    } catch (err) {
      errBox.textContent = err.message || 'Chyba při přidávání osoby.';
      errBox.classList.remove('hidden');
    }
  };
}

/* MODÁL PRO SMAZÁNÍ ČLENA (S POTVRZENÍM) */
function openDeleteMemberModal(memberId) {
  const m = window.DB ? window.DB.getMember(memberId) : null;
  if (!m) return;
  const isLast = window.DB.getMembers().length <= 1;
  const visited = window.DB.getVisitedCount(m.id);
  const records = window.DB.getMemberReviewCount(m.id);

  openModal(`
    ${modalHead('Smazat osobu')}
    <div class="p-5 space-y-4 text-sm">
      <div class="flex items-center gap-3 p-3 bg-white border border-line">
        <span class="text-2xl">${esc(m.logo)}</span>
        <div class="min-w-0">
          <div class="font-semibold" style="color:${esc(m.color)}">${esc(m.name)}</div>
          <div class="text-xs text-ink2">${visited} navštívených podniků · ${records} záznamů celkem</div>
        </div>
      </div>
      ${isLast
        ? `<p class="text-xs text-no">Posledního člena party nelze smazat. Nejdřív přidejte někoho dalšího.</p>`
        : `<p class="text-ink2 leading-relaxed">Opravdu chcete smazat <b>${esc(m.name)}</b>? Spolu s ním/ní se ${records ? `smaže i <b>${records}</b> ${records === 1 ? 'záznam' : records < 5 ? 'záznamy' : 'záznamů'} (návštěvy, hodnocení a poznámky)` : 'nic dalšího nesmaže, zatím nemá žádné záznamy'} — na všech zařízeních. Tuto akci nelze vrátit.</p>
           ${records ? `<p class="text-xs text-ink3">Tip: Pokud si chcete data ponechat, udělejte si nejdřív zálohu přes Data → Exportovat JSON.</p>` : ''}`}
      <div class="grid grid-cols-2 gap-3 pt-1">
        <button data-close class="btn-ghost">Zrušit</button>
        ${isLast ? '' : `<button id="btnConfirmDelMember" class="btn-ghost btn-danger">Smazat ${esc(m.name)}</button>`}
      </div>
    </div>`);

  const btnConfirm = $('#btnConfirmDelMember');
  if (btnConfirm) btnConfirm.onclick = async () => {
    btnConfirm.disabled = true;
    try {
      await window.DB.deleteMember(m.id);
      if (ui.viewMemberId === m.id) {
        ui.viewMemberId = 'all';
        $('#inspectBanner').classList.add('hidden');
      }
      if (ui.reviewAuthorId === m.id) ui.reviewAuthorId = window.DB.getActiveAuthorId();
      closeModal();
      renderMemberNavTabs();
      renderAll(true);
      toast(`${m.logo} ${m.name} byl/a smazán/a`);
    } catch (err) {
      btnConfirm.disabled = false;
      toast(err.message || 'Smazání se nepodařilo', true);
    }
  };
}

/* PŘEHLED NÁVŠTĚV & ŽEBŘÍČEK */
$('#btnStats').onclick = () => {
  const allVenueIds = VENUES.map(v => v.id);
  const stats = window.DB ? window.DB.getAllStats(allVenueIds) : { memberStats: [], commonVenues: [], unvisitedVenues: [] };

  openModal(`
    ${modalHead('Přehled návštěv & Žebříček')}
    <div class="p-5 space-y-6 max-h-[75vh] overflow-y-auto scroll-thin">
      <div>
        <div class="text-xs font-semibold text-ink2 uppercase tracking-wider mb-3">Žebříček návštěvnosti party</div>
        <div class="divide-y divide-line border border-line bg-white">
          ${stats.memberStats.map((ms, idx) => {
            const pct = Math.round((ms.visitedCount / VENUES.length) * 100);
            return `
              <div class="p-3.5 flex items-center gap-3">
                <span class="font-display font-semibold text-base text-ink3 w-5 text-center">${idx + 1}.</span>
                <span class="text-xl">${esc(ms.member.logo)}</span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-sm text-ink">${esc(ms.member.name)}</span>
                    <span class="text-xs text-[#c98a1e] font-medium">${ms.avgRating !== '–' ? '★ ' + ms.avgRating : ''}</span>
                  </div>
                  <div class="flex items-center gap-2 mt-1">
                    <div class="flex-1 h-2 bg-line rounded-full overflow-hidden">
                      <div class="h-full" style="width:${pct}%; background-color:${esc(ms.member.color)}"></div>
                    </div>
                    <span class="text-xs text-ink2 tabular-nums">${ms.visitedCount} / ${VENUES.length} (${pct} %)</span>
                  </div>
                </div>
                <button class="btn !h-7 !px-2.5 text-xs shrink-0" data-view-member="${esc(ms.member.id)}">
                  Zobrazit mapu
                </button>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="p-3.5 bg-white border border-line text-center">
          <div class="font-display text-2xl font-semibold text-yes tabular-nums">${stats.commonVenues.length}</div>
          <div class="text-xs text-ink2 mt-1">Byli jsme všichni společně</div>
        </div>
        <div class="p-3.5 bg-white border border-line text-center">
          <div class="font-display text-2xl font-semibold text-no tabular-nums">${stats.unvisitedVenues.length}</div>
          <div class="text-xs text-ink2 mt-1">Kde ještě nikdo nebyl</div>
        </div>
      </div>

      ${stats.commonVenues.length ? `
        <div>
          <div class="text-xs font-semibold text-ink2 uppercase tracking-wider mb-2">Společně navštívené podniky (${stats.commonVenues.length})</div>
          <div class="flex flex-wrap gap-1.5">
            ${stats.commonVenues.map(vId => {
              const v = venue(vId);
              return `<button class="chip static cursor-pointer hover:!border-ink" data-go="${esc(vId)}">${esc(v ? v.name : vId)}</button>`;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${stats.unvisitedVenues.length ? `
        <div>
          <div class="text-xs font-semibold text-ink2 uppercase tracking-wider mb-2">Zatím nenavštívené podniky (${stats.unvisitedVenues.length})</div>
          <div class="flex flex-wrap gap-1.5">
            ${stats.unvisitedVenues.map(vId => {
              const v = venue(vId);
              return `<button class="chip static cursor-pointer hover:!border-ink text-ink3" data-go="${esc(vId)}">${esc(v ? v.name : vId)}</button>`;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `);

  $$('#modalBox [data-view-member]').forEach(b => b.onclick = () => {
    const mId = b.dataset.viewMember;
    closeModal();
    ui.viewMemberId = mId;
    ui.reviewAuthorId = mId;
    window.DB.setActiveAuthorId(mId);
    renderMemberNavTabs();
    renderAll();
  });

  $$('#modalBox [data-go]').forEach(b => b.onclick = () => {
    const vId = b.dataset.go;
    const v = venue(vId);
    closeModal();
    if (v) {
      if (v.floor !== ui.floor && v.floor !== OUT_ID) { ui.floor = v.floor; drawFloor(); renderFloors(); }
      select(v.id, true);
    }
  });
};

/* MODÁL DATA & NASTAVENÍ DATABÁZE */
$('#btnMenu').onclick = () => {
  const isCloud = window.DB && window.DB.isCloud();
  const cfg = window.APP_CONFIG || {};

  openModal(`${modalHead('Data & Databáze')}
  <div class="p-5 space-y-4 text-sm">
    <!-- Stav připojení k databázi -->
    <div class="p-3.5 ${isCloud ? 'bg-yes/10 border-yes/40' : 'bg-paper border-line2'} border space-y-2">
      <div class="flex items-center justify-between">
        <div class="font-semibold text-xs flex items-center gap-1.5 ${isCloud ? 'text-yes' : 'text-ink2'}">
          <span class="w-2.5 h-2.5 rounded-full ${isCloud ? 'bg-yes animate-pulse' : 'bg-ink3'}"></span>
          <span>${isCloud ? 'PŘIPOJENO K SUPABASE CLOUDU' : 'OFFLINE / LOKÁLNÍ REŽIM'}</span>
        </div>
        <button id="btnForceSync" class="text-xs text-ink hover:underline font-semibold flex items-center gap-1">
          🔄 Synchronizovat teď
        </button>
      </div>
      <p class="text-xs text-ink2 leading-relaxed">
        ${isCloud
          ? `Databáze je <b>online</b> a propojena se Supabase. Všechny recenze i návštěvy se automaticky synchronizují v reálném čase mezi všemi zařízeními.`
          : `Aplikace momentálně běží v lokálním režimu na paměti tohoto zařízení.`}
      </p>
      ${isCloud ? `
        <div class="text-[11px] text-ink3 font-mono truncate pt-1 border-t border-line">
          URL: ${esc(cfg.supabaseUrl)}
        </div>
      ` : ''}
    </div>

    <div>
      <div class="text-xs font-semibold text-ink2 uppercase tracking-wider mb-2">Správa připojení</div>
      <button id="mDbSettings" class="btn-ghost flex items-center justify-center gap-2 font-medium !text-ink">
        <svg class="w-4 h-4 text-yes" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
        Zkontrolovat / změnit API klíče
      </button>
    </div>

    <div class="border-t border-line pt-3">
      <div class="text-xs font-semibold text-ink2 uppercase tracking-wider mb-2">Správa osob</div>
      <div class="divide-y divide-line border border-line bg-white mb-2">
        ${(window.DB ? window.DB.getMembers() : []).map(m => `
          <div class="flex items-center gap-2 px-3 py-2">
            <span class="member-dot" style="background:${esc(m.color)}"></span>
            <span class="text-base leading-none">${esc(m.logo)}</span>
            <span class="flex-1 min-w-0 truncate font-medium">${esc(m.name)}</span>
            <span class="text-[11px] text-ink3 tabular-nums">${window.DB.getVisitedCount(m.id)} navštíveno</span>
            <button class="text-xs text-ink3 hover:text-no underline underline-offset-2 shrink-0" data-del-member="${esc(m.id)}">Smazat</button>
          </div>`).join('')}
      </div>
      <button id="mAddMemberBtn" class="btn-ghost">
        + Přidat další osobu a logo
      </button>
    </div>

    <div class="border-t border-line pt-3">
      <div class="text-xs font-semibold text-ink2 uppercase tracking-wider mb-2">Lokální záloha</div>
      <div class="grid grid-cols-2 gap-3">
        <button id="mExport" class="btn-ghost">Exportovat JSON</button>
        <button id="mImport" class="btn-ghost">Importovat JSON</button>
      </div>
    </div>

    <div class="border-t border-line pt-3">
      <button id="mClear" class="btn-ghost hover:!border-no hover:!text-no">Smazat všechna data</button>
    </div>
  </div>`);

  $$('#modalBox [data-del-member]').forEach(b => b.onclick = () => openDeleteMemberModal(b.dataset.delMember));

  const btnSync = $('#btnForceSync');
  if (btnSync) {
    btnSync.onclick = async () => {
      toast('Synchronizuji se Supabase…');
      await syncFromCloud();
      closeModal();
      toast('Synchronizace dokončena!');
    };
  }
};

const cloudBadge = $('#cloudStatusBadge');
if (cloudBadge) cloudBadge.onclick = () => $('#btnMenu').click();

function openDbSettingsModal() {
  const cfg = window.APP_CONFIG || {};

  openModal(`
    ${modalHead('Nastavení Supabase databáze')}
    <div class="p-5 space-y-4 text-sm">
      <div class="p-3 bg-paper border border-line2 text-xs space-y-2 leading-relaxed text-ink2">
        <p class="font-medium text-ink">Jak propojit aplikaci s databází na Vercelu / Supabase:</p>
        <ol class="list-decimal pl-4 space-y-1">
          <li>Založte projekt zdarma na <a href="https://supabase.com" target="_blank" rel="noopener" class="underline text-ink font-semibold">supabase.com</a>.</li>
          <li>V <b>SQL Editoru</b> spusťte skript ze souboru <code class="bg-white px-1 py-0.5 border">supabase-schema.sql</code>.</li>
          <li>V <b>Project Settings -> API</b> zkopírujte <b>Project URL</b> a <b>anon public key</b>:</li>
        </ol>
      </div>

      <div class="space-y-3">
        <div>
          <label class="d-label" for="cfgUrl">Project URL (Supabase)</label>
          <input id="cfgUrl" type="url" placeholder="https://xyzcompany.supabase.co" value="${esc(cfg.supabaseUrl || '')}" class="field">
        </div>

        <div>
          <label class="d-label" for="cfgKey">Anon Public Key</label>
          <input id="cfgKey" type="text" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." value="${esc(cfg.supabaseAnonKey || '')}" class="field font-mono text-xs">
        </div>

        <button id="btnSaveDbConfig" class="btn-primary">Uložit a připojit databázi</button>
      </div>

      <div class="border-t border-line pt-3 flex items-center justify-between">
        <button id="btnResetToDemo" class="text-xs text-ink3 hover:text-ink underline">
          Vymazat klíče a používat lokální režim
        </button>
      </div>
    </div>`);

  $('#btnSaveDbConfig').onclick = async () => {
    const url = $('#cfgUrl').value.trim();
    const key = $('#cfgKey').value.trim();
    if (url && !url.startsWith('http')) return toast('URL musí začínat http:// nebo https://', true);

    window.saveAppConfig(url, key);
    toast('Konfigurace uložena, připojuji…');
    closeModal();

    await window.DB.init();
    renderAll();
  };

  $('#btnResetToDemo').onclick = async () => {
    window.saveAppConfig('', '');
    toast('Přepnuto do lokálního režimu');
    closeModal();
    await window.DB.init();
    renderAll();
  };
}

/* ============================================================
   LIŠTA VÝBĚRU OSOB (HLAVIČKA + MOBILNÍ LIŠTA)
   ============================================================ */
function renderMemberNavTabs() {
  if (!window.DB) return;
  const members = window.DB.getMembers();
  const container = $('#memberNavTabs');
  const mobBar = $('#mobileMemberBar');

  if (container) {
    container.innerHTML = members.map(m => {
      const isAct = ui.viewMemberId === m.id;
      return `
        <button class="view-btn ${isAct ? 'active' : ''}" data-member="${esc(m.id)}" style="${isAct ? 'background-color:' + esc(m.color) + '; color:#fff;' : ''}">
          <span class="mr-1">${esc(m.logo)}</span>
          <span>${esc(m.name)}</span>
        </button>`;
    }).join('');
  }

  if (mobBar) {
    const isAll = ui.viewMemberId === 'all';
    mobBar.innerHTML = `
      <button class="view-btn ${isAll ? 'active' : ''}" data-member="all">Všichni</button>
      ${members.map(m => {
        const isAct = ui.viewMemberId === m.id;
        const colorStyle = isAct ? `background-color:${esc(m.color)}; color:#fff;` : '';
        return `
          <button class="view-btn ${isAct ? 'active' : ''}" data-member="${esc(m.id)}" style="${colorStyle}">
            <span class="mr-1">${esc(m.logo)}</span>
            <span>${esc(m.name)}</span>
          </button>`;
      }).join('')}
      <button id="btnMobileAddMember" class="view-btn text-ink3 hover:text-ink font-bold shrink-0" title="Přidat další osobu">+ Nový</button>
    `;
    const btnMobAdd = $('#btnMobileAddMember');
    if (btnMobAdd) btnMobAdd.onclick = () => openAddMemberModal();
  }

  $$('#viewSelector [data-member], #mobileMemberBar [data-member]').forEach(b => {
    b.onclick = () => {
      const mId = b.dataset.member;
      ui.viewMemberId = mId;
      if (mId !== 'all') {
        setSavedAuthorId(mId);
      }
      renderMemberNavTabs();
      renderAll(true);

      const inspectBanner = $('#inspectBanner');
      const inspectText = $('#inspectText');
      if (mId === 'all') {
        if (inspectBanner) inspectBanner.classList.add('hidden');
        toast('Zobrazena celková mapa všech návštěv');
      } else {
        const mObj = window.DB.getMember(mId);
        if (inspectBanner && mObj) {
          inspectBanner.classList.remove('hidden');
          const count = window.DB.getVisitedCount(mId);
          inspectText.innerHTML = `Mapa návštěv: ${esc(mObj.logo)} <b>${esc(mObj.name)}</b> (${count}/${VENUES.length} navštíveno)`;
        }
        if (mObj) toast(`Zobrazena mapa: ${mObj.logo} ${mObj.name}`);
      }
    };
  });

  const btnAll = $('#viewSelector [data-member="all"]');
  if (btnAll) btnAll.classList.toggle('active', ui.viewMemberId === 'all');
}

// Události v dialogu Data
document.addEventListener('click', async e => {
  const t = e.target.closest('#mExport,#mImport,#mClear,#btnReset,#mDbSettings,#mAddMemberBtn');
  if (!t) return;

  if (t.id === 'mDbSettings') {
    closeModal();
    openDbSettingsModal();
    return;
  }
  if (t.id === 'mAddMemberBtn') {
    closeModal();
    openAddMemberModal();
    return;
  }
  if (t.id === 'mExport') {
    const exportData = {
      members: window.DB ? window.DB.getMembers() : [],
      reviews: localStorage.getItem('fnk_reviews_v2') ? JSON.parse(localStorage.getItem('fnk_reviews_v2')) : {}
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `foodcourt-karolina-recenze-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    toast('Exportováno');
  }
  if (t.id === 'mImport') {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'application/json';
    i.onchange = () => {
      const f = i.files[0]; if (!f) return;
      if (f.size > 2 * 1024 * 1024) {
        toast('Soubor zálohy je příliš velký (max 2 MB)', true);
        return;
      }
      const rd = new FileReader();
      rd.onload = async () => {
        try {
          const d = JSON.parse(rd.result);
          if (!d || typeof d !== 'object' || Array.isArray(d)) throw 0;

          let importedMembers = [];
          let importedReviews = {};

          // Bezpečná validace recenzí (ochrana před Prototype Pollution)
          if (d.reviews && typeof d.reviews === 'object' && !Array.isArray(d.reviews)) {
            const cleanReviews = Object.create(null);
            for (const [vId, authMap] of Object.entries(d.reviews)) {
              if (vId === '__proto__' || vId === 'constructor' || vId === 'prototype') continue;
              if (typeof authMap !== 'object' || !authMap || Array.isArray(authMap)) continue;
              cleanReviews[vId] = Object.create(null);
              for (const [aId, r] of Object.entries(authMap)) {
                if (aId === '__proto__' || aId === 'constructor' || aId === 'prototype') continue;
                if (typeof r !== 'object' || !r) continue;
                const rNum = Number(r.rating || 0);
                cleanReviews[vId][aId] = {
                  visited: Boolean(r.visited),
                  rating: Math.max(0, Math.min(5, isNaN(rNum) ? 0 : Math.round(rNum))),
                  note: String(r.note || '').slice(0, 1000),
                  date: (r.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) ? String(r.date) : null
                };
              }
            }
            importedReviews = cleanReviews;
          }

          // Bezpečná validace členů
          if (Array.isArray(d.members)) {
            const cleanMembers = d.members.filter(m => m && typeof m === 'object').map(m => ({
              id: String(m.id || '').replace(/[^a-z0-9_-]/g, '').slice(0, 50),
              name: String(m.name || '').slice(0, 30),
              color: /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : '#3b8559',
              logo: String(m.logo || '👤').slice(0, 8)
            })).filter(m => m.id && m.name && m.id !== '__proto__');
            importedMembers = cleanMembers;
          }

          closeModal();
          if (window.DB) await window.DB.importData(importedMembers, importedReviews);
          renderMemberNavTabs();
          renderAll();
          toast('Úspěšně importováno');
        } catch { toast('Neplatný soubor zálohy', true); }
      };
      rd.readAsText(f);
    };
    i.click();
  }
  if (t.id === 'mClear' || t.id === 'btnReset') {
    if (!confirm('Opravdu chcete vymazat všechny zaznamenané recenze a návštěvy?')) return;
    localStorage.removeItem('fnk_reviews_v2');
    if (window.DB) {
      await window.DB.resetDatabase(false);
    }
    ui.sel = null;
    renderAll();
    closeModal();
    toast('Všechny recenze byly vymazány');
  }
});

const btnAddMem = $('#btnAddMember');
if (btnAddMem) btnAddMem.onclick = () => openAddMemberModal();

const inspectClose = $('#inspectClose');
if (inspectClose) inspectClose.onclick = () => {
  ui.viewMemberId = 'all';
  renderMemberNavTabs();
  renderAll();
  $('#inspectBanner').classList.add('hidden');
};

/* ============================================================
   FILTRY UI + SIDEBAR
   ============================================================ */
$$('.flt').forEach(b => b.onclick = () => { ui.filter = b.dataset.filter; renderAll(); });
let st; $('#search').oninput = e => { clearTimeout(st); st = setTimeout(() => { ui.q = e.target.value.trim(); renderAll(); }, 160); };

const openSidebar  = () => { $('#sidebar').classList.remove('-translate-x-full'); $('#scrim').classList.remove('hidden'); };
const closeSidebar = () => { $('#sidebar').classList.add('-translate-x-full'); $('#scrim').classList.add('hidden'); };
$('#btnSidebar').onclick = () => $('#sidebar').classList.contains('-translate-x-full') ? openSidebar() : closeSidebar();
$('#scrim').onclick = closeSidebar;

const btnCloseSb = $('#btnCloseSidebar');
if (btnCloseSb) btnCloseSb.onclick = closeSidebar;

const btnMobList = $('#btnMobileList');
if (btnMobList) btnMobList.onclick = openSidebar;

const dScrim = $('#detailScrim');
if (dScrim) dScrim.onclick = () => select(null);

function renderAll(force = false) {
  $$('.flt').forEach(b => b.classList.toggle('on', b.dataset.filter === ui.filter));
  renderChips(); renderList(); renderProgress(); renderFloors(); refreshMap();

  const activeEl = document.activeElement;
  if (force || !activeEl || (activeEl.id !== 'dNote' && activeEl.id !== 'dDate')) {
    renderDetail(force);
  }
}

function initCookieBanner() {
  const banner = $('#cookieBanner');
  const btn = $('#btnCookieAccept');
  if (!banner || !btn) return;

  try {
    const accepted = localStorage.getItem('fnk_cookie_consent');
    if (!accepted) {
      banner.classList.remove('hidden');
      banner.classList.add('flex');
    }
  } catch {}

  btn.onclick = () => {
    try {
      localStorage.setItem('fnk_cookie_consent', 'true');
    } catch {}
    banner.classList.add('hidden');
    banner.classList.remove('flex');
  };
}

renderFloors();
drawFloor();
renderAll();
fit(false);
initCookieBanner();

if (window.DB) {
  window.DB.init().then(() => {
    const dbAuthor = window.DB.getActiveAuthorId();
    if (dbAuthor) {
      ui.reviewAuthorId = dbAuthor;
    }
    renderMemberNavTabs();
    renderAll();
    setStorageStatus(window.DB.isCloud());
  });

  window.DB.onChange(() => {
    const dbAuthor = window.DB.getActiveAuthorId();
    if (dbAuthor && dbAuthor !== ui.reviewAuthorId) {
      ui.reviewAuthorId = dbAuthor;
    }
    renderMemberNavTabs();
    renderAll();
    setStorageStatus(window.DB.isCloud());
  });
}

syncFromCloud();
window.addEventListener('focus', syncFromCloud);
window.addEventListener('online', syncFromCloud);
setInterval(syncFromCloud, 25000); // Automatická synchronizace pro celou partu

})();