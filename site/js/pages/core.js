import { h, btn, card, empty, form, table, money, moneyEl, num, pct, fmtDate, stat, badge, guard, toast, drawer, confirmBtn, lineChart, barChart } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import * as A from '../actions.js';

const { S } = db;
const accOpts = (list) => list.map((a) => [a.id, a.name]);

export function tradeDefs(accounts) {
  return [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'account_id', label: 'Account', type: 'select', options: accOpts(accounts) },
    { key: 'instrument', label: 'Instrument', type: 'select', options: T.INSTRUMENTS, blank: false },
    { key: 'point_value', label: 'Point value', type: 'number' },
    { key: 'direction', label: 'Direction', type: 'select', options: ['Long', 'Short'] },
    { key: 'contracts', label: 'Contracts', type: 'number', min: 1 },
    { key: 'entry_price', label: 'Entry price', type: 'number' },
    { key: 'stop_price', label: 'Stop price', type: 'number' },
    { key: 'exit_price', label: 'Exit price', type: 'number' },
    { key: 'setup_grade', label: 'Setup grade', type: 'select', options: T.GRADES },
    { key: 'session', label: 'Session', type: 'select', options: T.SESSIONS },
    { key: 'model', label: 'Model', type: 'select', options: T.MODELS },
    { key: 'emotion', label: 'Emotion', type: 'select', options: T.EMOTIONS },
    { key: 'followed_plan', label: 'Followed plan?', type: 'yesno' },
    { key: 'notes', label: 'Notes', type: 'textarea', span: 3 },
  ];
}
const pointSync = (k, api) => { if (k === 'instrument') { const pv = T.POINT[api.inputs.instrument.get()]; if (pv) api.set('point_value', pv); } };

export const tradeCols = () => [
  { label: 'Date', get: (t) => fmtDate(t.date) },
  { label: 'Account', get: (t) => A.accName(t.account_id) },
  { label: 'Instrument', get: (t) => t.instrument },
  { label: 'Dir', get: (t) => t.direction },
  { label: 'Contracts', get: (t) => t.contracts },
  { label: 'P&L', get: (t) => moneyEl(t.pnl) },
  { label: 'R', get: (t) => num(t.r_multiple) },
  { label: 'Grade', get: (t) => t.setup_grade || '—' },
  { label: 'Model', get: (t) => t.model || '—' },
  { label: 'Session', get: (t) => t.session || '—' },
  { label: 'Plan', get: (t) => (t.followed_plan == null ? '—' : t.followed_plan ? 'Yes' : 'No') },
];

function tradeDrawer(t, ctx) {
  drawer('Trade detail', (body, close) => {
    const view = () => {
      const img = h('div');
      if (t.screenshot_path) db.fileUrl(t.screenshot_path).then((u) => { if (u) img.append(h('img', { src: u, alt: 'Chart screenshot', style: { maxWidth: '100%', borderRadius: '6px', marginTop: '16px' } })); }).catch(() => {});
      const rows = [['Date', fmtDate(t.date)], ['Account', A.accName(t.account_id)], ['Instrument', `${t.instrument} (point value ${t.point_value})`],
        ['Direction', t.direction], ['Contracts', t.contracts], ['Entry', t.entry_price], ['Stop', t.stop_price], ['Exit', t.exit_price],
        ['P&L', money(t.pnl)], ['Risk', money(t.risk)], ['R multiple', num(t.r_multiple)], ['Grade', t.setup_grade || '—'], ['Session', t.session || '—'],
        ['Model', t.model || '—'], ['Emotion', t.emotion || '—'], ['Followed plan', t.followed_plan == null ? '—' : t.followed_plan ? 'Yes' : 'No'], ['Notes', t.notes || '—']];
      body.replaceChildren(h('div', { class: 'dl' }, rows.map(([k, v]) => [h('span', { class: 'label' }, k), h('span', null, v)])), img,
        h('div', { class: 'row', style: { marginTop: '24px' } },
          btn('Edit', edit, 'ghost'),
          btn('Turn into lesson', () => { A.nav.prefill = { lesson: { date: t.date, trade_id: t.id, title: `${t.direction} ${t.instrument}, ${t.model || 'trade'}`, body: t.notes || '' } }; close(); ctx.go('lessons'); }, 'ghost'),
          confirmBtn('Delete', async () => { await db.remove('trades', t.id); close(); toast('Trade deleted'); ctx.refresh(); }, 'ghost')));
    };
    const edit = () => {
      const f = form(tradeDefs(S.accounts), t, pointSync);
      body.replaceChildren(f.el, h('div', { class: 'row', style: { marginTop: '18px' } },
        btn('Save changes', guard(async () => { await A.updateTrade(t.id, { ...t, ...f.get() }); close(); toast('Trade updated'); ctx.refresh(); })),
        btn('Cancel', view, 'ghost')));
    };
    view();
  });
}

