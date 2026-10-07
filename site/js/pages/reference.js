import { h, btn, card, empty, form, table, money, fmtDate, badge, guard, toast, confirmBtn, editTable } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import { DEFAULT_RULES, DEFAULT_SPECS, DEFAULT_DEALS, NEWS_TEMPLATES } from '../defaults.js';
import { newsOn } from './core.js';

// ---------------- Futures Specs ----------------
function specs(el, ctx) {
  el.append(card(null, editTable([
    { key: 'instrument', label: 'Instrument', width: '70px' }, { key: 'exchange', label: 'Exchange', width: '80px' }, { key: 'tick_size', label: 'Tick size', type: 'number', width: '70px' },
    { key: 'tick_value', label: 'Tick value ($)', type: 'number', width: '80px' }, { key: 'point_value', label: 'Point value ($)', type: 'number', width: '80px' },
    { key: 'hours', label: 'Regular hours (NY)', width: '130px' }, { key: 'margin', label: 'Margin note', width: '180px' },
  ], db.doc('specs', DEFAULT_SPECS), async (rows) => { await db.setDoc('specs', rows); ctx.refresh(); })));
  el.append(h('p', { class: 'ital' }, 'Contract specs can change. Confirm with the exchange or your platform.'));
}

// ---------------- Market Calendar ----------------
let calWeek = null;
function marketCalendar(el, ctx) {
  calWeek ??= T.weekStart(T.today());
  const day = T.today();
  const f = form([{ key: 'date', label: 'Date', type: 'date' }, { key: 'time', label: 'Time (NY)', type: 'time' }, { key: 'impact', label: 'Impact', type: 'select', options: ['High', 'Medium'], blank: false },
    { key: 'event', label: 'Event', span: 2 }, { key: 'template', label: 'Or pick a common one', type: 'select', options: NEWS_TEMPLATES.map((n) => n[0]) }],
  { date: day, time: '08:30', impact: 'High' }, (k, api) => {
    if (k !== 'template') return;
    const t = NEWS_TEMPLATES.find((n) => n[0] === api.inputs.template.get());
    if (t) { api.set('event', t[0]); api.set('time', t[1]); api.set('impact', t[2]); }
  });
  el.append(card('Add a red-folder event', f.el, h('div', { style: { marginTop: '18px' } }, btn('Add event', guard(async () => {
    const { template, ...v } = f.get();
    if (!v.date || !v.event) throw new Error('An event needs a date and a name.');
    await db.add('news', v); toast('Event added'); ctx.refresh();
  })))));
  el.append(h('div', { class: 'row mb' }, btn('‹', () => { calWeek = T.addDays(calWeek, -7); ctx.refresh(); }, 'ghost sm'), h('h2', null, 'Week of ' + fmtDate(calWeek)), btn('›', () => { calWeek = T.addDays(calWeek, 7); ctx.refresh(); }, 'ghost sm')));
  for (let i = 0; i < 5; i++) {
    const d = T.addDays(calWeek, i), list = newsOn(d);
    el.append(h('div', { class: 'card', style: d === day ? { borderColor: 'var(--gold)' } : null }, h('div', { class: 'label', style: { marginBottom: '8px' } }, new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })),
      list.length ? table([{ label: 'Time (NY)', get: (n) => n.time || '—' }, { label: 'Event', get: (n) => n.event }, { label: 'Impact', get: (n) => badge(n.impact || 'High', n.impact === 'Medium' ? '' : 'red') },
        { label: '', get: (n) => (n.auto ? h('span', { class: 'mut' }, 'Weekly') : confirmBtn('Remove', async () => { await db.remove('news', n.id); ctx.refresh(); })) }], list) : empty('Nothing saved.')));
  }
  el.append(h('p', { class: 'ital' }, 'CPI, PPI, FOMC, NFP, PCE, GDP and Retail Sales dates move every month. Confirm them on an economic calendar and add them here. Jobless Claims shows every Thursday at 8:30 on its own.'));
}

