// Account protection: the tilt guard, the pre-trade check, and the "why did you take it" review.
// Built from what Timmy's members keep running into: tilt and revenge trades, wrong size (minis vs micros),
// no stop attached, broken consistency rules, and copying entries instead of reading the chart.
import { h, btn, card, form, money, num, stat, badge, guard, toast, drawer } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import * as A from '../actions.js';

const { S } = db;
const MICRO = { NQ: 'MNQ', ES: 'MES' };
const MINI = { MNQ: 'NQ', MES: 'ES' };

// Timmy's own day rules are the defaults: max 3 trades, off after a win, off after 2 losses in a row.
export function myRules() {
  const p = db.doc('trading_plan', {}) || {};
  return {
    max_risk_per_trade: p.max_risk_per_trade ?? null,
    daily_max_loss: p.daily_max_loss ?? null,
    max_trades_per_day: p.max_trades_per_day ?? 3,
    stop_after_win: p.stop_after_win ?? true,
    max_losses_in_row: p.max_losses_in_row ?? 2,
  };
}

export function tiltStatus(day = T.today()) {
  const r = myRules();
  const ts = A.tradesIn({ date_from: day, date_to: day }).slice().reverse();
  const pnl = T.sum(ts, (t) => t.pnl);
  const stop = [], warn = [];
  if (r.daily_max_loss != null && pnl <= -r.daily_max_loss) stop.push(`You hit your daily max loss of ${money(r.daily_max_loss)}.`);
  for (const a of A.activeAccounts()) {
    const s = A.statusOf(a, day);
    if (s.daily_limit_hit) stop.push(`Daily loss limit hit on ${s.name}.`);
    else if (s.danger_zone) warn.push(`${s.name} is in the danger zone: ${money(s.drawdown_room)} of drawdown left.`);
  }
  if (r.max_trades_per_day != null && ts.length >= r.max_trades_per_day) stop.push(`That's ${ts.length} ${ts.length === 1 ? 'trade' : 'trades'} today. Your max is ${r.max_trades_per_day}.`);
  else if (r.max_trades_per_day != null && ts.length && ts.length === r.max_trades_per_day - 1) warn.push('One trade left today under your rules.');
  if (r.stop_after_win && ts.some((t) => t.pnl > 0)) stop.push("You've got a win today. Timmy's rule: take the win and get off.");
  let run = 0;
  for (let i = ts.length - 1; i >= 0 && ts[i].pnl < 0; i--) run++;
  if (run >= r.max_losses_in_row) stop.push(`${run} losses in a row. Step away, you're done for today.`);
  else if (run && run === r.max_losses_in_row - 1) warn.push("One more loss and you're done for today.");
  if (ts.some((t) => t.emotion === 'Revenge' || t.emotion === 'Frustrated')) warn.push('You logged a revenge or frustrated trade today. Sit the next one out.');
  return { level: stop.length ? 'stop' : warn.length ? 'warn' : 'ok', stop: [...new Set(stop)], warn, trades: ts.length, pnl, rules: r };
}

export function tiltCard(t = tiltStatus()) {
  if (t.level === 'ok') return h('div', { class: 'card', style: { borderColor: 'var(--green)' } }, h('div', { class: 'row between' }, h('h3', null, 'Tilt guard'), badge('Clear to trade', 'green')),
    h('p', { class: 'mut', style: { margin: '8px 0 0' } }, `${t.trades} of ${t.rules.max_trades_per_day ?? 'unlimited'} trades used today.`));
  return h('div', { class: 'card' + (t.level === 'stop' ? ' danger' : ''), style: t.level === 'warn' ? { borderColor: 'var(--gold)' } : null },
    h('div', { class: 'row between' }, h('h3', null, t.level === 'stop' ? "You're done for today" : 'Careful'), badge(t.level === 'stop' ? 'Stop' : 'Warning', t.level === 'stop' ? 'red' : 'gold')),
    [...t.stop, ...t.warn].map((x) => h('p', { class: t.stop.includes(x) ? 'red' : '', style: { margin: '8px 0 0' } }, x)),
    t.level === 'stop' ? h('p', { class: 'ital', style: { marginTop: '10px' } }, 'Only going for winning days. The account is still here tomorrow.') : null);
}

// How much more profit fits under the consistency rule today (best day must stay at or under pct% of total profit).
export function consistencyRoom(s, day = T.today()) {
  const pct = +(S.accounts.find((a) => a.id === s.id)?.consistency_rule_pct) || 0;
  if (!pct || pct >= 100) return null;
  const others = Object.entries(s.days).filter(([d]) => d !== day).map(([, v]) => v);
  const otherProfit = T.sum(others);
  const today = s.days[day] || 0;
  if (otherProfit <= 0) return { pct, text: `Any profit today becomes your best day. With a ${pct}% rule you'll need more winning days after it before a payout.` };
  const maxToday = (pct * otherProfit) / (100 - pct);
  const left = maxToday - today;
  return { pct, text: left > 0 ? `You can make up to ${money(left)} more today and stay inside the ${pct}% consistency rule.` : `Today is already over the ${pct}% consistency rule. Spread profit over more days before a payout.`, over: left <= 0 };
}

