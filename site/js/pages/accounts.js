import { h, btn, card, empty, form, table, money, moneyEl, num, fmtDate, stat, badge, guard, toast, drawer, confirmBtn, progress, lineChart } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import * as A from '../actions.js';
import { DEFAULT_RULES } from '../defaults.js';

const { S } = db;

const accountDefs = (editing) => [
  { key: 'name', label: 'Name', placeholder: 'Lucid 50K Flex #2' },
  { key: 'firm', label: 'Firm', type: 'select', options: T.FIRMS },
  { key: 'account_size', label: 'Account size', type: 'number' },
  { key: 'stage', label: 'Stage', type: 'select', options: ['Evaluation', 'Funded'], blank: false },
  { key: 'start_date', label: 'Start date', type: 'date' },
  { key: 'starting_balance', label: 'Starting balance', type: 'number' },
  { key: 'profit_target', label: 'Profit target ($)', type: 'number' },
  { key: 'max_drawdown', label: 'Max drawdown ($)', type: 'number' },
  { key: 'drawdown_type', label: 'Drawdown type', type: 'select', options: T.DD_TYPES, blank: false },
  { key: 'daily_loss_limit', label: 'Daily loss limit ($, optional)', type: 'number' },
  { key: 'consistency_rule_pct', label: 'Consistency rule (%, optional)', type: 'number' },
  { key: 'min_trading_days', label: 'Minimum trading days', type: 'number' },
  ...(editing ? [{ key: 'adjustment', label: 'Balance adjustment ($)', type: 'number', placeholder: 'Fees, payouts, resets' }] : []),
  { key: 'status_notes', label: 'Notes', type: 'textarea', span: 3 },
];

function accountDrawer(acc, ctx) {
  drawer(acc ? 'Edit account' : 'Add account', (body, close) => {
    const rules = db.doc('rules', DEFAULT_RULES);
    const f = form(accountDefs(!!acc), acc || { stage: 'Evaluation', drawdown_type: 'Trailing', start_date: T.today() }, (k, api) => {
      if (k !== 'firm' && k !== 'account_size') return;
      const v = api.get();
      if (v.account_size && !api.inputs.starting_balance.get()) api.set('starting_balance', v.account_size);
      const r = rules.find((x) => x.firm === v.firm && +x.size === +v.account_size);
      if (!r) return;
      const map = { profit_target: r.profit_target, max_drawdown: r.max_drawdown, drawdown_type: r.drawdown_type, daily_loss_limit: r.daily_loss_limit, consistency_rule_pct: r.consistency, min_trading_days: r.min_days };
      for (const key in map) if (map[key] != null && map[key] !== '') api.set(key, map[key]);
    });
    body.append(h('p', { class: 'ital' }, 'Rule fields pre-fill from your Prop Firm Rules table when it has numbers for that firm and size. Always confirm them on the firm site.'), f.el,
      h('div', { class: 'row', style: { marginTop: '18px' } }, btn(acc ? 'Save changes' : 'Add account', guard(async () => {
        const v = f.get();
        if (!v.name) throw new Error('Give the account a name.');
        if (!v.account_size && !v.starting_balance) throw new Error('Enter the account size.');
        v.starting_balance ??= v.account_size;
        if (acc) await db.update('accounts', acc.id, v); else await db.add('accounts', v);
        close(); toast('Account saved'); ctx.refresh();
      }))));
  });
}

