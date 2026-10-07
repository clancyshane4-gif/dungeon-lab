import { h, btn, card, empty, form, table, money, num, pct, stat, badge, guard, toast, lineChart, barChart } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import * as A from '../actions.js';
import { DEFAULT_PLAYBOOK } from '../defaults.js';

const { S } = db;
const accSelect = (list, value, onchange, allLabel) => h('select', { onchange }, allLabel ? h('option', { value: '' }, allLabel) : null, list.map((a) => h('option', { value: a.id, selected: a.id === value }, a.name)));

// ---------------- Validator ----------------
function validator(el, ctx) {
  const acts = A.activeAccounts();
  const ans = { trend: 'With trend', model: '', account_id: acts.length === 1 ? acts[0].id : '', lrl_at_stop: false, secure_day: false };
  const out = h('div', { class: 'card' });
  const update = () => {
    const a = S.accounts.find((x) => x.id === ans.account_id);
    const st = a ? A.statusOf(a) : null;
    const g = T.gradeSetup({ ...ans, account_ok: st ? !st.daily_limit_hit && !st.breached : null });
    out.replaceChildren(h('div', { class: 'row between' }, h('span', { class: 'label' }, 'Grade'), badge(g.grade, g.grade === 'C' ? 'red' : 'gold')),
      h('p', { class: 'big', style: { margin: '10px 0' } }, g.line), g.notes.map((n) => h('p', { class: 'mut' }, n)),
      st ? h('p', { class: 'mut' }, `${st.name}: drawdown room ${money(st.drawdown_room)}, daily loss room ${st.daily_loss_room == null ? 'not set' : money(st.daily_loss_room)}.`) : h('p', { class: 'ital' }, 'Pick an account to include the account check.'),
      h('div', { style: { marginTop: '14px' } }, btn('Log this trade', () => {
        A.nav.prefill = { journal: { setup_grade: g.grade, model: ans.model || null, session: T.sessionAt(T.nyParts().minutes), account_id: ans.account_id || null } };
        ctx.go('journal');
      })));
  };
  const check = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { ans[key] = e.target.checked; update(); } }), h('span', null, label));
  const pick = (key, label, options, blank) => h('label', { class: 'fld', style: { margin: '8px 0' } }, h('span', { class: 'label' }, label),
    h('select', { onchange: (e) => { ans[key] = e.target.value; update(); } }, blank ? h('option', { value: '' }, blank) : null, options.map((o) => (Array.isArray(o) ? h('option', { value: o[0], selected: o[0] === ans[key] }, o[1]) : h('option', { value: o, selected: o === ans[key] }, o)))));
  for (const g of T.VALIDATOR) {
    const c = card(null, h('div', { class: 'label gold', style: { marginBottom: '6px' } }, g.group), g.items.map(([k, l]) => check(k, l)));
    if (g.group === 'HTF context') c.append(pick('trend', 'Is the 15-minute trending my direction?', ['With trend', 'Neutral, reacting', 'Counter-trend']));
    if (g.group === 'Entry') c.append(pick('model', 'Which model is this?', T.MODELS.slice(0, 6), 'Select a model'));
    if (g.group === 'Stop') c.append(check('lrl_at_stop', 'Is stacked LRL sitting right at my stop? (yes is lower quality)'));
    el.append(c);
  }
  el.append(card(null, h('div', { class: 'label gold', style: { marginBottom: '6px' } }, 'Account'), pick('account_id', 'Which account?', acts.map((a) => [a.id, a.name]), 'Select an account'), check('secure_day', 'Am I just trying to secure a winning day?')));
  el.append(out);
  el.append(h('p', { class: 'ital' }, 'The Validator reports the grade and the gaps. It never tells you to take or skip a trade.'));
  update();
}