// ---------------- Prop Firm Rules ----------------
function rules(el, ctx) {
  el.append(h('div', { class: 'banner info' }, "Rules change. Confirm on the firm's site before you rely on these."));
  el.append(card(null, editTable([
    { key: 'firm', label: 'Firm', options: T.FIRMS }, { key: 'plan', label: 'Plan name', width: '110px' }, { key: 'size', label: 'Account size', type: 'number' }, { key: 'profit_target', label: 'Profit target', type: 'number' },
    { key: 'max_drawdown', label: 'Max drawdown', type: 'number' }, { key: 'drawdown_type', label: 'Drawdown type', options: T.DD_TYPES }, { key: 'daily_loss_limit', label: 'Daily loss limit', type: 'number' },
    { key: 'consistency', label: 'Consistency %', type: 'number', width: '70px' }, { key: 'min_days', label: 'Min days', type: 'number', width: '60px' }, { key: 'notes', label: 'Notes', width: '180px' },
  ], db.doc('rules', DEFAULT_RULES), async (rows) => { await db.setDoc('rules', rows); ctx.refresh(); }, { blankRow: { firm: '', size: null } })));
  el.append(h('p', { class: 'ital' }, 'The numbers start blank on purpose. Fill in the plans you actually run and the Prop Firm Tracker will pre-fill new accounts from this table.'));
}

// ---------------- Prop Firm Deals ----------------
function deals(el, ctx) {
  const list = (db.doc('deals', DEFAULT_DEALS) || []).map((d) => ({ ...d }));
  el.append(h('div', { class: 'banner info' }, 'Disclosure: these are affiliate links. Timmy is paid by the firm when you use code TIMMY. Compare the rules on the Prop Firm Rules page before you buy anything.'));
  const grid = h('div', { class: 'grid2 mb' });
  for (const d of list) {
    const inp = h('input', { type: 'url', placeholder: 'Paste the link', value: d.url || '', oninput: (e) => { d.url = e.target.value.trim(); } });
    grid.append(h('div', { class: 'card' }, h('h2', null, d.firm), h('p', { class: 'gold' }, 'Use code TIMMY'), inp,
      /^https:\/\//.test(d.url || '') ? h('p', { style: { marginTop: '10px' } }, h('a', { href: d.url, target: '_blank', rel: 'noopener sponsored' }, 'Open ' + d.firm)) : null));
  }
  el.append(grid, btn('Save links', guard(async () => { await db.setDoc('deals', list); toast('Links saved'); ctx.refresh(); })));
}

// ---------------- Trader Tax Guide ----------------
function tax(el, ctx) {
  const notes = [
    ['Payouts are usually 1099 income', 'In the US, prop firm payouts are generally reported as contractor income, not capital gains. Your situation may differ.'],
    ['Keep every payout record', 'Save the confirmation for each payout the day it lands. Log it in the table below.'],
    ['Track eval fees as an expense line', 'Evaluation and reset fees add up. Keep the receipts in one place.'],
    ['Consider a separate bank account', 'Running payouts and fees through one account makes the year-end work far shorter.'],
    ['Talk to a tax professional', 'Preferably one who has worked with traders or contractors before.'],
  ];
  el.append(card(null, notes.map(([t, b]) => h('div', { style: { marginBottom: '14px' } }, h('h3', null, t), h('p', { class: 'mut', style: { margin: '4px 0 0' } }, b)))));
  const rows = db.doc('payouts', []) || [];
  const total = T.sum(rows, (p) => (+p.amount || 0) - (+p.fee || 0));
  el.append(card('Payout log', h('p', { class: 'mut' }, 'Net logged so far: ' + money(total)), editTable([
    { key: 'date', label: 'Date', type: 'date' }, { key: 'firm', label: 'Firm', options: T.FIRMS }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'fee', label: 'Fee', type: 'number' },
  ], rows, async (r) => { await db.setDoc('payouts', r); ctx.refresh(); }, { addLabel: 'Add payout', blankRow: { date: T.today() } })));
  el.append(h('p', { class: 'ital' }, 'General information, not tax advice.'));
}

export default [
  { slug: 'specs', title: 'Futures Specs', desc: 'Tick and point values for the contracts you trade. The Journal and Risk Calculator use the same numbers.', render: specs },
  { slug: 'market-calendar', title: 'Market Calendar', desc: 'Red-folder news for the week. Events show on the Today page and in Premarket Prep.', render: marketCalendar },
  { slug: 'rules', title: 'Prop Firm Rules', desc: 'Your reference table of firm rules. The Prop Firm Tracker pre-fills new accounts from it.', render: rules },
  { slug: 'deals', title: 'Prop Firm Deals', desc: 'The firms Timmy is partnered with, and the code to use.', render: deals },
  { slug: 'tax', title: 'Trader Tax Guide', desc: 'Plain-language basics and a payout log, so the year-end is not a scramble.', render: tax },
];
