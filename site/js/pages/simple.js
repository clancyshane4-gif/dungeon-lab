import { h, btn, card, empty, form, money, pct, num, stat, badge, guard, toast, progress } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import * as A from '../actions.js';
import accounts from './accounts.js';
import { tiltStatus } from './guard.js';

const { S } = db;
const tracker = accounts.find((p) => p.slug === 'tracker').render;
const isWeekday = (d) => T.dow(d) % 6 !== 0;
const prevWeekday = (d) => { do d = T.addDays(d, -1); while (!isWeekday(d)); return d; };

function streaks(day) {
  const dates = new Set(S.trades.map((t) => t.date));
  let d = dates.has(day) || !isWeekday(day) ? day : prevWeekday(day);
  if (!isWeekday(d)) d = prevWeekday(d);
  let cur = 0;
  while (dates.has(d)) { cur++; d = prevWeekday(d); }
  let best = 0;
  for (const s of dates) { let n = 0, x = s; while (dates.has(x)) { n++; x = prevWeekday(x); } best = Math.max(best, n); }
  return { cur, best };
}

function dashboard(el, ctx) {
  const p = T.nyParts(), day = p.date, sess = T.sessionAt(p.minutes);
  const name = S.mode === 'live' ? (S.user.email || '').split('@')[0] : '';
  const acts = A.activeAccounts().map((a) => A.statusOf(a));
  const today = T.stats(A.tradesIn({ date_from: day, date_to: day }));
  const week = T.stats(A.tradesIn({ date_from: T.weekStart(day), date_to: day }));
  const all = T.stats(S.trades);
  const st = streaks(day);
  const rules = db.doc('trading_plan', {}) || {};
  const days = (n) => n + (n === 1 ? ' day' : ' days');

  el.append(h('h1', null, 'Welcome back' + (name ? ', ' + name : '')),
    h('div', { class: 'row', style: { margin: '8px 0 24px' } }, h('span', { class: 'mut' }, new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })),
      badge(sess || 'Outside killzone', sess ? 'green' : '')));

  const notes = [];
  const tilt = tiltStatus(day);
  notes.push(...tilt.stop, ...tilt.warn);
  if (tilt.level === 'stop') notes.unshift("You're done for today.");
  el.append(h('div', { class: 'card' + (notes.length ? ' danger' : '') }, h('h3', null, "Today's Briefing"),
    notes.length ? notes.map((n) => h('p', { class: 'red', style: { margin: '8px 0 0' } }, n))
      : h('p', { class: 'mut', style: { margin: '8px 0 0' } }, !S.accounts.length ? 'Welcome to Dungeon Lab. Start by setting up your account in Settings.' : !S.trades.length ? 'Your account is set up. Validate your first setup, then log the trade.' : 'Every account has room. Validate before you click.')));

  el.append(h('div', { class: 'stats', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' } }, stat("Today's P&L", money(today.total_pnl)), stat('Weekly P&L', money(week.total_pnl)),
    stat('Win rate', all.win_rate == null ? '- -' : pct(all.win_rate)), stat('Current streak', days(st.cur))));

  el.append(h('div', { class: 'card', style: { borderLeft: '2px solid var(--gold)' } }, h('h3', null, 'Insights'),
    S.trades.length < 10 ? h('p', { class: 'mut', style: { margin: '8px 0 0' } }, `Log at least 10 trades to unlock insights. The Lab needs data to find your patterns. ${S.trades.length} of 10 logged.`)
      : h('div', { class: 'dl', style: { marginTop: '12px' } }, [['Best session', all.best_session], ['Worst session', all.worst_session], ['Best model', all.best_model], ['Worst model', all.worst_model],
        ['Average R', num(all.avg_r)], ['Plan-follow rate', pct(all.plan_follow_rate)], ['A+ setups taken', all.a_plus_count]].map(([k, v]) => [h('span', { class: 'label' }, k), h('span', null, v ?? '-')]))));

  const hasRules = rules.max_trades_per_day != null || rules.daily_max_loss != null || rules.max_risk_per_trade != null;
  const todays = A.tradesIn({ date_from: day, date_to: day });
  const line = (label, ok) => h('p', { style: { margin: '8px 0 0' } }, h('span', { class: ok ? 'green' : 'red' }, ok ? 'Kept' : 'Broken'), '  ', label);
  const first = acts[0];
  el.append(h('div', { class: 'grid3' },
    h('div', { class: 'card' }, h('h3', null, 'Streaks'), h('div', { class: 'label', style: { marginTop: '12px' } }, 'Journal streak'), h('div', { class: 'big', style: { margin: '4px 0' } }, days(st.cur)), h('span', { class: 'mut' }, 'Best: ' + days(st.best))),
    h('div', { class: 'card' }, h('h3', null, 'Rules Compliance'), hasRules ? [
      rules.max_trades_per_day != null ? line(`Max ${rules.max_trades_per_day} trades a day (${todays.length} today)`, todays.length <= rules.max_trades_per_day) : null,
      rules.daily_max_loss != null ? line(`Daily max loss ${money(rules.daily_max_loss)}`, today.total_pnl > -rules.daily_max_loss) : null,
      rules.max_risk_per_trade != null ? line(`Max risk ${money(rules.max_risk_per_trade)} a trade`, todays.every((t) => t.risk <= rules.max_risk_per_trade)) : null,
    ] : [h('p', { class: 'mut', style: { margin: '8px 0 12px' } }, 'Set your rules in Settings to start tracking your discipline.'), btn('Set my rules', () => ctx.go('settings'), 'ghost sm')]),
    h('div', { class: 'card' + (first && first.danger_zone ? ' danger' : '') }, h('h3', null, 'Prop Account'), first ? [
      h('p', { class: 'mut', style: { margin: '6px 0 12px' } }, first.name + (acts.length > 1 ? ` (+${acts.length - 1} more in Settings)` : '')),
      progress('Drawdown room', first.max_drawdown ? first.drawdown_room / first.max_drawdown : 0, money(first.drawdown_room), first.danger_zone ? 'red' : ''),
      progress('Profit target', first.profit_target_progress, first.profit_target ? `${money(first.profit)} of ${money(first.profit_target)}` : 'No target set', 'green'),
    ] : [h('p', { class: 'mut', style: { margin: '8px 0 12px' } }, 'Track drawdown and progress toward your profit target.'), btn('Set up your account', () => ctx.go('settings'))])));
}

