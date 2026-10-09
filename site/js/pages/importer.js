// Import trades from a platform export (CSV). No typing: download the file from Tradovate, ProjectX (TopstepX) or NinjaTrader and drop it in.
// Platforms don't export a stop, so imported trades come in without one. The trader adds it in the review and R fills in.
import { h, btn, card, table, money, moneyEl, stat, toast, guard } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import * as A from '../actions.js';
import { DEFAULT_SPECS } from '../defaults.js';
import { reviewDrawer } from './guard.js';

const MAX_ROWS = 3000;
const ROOTS = ['MNQ', 'MES', 'MYM', 'M2K', 'MCL', 'MGC', 'NQ', 'ES', 'YM', 'RTY', 'CL', 'GC'];
const PV = Object.fromEntries(DEFAULT_SPECS.map((s) => [s.instrument, +s.point_value]));

// ---------- CSV ----------
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') + 1 || undefined);
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

// ---------- Values ----------
export function parseMoney(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s.replace(/[$\s]|USD/g, '')) || /^-|^\$-|-\$/.test(s);
  s = s.replace(/[^0-9.]/g, '');
  if (!s) return null;
  const n = +s;
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
const numOf = (v) => { const n = parseMoney(v); return n == null ? null : n; };

export function rootOf(symbol) {
  const toks = String(symbol || '').toUpperCase().replace(/^\//, '').split(/[^A-Z0-9]+/).filter(Boolean);
  for (const t of toks) for (const r of ROOTS) if (t.startsWith(r) && /^([FGHJKMNQUVXZ]\d{1,2})?$/.test(t.slice(r.length))) return r;
  return null;
}

// Wall-clock time in a time zone -> the real moment (handles daylight saving).
function zoned(y, mo, d, hr, mi, se, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const want = Date.UTC(y, mo - 1, d, hr, mi, se);
  let t = want;
  for (let k = 0; k < 3; k++) {
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, +x.value || x.value]));
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    if (seen === want) break;
    t += want - seen;
  }
  return new Date(t);
}

export const ZONES = [['America/New_York', 'New York (ET)'], ['America/Chicago', 'Chicago (CT)'], ['America/Denver', 'Denver (MT)'], ['America/Los_Angeles', 'Los Angeles (PT)'], ['Europe/London', 'London'], ['UTC', 'UTC']];

// Returns { date: 'YYYY-MM-DD', minutes, iso } in New York time.
// Times with an offset (Z, -04:00) are exact. Times without one are read in tz, the zone the trader's platform is set to.
export function parseTime(v, tz = 'America/New_York') {
  const s = String(v || '').trim();
  if (!s) return null;
  const ny = (d) => { const p = T.nyParts(d); return { date: p.date, minutes: p.minutes, iso: d.toISOString() }; };
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(s) || /\s[+-]\d{2}:?\d{2}$/.test(s)) {
    let d = new Date(s);
    if (isNaN(d)) { // "09/24/2024 09:31:05 -04:00"
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}):?(\d{2})$/);
      if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; d = new Date(`${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}${m[7]}:${m[8]}`); }
    }
    if (!isNaN(d)) return ny(d);
  }
  const m = s.match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?)?/i);
  if (!m) return null;
  let y, mo, d;
  if (m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; } else { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  if (m[4] == null) { const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return { date, minutes: null, iso: zoned(y, mo, d, 12, 0, 0, 'America/New_York').toISOString() }; }
  let hr = +m[4]; const mi = +m[5], se = +(m[6] || 0);
  if (m[7]) { const pm = /pm/i.test(m[7]); if (hr === 12) hr = pm ? 12 : 0; else if (pm) hr += 12; }
  return ny(zoned(y, mo, d, hr, mi, se, tz));
}

// ---------- Formats ----------
const ALIASES = {
  symbol: ['contractname', 'symbol', 'instrument', 'contract', 'ticker', 'product'],
  qty: ['size', 'qty', 'quantity', 'contracts', 'filledqty', 'lots'],
  dir: ['type', 'side', 'direction', 'marketpos', 'position', 'longshort', 'tradetype'],
  entry: ['entryprice', 'avgentryprice', 'openprice', 'entry', 'priceopen', 'avgopenprice'],
  exit: ['exitprice', 'avgexitprice', 'closeprice', 'exit', 'priceclose', 'avgcloseprice'],
  tEntry: ['enteredat', 'entrytime', 'opentime', 'opened', 'entrydate', 'entered', 'opendate', 'timeopen'],
  tExit: ['exitedat', 'exittime', 'closetime', 'closed', 'exitdate', 'exited', 'closedate', 'timeclose'],
  pnl: ['pnl', 'profit', 'profitloss', 'netpnl', 'grosspnl', 'realizedpnl', 'pl', 'grossprofit', 'netprofit'],
  fees: ['fees', 'commissions', 'commission', 'fee', 'totalfees'],
  day: ['tradeday', 'date', 'tradedate'],
};
const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');