// ---------------- Pre-Trade Checklist ----------------
const CHECKS = ['Looked left on the HTF', 'Clear DOL with LRL', 'Checked ES', 'Past the open (1+ min in)', 'Displacement + IFG/CISD', 'Protected stop + base-hit target + size checked'];
function checklist(el, ctx) {
  const key = 'dl_checklist_' + T.today();
  let state = [];
  try { state = JSON.parse(localStorage.getItem(key) || '[]'); } catch { state = []; }
  const ready = h('div');
  const draw = () => {
    const all = CHECKS.every((_, i) => state[i]);
    ready.replaceChildren(h('div', { class: 'card', style: { borderColor: all ? 'var(--gold)' : 'var(--line)', textAlign: 'center' } }, h('h2', { class: all ? 'gold' : 'mut' }, all ? 'Ready' : `${state.filter(Boolean).length} of ${CHECKS.length}`)));
  };
  el.append(card(null, CHECKS.map((c, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!state[i], onchange: (e) => { state[i] = e.target.checked; localStorage.setItem(key, JSON.stringify(state)); draw(); } }), h('span', null, c))),
    h('div', { style: { marginTop: '12px' } }, btn('Reset for the next trade', () => { localStorage.removeItem(key); ctx.refresh(); }, 'ghost sm'))), ready);
  el.append(h('p', { class: 'ital' }, 'Resets every day. All six ticked is the minimum, not a signal.'));
  draw();
}

// ---------------- Risk Calculator ----------------
function riskCalc(el) {
  const acts = A.activeAccounts();
  const out = h('div', { class: 'card' });
  const f = form([
    { key: 'account_id', label: 'Account', type: 'select', options: acts.map((a) => [a.id, a.name]) },
    { key: 'instrument', label: 'Instrument', type: 'select', options: ['NQ', 'MNQ', 'ES', 'MES'], blank: false },
    { key: 'mode', label: 'Risk as', type: 'select', options: [['usd', 'Dollars'], ['pct', '% of drawdown room']], blank: false },
    { key: 'entry', label: 'Entry', type: 'number' }, { key: 'stop', label: 'Stop', type: 'number' }, { key: 'risk', label: 'Risk per trade', type: 'number' },
    { key: 'target', label: 'Target price (optional)', type: 'number' },
  ], { instrument: 'NQ', mode: 'usd', account_id: acts.length === 1 ? acts[0].id : null }, () => calc());
  function calc() {
    const v = f.get();
    const a = S.accounts.find((x) => x.id === v.account_id);
    const st = a ? A.statusOf(a) : null;
    if (v.entry == null || v.stop == null || !v.risk || v.entry === v.stop) { out.replaceChildren(empty('Enter an entry, a stop and a risk amount.')); return; }
    const pv = T.POINT[v.instrument], pts = Math.abs(v.entry - v.stop);
    if (v.mode === 'pct' && !st) { out.replaceChildren(empty('Pick an account to size as a percent of its drawdown room.')); return; }
    const budget = v.mode === 'pct' ? (st.drawdown_room || 0) * (v.risk / 100) : v.risk;
    const contracts = Math.max(0, Math.floor(budget / (pts * pv)));
    const dollars = contracts * pts * pv;
    const rr = v.target != null ? Math.abs(v.target - v.entry) / pts : null;
    const over = st && st.daily_loss_room != null && dollars > 0.5 * Math.max(0, st.daily_loss_room);
    out.replaceChildren(h('div', { class: 'stats', style: { marginBottom: 0 } }, stat('Contracts', contracts, 'Rounded down'), stat('Dollar risk', money(dollars), `Budget ${money(budget)}`), stat('Points at risk', num(pts)),
      rr != null ? stat('R:R to target', num(rr) + 'R') : null, st ? stat('Daily loss room', st.daily_loss_room == null ? 'Not set' : money(st.daily_loss_room), st.name) : null),
      contracts === 0 ? h('p', { class: 'red', style: { marginTop: '14px' } }, 'One contract already risks more than your budget with this stop. Use a micro or pass.') : null,
      over ? h('p', { class: 'red', style: { marginTop: '14px' } }, "This size risks more than 50% of today's remaining daily loss room on this account.") : null);
  }
  el.append(card(null, f.el), out);
  calc();
}