function settings(el, ctx) {
  const cur = db.doc('trading_plan', {}) || {};
  const f = form([{ key: 'max_risk_per_trade', label: 'Max risk per trade ($)', type: 'number' }, { key: 'daily_max_loss', label: 'Daily max loss ($)', type: 'number' }, { key: 'max_trades_per_day', label: 'Max trades per day', type: 'number' }, { key: 'max_losses_in_row', label: 'Done after this many losses in a row', type: 'number' }, { key: 'stop_after_win', label: 'Stop for the day after a win?', type: 'yesno' }], { max_trades_per_day: 3, max_losses_in_row: 2, stop_after_win: true, ...cur });
  el.append(card('My rules', h('p', { class: 'mut' }, "Your Dashboard, Pre-Trade Check and Timmy use these. Timmy's own defaults: 3 trades max, off after a win, off after 2 losses in a row."), f.el,
    h('div', { style: { marginTop: '18px' } }, btn('Save rules', guard(async () => { await db.setDoc('trading_plan', { ...cur, ...f.get() }); toast('Rules saved'); ctx.refresh(); })))));
  el.append(h('h2', { style: { margin: '32px 0 16px' } }, 'My accounts'));
  tracker(el, ctx);
}

export default [
  { slug: 'dashboard', title: 'Dashboard', desc: '', render: dashboard, bare: true },
  { slug: 'settings', title: 'Settings', desc: 'Your rules and your prop firm accounts. Everything else in the Lab reads from here.', render: settings },
];
