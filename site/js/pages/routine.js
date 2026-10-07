import { h, btn, card, empty, form, table, money, moneyEl, num, pct, fmtDate, stat, guard, toast, confirmBtn } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import * as A from '../actions.js';
import { PLAN_FIELDS, PLAN_NUMBERS, DAY_BLOCKS } from '../defaults.js';
import { tradeCols, newsOn } from './core.js';

const dl = (rows) => h('div', { class: 'dl' }, rows.map(([k, v]) => [h('span', { class: 'label' }, k), h('span', { style: { whiteSpace: 'pre-wrap' } }, v ?? '—')]));

// ---------------- Premarket Prep ----------------
function prep(el, ctx) {
  const day = T.today();
  const acts = A.activeAccounts();
  const news = newsOn(day);
  const picked = new Set();
  const f = form([
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'bias', label: 'HTF bias', type: 'select', options: ['Bullish', 'Bearish', 'Neutral, reacting'] },
    { key: 'bias_reason', label: 'One line of reasoning' },
    { key: 'htf_gaps', label: 'HTF gaps in play', span: 3 },
    { type: 'heading', label: 'Key levels' },
    { key: 'asia_h', label: 'Asia high', type: 'number' }, { key: 'asia_l', label: 'Asia low', type: 'number' }, { key: 'weekly_gap', label: 'Weekly gap / NWOG' },
    { key: 'london_h', label: 'London high', type: 'number' }, { key: 'london_l', label: 'London low', type: 'number' }, { key: 'data_wicks', label: 'Data wicks (8:30 news)' },
    { key: 'pdh', label: 'Previous day high', type: 'number' }, { key: 'pdl', label: 'Previous day low', type: 'number' }, { key: 'es_note', label: 'ES vs NQ', type: 'select', options: ['Agreeing', 'Diverging', 'SMT already in'] },
    { key: 'pwh', label: 'Previous week high', type: 'number' }, { key: 'pwl', label: 'Previous week low', type: 'number' },
    { key: 'dol', label: 'Draw on liquidity: which level and why', type: 'textarea', span: 3 },
    { key: 'news', label: 'News today', type: 'textarea', span: 3 },
    { key: 'sit_out', label: 'What would make me sit out today?', span: 3 },
  ], { date: day, news: news.map((n) => `${n.time || ''} ${n.event}`.trim()).join('\n') });
  const accBox = h('div', null, acts.length ? acts.map((a) => {
    const s = A.statusOf(a);
    const room = Math.min(s.daily_loss_room ?? Infinity, s.drawdown_room ?? Infinity);
    const max = Number.isFinite(room) ? Math.max(0, Math.floor(room / (20 * 20))) : null;
    return h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? picked.add(a.id) : picked.delete(a.id); } }),
      h('span', null, a.name, h('span', { class: 'mut' }, max == null ? '' : `, max ${max} NQ contracts on a 20 point stop`)));
  }) : empty('No active accounts yet.'));
  el.append(card("Today's prep", f.el, h('div', { class: 'label', style: { margin: '16px 0 4px' } }, 'Accounts I am trading today'), accBox,
    h('div', { class: 'row', style: { marginTop: '18px' } }, btn('Save prep', guard(async () => { await db.add('prep', { ...f.get(), accounts: [...picked] }); toast('Prep saved'); ctx.refresh(); })), btn('Open Market Calendar', () => ctx.go('market-calendar'), 'ghost'))));
  const past = [...db.list('prep')].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  el.append(card('Recent preps', table([{ label: 'Date', get: (p) => fmtDate(p.date) }, { label: 'Bias', get: (p) => p.bias || '—' }, { label: 'Draw on liquidity', get: (p) => p.dol || '—' }, { label: 'Sit out if', get: (p) => p.sit_out || '—' },
    { label: '', get: (p) => confirmBtn('Delete', async () => { await db.remove('prep', p.id); ctx.refresh(); }) }], past, { emptyText: 'No preps yet. The first one takes five minutes.' })));
}

// ---------------- Your Trading Day ----------------
function tradingDay(el) {
  const p = T.nyParts();
  el.append(h('p', { class: 'mut mb' }, `It is ${p.hhmm} in New York.`));
  el.append(h('div', { class: 'tl' }, DAY_BLOCKS.map(([a, b, title, what]) => h('div', { class: 'blk' + (p.minutes >= a && p.minutes < b ? ' now' : '') }, h('h3', null, title), h('p', { class: 'mut', style: { margin: '4px 0 0' } }, what)))));
  el.append(h('p', { class: 'ital' }, 'All times are New York time. This page is a reference, not a form.'));
}