function dirOf(v) {
  const s = String(v || '').toLowerCase();
  if (/long|^buy|bought|^b$/.test(s)) return 'Long';
  if (/short|^sell|sold|^s$/.test(s)) return 'Short';
  return null;
}

// Turns the file into raw trade rows. Throws a plain-English error if the file isn't a trade export.
export function readTrades(text, tz = 'America/New_York') {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('That file is empty or only has a header row.');
  // Some exports have a title line or two before the header. Find the first row that looks like a header.
  let hi = rows.findIndex((r) => { const n = r.map(norm); return n.some((x) => ALIASES.symbol.includes(x)) && (n.includes('buyprice') || n.some((x) => ALIASES.entry.includes(x))); });
  if (hi < 0) throw new Error("That doesn't look like a trade history file. Use the Performance report from Tradovate, the Trades export from ProjectX or TopstepX, or the Trades tab from NinjaTrader.");
  const head = rows[hi].map(norm);
  // Exact copies of a row (two reports pasted together) are dropped. Real rows always differ: fill ids, trade numbers or times.
  const seen = new Set();
  const all = rows.slice(hi + 1);
  const body = all.filter((r) => { const k = r.join('\u0001'); if (seen.has(k)) return false; seen.add(k); return true; });
  const dupRows = all.length - body.length;
  if (body.length > MAX_ROWS) throw new Error(`That file has ${body.length} rows. Import ${MAX_ROWS} or fewer at a time (pick a shorter date range when you download it).`);
  const col = (k) => { for (const a of ALIASES[k]) { const i = head.indexOf(a); if (i >= 0) return i; } return -1; };
  const get = (r, i) => (i >= 0 ? r[i] : undefined);
  const out = [];
  if (head.includes('buyprice') && head.includes('sellprice')) {
    // Tradovate Performance report: one row per buy/sell fill pair.
    const c = { sym: col('symbol'), qty: col('qty'), bp: head.indexOf('buyprice'), sp: head.indexOf('sellprice'), bt: head.indexOf('boughttimestamp'), st: head.indexOf('soldtimestamp'), pnl: col('pnl') };
    body.forEach((r, n) => {
      const bt = parseTime(get(r, c.bt), tz), st = parseTime(get(r, c.st), tz);
      const long = bt && st ? bt.iso <= st.iso : true;
      out.push({ line: hi + n + 2, symbol: get(r, c.sym), qty: numOf(get(r, c.qty)), direction: long ? 'Long' : 'Short',
        entry: numOf(get(r, long ? c.bp : c.sp)), exit: numOf(get(r, long ? c.sp : c.bp)), tIn: long ? bt : st, tOut: long ? st : bt, pnl: parseMoney(get(r, c.pnl)), fees: null });
    });
    return { format: 'Tradovate', rows: out, dupRows };
  }
  const c = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, col(k)]));
  const fmt = head.includes('contractname') || head.includes('enteredat') ? 'ProjectX' : head.includes('marketpos') ? 'NinjaTrader' : 'CSV';
  body.forEach((r, n) => {
    const tIn = parseTime(get(r, c.tEntry), tz) || parseTime(get(r, c.day), tz);
    out.push({ line: hi + n + 2, symbol: get(r, c.symbol), qty: Math.abs(numOf(get(r, c.qty)) ?? NaN), direction: dirOf(get(r, c.dir)),
      entry: numOf(get(r, c.entry)), exit: numOf(get(r, c.exit)), tIn, tOut: parseTime(get(r, c.tExit), tz), pnl: parseMoney(get(r, c.pnl)), fees: parseMoney(get(r, c.fees)) });
  });
  return { format: fmt, rows: out, dupRows };
}