// ---------------- Today ----------------
function today(el, ctx) {
  const p = T.nyParts();
  const sess = T.sessionAt(p.minutes);
  const acts = A.activeAccounts().map((a) => A.statusOf(a));
  const news = newsOn(p.date);
  const prep = A.latestPrep();
  el.append(
    h('div', { class: 'stats' },
      stat('Today', fmtDate(p.date), `${p.weekday}, ${p.hhmm} New York`),
      stat('What session is it?', sess || 'Outside killzone', sess ? 'Killzone is open' : 'No active session right now'),
      stat('Active accounts', acts.length)),
    h('div', { class: 'row mb' }, btn('Log a trade', () => ctx.go('journal')), btn('Run the Validator', () => ctx.go('validator'), 'ghost')),
    card('News today', news.length ? table([{ label: 'Time (NY)', get: (n) => n.time || '—' }, { label: 'Event', get: (n) => n.event }, { label: 'Impact', get: (n) => badge(n.impact || 'High', n.impact === 'Medium' ? '' : 'red') }], news)
      : empty('No red-folder events saved for today. Check the Market Calendar.')),
    card('Active accounts', acts.length ? table([
      { label: 'Account', get: (s) => s.name }, { label: 'Stage', get: (s) => badge(s.stage) },
      { label: 'Balance', get: (s) => money(s.current_balance) },
      { label: 'Drawdown room', get: (s) => h('span', { class: s.danger_zone ? 'red' : 'gold' }, money(s.drawdown_room)) },
      { label: 'Daily loss room', get: (s) => (s.daily_loss_room == null ? '—' : h('span', { class: s.daily_limit_hit ? 'red' : '' }, money(s.daily_loss_room))) },
    ], acts) : h('div', null, empty('No active accounts yet. Add one in the Prop Firm Tracker.'), h('div', { class: 'mt' }, btn('Add an account', () => ctx.go('tracker'), 'ghost')))),
    card("Latest premarket prep", prep ? h('div', { class: 'dl' },
      [['Date', fmtDate(prep.date)], ['HTF bias', [prep.bias, prep.bias_reason].filter(Boolean).join(': ') || '—'], ['Draw on liquidity', prep.dol || '—'],
        ['ES vs NQ', prep.es_note || '—'], ['Sit out if', prep.sit_out || '—']].map(([k, v]) => [h('span', { class: 'label' }, k), h('span', null, v)]))
      : empty('No prep saved yet. Fill in Premarket Prep before the open.')));
}

export function newsOn(date) {
  const list = db.list('news').filter((n) => n.date === date);
  if (T.dow(date) === 4 && !list.some((n) => /jobless/i.test(n.event || ''))) list.push({ date, time: '08:30', event: 'Jobless Claims (confirm on the calendar)', impact: 'Medium', auto: true });
  return list.sort((a, b) => (a.time || '') < (b.time || '') ? -1 : 1);
}