// ---------------- Prop Firm Tracker ----------------
function tracker(el, ctx) {
  el.append(h('div', { class: 'mb' }, btn('Add account', () => accountDrawer(null, ctx))));
  const act = A.activeAccounts();
  if (!act.length) el.append(empty('No accounts yet. Add the evals you are running and every tool in the Lab starts working.'));
  const grid = h('div', { class: 'grid2 mb' });
  for (const a of act) {
    const s = A.statusOf(a);
    const close = (stage) => guard(async () => { await db.update('accounts', a.id, { stage, closed_date: T.today() }); toast(`Marked ${stage.toLowerCase()}`); ctx.refresh(); });
    grid.append(h('div', { class: 'card' + (s.danger_zone ? ' danger' : '') },
      h('div', { class: 'row between' }, h('span', { class: 'label' }, a.firm || 'Firm'), h('div', { class: 'row' }, badge(a.stage), s.danger_zone ? badge('Danger zone', 'red') : null, s.ready_to_pass ? badge('Ready to pass', 'green') : null, s.consistency_flag ? badge('Consistency flag', 'red') : null)),
      h('h2', { style: { margin: '8px 0 16px' } }, a.name),
      progress('Profit target', s.profit_target_progress, s.profit_target ? `${money(s.profit)} of ${money(s.profit_target)}` : 'No target set', 'green'),
      progress('Drawdown room', s.max_drawdown ? s.drawdown_room / s.max_drawdown : 0, s.max_drawdown ? `${money(s.drawdown_room)} of ${money(s.max_drawdown)}` : 'No drawdown set', s.danger_zone ? 'red' : ''),
      progress('Daily loss room today', s.daily_loss_limit ? s.daily_loss_room / s.daily_loss_limit : 0, s.daily_loss_limit ? `${money(Math.max(0, s.daily_loss_room))} of ${money(s.daily_loss_limit)}` : 'No daily limit', s.daily_limit_hit ? 'red' : ''),
      progress('Trading days', s.min_trading_days ? s.trading_days / s.min_trading_days : s.trading_days ? 1 : 0, s.min_trading_days ? `${s.trading_days} of ${s.min_trading_days}` : `${s.trading_days} completed`),
      h('div', { class: 'dl', style: { margin: '6px 0 14px' } }, h('span', { class: 'label' }, 'Balance'), h('span', null, money(s.current_balance)), h('span', { class: 'label' }, 'High-water mark'), h('span', null, money(s.high_water_mark)),
        h('span', { class: 'label' }, 'Room left'), h('span', { class: 'gold' }, money(s.drawdown_room))),
      s.daily_limit_hit ? h('p', { class: 'red' }, 'Daily loss limit hit. Stop trading this account today.') : null,
      h('div', { class: 'row' }, btn('Edit', () => accountDrawer(a, ctx), 'ghost sm'), btn('Mark passed', close('Passed'), 'ghost sm'), btn('Mark failed', close('Failed'), 'ghost sm'),
        confirmBtn('Delete', async () => { await db.remove('accounts', a.id); toast('Account and its trades deleted'); ctx.refresh(); }))));
  }
  el.append(grid);
  const hist = S.accounts.filter((a) => !A.isActive(a));
  if (hist.length) el.append(h('details', { class: 'card' }, h('summary', { class: 'label', style: { cursor: 'pointer' } }, `History (${hist.length})`), h('div', { style: { marginTop: '14px' } },
    table([{ label: 'Account', get: (a) => a.name }, { label: 'Firm', get: (a) => a.firm || '—' }, { label: 'Outcome', get: (a) => badge(a.stage, a.stage === 'Passed' ? 'green' : 'red') }, { label: 'Date', get: (a) => fmtDate(a.closed_date) },
      { label: 'Final P&L', get: (a) => moneyEl(A.statusOf(a).profit) },
      { label: '', get: (a) => btn('Reopen', guard(async () => { await db.update('accounts', a.id, { stage: 'Evaluation', closed_date: null }); ctx.refresh(); }), 'ghost sm') }], hist))));
  el.append(h('p', { class: 'ital' }, 'Trailing drawdown here follows your balance trade by trade. If your firm locks the floor at a certain point, track that in the account notes.'));
}

// ---------------- Daily Loss Guard ----------------
let stopPts = 20, guardInst = 'NQ';
function lossGuard(el, ctx) {
  const rows = A.activeAccounts().map((a) => A.statusOf(a));
  const pv = T.POINT[guardInst];
  el.append(h('p', { class: 'big' }, "If you hit the number, you're done for the day. No exceptions."));
  el.append(h('div', { class: 'row mb' },
    h('label', { class: 'fld' }, h('span', { class: 'label' }, 'Stop size (points)'), h('input', { type: 'number', value: stopPts, style: { width: '120px' }, onchange: (e) => { stopPts = Math.max(1, +e.target.value || 20); ctx.refresh(); } })),
    h('label', { class: 'fld' }, h('span', { class: 'label' }, 'Instrument'), h('select', { style: { width: '120px' }, onchange: (e) => { guardInst = e.target.value; ctx.refresh(); } }, ['NQ', 'MNQ', 'ES', 'MES'].map((i) => h('option', { value: i, selected: i === guardInst }, i))))));
  el.append(card(null, table([
    { label: 'Account', get: (s) => s.name },
    { label: 'Daily loss limit', get: (s) => money(s.daily_loss_limit) },
    { label: 'Realized P&L today', get: (s) => moneyEl(s.realized_today) },
    { label: 'Room left', get: (s) => (s.daily_loss_room == null ? '—' : money(Math.max(0, s.daily_loss_room))) },
    { label: `Max contracts, ${stopPts} pt stop`, get: (s) => {
      const room = Math.min(s.daily_loss_room ?? Infinity, s.drawdown_room ?? Infinity);
      return Number.isFinite(room) ? Math.max(0, Math.floor(room / (stopPts * pv))) : '—';
    } },
  ], rows, { rowClass: (s) => (s.daily_loss_limit && s.daily_loss_room < 0.25 * s.daily_loss_limit ? 'warn' : ''), emptyText: 'No active accounts. Add one in the Prop Firm Tracker.' })));
  el.append(h('p', { class: 'ital' }, 'Max contracts uses whichever is smaller: daily loss room or drawdown room.'));
}

