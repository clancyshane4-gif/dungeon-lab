// Starting content for the editable reference pages. Customers can change all of it; their edits are saved to their own data.
import { MODELS } from './lib/trading.js';

const RULE_FIRMS = ['Lucid Trading', 'Tradeify', 'FundedNext', 'Apex', 'My Funded Futures', 'Alpha Futures'];
// Rule numbers are left blank on purpose. Firms change them often, so each trader confirms and fills in their own.
export const DEFAULT_RULES = RULE_FIRMS.flatMap((firm) => [25000, 50000, 100000, 150000].map((size) => ({
  firm, plan: '', size, profit_target: null, max_drawdown: null, drawdown_type: '', daily_loss_limit: null, consistency: null, min_days: null, notes: 'Fill in from the firm site',
})));

const idx = '09:30 to 16:00';
const margin = 'Set by your firm or broker';
export const DEFAULT_SPECS = [
  ['NQ', 'CME', 0.25, 5, 20, idx], ['MNQ', 'CME', 0.25, 0.5, 2, idx], ['ES', 'CME', 0.25, 12.5, 50, idx], ['MES', 'CME', 0.25, 1.25, 5, idx],
  ['YM', 'CBOT', 1, 5, 5, idx], ['MYM', 'CBOT', 1, 0.5, 0.5, idx], ['RTY', 'CME', 0.1, 5, 50, idx], ['M2K', 'CME', 0.1, 0.5, 5, idx],
  ['CL', 'NYMEX', 0.01, 10, 1000, '09:00 to 14:30'], ['MCL', 'NYMEX', 0.01, 1, 100, '09:00 to 14:30'],
  ['GC', 'COMEX', 0.1, 10, 100, '08:20 to 13:30'], ['MGC', 'COMEX', 0.1, 1, 10, '08:20 to 13:30'],
].map(([instrument, exchange, tick_size, tick_value, point_value, hours]) => ({ instrument, exchange, tick_size, tick_value, point_value, hours, margin }));

export const DEFAULT_DEALS = [
  { firm: 'Lucid Trading', url: 'https://lucidtrading.com/ref/TIMMY' },
  { firm: 'Tradeify', url: 'https://tradeify.co/?ref=TIMMY' },
  { firm: 'FundedNext', url: 'https://fundednext.com/futures?fpr=timmy' },
  { firm: 'Apex', url: '' }, { firm: 'My Funded Futures', url: '' }, { firm: 'Alpha Futures', url: '' },
];

export const DEFAULT_PLAYBOOK = [
  '1. Close the platform.',
  '2. Log the trades honestly.',
  '3. Fill the Day Debrief.',
  "4. Check every account's room in the Prop Firm Tracker.",
  '5. No new evals bought today.',
  '6. Tomorrow, size down by half for the first two trades.',
].join('\n');

export const PLAN_FIELDS = [
  ['markets', 'Markets and sessions I trade', 'NQ and MNQ. NY AM is the main session.'],
  ['models', 'My models', MODELS.slice(0, 6).join('\n')],
  ['entry', 'Entry rules', 'Displacement first, then an IFG on the 30-second or 1-minute, or a CISD close. No entries on the 9:29 or 9:30 candle.'],
  ['stop', 'Stop rules', 'Protected stop at the swing high/low or candle body.'],
  ['target', 'Target rules (base hit)', 'Target the obvious swing before the full draw on liquidity.'],
  ['breakeven', 'Break-even rules', 'Move to break-even at the internal level or when ES sweeps.'],
  ['stop_day', 'When I stop for the day', ''],
  ['stop_week', 'When I stop for the week', ''],
  ['sizing', 'Accounts and sizing', ''],
];
export const PLAN_NUMBERS = [
  ['max_risk_per_trade', 'Max risk per trade ($)'],
  ['daily_max_loss', 'Daily max loss ($)'],
  ['weekly_max_loss', 'Weekly max loss ($)'],
  ['max_trades_per_day', 'Max trades per day'],
];

export const NEWS_TEMPLATES = [
  ['CPI', '08:30', 'High'], ['PPI', '08:30', 'High'], ['FOMC', '14:00', 'High'], ['NFP', '08:30', 'High'],
  ['Jobless Claims', '08:30', 'Medium'], ['PCE', '08:30', 'High'], ['GDP', '08:30', 'High'], ['Retail Sales', '08:30', 'Medium'],
];

// [start minute, end minute, title, what to do]
export const DAY_BLOCKS = [
  [20 * 60, 24 * 60, 'Asia session, 8:00pm to midnight', 'Mark the Asia high and low. You are not trading it, you are collecting levels.'],
  [120, 300, 'London killzone, 2:00am to 5:00am', 'Mark the London high and low. Note which side of Asia got taken.'],
  [480, 510, 'Premarket, 8:00am', 'Fill in Premarket Prep. Look left on the 4H and 1H, find the draw on liquidity.'],
  [510, 570, '8:30am news check', 'If there is red-folder news, mark the data wick high and low. Do not trade into the release.'],
  [570, 572, '9:30am open', 'No entries for the first 1 to 2 minutes. Not the 9:29 candle, not the 9:30 candle.'],
  [572, 660, 'NY AM session, 9:30am to 11:00am', 'This is the session. Displacement, IFG or CISD, protected stop, base hit. Check ES every time.'],
  [660, 810, 'Lunch, 11:00am to 1:30pm', 'No trading. Log what you took this morning.'],
  [810, 960, 'NY PM session, 1:30pm to 4:00pm', 'Only if the morning plan is still valid and the account has room. A winning day is already a good day.'],
  [960, 1020, 'Close and debrief, 4:00pm', 'Fill the Day Debrief and the Daily Scorecard. Two minutes.'],
];