// ---------------- Profit Projection ----------------
function projection(el) {
  const acts = A.activeAccounts();
  const st = T.stats(S.trades);
  const wins = S.trades.filter((t) => t.pnl > 0 && t.r_multiple != null), losses = S.trades.filter((t) => t.pnl < 0 && t.r_multiple != null);
  const out = h('div');
  const f = form([
    { key: 'account_id', label: 'Account', type: 'select', options: acts.map((a) => [a.id, a.name]) },
    { key: 'win_rate', label: 'Win rate (%)', type: 'number' }, { key: 'trades_week', label: 'Trades per week', type: 'number' },
    { key: 'avg_win', label: 'Average win (R)', type: 'number' }, { key: 'avg_loss', label: 'Average loss (R)', type: 'number' }, { key: 'risk', label: 'Risk per trade ($)', type: 'number' },
  ], { account_id: acts.length === 1 ? acts[0].id : null, win_rate: st.win_rate != null ? Math.round(st.win_rate * 100) : 50, trades_week: 5,
    avg_win: wins.length ? +(T.sum(wins, (t) => t.r_multiple) / wins.length).toFixed(2) : 1.5, avg_loss: losses.length ? +Math.abs(T.sum(losses, (t) => t.r_multiple) / losses.length).toFixed(2) : 1, risk: 300 }, () => calc());
  function calc() {
    const v = f.get();
    if ([v.win_rate, v.trades_week, v.avg_win, v.avg_loss, v.risk].some((x) => x == null)) { out.replaceChildren(empty('Fill in every input to see the projection.')); return; }
    const perTrade = (mult) => { const w = Math.min(1, (v.win_rate / 100) * mult); return (w * v.avg_win - (1 - w) * v.avg_loss) * v.risk; };
    const monthly = (mult) => perTrade(mult) * v.trades_week * 4.33;
    const a = S.accounts.find((x) => x.id === v.account_id);
    const s = a ? A.statusOf(a) : null;
    const perDay = (perTrade(1) * v.trades_week) / 5;
    const left = s && s.profit_target ? s.profit_target - s.profit : null;
    const days = left == null ? null : left <= 0 ? 0 : perDay > 0 ? Math.ceil(left / perDay) : null;
    const weeks = Array.from({ length: 13 }, (_, i) => ({ x: 'Wk ' + i, y: perTrade(1) * v.trades_week * i }));
    out.replaceChildren(h('div', { class: 'stats' }, stat('Conservative', money(monthly(0.7)), 'Per month at 0.7x win rate'), stat('Base', money(monthly(1)), 'Per month at your win rate'), stat('Optimistic', money(monthly(1.3)), 'Per month at 1.3x win rate'),
      stat('Trading days to profit target', left == null ? 'Pick an account with a target' : days === 0 ? 'Reached' : days ?? 'Not at this rate', s ? s.name : '')),
      card('Base rate, next 12 weeks', lineChart(weeks)));
  }
  el.append(card(null, f.el), out, h('p', { class: 'ital' }, 'A projection is arithmetic on your past trades, not a promise about your future ones.'));
  calc();
}

// ---------------- Max Loss Tracker ----------------
let mlAcc = '';
function maxLoss(el, ctx) {
  const ts = A.tradesIn({ account: mlAcc || null });
  const st = T.stats(ts);
  const day = T.today();
  const a = S.accounts.find((x) => x.id === mlAcc);
  const limits = (a ? [a] : A.activeAccounts()).map((x) => +x.daily_loss_limit).filter(Boolean);
  const bars = [];
  const map = Object.fromEntries(st.daily.map((d) => [d.date, d.pnl]));
  for (let i = 29; i >= 0; i--) { const d = T.addDays(day, -i); bars.push({ label: d.slice(5), value: map[d] || 0 }); }
  el.append(h('div', { class: 'row mb' }, accSelect(S.accounts, mlAcc, (e) => { mlAcc = e.target.value; ctx.refresh(); }, 'All accounts')));
  el.append(h('div', { class: 'stats' }, stat('Current losing streak', st.losing_streak + (st.losing_streak === 1 ? ' trade' : ' trades')), stat('Largest losing streak', st.max_losing_streak + ' trades'), stat('Largest daily loss', money(st.largest_daily_loss))));
  if (st.losing_streak >= 3) el.append(h('div', { class: 'banner' }, 'Three losses in a row. Step away for the session and open the Red Day Playbook.'));
  el.append(card('Daily P&L, last 30 days', barChart(bars, { ref: limits.length ? { y: -Math.min(...limits), label: 'Daily loss limit' } : null })));
  el.append(h('p', { class: 'ital' }, 'Three losses in a row means step away for the session.'));
}

