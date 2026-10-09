// Pure trading math. No DOM, no network. Shared by every page.

export const POINT = { NQ: 20, MNQ: 2, ES: 50, MES: 5 };
export const INSTRUMENTS = ['NQ', 'MNQ', 'ES', 'MES', 'Other'];
export const FIRMS = ['Lucid Trading', 'Tradeify', 'FundedNext', 'Apex', 'My Funded Futures', 'Alpha Futures', 'Other'];
export const STAGES = ['Evaluation', 'Funded', 'Passed', 'Failed'];
export const DD_TYPES = ['Trailing', 'EOD Trailing', 'Static'];
export const GRADES = ['A+', 'A', 'B', 'C'];
export const SESSIONS = ['Asia', 'London', 'NY AM', 'NY PM'];
export const MODELS = ['AMD / Judas swing', 'Stop hunt re-entry', 'IFG continuation', 'CISD late entry', 'Data wick trade', 'Counter-trend base hit', 'Other'];
export const EMOTIONS = ['Calm', 'Confident', 'Anxious', 'Frustrated', 'Revenge', 'Bored'];

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (+f(x) || 0), 0);

// ---------- New York time ----------
export function nyParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long',
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const hr = +p.hour % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: hr * 60 + +p.minute, weekday: p.weekday, hhmm: `${String(hr).padStart(2, '0')}:${p.minute}` };
}
export const today = () => nyParts().date;
export function addDays(ds, n) {
  const d = new Date(ds + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dow = (ds) => new Date(ds + 'T12:00:00Z').getUTCDay(); // 0 Sunday
export const weekStart = (ds) => addDays(ds, -((dow(ds) + 6) % 7)); // Monday
export function sessionAt(min) {
  if (min >= 20 * 60) return 'Asia';
  if (min >= 120 && min < 300) return 'London';
  if (min >= 570 && min < 660) return 'NY AM';
  if (min >= 810 && min < 960) return 'NY PM';
  return null;
}

// ---------- One trade ----------
export function calcTrade(t) {
  const pv = +t.point_value || POINT[t.instrument] || 1;
  const dir = t.direction === 'Short' ? -1 : 1;
  const c = +t.contracts || 0;
  const pnl = (+t.exit_price - +t.entry_price) * dir * c * pv;
  const hasStop = t.stop_price != null && t.stop_price !== '';
  const risk = hasStop ? Math.abs(+t.entry_price - +t.stop_price) * c * pv : null;
  return { point_value: pv, pnl: r2(pnl), risk: risk == null ? null : r2(risk), r_multiple: risk ? r2(pnl / risk) : null };
}

const byTime = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (x.created_at || '') < (y.created_at || '') ? -1 : 1);

// ---------- One account ----------
// Balance, high-water mark and every "room" number are derived from the trades,
// so editing or deleting a trade can never leave an account out of sync.
export function accountStatus(a, trades, day = today()) {
  const ts = trades.filter((t) => t.account_id === a.id).sort(byTime);
  const base = +a.starting_balance || +a.account_size || 0;
  const start = base + (+a.adjustment || 0);
  let bal = start, hwm = start;
  const days = {};
  for (const t of ts) {
    bal += +t.pnl || 0;
    if (bal > hwm) hwm = bal;
    days[t.date] = (days[t.date] || 0) + (+t.pnl || 0);
  }
  let eb = start, eodHwm = start;
  for (const d of Object.keys(days).sort()) { eb += days[d]; if (d < day && eb > eodHwm) eodHwm = eb; }
  const maxdd = +a.max_drawdown || 0;
  const floor = a.drawdown_type === 'Static' ? base - maxdd : a.drawdown_type === 'EOD Trailing' ? eodHwm - maxdd : hwm - maxdd;
  const drawdown_room = maxdd ? r2(bal - floor) : null;
  const realized_today = r2(days[day] || 0);
  const limit = +a.daily_loss_limit || 0;
  const daily_loss_room = limit ? r2(limit + realized_today) : null;
  const profit = r2(bal - start);
  const target = +a.profit_target || 0;
  const dayVals = Object.values(days);
  const maxDay = dayVals.length ? Math.max(...dayVals) : 0;
  const pct = +a.consistency_rule_pct || 0;
  const consistency_flag = !!(pct && profit > 0 && (maxDay / profit) * 100 > pct);
  const trading_days = Object.keys(days).length;
  const minDays = +a.min_trading_days || 0;
  return {
    id: a.id, name: a.name, firm: a.firm, stage: a.stage,
    current_balance: r2(bal), high_water_mark: r2(a.drawdown_type === 'EOD Trailing' ? eodHwm : hwm), floor: r2(floor),
    max_drawdown: maxdd, drawdown_room, daily_loss_limit: limit || null, realized_today, daily_loss_room,
    daily_limit_hit: !!(limit && realized_today <= -limit),
    profit, profit_target: target || null, profit_target_progress: target ? Math.max(0, Math.min(1, profit / target)) : null,
    trading_days, min_trading_days: minDays || null, consistency_flag,
    best_day: r2(maxDay),
    danger_zone: !!(maxdd && drawdown_room < 0.2 * maxdd),
    breached: !!(maxdd && drawdown_room <= 0),
    ready_to_pass: !!(a.stage === 'Evaluation' && target && profit >= target && trading_days >= minDays && !consistency_flag),
    days,
  };
}

export function roomWarning(s) {
  const w = [];
  if (s.daily_limit_hit) w.push(`Daily loss limit hit on ${s.name}. Stop trading this account today.`);
  else if (s.daily_loss_room != null && s.daily_loss_room < 0.25 * s.daily_loss_limit) w.push(`Daily loss room on ${s.name} is under 25%.`);
  if (s.breached) w.push(`${s.name} is at or past its drawdown floor.`);
  else if (s.drawdown_room != null && s.drawdown_room < 0.25 * s.max_drawdown) w.push(`Drawdown room on ${s.name} is under 25%.`);
  return w.join(' ');
}

// ---------- Stats ----------
export function group(trades, key) {
  const g = {};
  for (const t of trades) {
    const k = t[key] || 'Unset';
    g[k] ??= { key: k, pnl: 0, count: 0, rs: [] };
    g[k].pnl += +t.pnl || 0; g[k].count++;
    if (t.r_multiple != null) g[k].rs.push(+t.r_multiple);
  }
  return Object.values(g).map((x) => ({ key: x.key, pnl: r2(x.pnl), count: x.count, avg_r: x.rs.length ? r2(sum(x.rs) / x.rs.length) : null }));
}
const best = (arr) => (arr.length ? [...arr].sort((a, b) => b.pnl - a.pnl)[0].key : null);
const worst = (arr) => (arr.length ? [...arr].sort((a, b) => a.pnl - b.pnl)[0].key : null);

export function scoreOf(s) {
  return (+s.followed_plan_score + +s.risk_discipline_score + +s.patience_score + +s.emotion_score) / 4;
}
export function disciplineScore(scorecards, from, to) {
  const xs = scorecards.filter((s) => (!from || s.date >= from) && (!to || s.date <= to));
  return xs.length ? r2(sum(xs, scoreOf) / xs.length) : null;
}

export function stats(trades, scorecards = [], day = today()) {
  const ts = [...trades].sort(byTime);
  const wins = ts.filter((t) => t.pnl > 0), losses = ts.filter((t) => t.pnl < 0);
  const rs = ts.filter((t) => t.r_multiple != null).map((t) => +t.r_multiple);
  const gw = sum(wins, (t) => t.pnl), gl = Math.abs(sum(losses, (t) => t.pnl));
  const bySession = group(ts, 'session'), byModel = group(ts, 'model'), byGrade = group(ts, 'setup_grade');
  const days = {};
  for (const t of ts) days[t.date] = (days[t.date] || 0) + (+t.pnl || 0);
  const dayList = Object.keys(days).sort().map((d) => ({ date: d, pnl: r2(days[d]) }));
  let cur = 0, maxStreak = 0, run = 0;
  for (const t of ts) { if (t.pnl < 0) { run++; maxStreak = Math.max(maxStreak, run); } else if (t.pnl > 0) run = 0; }
  for (let i = ts.length - 1; i >= 0; i--) { if (ts[i].pnl < 0) cur++; else if (ts[i].pnl > 0) break; }
  let eq = 0;
  const equity = dayList.map((d) => ({ x: d.date, y: (eq = r2(eq + d.pnl)) }));
  const planned = ts.filter((t) => t.followed_plan != null);
  return {
    trade_count: ts.length,
    total_pnl: r2(sum(ts, (t) => t.pnl)),
    win_rate: wins.length + losses.length ? r2(wins.length / (wins.length + losses.length)) : null,
    avg_r: rs.length ? r2(sum(rs) / rs.length) : null,
    profit_factor: gl ? r2(gw / gl) : null,
    a_plus_count: ts.filter((t) => t.setup_grade === 'A+').length,
    plan_follow_rate: planned.length ? r2(planned.filter((t) => t.followed_plan).length / planned.length) : null,
    pnl_by_session: bySession, pnl_by_model: byModel, pnl_by_grade: byGrade,
    best_session: best(bySession), worst_session: worst(bySession), best_model: best(byModel), worst_model: worst(byModel),
    best_day: dayList.length ? [...dayList].sort((a, b) => b.pnl - a.pnl)[0] : null,
    worst_day: dayList.length ? [...dayList].sort((a, b) => a.pnl - b.pnl)[0] : null,
    days_traded: dayList.length, daily: dayList, equity,
    losing_streak: cur, max_losing_streak: maxStreak,
    largest_daily_loss: dayList.length ? Math.min(0, ...dayList.map((d) => d.pnl)) : 0,
    discipline_score: disciplineScore(scorecards, addDays(day, -30), day),
  };
}

// ---------- Validator ----------
export const VALIDATOR = [
  { group: 'HTF context', items: [
    ['htf_left', 'Did I look left on the 4H and 1H?'],
    ['htf_gap', 'Am I delivering out of, or reacting off, a higher-timeframe gap (FVG / IFG / weekly gap / NWOG)?'],
    ['rejection', 'Did price print a rejection wick or reject a level?'],
  ] },
  { group: 'Draw on liquidity', items: [
    ['dol', 'Is there a clear DOL (Asia H/L, London H/L, previous day H/L, previous week low, weekly gap, all-time highs, 8:30 data wick)?'],
    ['lrl', 'Is there low resistance liquidity (stacked highs/lows) leading into it?'],
    ['base_target', 'Is my target the obvious swing or wicks before the full move, not the full DOL?'],
  ] },
  { group: 'ES check', items: [
    ['es_looked', 'Did I look at ES?'],
    ['smt', 'Is there an SMT (NQ swept a level ES did not, or the reverse)?'],
    ['es_same', 'Is ES delivering the same direction right now?'],
  ] },
  { group: 'Timing', items: [
    ['past_open', 'Is it at least 1 to 2 minutes past 9:30 (not the 9:29 or 9:30 candle)?'],
    ['displacing', 'Is price displacing, not ranging or chopping?'],
    ['no_news', 'No red-folder news in the next 5 minutes?'],
  ] },
  { group: 'Entry', items: [
    ['displacement_candle', 'Clear displacement candle?'],
    ['ifg_cisd', 'IFG on the 30-second or 1-minute, or a CISD close?'],
  ] },
  { group: 'Stop', items: [
    ['protected_stop', 'Stop at the protected swing high/low or candle body, not a tight 20-point stop?'],
    ['be_level', 'Is there a clear break-even level (internal high/low, or an ES sweep)?'],
  ] },
];
const MISSING = {
  htf_left: ['HTF look-left', 'look left on the 4H and 1H before anything else'],
  htf_ctx: ['HTF gap or rejection', 'trade out of a higher-timeframe gap or off a rejection, not the middle of nowhere'],
  dol: ['clear DOL', 'find the magnet first, the draw on liquidity is the trade'],
  lrl: ['LRL leading in', 'stacked highs or lows leading into the DOL make it a magnet'],
  base_target: ['base-hit target', 'aim for the base hit, not the stars'],
  es_looked: ['ES check', 'always check ES before you click'],
  smt: ['SMT with ES', 'SMT is the best confirmation, wait for ES to agree'],
  es_same: ['ES agreement', 'ES and NQ moving opposite with no SMT means sit out'],
  past_open: ['past the open', 'no entries on the 9:29 or 9:30 candle, wait 1 to 2 minutes'],
  displacing: ['displacement', 'no trading in chop, wait for price to displace'],
  no_news: ['news clearance', 'do not enter into red-folder news'],
  displacement_candle: ['displacement candle', 'entry is displacement first, then the IFG or CISD'],
  ifg_cisd: ['IFG or CISD', 'wait for the IFG on the 30-second or 1-minute, or a CISD close'],
  protected_stop: ['protected stop', 'big protected stops at the swing or candle body, not 20-point stops'],
  be_level: ['break-even level', 'know your break-even level before you enter'],
  account: ['account room', 'if the account does not have the room, there is no trade'],
};

// a = answers (booleans keyed as above) plus: trend ('With trend' | 'Neutral, reacting' | 'Counter-trend'),
// model, lrl_at_stop, secure_day, account_ok (boolean or null when no account picked)
export function gradeSetup(a) {
  const miss = [];
  const need = (k, ok) => { if (!ok) miss.push(k); };
  need('htf_left', a.htf_left); need('htf_ctx', a.htf_gap || a.rejection);
  need('dol', a.dol); need('lrl', a.lrl); need('base_target', a.base_target);
  need('es_looked', a.es_looked); need('smt', a.smt);
  need('past_open', a.past_open); need('displacing', a.displacing); need('no_news', a.no_news);
  need('displacement_candle', a.displacement_candle); need('ifg_cisd', a.ifg_cisd);
  need('protected_stop', a.protected_stop); need('be_level', a.be_level);
  if (!a.es_same && !a.smt) miss.push('es_same');
  if (a.account_ok === false) miss.push('account');
  const counter = a.trend === 'Counter-trend' || a.model === 'Counter-trend base hit';
  const noHtf = !a.htf_left || !(a.htf_gap || a.rejection);
  let grade;
  if (!a.past_open || noHtf || !a.displacing || (!a.es_same && !a.smt) || a.account_ok === false) grade = 'C';
  else if (counter || miss.length >= 2) grade = 'B';
  else if (miss.length === 1 || a.lrl_at_stop) grade = 'A';
  else grade = 'A+';
  // The rule quoted is for the gap that hurts the grade most, not just the first box left unticked.
  const first = ['account', 'past_open', 'htf_left', 'htf_ctx', 'displacing', 'es_same'].find((k) => miss.includes(k)) || miss[0];
  let rule = first ? MISSING[first][1] : 'this is the setup, now it is just execution and a protected stop';
  const notes = [];
  if (counter) { notes.push('Counter-trend: this is a 1R to 1.5R trade only.'); if (!first) rule = 'counter-trend trades are base hits, 1R to 1.5R and out'; }
  if (a.lrl_at_stop) notes.push('Stacked LRL is sitting at your stop. Lower quality, the risk is acknowledged.');
  if (a.secure_day) notes.push('You are securing a winning day. Take the shorter target.');
  const missing = miss.map((k) => MISSING[k][0]);
  return {
    grade, missing, rule, notes,
    line: `This grades as ${grade}. Missing: ${missing.length ? missing.join(', ') : 'nothing'}. Timmy's rule: ${rule}.`,
  };
}