// Cleans, merges scale-outs into one trade, and builds Journal trades.
export function buildTrades(raw, format) {
  const bad = [], ok = [];
  for (const r of raw) {
    const root = rootOf(r.symbol);
    let { direction } = r;
    if (!direction && r.pnl && r.entry != null && r.exit != null && r.exit !== r.entry) direction = (r.exit - r.entry) * r.pnl > 0 ? 'Long' : 'Short';
    const why = !r.symbol ? 'no instrument' : !(r.qty > 0) ? 'no size' : r.entry == null || r.exit == null ? 'no entry or exit price' : !r.tIn ? 'no date' : !direction ? 'no long/short' : null;
    if (why) { bad.push({ line: r.line, why }); continue; }
    ok.push({ ...r, root, direction });
  }
  // Same instrument, direction and entry time = one trade that was scaled out of.
  const groups = new Map();
  ok.forEach((r, i) => {
    const key = r.tIn.minutes != null ? [r.root || r.symbol, r.direction, r.tIn.iso].join('|') : 'row' + i;
    (groups.get(key) || groups.set(key, []).get(key)).push(r);
  });
  const trades = [];
  for (const g of groups.values()) {
    const qty = T.sum(g, (r) => r.qty);
    const entry = T.sum(g, (r) => r.entry * r.qty) / qty;
    const exit = T.sum(g, (r) => r.exit * r.qty) / qty;
    const first = g[0];
    const filePnl = g.every((r) => r.pnl != null) ? T.sum(g, (r) => r.pnl) : null;
    const fees = g.some((r) => r.fees != null) ? T.sum(g, (r) => r.fees) : null;
    const pts = (exit - entry) * (first.direction === 'Short' ? -1 : 1);
    let pv = first.root ? PV[first.root] : null;
    if (!pv && filePnl != null && pts) pv = Math.abs(filePnl / (pts * qty));
    const instrument = ['NQ', 'MNQ', 'ES', 'MES'].includes(first.root) ? first.root : 'Other';
    const pnl = filePnl != null ? filePnl : pv ? pts * qty * pv : null;
    const out = g.reduce((m, r) => (r.tOut && (!m || r.tOut.iso > m.iso) ? r.tOut : m), null);
    const note = [`Imported from ${format}${instrument === 'Other' ? ` (${String(first.symbol).toUpperCase()})` : ''}.`,
      g.length > 1 ? `Scaled out in ${g.length} parts.` : null, fees ? `Fees ${money(Math.abs(fees))}.` : null, 'No stop in the file: add it in the review to get R.'].filter(Boolean).join(' ');
    trades.push({
      date: first.tIn.date, instrument, point_value: pv ? +pv.toFixed(4) : null, direction: first.direction, contracts: qty,
      entry_price: +entry.toFixed(4), exit_price: +exit.toFixed(4), stop_price: null, pnl: pnl == null ? null : Math.round(pnl * 100) / 100, risk: null, r_multiple: null,
      session: first.tIn.minutes != null ? T.sessionAt(first.tIn.minutes) : null, notes: note, created_at: first.tIn.iso,
      _time: first.tIn.minutes != null ? `${String(Math.floor(first.tIn.minutes / 60)).padStart(2, '0')}:${String(first.tIn.minutes % 60).padStart(2, '0')}` : '', _out: out,
    });
  }
  trades.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return { trades, bad };
}

const dupKey = (t) => [t.account_id, t.date, t.direction, t.instrument, +t.contracts, (+t.entry_price).toFixed(2), (+t.exit_price).toFixed(2)].join('|');