// ---------------- Journal ----------------
function journal(el, ctx) {
  const pre = A.nav.prefill?.journal; A.nav.prefill = null;
  const acts = A.activeAccounts();
  for (const s of acts.map((a) => A.statusOf(a))) if (s.daily_limit_hit) el.append(h('div', { class: 'banner' }, `Daily loss limit hit on ${s.name}. Stop trading this account today.`));
  const defaults = { date: T.today(), instrument: 'NQ', point_value: 20, session: T.sessionAt(T.nyParts().minutes), account_id: acts.length === 1 ? acts[0].id : null, ...pre };
  const f = form(tradeDefs(acts), defaults, pointSync);
  const file = h('input', { type: 'file', accept: 'image/*' });
  el.append(card('Log a trade',
    acts.length ? null : h('p', { class: 'ital' }, 'Add an account in the Prop Firm Tracker first, then log trades against it.'),
    f.el,
    h('label', { class: 'fld', style: { marginTop: '14px' } }, h('span', { class: 'label' }, 'Chart screenshot (optional)'), file),
    h('div', { style: { marginTop: '18px' } }, btn('Save trade', guard(async () => {
      const v = f.get();
      if (!v.account_id) throw new Error('Pick the account this trade was on.');
      if (file.files[0]) v.screenshot_path = await db.upload(file.files[0]);
      const r = await A.logTrade(v);
      toast(`Trade saved. ${money(r.trade.pnl)}, ${num(r.trade.r_multiple)}R.`);
      ctx.refresh();
    })))));
  el.append(card('Recent trades', table(tradeCols(), A.tradesIn().slice(0, 100), { onRow: (t) => tradeDrawer(t, ctx), emptyText: 'No trades yet. Log your first one above, every entry is a data point.' })));
}

// ---------------- Calendar ----------------
let calMonth = null, calAcc = '', calDay = null;
function calendar(el, ctx) {
  calMonth ??= T.today().slice(0, 7);
  const [y, m] = calMonth.split('-').map(Number);
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); calMonth = d.toISOString().slice(0, 7); calDay = null; ctx.refresh(); };
  const from = calMonth + '-01', to = calMonth + '-31';
  const ts = A.tradesIn({ account: calAcc || null, date_from: from, date_to: to });
  const st = T.stats(ts);
  const sel = h('select', { style: { width: 'auto' }, onchange: (e) => { calAcc = e.target.value; ctx.refresh(); } }, h('option', { value: '' }, 'All accounts'), S.accounts.map((a) => h('option', { value: a.id, selected: a.id === calAcc }, a.name)));
  el.append(h('div', { class: 'row between mb' },
    h('div', { class: 'row' }, btn('‹', () => shift(-1), 'ghost sm'), h('h2', null, new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })), btn('›', () => shift(1), 'ghost sm')), sel));
  el.append(h('div', { class: 'stats' }, stat('Month P&L', money(st.total_pnl)), stat('Win rate', pct(st.win_rate)), stat('Days traded', st.days_traded),
    stat('Best day', st.best_day ? money(st.best_day.pnl) : '—', st.best_day ? fmtDate(st.best_day.date) : ''), stat('Worst day', st.worst_day ? money(st.worst_day.pnl) : '—', st.worst_day ? fmtDate(st.worst_day.date) : '')));
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDay = {};
  for (const t of ts) { (byDay[t.date] ??= { pnl: 0, n: 0 }); byDay[t.date].pnl += +t.pnl; byDay[t.date].n++; }
  const grid = h('div', { class: 'cal' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('div', { class: 'label' }, d)), Array.from({ length: lead }, () => h('div', { class: 'd off' })));
  for (let d = 1; d <= dim; d++) {
    const ds = `${calMonth}-${String(d).padStart(2, '0')}`, v = byDay[ds];
    grid.append(h('div', { class: 'd' + (ds === calDay ? ' sel' : ''), onclick: () => { calDay = ds; ctx.refresh(); } }, h('span', { class: 'mut' }, d),
      v ? [h('b', { class: v.pnl > 0 ? 'green' : v.pnl < 0 ? 'red' : 'mut' }, money(v.pnl)), h('span', { class: 'mut' }, v.n + (v.n === 1 ? ' trade' : ' trades'))] : null));
  }
  el.append(h('div', { class: 'mb' }, grid));
  if (calDay) el.append(card('Trades on ' + fmtDate(calDay), table(tradeCols(), ts.filter((t) => t.date === calDay), { onRow: (t) => tradeDrawer(t, ctx), emptyText: 'No trades on this day.' })));
}