// ---------------- Payout Planner ----------------
let payAcc = null;
function payouts(el, ctx) {
  const funded = S.accounts.filter((a) => a.stage === 'Funded');
  if (!funded.length) { el.append(empty('No funded accounts yet. When an eval passes, set its stage to Funded and it shows up here.')); return; }
  const day = T.today();
  const info = funded.map((a) => {
    const s = A.statusOf(a);
    const recent = Object.entries(s.days).filter(([d]) => d >= T.addDays(day, -30));
    const avg = recent.length ? T.sum(recent, ([, v]) => v) / recent.length : null;
    const gap = a.payout_threshold ? a.payout_threshold - s.profit : null;
    return { a, s, avg, gap, days_to: gap == null ? null : gap <= 0 ? 0 : avg > 0 ? Math.ceil(gap / avg) : null,
      since: a.last_payout_date ? Math.round((new Date(day) - new Date(a.last_payout_date)) / 864e5) : null };
  });
  const cell = (a, key, type) => h('input', { type, value: a[key] ?? '', style: { minWidth: '120px' }, onchange: guard(async (e) => { await db.update('accounts', a.id, { [key]: e.target.value === '' ? null : type === 'number' ? +e.target.value : e.target.value }); ctx.refresh(); }) });
  el.append(card(null, table([
    { label: 'Account', get: (x) => x.a.name },
    { label: 'Payout threshold ($)', get: (x) => cell(x.a, 'payout_threshold', 'number') },
    { label: 'Profit above start', get: (x) => moneyEl(x.s.profit) },
    { label: 'Last payout', get: (x) => cell(x.a, 'last_payout_date', 'date') },
    { label: 'Days since', get: (x) => x.since ?? '—' },
    { label: 'Avg trading day (30d)', get: (x) => money(x.avg) },
    { label: 'Trading days to threshold', get: (x) => (x.gap == null ? 'Set a threshold' : x.days_to === 0 ? 'Reached' : x.days_to ?? 'Not on current average') },
  ], info)));
  payAcc = funded.some((a) => a.id === payAcc) ? payAcc : funded[0].id;
  const cur = info.find((x) => x.a.id === payAcc);
  let run = 0;
  const pts = Object.keys(cur.s.days).sort().map((d) => ({ x: d.slice(5), y: (run += cur.s.days[d]) }));
  el.append(card('Profit vs threshold',
    h('select', { style: { width: 'auto', marginBottom: '12px' }, onchange: (e) => { payAcc = e.target.value; ctx.refresh(); } }, funded.map((a) => h('option', { value: a.id, selected: a.id === payAcc }, a.name))),
    lineChart(pts, { ref: cur.a.payout_threshold ? { y: +cur.a.payout_threshold, label: 'Threshold' } : null })));
  el.append(h('p', { class: 'ital' }, 'The projection is arithmetic on your last 30 days, not a promise about the next 30.'));
}

export default [
  { slug: 'tracker', title: 'Prop Firm Tracker', desc: "Every eval you're running, in one place. Know your room before you click.", render: tracker },
  { slug: 'loss-guard', title: 'Daily Loss Guard', desc: 'Your stop-trading numbers for today, per account.', render: lossGuard },
  { slug: 'payouts', title: 'Payout Planner', desc: 'How far you are from your next payout on funded accounts.', render: payouts },
];