// ---------------- Day Debrief ----------------
function debrief(el, ctx) {
  const day = T.today();
  const ts = A.tradesIn({ date_from: day, date_to: day });
  const per = A.activeAccounts().map((a) => ({ name: a.name, pnl: T.sum(ts.filter((t) => t.account_id === a.id), (t) => t.pnl), n: ts.filter((t) => t.account_id === a.id).length })).filter((x) => x.n);
  el.append(card("Today's trades", per.length ? h('div', { class: 'stats' }, per.map((x) => stat(x.name, money(x.pnl), `${x.n} ${x.n === 1 ? 'trade' : 'trades'}`))) : null,
    table(tradeCols(), ts, { emptyText: 'No trades logged today. Sitting out is a decision too, debrief it.' })));
  const f = form([
    { key: 'followed_plan', label: 'Did I follow the plan?', type: 'yesno' },
    { key: 'base_hit_or_stars', label: 'Base hit or the stars?', type: 'select', options: ['Base hit', 'The stars', 'No trade'] },
    { key: 'emotion_at_close', label: 'Emotion at close', type: 'select', options: T.EMOTIONS },
    { key: 'best_decision', label: 'Best decision today', type: 'textarea', span: 3 },
    { key: 'worst_decision', label: 'Worst decision today', type: 'textarea', span: 3 },
    { key: 'change_tomorrow', label: 'One thing to do differently tomorrow', type: 'textarea', span: 3 },
  ]);
  el.append(card('Debrief', f.el, h('div', { style: { marginTop: '18px' } }, btn('Save debrief', guard(async () => {
    const r = await A.saveDebrief({ ...f.get(), date: day });
    if (r.needs_scorecard) { toast('Debrief saved. Now grade the day.'); ctx.go('scorecard'); } else { toast('Debrief saved'); ctx.refresh(); }
  })))));
  const past = [...db.list('debrief')].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  el.append(card('Recent debriefs', table([{ label: 'Date', get: (d) => fmtDate(d.date) }, { label: 'Plan', get: (d) => (d.followed_plan == null ? '—' : d.followed_plan ? 'Yes' : 'No') }, { label: 'Best', get: (d) => d.best_decision || '—' },
    { label: 'Worst', get: (d) => d.worst_decision || '—' }, { label: 'Tomorrow', get: (d) => d.change_tomorrow || '—' }], past, { emptyText: 'No debriefs yet.' })));
}

// ---------------- Weekly Review ----------------
function weekly(el, ctx) {
  const w = A.weekSummary();
  el.append(h('p', { class: 'mut mb' }, `Week of ${fmtDate(w.week_start)} to ${fmtDate(w.week_end)}`));
  el.append(h('div', { class: 'stats' }, stat('Week P&L', money(w.total_pnl), `${w.trade_count} trades`), stat('Win rate', pct(w.win_rate)), stat('Average R', num(w.avg_r)),
    stat('Discipline score', num(w.discipline_score, 1)), stat('Plan-follow rate', pct(w.plan_follow_rate)), stat('A+ setups taken', w.a_plus_count)));
  el.append(card('This week', dl([['Best session', w.best_session], ['Worst session', w.worst_session], ['Best model', w.best_model], ['Worst model', w.worst_model],
    ['P&L per account', w.per_account.map((p) => `${p.account}: ${money(p.pnl)}`).join('\n') || '—']])));
  const f = form([{ key: 'what_worked', label: 'What worked', type: 'textarea', span: 3 }, { key: 'what_didnt', label: "What didn't", type: 'textarea', span: 3 }, { key: 'next_focus', label: "Next week's focus", type: 'textarea', span: 3 }]);
  el.append(card('Review', f.el, h('div', { style: { marginTop: '18px' } }, btn('Save weekly review', guard(async () => { await A.saveWeeklyReview(f.get()); toast('Weekly review saved'); ctx.refresh(); })))));
  const past = [...db.list('weekly')].sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
  if (!past.length) el.append(empty('No reviews saved yet. Do the first one this Friday.'));
  for (const r of past) el.append(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', null, 'Week of ' + fmtDate(r.week_start)), moneyEl(r.summary?.total_pnl)),
    dl([['What worked', r.what_worked], ["What didn't", r.what_didnt], ['Next focus', r.next_focus]]), h('div', { style: { marginTop: '12px' } }, confirmBtn('Delete', async () => { await db.remove('weekly', r.id); ctx.refresh(); }))));
}

// ---------------- Trading Plan ----------------
function plan(el, ctx) {
  const saved = db.doc('trading_plan', null);
  const cur = saved || Object.fromEntries(PLAN_FIELDS.map(([k, , d]) => [k, d]));
  const nums = form(PLAN_NUMBERS.map(([key, label]) => ({ key, label, type: 'number' })), cur);
  const areas = PLAN_FIELDS.map(([key, label]) => { const ta = h('textarea', { rows: key === 'models' ? 6 : 3 }); ta.value = cur[key] ?? ''; return { key, el: h('label', { class: 'fld', style: { marginTop: '14px' } }, h('span', { class: 'label' }, label), ta), ta }; });
  const updated = db.docUpdated('trading_plan');
  el.append(h('p', { class: 'mut mb' }, updated ? 'Last edited ' + fmtDate(updated) : 'Not saved yet. The text below is a starting point, rewrite it as yours.'));
  el.append(card('The numbers', h('p', { class: 'ital' }, 'These feed the Risk Blueprint.'), nums.el));
  el.append(card('The rules', areas.map((a) => a.el), h('div', { style: { marginTop: '18px' } }, btn('Save trading plan', guard(async () => {
    await db.setDoc('trading_plan', { ...nums.get(), ...Object.fromEntries(areas.map((a) => [a.key, a.ta.value])) }); toast('Trading plan saved'); ctx.refresh();
  })))));
}

export default [
  { slug: 'prep', title: 'Premarket Prep', desc: 'Five minutes before the open. Feeds the Today page and gives the Day Debrief something to compare against.', render: prep },
  { slug: 'trading-day', title: 'Your Trading Day', desc: 'The shape of the day in New York time, and what to do in each block.', render: tradingDay },
  { slug: 'debrief', title: 'Day Debrief', desc: 'Two minutes at the close. This is where the edge actually comes from.', render: debrief },
  { slug: 'weekly', title: 'Weekly Review', desc: 'The week, added up from your Journal and Scorecards, then three honest answers.', render: weekly },
  { slug: 'plan', title: 'Trading Plan', desc: 'Your rules in one place. Feeds the Risk Blueprint, and it is what you check yourself against.', render: plan },
];
