// Small DOM helpers. Everything user-typed goes in as text nodes, never as HTML.

export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function money(n) {
  if (n == null || Number.isNaN(+n)) return '—';
  const v = +n;
  return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export const moneyEl = (n, signed = true) => h('span', { class: signed && n > 0 ? 'green' : signed && n < 0 ? 'red' : '' }, money(n));
export const pct = (n) => (n == null ? '—' : Math.round(n * 100) + '%');
export const num = (n, d = 2) => (n == null ? '—' : (+n).toFixed(d));
export function fmtDate(ds) {
  if (!ds) return '—';
  const d = new Date(String(ds).slice(0, 10) + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', onclick }, label);
export const card = (title, ...kids) => h('div', { class: 'card' }, title ? h('h2', null, title) : null, ...kids);
export const empty = (text) => h('p', { class: 'ital' }, text);
export const badge = (text, cls = '') => h('span', { class: 'badge ' + cls }, text);
export const stat = (label, value, sub) => h('div', { class: 'stat' }, h('span', { class: 'label' }, label), h('b', null, value), sub ? h('span', { class: 'mut', style: { fontSize: '12px' } }, sub) : null);
export function progress(label, frac, text, cls = '') {
  const f = Math.max(0, Math.min(1, frac || 0));
  return h('div', null, h('div', { class: 'row between' }, h('span', { class: 'label' }, label), h('span', { class: 'mut', style: { fontSize: '12px' } }, text)),
    h('div', { class: 'bar ' + cls }, h('span', { style: { width: f * 100 + '%' } })));
}

export function toast(msg, err) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), err ? 6000 : 2500);
}

// Runs an async action from a click, shows errors instead of failing silently.
export function guard(fn) {
  return async (ev) => {
    const b = ev?.currentTarget;
    if (b && b.disabled) return;
    if (b) b.disabled = true;
    try { await fn(ev); } catch (e) { console.error(e); toast(e.message || 'Something went wrong', true); }
    finally { if (b) b.disabled = false; }
  };
}

export function drawer(title, build) {
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', close); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  const body = h('div');
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'drawer' }, h('div', { class: 'row between mb' }, h('h2', null, title), btn('Close', close, 'ghost sm')), body));
  build(body, close);
  document.body.append(ov);
  return close;
}

// ---------- Forms ----------
// def: { key, label, type, options, span, placeholder, step, min, max, blank }
export function field(d, value) {
  let input, get, set;
  const opts = (d.options || []).map((o) => (Array.isArray(o) ? o : [o, o]));
  if (d.type === 'select') {
    input = h('select', null, d.blank !== false ? h('option', { value: '' }, d.placeholder || 'Select') : null, opts.map(([v, l]) => h('option', { value: v }, l)));
    get = () => input.value || null; set = (v) => { input.value = v ?? ''; };
  } else if (d.type === 'yesno') {
    input = h('select', null, h('option', { value: '' }, 'Select'), h('option', { value: 'y' }, 'Yes'), h('option', { value: 'n' }, 'No'));
    get = () => (input.value === 'y' ? true : input.value === 'n' ? false : null);
    set = (v) => { input.value = v === true ? 'y' : v === false ? 'n' : ''; };
  } else if (d.type === 'textarea') {
    input = h('textarea', { placeholder: d.placeholder, rows: d.rows });
    get = () => input.value.trim() || null; set = (v) => { input.value = v ?? ''; };
  } else if (d.type === 'range') {
    const out = h('span', { class: 'gold' });
    input = h('input', { type: 'range', min: d.min ?? 0, max: d.max ?? 10, step: 1 });
    input.addEventListener('input', () => { out.textContent = input.value; });
    get = () => +input.value; set = (v) => { input.value = v ?? 7; out.textContent = input.value; };
    set(value);
    return { el: h('label', { class: 'fld' + (d.span ? ' span' + d.span : '') }, h('span', { class: 'label' }, d.label, ' ', out), input), input, get, set };
  } else if (d.type === 'number') {
    input = h('input', { type: 'number', step: d.step || 'any', min: d.min, max: d.max, placeholder: d.placeholder, inputmode: 'decimal' });
    get = () => (input.value === '' ? null : +input.value); set = (v) => { input.value = v ?? ''; };
  } else {
    input = h('input', { type: d.type || 'text', placeholder: d.placeholder });
    get = () => input.value.trim() || null; set = (v) => { input.value = v ?? ''; };
  }
  set(value);
  return { el: h('label', { class: 'fld' + (d.span ? ' span' + d.span : '') }, h('span', { class: 'label' }, d.label), input), input, get, set };
}