// ---------------- Pre-Trade Check ----------------
function preTrade(el, ctx) {
  const tilt = tiltStatus();
  el.append(tiltCard(tilt));
  const acts = A.activeAccounts();
  const r = tilt.rules;
  const out = h('div');
  const f = form([
    { key: 'account_id', label: 'Account', type: 'select', options: acts.map((a) => [a.id, a.name]) },
    { key: 'instrument', label: 'Instrument', type: 'select', options: ['NQ', 'MNQ', 'ES', 'MES'], blank: false },
    { key: 'risk', label: 'Max risk on this trade ($)', type: 'number' },
    { key: 'entry', label: 'Entry', type: 'number' }, { key: 'stop', label: 'Stop', type: 'number' }, { key: 'target', label: 'Target (optional)', type: 'number' },
  ], { instrument: 'NQ', account_id: acts.length === 1 ? acts[0].id : null, risk: r.max_risk_per_trade }, () => calc());
  const checks = ['My stop loss is attached in the platform, not just in my head', 'I checked minis vs micros on the order ticket', "This is my read of the chart, not someone else's entry"];
  const ticked = checks.map(() => false);
  const ready = h('div');
  function drawReady() {
    const all = ticked.every(Boolean);
    ready.replaceChildren(h('div', { class: 'card', style: { textAlign: 'center', borderColor: tilt.level === 'stop' ? 'var(--red)' : all ? 'var(--gold)' : 'var(--line)' } },
      h('h2', { class: tilt.level === 'stop' ? 'red' : all ? 'gold' : 'mut' }, tilt.level === 'stop' ? 'Done for today' : all ? 'Ready' : `${ticked.filter(Boolean).length} of ${checks.length}`)));
  }
  function calc() {
    const v = f.get();
    const a = S.accounts.find((x) => x.id === v.account_id);
    const s = a ? A.statusOf(a) : null;
    if (v.entry == null || v.stop == null || v.entry === v.stop) { out.replaceChildren(card(null, h('p', { class: 'ital' }, 'Enter your entry and stop to size the trade.'))); return; }
    const pts = Math.abs(v.entry - v.stop);
    const pv = T.POINT[v.instrument];
    const budget = v.risk || (s ? Math.min(s.daily_loss_room ?? Infinity, s.drawdown_room ?? Infinity) * 0.5 : null);
    if (!budget || !Number.isFinite(budget)) { out.replaceChildren(card(null, h('p', { class: 'ital' }, 'Enter how much you are willing to risk, or pick an account.'))); return; }
    const n = Math.max(0, Math.floor(budget / (pts * pv)));
    const dollars = n * pts * pv;
    const isMini = !!MICRO[v.instrument];
    const alt = isMini ? `= ${n * 10} ${MICRO[v.instrument]}` : n >= 10 ? `= ${Math.floor(n / 10)} ${MINI[v.instrument]}${n % 10 ? ` + ${n % 10} ${v.instrument}` : ''}` : `under 1 ${MINI[v.instrument]}`;
    const microN = isMini ? Math.floor(budget / (pts * T.POINT[MICRO[v.instrument]])) : null;
    const rr = v.target != null ? Math.abs(v.target - v.entry) / pts : null;
    const flags = [];
    if (n === 0) flags.push(isMini ? `One ${v.instrument} risks ${money(pts * pv)} with this stop. Switch to micros: ${microN} ${MICRO[v.instrument]} fits your risk.` : `One contract risks more than ${money(budget)} with this stop. Pass or tighten the risk.`);
    if (s && s.daily_loss_room != null && dollars > 0.5 * Math.max(0, s.daily_loss_room)) flags.push(`A full stop uses more than half of today's daily loss room on ${s.name}.`);
    if (s && s.drawdown_room != null && dollars >= s.drawdown_room) flags.push(`A full stop takes ${s.name} past its drawdown floor.`);
    if (pts > 60 && v.instrument.includes('NQ')) flags.push(`That's a ${num(pts, 0)} point stop. Big stops are fine when they're protected, just size down for it.`);
    const cons = s ? consistencyRoom(s) : null;
    out.replaceChildren(
      h('div', { class: 'stats' }, stat('Size', `${n} ${v.instrument}`, n ? alt : ''), stat('Dollar risk', money(dollars), `${num(pts)} points`), stat('Risk budget', money(budget), v.risk ? 'Your number' : 'Half of your room'),
        rr != null ? stat('Reward to risk', num(rr) + 'R', rr < 1 ? 'Under 1R' : '') : null,
        s ? stat('Room after a full stop', money(Math.min(s.daily_loss_room ?? Infinity, s.drawdown_room ?? Infinity) - dollars), s.name) : null),
      flags.length ? h('div', { class: 'card danger' }, flags.map((x) => h('p', { class: 'red', style: { margin: '4px 0' } }, x))) : null,
      cons ? h('div', { class: 'card' + (cons.over ? ' danger' : '') }, h('h3', null, 'Consistency rule'), h('p', { class: cons.over ? 'red' : 'mut', style: { margin: '8px 0 0' } }, cons.text)) : null);
  }
  el.append(card(null, f.el), out,
    card('Before you click', checks.map((c, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { ticked[i] = e.target.checked; drawReady(); } }), h('span', null, c)))),
    ready, h('p', { class: 'ital' }, 'This checks size and room. It does not tell you to take the trade.'));
  calc(); drawReady();
}