// ---------------- Daily Scorecard ----------------
function scorecard(el, ctx) {
  const acts = A.activeAccounts();
  const f = form([
    { key: 'date', label: 'Date', type: 'date' }, { key: 'account_id', label: 'Account', type: 'select', options: accOpts(acts), span: 2 },
    { key: 'followed_plan_score', label: 'Followed plan', type: 'range' }, { key: 'risk_discipline_score', label: 'Risk discipline', type: 'range' },
    { key: 'patience_score', label: 'Patience', type: 'range' }, { key: 'emotion_score', label: 'Emotional control', type: 'range' },
    { key: 'notes', label: 'Notes', type: 'textarea', span: 3 },
  ], { date: T.today(), account_id: acts.length === 1 ? acts[0].id : null, followed_plan_score: 7, risk_discipline_score: 7, patience_score: 7, emotion_score: 7 });
  const cards = [...db.list('scorecard')].sort((a, b) => (a.date < b.date ? -1 : 1));
  const day = T.today();
  const last30 = cards.filter((s) => s.date >= T.addDays(day, -30));
  const byDate = {};
  for (const s of last30) (byDate[s.date] ??= []).push(T.scoreOf(s));
  const pts = Object.keys(byDate).sort().map((d) => ({ x: d.slice(5), y: T.sum(byDate[d]) / byDate[d].length }));
  const dates = [...new Set(cards.map((s) => s.date))].sort().reverse();
  let streak = 0;
  for (const d of dates) {
    const good = cards.filter((s) => s.date === d).every((s) => Math.min(s.followed_plan_score, s.risk_discipline_score, s.patience_score, s.emotion_score) >= 7);
    if (good) streak++; else break;
  }
  el.append(h('div', { class: 'stats' }, stat('Discipline score', num(T.disciplineScore(cards, T.addDays(day, -30), day), 1), '30-day average, out of 10'),
    stat('Streak', streak + (streak === 1 ? ' day' : ' days'), 'All four scores 7 or higher'), stat('Scorecards filed', cards.length)));
  el.append(card('Grade today', f.el, h('div', { style: { marginTop: '18px' } }, btn('Save scorecard', guard(async () => { await A.saveScorecard(f.get()); toast('Scorecard saved'); ctx.refresh(); })))));
  el.append(card('Last 30 days', lineChart(pts, { zero: false })));
  el.append(card('History', table([{ label: 'Date', get: (s) => fmtDate(s.date) }, { label: 'Account', get: (s) => (s.account_id ? A.accName(s.account_id) : '—') },
    { label: 'Plan', get: (s) => s.followed_plan_score }, { label: 'Risk', get: (s) => s.risk_discipline_score }, { label: 'Patience', get: (s) => s.patience_score },
    { label: 'Emotion', get: (s) => s.emotion_score }, { label: 'Notes', get: (s) => s.notes || '—' },
    { label: '', get: (s) => confirmBtn('Delete', async () => { await db.remove('scorecard', s.id); ctx.refresh(); }) }], [...cards].reverse().slice(0, 30), { emptyText: 'No scorecards yet. File the first one at the end of today.' })));
}