export function form(defs, vals = {}, onChange) {
  const inputs = {};
  const el = h('div', { class: 'grid3' });
  const api = {
    el, inputs,
    get() { const o = {}; for (const k in inputs) o[k] = inputs[k].get(); return o; },
    set(k, v) { inputs[k]?.set(v); },
  };
  for (const d of defs) {
    if (d.type === 'heading') { el.append(h('div', { class: 'label span3 mt gold' }, d.label)); continue; }
    const f = field(d, vals[d.key] ?? d.default);
    inputs[d.key] = f; el.append(f.el);
    if (onChange) for (const ev of ['input', 'change']) f.input.addEventListener(ev, () => onChange(d.key, api));
  }
  return api;
}

// ---------- Tables ----------
// cols: [{ label, get(row) -> node | string }]
export function table(cols, rows, { onRow, emptyText, rowClass } = {}) {
  if (!rows.length) return empty(emptyText || 'Nothing here yet.');
  return h('div', { class: 'scroll' }, h('table', null,
    h('thead', null, h('tr', null, cols.map((c) => h('th', null, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', { class: [onRow ? 'click' : '', rowClass ? rowClass(r) : ''].join(' '), onclick: onRow ? () => onRow(r) : null }, cols.map((c) => h('td', null, c.get(r))))))));
}

// Editable grid for reference tables. cols: [{ key, label, type, options, width }]
export function editTable(cols, rows, onSave, { addLabel = 'Add row', blankRow = {} } = {}) {
  const data = rows.map((r) => ({ ...r }));
  const wrap = h('div');
  const draw = () => {
    wrap.replaceChildren(
      h('div', { class: 'scroll' }, h('table', null,
        h('thead', null, h('tr', null, cols.map((c) => h('th', null, c.label)), h('th'))),
        h('tbody', null, data.map((r, i) => h('tr', null, cols.map((c) => {
          const inp = c.options
            ? h('select', null, h('option', { value: '' }, ''), c.options.map((o) => h('option', { value: o }, o)))
            : h('input', { type: c.type || 'text', step: 'any', style: { minWidth: c.width || '90px' } });
          inp.value = r[c.key] ?? '';
          inp.addEventListener('input', () => { r[c.key] = c.type === 'number' ? (inp.value === '' ? null : +inp.value) : inp.value; });
          inp.addEventListener('change', () => { r[c.key] = c.type === 'number' ? (inp.value === '' ? null : +inp.value) : inp.value; });
          return h('td', null, inp);
        }), h('td', null, btn('Remove', () => { data.splice(i, 1); draw(); }, 'ghost sm'))))))),
      h('div', { class: 'row mt', style: { marginTop: '14px' } },
        btn(addLabel, () => { data.push({ ...blankRow }); draw(); }, 'ghost'),
        btn('Save changes', guard(async () => { await onSave(data.map((r) => ({ ...r }))); toast('Saved'); }))),
    );
  };
  draw();
  return wrap;
}

// ---------- Charts (single accent, thin lines, no grid clutter) ----------
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}
const short = (v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v * 100) / 100));

// points: [{ x: label, y: number }], opts.ref: { y, label } draws a red reference line
export function lineChart(points, { height = 180, ref, zero = true } = {}) {
  if (points.length < 2) return empty('Not enough data to draw this yet.');
  const W = 600, H = height, L = 44, R = 10, T = 12, B = 22;
  const ys = points.map((p) => p.y).concat(ref ? [ref.y] : [], zero ? [0] : []);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const X = (i) => L + (i / (points.length - 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' });
  if (zero && lo < 0 && hi > 0) svg.append(s('line', { x1: L, x2: W - R, y1: Y(0), y2: Y(0), stroke: '#26262A', 'stroke-width': 1 }));
  if (ref) {
    svg.append(s('line', { x1: L, x2: W - R, y1: Y(ref.y), y2: Y(ref.y), stroke: '#C96A5E', 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
    svg.append(s('text', { x: W - R, y: Y(ref.y) - 4, 'text-anchor': 'end' }, ref.label));
  }
  svg.append(s('polyline', { fill: 'none', stroke: '#C8A45D', 'stroke-width': 1.5, points: points.map((p, i) => `${X(i)},${Y(p.y)}`).join(' ') }));
  svg.append(s('text', { x: L - 6, y: Y(hi) + 4, 'text-anchor': 'end' }, short(hi)));
  svg.append(s('text', { x: L - 6, y: Y(lo) + 4, 'text-anchor': 'end' }, short(lo)));
  svg.append(s('text', { x: L, y: H - 6 }, points[0].x));
  svg.append(s('text', { x: W - R, y: H - 6, 'text-anchor': 'end' }, points[points.length - 1].x));
  return svg;
}

// bars: [{ label, value }], opts.ref: { y, label }
export function barChart(bars, { height = 180, ref } = {}) {
  if (!bars.length) return empty('No data yet.');
  const W = 600, H = height, L = 44, R = 10, T = 12, B = 22;
  const vs = bars.map((b) => b.value).concat([0], ref ? [ref.y] : []);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (lo === hi) hi = lo + 1;
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const bw = (W - L - R) / bars.length;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' });
  bars.forEach((b, i) => {
    const y0 = Y(0), y1 = Y(b.value);
    svg.append(s('rect', { x: L + i * bw + bw * 0.18, width: Math.max(1, bw * 0.64), y: Math.min(y0, y1), height: Math.max(1, Math.abs(y1 - y0)), fill: b.value < 0 ? '#6b4a44' : '#C8A45D' }));
    if (bars.length <= 8) svg.append(s('text', { x: L + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle' }, b.label));
  });
  svg.append(s('line', { x1: L, x2: W - R, y1: Y(0), y2: Y(0), stroke: '#26262A', 'stroke-width': 1 }));
  if (ref) {
    svg.append(s('line', { x1: L, x2: W - R, y1: Y(ref.y), y2: Y(ref.y), stroke: '#C96A5E', 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
    svg.append(s('text', { x: W - R, y: Y(ref.y) - 4, 'text-anchor': 'end' }, ref.label));
  }
  svg.append(s('text', { x: L - 6, y: Y(hi) + 4, 'text-anchor': 'end' }, short(hi)));
  svg.append(s('text', { x: L - 6, y: Y(lo) + 4, 'text-anchor': 'end' }, short(lo)));
  if (bars.length > 8) {
    svg.append(s('text', { x: L, y: H - 6 }, bars[0].label));
    svg.append(s('text', { x: W - R, y: H - 6, 'text-anchor': 'end' }, bars[bars.length - 1].label));
  }
  return svg;
}

// Two-click delete, so nothing is removed by a stray click and no browser dialog is needed.
export function confirmBtn(label, fn, cls = 'ghost sm') {
  let armed = false;
  const b = btn(label, async (ev) => {
    if (!armed) { armed = true; b.textContent = 'Click again to confirm'; setTimeout(() => { armed = false; b.textContent = label; }, 4000); return; }
    await guard(fn)(ev);
  }, cls);
  return b;
}