// ---------------- Why did you take it? ----------------
const QS = [
  ['htf', 'HTF reason: looked left, swept a level or delivering out of a gap?'],
  ['dol', 'Clear draw on liquidity with LRL leading into it?'],
  ['es', 'ES agreed, or there was an SMT?'],
  ['open', 'Past the first 1 to 2 minutes and price was displacing?'],
  ['entry', 'Entry was an IFG or CISD close, not the first candle?'],
  ['stop', 'Protected stop and a base-hit target?'],
];
export function reviewDrawer(trade, ctx) {
  drawer('Why did you take it?', (body, close) => {
    const ans = {};
    let copied = null;
    const yn = (onPick) => {
      const wrap = h('div', { class: 'row' });
      const mk = (label, val) => btn(label, () => { onPick(val); [...wrap.children].forEach((b) => b.classList.add('ghost')); bt[val ? 0 : 1].classList.remove('ghost'); }, 'ghost sm');
      const bt = [mk('Yes', true), mk('No', false)];
      wrap.append(...bt);
      return wrap;
    };
    body.append(h('p', { class: 'mut' }, `${trade.direction} ${trade.instrument}, ${money(trade.pnl)}. Six quick taps. This is how the Lab learns what actually makes you money.`),
      ...QS.map(([k, q]) => h('div', { style: { margin: '14px 0' } }, h('p', { style: { margin: '0 0 6px' } }, q), yn((v) => { ans[k] = v; }))),
      h('div', { style: { margin: '14px 0' } }, h('p', { style: { margin: '0 0 6px' } }, "Did you copy someone else's entry?"), yn((v) => { copied = v; })));
    const result = h('div');
    body.append(h('div', { class: 'row', style: { marginTop: '18px' } }, btn('Save review', guard(async () => {
      if (QS.some(([k]) => ans[k] == null)) throw new Error('Answer all six, yes or no.');
      const g = T.gradeSetup({ htf_left: ans.htf, htf_gap: ans.htf, dol: ans.dol, lrl: ans.dol, base_target: ans.stop, es_looked: true, es_same: ans.es, smt: ans.es,
        past_open: ans.open, displacing: ans.open, no_news: true, displacement_candle: ans.entry, ifg_cisd: ans.entry, protected_stop: ans.stop, be_level: ans.stop });
      const note = `Review: grades ${g.grade}${g.missing.length ? `, missing ${g.missing.join(', ')}` : ''}.${copied ? ' Copied entry.' : ''}`;
      await A.updateTrade(trade.id, { ...trade, setup_grade: g.grade, notes: [trade.notes, note].filter(Boolean).join('\n') });
      result.replaceChildren(h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'row between' }, h('h3', null, 'Grade'), badge(g.grade, g.grade === 'C' ? 'red' : 'gold')),
        h('p', null, g.line), copied ? h('p', { class: 'red' }, "Copying entries skips the part that makes you money. Next time, run the Pre-Trade Check on your own read first.") : null,
        trade.pnl > 0 && g.grade === 'C' ? h('p', { class: 'mut' }, 'A win on a C setup is luck, not edge. Do not let it teach you the wrong lesson.') : null,
        trade.pnl < 0 && (g.grade === 'A+' || g.grade === 'A') ? h('p', { class: 'mut' }, "Good setup, it just didn't work. It's whatever, it happens. That loss is part of the edge.") : null));
      toast('Review saved'); ctx.refresh();
    })), btn('Skip', close, 'ghost')), result);
  });
}

export default [
  { slug: 'pre-trade', title: 'Pre-Trade Check', desc: 'Size the trade, check your room and your tilt before you click. Answers "how many contracts?" in one go.', render: preTrade },
];
