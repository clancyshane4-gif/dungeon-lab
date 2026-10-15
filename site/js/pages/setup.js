// First-run setup. Three steps on the Dashboard until a member has an account, day rules and a first trade.
// Replaces the old "go to Settings" dead end that most new members never got past.
import { h, btn, form, badge, guard, toast } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import { DEFAULT_RULES } from '../defaults.js';

const { S } = db;
const SIZES = [25000, 50000, 100000, 150000];
const sizeLabel = (n) => `$${n / 1000}K`;

export function setupState() {
  const rules = db.doc('trading_plan', null);
  return {
    account: S.accounts.length > 0,
    rules: !!(rules && rules.max_trades_per_day != null),
    trade: S.trades.length > 0,
    dismissed: !!db.doc('setup_done', false),
  };
}
export const setupNeeded = () => { const s = setupState(); return !s.dismissed && !(s.account && s.rules && s.trade); };

export function setupCard(ctx) {
  const st = setupState();
  const step = !st.account ? 1 : !st.rules ? 2 : 3;
  const wrap = h('div', { class: 'card', style: { borderColor: 'var(--gold)' } });
  const head = (n, title, done) => h('div', { class: 'row between', style: { padding: '10px 0', borderTop: n === 1 ? 0 : '1px solid var(--line)' } },
    h('div', { class: 'row' }, h('span', { class: 'stepn' + (done ? ' done' : n === step ? ' now' : '') }, done ? '✓' : String(n)), h('b', { style: { fontWeight: 500, color: done ? 'var(--mut)' : '#E9E6DE' } }, title)),
    done ? badge('Done', 'green') : n === step ? badge('Now', 'gold') : null);

  wrap.append(h('h2', null, step === 1 ? 'Set up your Lab' : step === 2 ? 'Your day rules' : 'Your first trade'),
    h('p', { class: 'mut', style: { margin: '-6px 0 10px' } }, 'Three steps, about two minutes. Everything in the Lab reads from these.'));

  // ---- Step 1: account
  wrap.append(head(1, 'Your prop firm account', st.account));
  if (step === 1) {
    const rules = db.doc('rules', DEFAULT_RULES);
    const f = form([
      { key: 'firm', label: 'Firm', type: 'select', options: T.FIRMS, blank: false },
      { key: 'account_size', label: 'Size', type: 'select', options: SIZES.map((n) => [String(n), sizeLabel(n)]), blank: false },
      { key: 'stage', label: 'Stage', type: 'select', options: ['Evaluation', 'Funded'], blank: false },
      { key: 'max_drawdown', label: 'Max drawdown ($)', type: 'number' },
      { key: 'drawdown_type', label: 'Drawdown type', type: 'select', options: T.DD_TYPES, blank: false },
      { key: 'daily_loss_limit', label: 'Daily loss limit ($, if any)', type: 'number' },
      { key: 'profit_target', label: 'Profit target ($)', type: 'number' },
      { key: 'consistency_rule_pct', label: 'Consistency rule (%, if any)', type: 'number' },
      { key: 'starting_balance', label: 'Current balance ($)', type: 'number', placeholder: 'Leave blank if fresh' },
    ], { firm: 'Lucid Trading', account_size: '50000', stage: 'Evaluation', drawdown_type: 'EOD Trailing' }, (k, api) => {
      if (k !== 'firm' && k !== 'account_size') return;
      const v = api.get();
      const r = rules.find((x) => x.firm === v.firm && +x.size === +v.account_size);
      const map = r ? { profit_target: r.profit_target, max_drawdown: r.max_drawdown, drawdown_type: r.drawdown_type, daily_loss_limit: r.daily_loss_limit, consistency_rule_pct: r.consistency } : {};
      for (const key of ['profit_target', 'max_drawdown', 'daily_loss_limit', 'consistency_rule_pct']) api.set(key, map[key] ?? null);
      if (map.drawdown_type) api.set('drawdown_type', map.drawdown_type);
      note.textContent = r && r.max_drawdown ? `Pre-filled from the ${v.firm} ${sizeLabel(+v.account_size)} rules in the Lab. Confirm them on the firm's site.` : "No saved rules for this one yet. Type the numbers from the firm's site; you can change them any time in Accounts & rules.";
    });
    const note = h('p', { class: 'ital', style: { margin: '10px 0 0' } }, "Pre-filled from the Lucid Trading $50K rules in the Lab. Confirm them on the firm's site.");
    f.inputs.firm.input.dispatchEvent(new Event('change'));
    wrap.append(f.el, note, h('div', { style: { marginTop: '14px' } }, btn('Save account', guard(async () => {
      const v = f.get();
      if (!v.max_drawdown) throw new Error('Enter the max drawdown. It is the number the tilt guard protects.');
      const size = +v.account_size;
      await db.add('accounts', { ...v, account_size: size, starting_balance: v.starting_balance || size, name: `${v.firm.replace(' Trading', '')} ${sizeLabel(size)}`, start_date: T.today() });
      toast('Account saved'); ctx.refresh();
    }))));
  }

  // ---- Step 2: day rules
  wrap.append(head(2, 'Your day rules', st.rules));
  if (step === 2) {
    const cur = db.doc('trading_plan', {}) || {};
    const f = form([
      { key: 'max_trades_per_day', label: 'Max trades per day', type: 'number' },
      { key: 'stop_after_win', label: 'Stop for the day after a win?', type: 'yesno' },
      { key: 'max_losses_in_row', label: 'Done after this many losses in a row', type: 'number' },
      { key: 'max_risk_per_trade', label: 'Max risk per trade ($)', type: 'number' },
      { key: 'daily_max_loss', label: 'Your own daily max loss ($)', type: 'number' },
    ], { max_trades_per_day: 3, stop_after_win: true, max_losses_in_row: 2, ...cur });
    wrap.append(f.el, h('p', { class: 'ital', style: { margin: '10px 0 0' } }, 'The tilt guard, the Pre-Trade Check and Timmy all use these. Change them in Accounts & rules any time.'),
      h('div', { style: { marginTop: '14px' } }, btn('Save rules', guard(async () => {
        const v = f.get();
        if (!v.max_trades_per_day) throw new Error('Set a max number of trades per day.');
        await db.setDoc('trading_plan', { ...cur, ...v, stop_after_win: v.stop_after_win ?? true, max_losses_in_row: v.max_losses_in_row ?? 2 });
        toast('Rules saved'); ctx.refresh();
      }))));
  }

  // ---- Step 3: first trade
  wrap.append(head(3, 'Your first trade', st.trade));
  if (step === 3) {
    wrap.append(h('p', { class: 'mut', style: { margin: '8px 0 12px' } }, 'Two ways in. Import is faster: download your trade history from your platform and drop the file in.'),
      h('div', { class: 'row' }, btn('Import from my platform', () => ctx.go('journal')), btn('Log one by hand', () => ctx.go('journal'), 'ghost'), btn('Tell Timmy in chat', () => ctx.go('timmy'), 'ghost')),
      h('p', { style: { marginTop: '14px', fontSize: '12px' } }, h('a', { href: '#', onclick: guard(async (e) => { e.preventDefault(); await db.setDoc('setup_done', true); ctx.refresh(); }) }, 'No trades yet, hide this for now')));
  }
  return wrap;
}