// ---------- Page piece ----------
export function importCard(ctx) {
  const accts = A.activeAccounts().length ? A.activeAccounts() : db.S.accounts;
  const sel = h('select', null, h('option', { value: '' }, 'Pick the account these trades were on'), accts.map((a) => h('option', { value: a.id }, a.name)));
  if (accts.length === 1) sel.value = accts[0].id;
  const file = h('input', { type: 'file', accept: '.csv,.txt,text/csv' });
  const zone = h('select', null, ZONES.map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div');
  let parsed = null;

  const show = guard(async () => {
    out.replaceChildren();
    parsed = null;
    if (!file.files[0]) return;
    if (/\.xlsx?$/i.test(file.files[0].name)) throw new Error('That is an Excel file. Download the CSV version from your platform instead.');
    const { format, rows, dupRows } = readTrades(await file.files[0].text(), zone.value);
    const { trades, bad } = buildTrades(rows, format);
    if (!trades.length) throw new Error(`Found no trades I could read in that file${bad.length ? ` (${bad.length} rows were missing ${bad[0].why})` : ''}.`);
    parsed = { format, trades, bad, dupRows };
    preview();
  });
  function preview() {
    if (!parsed) return;
    const acc = sel.value;
    const have = new Set(A.tradesIn().map(dupKey));
    const fresh = parsed.trades.filter((t) => !acc || !have.has(dupKey({ ...t, account_id: acc })));
    const dup = parsed.trades.length - fresh.length;
    const cols = [{ label: 'Date', get: (t) => t.date }, { label: 'Time', get: (t) => t._time }, { label: 'Instrument', get: (t) => t.instrument === 'Other' ? t.notes.match(/\((.*?)\)/)?.[1] || 'Other' : t.instrument },
      { label: 'Side', get: (t) => t.direction }, { label: 'Size', get: (t) => t.contracts }, { label: 'Entry', get: (t) => t.entry_price }, { label: 'Exit', get: (t) => t.exit_price }, { label: 'P&L', get: (t) => moneyEl(t.pnl) }];
    out.replaceChildren(
      h('div', { class: 'stats', style: { marginTop: '16px' } }, stat('From', parsed.format), stat('New trades', String(fresh.length)), stat('P&L', money(T.sum(fresh, (t) => t.pnl)))),
      dup ? h('p', { class: 'mut' }, `${dup} ${dup === 1 ? 'trade is' : 'trades are'} already in your journal and will be skipped.`) : null,
      parsed.dupRows ? h('p', { class: 'mut' }, `${parsed.dupRows} repeated ${parsed.dupRows === 1 ? 'row' : 'rows'} in the file ignored (the same line appeared twice).`) : null,
      parsed.bad.length ? h('p', { class: 'mut' }, `${parsed.bad.length} ${parsed.bad.length === 1 ? 'row' : 'rows'} skipped (for example line ${parsed.bad[0].line}: ${parsed.bad[0].why}).`) : null,
      table(cols, fresh.slice(0, 50), { emptyText: 'Every trade in this file is already in your journal.' }),
      fresh.length > 50 ? h('p', { class: 'mut' }, `Showing 50 of ${fresh.length}.`) : null,
      fresh.length ? h('div', { class: 'row', style: { marginTop: '14px' } }, btn(`Import ${fresh.length} ${fresh.length === 1 ? 'trade' : 'trades'}`, guard(async () => {
        if (!sel.value) throw new Error('Pick the account these trades were on.');
        const rows = await db.addMany('trades', fresh.map(({ _time, _out, ...t }) => ({ ...t, account_id: sel.value })));
        toast(`Imported ${rows.length} ${rows.length === 1 ? 'trade' : 'trades'}.`);
        file.value = ''; parsed = null;
        done(rows);
      }))) : null);
  }
  function done(rows) {
    const recent = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 10);
    out.replaceChildren(h('div', { class: 'card', style: { marginTop: '16px', borderColor: 'var(--gold)' } },
      h('h3', null, `${rows.length} ${rows.length === 1 ? 'trade' : 'trades'} imported`),
      h('p', { class: 'mut' }, 'Now the part that makes it worth it: tell the Lab why you took them. Add the stop and it works out your R.'),
      recent.map((t) => h('div', { class: 'row between', style: { padding: '8px 0', borderTop: '1px solid var(--line)' } },
        h('span', null, `${t.date} ${t.direction} ${t.contracts} ${t.instrument} `, moneyEl(t.pnl)),
        btn('Why did you take it?', () => reviewDrawer(t, ctx), 'ghost sm'))),
      h('div', { class: 'row', style: { marginTop: '12px' } }, btn('Done', () => ctx.refresh(), 'ghost sm'))));
  }
  file.addEventListener('change', show);
  sel.addEventListener('change', preview);
  zone.addEventListener('change', show);

  const help = h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'mut', style: { cursor: 'pointer' } }, 'Where do I get the file?'),
    h('p', { class: 'mut' }, h('b', null, 'Tradovate: '), 'open the Performance report for your account, pick the dates, and download it as CSV.'),
    h('p', { class: 'mut' }, h('b', null, 'ProjectX / TopstepX: '), 'open your Trades history, pick the dates, and export it as CSV.'),
    h('p', { class: 'mut' }, h('b', null, 'NinjaTrader: '), 'in Trade Performance, go to the Trades tab, right-click and export as CSV.'),
    h('p', { class: 'mut' }, 'Other platforms: any CSV with the instrument, size, side, entry and exit price and the entry time usually works.'));

  return card('Import trades from your platform',
    h('p', { class: 'mut', style: { marginTop: 0 } }, 'Skip the typing. Download your trade history and drop the file here. Trades already in your journal are skipped, so it is safe to import the same week twice.'),
    h('div', { class: 'grid3' },
      h('label', { class: 'fld' }, h('span', { class: 'label' }, 'Account'), sel),
      h('label', { class: 'fld' }, h('span', { class: 'label' }, 'Trade history file (CSV)'), file),
      h('label', { class: 'fld' }, h('span', { class: 'label' }, 'Platform time zone'), zone)),
    h('p', { class: 'mut', style: { fontSize: '12px', margin: '8px 0 0' } }, 'Set this to the time zone your platform shows. Most US futures platforms default to New York or Chicago. Check the times in the preview match your trades.'),
    help, out);
}