// ---------------- Lessons ----------------
function lessons(el, ctx) {
  const pre = A.nav.prefill?.lesson; A.nav.prefill = null;
  const f = form([{ key: 'date', label: 'Date', type: 'date' }, { key: 'title', label: 'Title' }, { key: 'tag', label: 'Tag', type: 'select', options: ['Execution', 'Risk', 'Psychology', 'Market'], blank: false },
    { key: 'body', label: 'Lesson', type: 'textarea', span: 3 }], { date: T.today(), tag: 'Execution', ...pre });
  el.append(card('Add a lesson', pre?.trade_id ? h('p', { class: 'ital' }, 'Linked to the trade you just opened.') : null, f.el,
    h('div', { style: { marginTop: '18px' } }, btn('Save lesson', guard(async () => { await A.saveLesson({ ...f.get(), trade_id: pre?.trade_id }); toast('Lesson saved'); ctx.refresh(); })))));
  const list = [...db.list('lesson')].sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!list.length) el.append(empty('No lessons yet. The trades that cost you the most are the ones worth writing down.'));
  for (const l of list) el.append(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', null, l.title), h('div', { class: 'row' }, badge(l.tag), h('span', { class: 'mut' }, fmtDate(l.date)))),
    h('p', { style: { whiteSpace: 'pre-wrap' } }, l.body), confirmBtn('Delete', async () => { await db.remove('lesson', l.id); ctx.refresh(); })));
}

// ---------------- Dashboard ----------------
let dashRange = '30', dashAcc = '';
function dashboard(el, ctx) {
  const day = T.today();
  const from = dashRange === 'all' ? null : T.addDays(day, -(+dashRange));
  const ts = A.tradesIn({ account: dashAcc || null, date_from: from });
  const st = T.stats(ts, db.list('scorecard'), day);
  el.append(h('div', { class: 'row between mb' },
    h('div', { class: 'row' }, [['7', '7d'], ['30', '30d'], ['90', '90d'], ['all', 'All']].map(([v, l]) => btn(l, () => { dashRange = v; ctx.refresh(); }, dashRange === v ? 'sm' : 'ghost sm'))),
    h('select', { style: { width: 'auto' }, onchange: (e) => { dashAcc = e.target.value; ctx.refresh(); } }, h('option', { value: '' }, 'All accounts'), S.accounts.map((a) => h('option', { value: a.id, selected: a.id === dashAcc }, a.name)))));
  if (!ts.length) { el.append(empty('Your stats will appear here once you log trades.')); return; }
  el.append(h('div', { class: 'stats' }, stat('Total P&L', money(st.total_pnl), `${st.trade_count} trades`), stat('Win rate', pct(st.win_rate), 'Break-evens excluded'), stat('Average R', num(st.avg_r)),
    stat('Profit factor', num(st.profit_factor)), stat('Discipline score', num(st.discipline_score, 1), '30-day scorecard average'), stat('Active accounts', A.activeAccounts().length)));
  const bars = (arr, order) => (order ? order.map((k) => arr.find((x) => x.key === k)).filter(Boolean) : arr).map((x) => ({ label: x.key.split(' ')[0] === 'NY' ? x.key : x.key.split(' / ')[0].slice(0, 12), value: x.pnl }));
  el.append(card('Equity curve', lineChart([{ x: 'Start', y: 0 }, ...st.equity.map((p) => ({ x: p.x.slice(5), y: p.y }))])));
  el.append(h('div', { class: 'grid2 mb' }, card('P&L by session', barChart(bars(st.pnl_by_session, T.SESSIONS))), card('P&L by setup grade', barChart(bars(st.pnl_by_grade, T.GRADES)))));
  el.append(card('P&L by model', barChart(bars(st.pnl_by_model))));
  const ranked = st.pnl_by_model.filter((x) => x.avg_r != null).sort((a, b) => b.avg_r - a.avg_r);
  const cols = [{ label: 'Model', get: (x) => x.key }, { label: 'Avg R', get: (x) => num(x.avg_r) }, { label: 'Trades', get: (x) => x.count }, { label: 'P&L', get: (x) => moneyEl(x.pnl) }];
  el.append(h('div', { class: 'grid2' }, card("What's working", table(cols, ranked.slice(0, 3))), card("What's not", table(cols, ranked.length > 3 ? ranked.slice(-3).reverse() : [], { emptyText: 'Log trades on more than three models to see this.' }))));
}