// ---------------- Red Day Playbook ----------------
function redDay(el, ctx) {
  const ta = h('textarea', { rows: 12 });
  ta.value = db.doc('playbook', DEFAULT_PLAYBOOK);
  el.append(card('The protocol', ta, h('div', { class: 'row', style: { marginTop: '14px' } }, btn('Save my version', guard(async () => { await db.setDoc('playbook', ta.value); toast('Playbook saved'); })),
    btn('Restore the original', guard(async () => { await db.setDoc('playbook', DEFAULT_PLAYBOOK); ctx.refresh(); }), 'ghost'))));
  el.append(h('div', { class: 'row' }, btn('Open Day Debrief', () => ctx.go('debrief'), 'ghost'), btn('Check account room', () => ctx.go('tracker'), 'ghost')));
  el.append(h('p', { class: 'ital', style: { marginTop: '20px' } }, 'Only going for winning days. A red day handled well is one you can come back from tomorrow.'));
}

// ---------------- Risk Blueprint ----------------
function blueprint(el, ctx) {
  const plan = db.doc('trading_plan', {}) || {};
  const acts = A.activeAccounts().map((a) => A.statusOf(a));
  const evals = acts.filter((s) => s.stage === 'Evaluation');
  const m = (v) => (v == null || v === '' ? 'Set in Trading Plan' : money(v));
  el.append(card('Risk Blueprint',
    h('div', { class: 'stats', style: { marginBottom: '16px' } }, stat('Max risk per trade', m(plan.max_risk_per_trade)), stat('Daily max loss', m(plan.daily_max_loss)), stat('Weekly max loss', m(plan.weekly_max_loss)),
      stat('Max trades per day', plan.max_trades_per_day ?? 'Set in Trading Plan'), stat('At risk across evaluations', money(T.sum(evals, (s) => Math.max(0, s.drawdown_room || 0))), 'Sum of drawdown room')),
    table([{ label: 'Account', get: (s) => s.name }, { label: 'Daily loss limit', get: (s) => money(s.daily_loss_limit) }, { label: 'Drawdown room', get: (s) => money(s.drawdown_room) }], acts, { emptyText: 'No active accounts yet.' })));
  el.append(h('div', { class: 'row noprint' }, btn('Edit Trading Plan', () => ctx.go('plan'), 'ghost'), btn('Print', () => window.print(), 'ghost')));
  el.append(h('p', { class: 'ital', style: { marginTop: '16px' } }, 'Screenshot this and keep it next to the charts.'));
}

export default [
  { slug: 'validator', title: 'Validator', desc: "Run every setup through this before you take it. It doesn't predict, it checks whether this looks like a Timmy trade.", render: validator },
  { slug: 'checklist', title: 'Pre-Trade Checklist', desc: 'Six ticks at the moment of entry. Feeds nothing but your discipline.', render: checklist },
  { slug: 'risk-calc', title: 'Risk Calculator', desc: 'Size the trade to the account, not to your confidence.', render: riskCalc },
  { slug: 'projection', title: 'Profit Projection', desc: 'Arithmetic on your own stats, so you can see what your current numbers add up to.', render: projection },
  { slug: 'max-loss', title: 'Max Loss Tracker', desc: "Consecutive losses and daily drawdown, tracked so you don't have to trust your memory.", render: maxLoss },
  { slug: 'red-day', title: 'Red Day Playbook', desc: 'What you do on a losing day, decided before the losing day. Rewrite it in your own words.', render: redDay },
  { slug: 'blueprint', title: 'Risk Blueprint', desc: 'Your risk rules on one card, pulled from your Trading Plan and your accounts.', render: blueprint },
];