// ---------------- Monthly Report ----------------
let repMonth = null;
function monthly(el, ctx) {
  repMonth ??= T.today().slice(0, 7);
  const from = repMonth + '-01', to = repMonth + '-31';
  const ts = A.tradesIn({ date_from: from, date_to: to });
  const st = T.stats(ts);
  const inMonth = (d) => d && d >= from && d <= to;
  const disc = T.disciplineScore(db.list('scorecard'), from, to);
  const closed = S.accounts.filter((a) => inMonth(a.closed_date));
  const payouts = (db.doc('payouts', []) || []).filter((p) => inMonth(p.date));
  const ls = db.list('lesson').filter((l) => inMonth(l.date));
  el.append(h('div', { class: 'row between mb noprint' }, h('input', { type: 'month', value: repMonth, style: { width: 'auto' }, onchange: (e) => { if (e.target.value) { repMonth = e.target.value; ctx.refresh(); } } }), btn('Export as PDF', () => window.print())));
  el.append(h('div', { class: 'stats' }, stat('Total P&L', money(st.total_pnl), `${st.trade_count} trades`), stat('Win rate', pct(st.win_rate)), stat('Average R', num(st.avg_r)), stat('Profit factor', num(st.profit_factor)),
    stat('Discipline score', num(disc, 1)), stat('Plan-follow rate', pct(st.plan_follow_rate))));
  el.append(card('Highs and lows', h('div', { class: 'dl' }, [['Best day', st.best_day ? `${money(st.best_day.pnl)} on ${fmtDate(st.best_day.date)}` : '—'], ['Worst day', st.worst_day ? `${money(st.worst_day.pnl)} on ${fmtDate(st.worst_day.date)}` : '—'],
    ['Best session', st.best_session || '—'], ['Worst session', st.worst_session || '—'], ['Best model', st.best_model || '—'], ['Worst model', st.worst_model || '—'],
    ['Accounts passed', closed.filter((a) => a.stage === 'Passed').map((a) => a.name).join(', ') || 'None'], ['Accounts failed', closed.filter((a) => a.stage === 'Failed').map((a) => a.name).join(', ') || 'None'],
    ['Total payouts', money(T.sum(payouts, (p) => (+p.amount || 0) - (+p.fee || 0)))]].map(([k, v]) => [h('span', { class: 'label' }, k), h('span', null, v)]))));
  el.append(card('P&L per account', table([{ label: 'Account', get: (a) => a.name }, { label: 'Trades', get: (a) => ts.filter((t) => t.account_id === a.id).length }, { label: 'P&L', get: (a) => moneyEl(T.sum(ts.filter((t) => t.account_id === a.id), (t) => t.pnl)) }],
    S.accounts.filter((a) => ts.some((t) => t.account_id === a.id)), { emptyText: 'No trades this month.' })));
  el.append(card('Lessons this month', ls.length ? h('div', null, ls.map((l) => h('p', null, h('b', null, l.title), ' — ', l.body))) : empty('No lessons logged this month.')));
}

export default [
  { slug: 'today', title: 'Today', desc: 'Your daily cockpit. Session, accounts, news and prep in one glance before you click anything.', render: today },
  { slug: 'journal', title: 'Journal', desc: "Every trade logged here feeds your calendar, lessons, and discipline score. Be honest, the data only helps if it's real.", render: journal },
  { slug: 'calendar', title: 'Calendar', desc: 'Your month, day by day. Feeds the Monthly Report and shows which days are doing the damage.', render: calendar },
  { slug: 'scorecard', title: 'Daily Scorecard', desc: 'Grade the trader, not the trade. Fill this in at the end of every session.', render: scorecard },
  { slug: 'lessons', title: 'Lessons', desc: 'What the market taught you, in your own words. Feeds your Weekly Review and Monthly Report.', render: lessons },
  { slug: 'dashboard', title: 'Dashboard', desc: 'Everything you have logged, added up. This is what your Journal and Scorecards feed.', render: dashboard },
  { slug: 'monthly', title: 'Monthly Report', desc: 'One printable page per month, built from your Journal, Scorecards, Lessons and payouts.', render: monthly },
];
