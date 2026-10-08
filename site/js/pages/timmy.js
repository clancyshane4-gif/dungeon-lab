// Timmy's shortcuts. A scripted helper in Timmy's voice: it understands the commands below and nothing else.
// There is no AI model behind it, so it costs nothing to run.
import { h, btn, money, num, pct } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import * as A from '../actions.js';
import { renderAI } from './aitimmy.js';

const { S } = db;
let shown = [], pending = null;
const N = '(-?\\d+(?:\\.\\d+)?)';
const HELP = 'Here is what I know:\n\nlog short NQ 2 in 20150 stop 20180 out 20090\n(add: A setup, NY AM, IFG, calm, followed plan)\n\nvalidate - run a setup through the checklist\naccounts - room on every account\nstats - your last 30 days\nreview - today, added up';
const NO_CALL = "I don't call trades, bro. Run it through validate and check it against your plan.";

function parseTrade(text, base = {}) {
  const t = { ...base };
  let s = ' ' + text.replace(/(\d),(?=\d{3})/g, '$1') + ' ';
  const take = (re) => { const m = s.match(re); if (!m) return null; s = s.replace(m[0], ' '); return m[1]; };
  if (/\b(short|sell|sold)\b/i.test(s)) t.direction = 'Short'; else if (/\b(long|buy|bought)\b/i.test(s)) t.direction = 'Long';
  const inst = (s.match(/\b(MNQ|NQ|MES|ES)\b/i) || [])[1];
  if (inst) t.instrument = inst.toUpperCase();
  const acc = S.accounts.find((a) => s.toLowerCase().includes(a.name.toLowerCase()));
  if (acc) { t.account_id = acc.id; s = s.replace(new RegExp(acc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' '); }
  const stop = take(new RegExp('\\b(?:stop|sl)\\s*(?:at|@)?\\s*' + N, 'i')); if (stop) t.stop_price = +stop;
  const out = take(new RegExp('\\b(?:out|exit|exited|tp|closed|target)\\s*(?:at|@)?\\s*' + N, 'i')); if (out) t.exit_price = +out;
  const ent = take(new RegExp('\\b(?:in|entry|entered|from|at)\\s*(?:at|@)?\\s*' + N, 'i')); if (ent) t.entry_price = +ent;
  const con = take(new RegExp(N + '\\s*(?:contracts?|cons?|lots?)\\b', 'i')) || take(/\bx\s*(\d{1,3})\b/i) || take(/\b(?:MNQ|NQ|MES|ES)\s+(\d{1,3})\b/i); if (con) t.contracts = +con;
  const g = (s.match(/(A\+|\b[ABC])\s*(?:setup|grade)\b/i) || s.match(/\bgrade\s*(A\+|[ABC])/i) || [])[1]; if (g) t.setup_grade = g.toUpperCase();
  const se = (s.match(/\b(asia|london|ny\s*am|ny\s*pm)\b/i) || [])[1];
  if (se) t.session = T.SESSIONS.find((x) => x.toLowerCase().replace(' ', '') === se.toLowerCase().replace(/\s/g, ''));
  const models = [[/judas|\bamd\b/i, 0], [/stop hunt/i, 1], [/\bifg\b/i, 2], [/\bcisd\b/i, 3], [/data wick/i, 4], [/counter/i, 5]];
  for (const [re, i] of models) if (re.test(s)) { t.model = T.MODELS[i]; break; }
  const emo = T.EMOTIONS.find((e) => new RegExp('\\b' + e + '\\b', 'i').test(s)); if (emo) t.emotion = emo;
  if (/broke (the |my )?plan|didn'?t follow|off plan/i.test(s)) t.followed_plan = false; else if (/followed (the |my )?plan|on plan/i.test(s)) t.followed_plan = true;
  if (/\byesterday\b/i.test(s)) t.date = T.addDays(T.today(), -1);
  return t;
}

const room = (a) => `Drawdown room ${money(a.drawdown_room)}${a.daily_loss_room == null ? '' : ', daily loss room ' + money(a.daily_loss_room)}.`;

async function doLog(t) {
  const need = [['direction', 'long or short'], ['contracts', 'contracts'], ['entry_price', 'entry'], ['stop_price', 'stop'], ['exit_price', 'exit']].filter(([k]) => t[k] == null).map(([, l]) => l);
  if (need.length) { pending = { type: 'log', t }; return `Almost. I still need: ${need.join(', ')}.\nSend it like: in 20150 stop 20180 out 20090`; }
  if (Math.abs(t.exit_price - t.entry_price) > 0.1 * Math.abs(t.entry_price) || Math.abs(t.stop_price - t.entry_price) > 0.1 * Math.abs(t.entry_price)) {
    pending = null;
    return `Those prices look off, bro: in ${t.entry_price}, stop ${t.stop_price}, out ${t.exit_price}. Nothing saved. Send the trade again.`;
  }
  pending = null;
  const r = await A.logTrade(t);
  const tr = r.trade;
  const tail = tr.pnl > 0 ? 'Smacked it. Base hit, clean.' : tr.pnl < 0 ? "It's whatever, it happens. Was the stop protected?" : 'Flat. No damage.';
  return `Logged. ${tr.direction} ${tr.instrument}, ${tr.contracts} ${tr.contracts === 1 ? 'contract' : 'contracts'}, ${money(tr.pnl)}, ${num(tr.r_multiple)}R on ${r.account.name}. ${tail}\n${room(r.account)}${r.warning ? '\n' + r.warning : ''}`;
}

const GROUPS = [...T.VALIDATOR, { group: 'Last one', items: [['counter', 'Is this a counter-trend trade?'], ['lrl_at_stop', 'Is stacked LRL sitting right at your stop?']] }];
function askGroup(i) {
  const g = GROUPS[i];
  return `${g.group.toUpperCase()} (${i + 1} of ${GROUPS.length})\n${g.items.map(([, q], n) => `${n + 1}. ${q}`).join('\n')}\n\nAnswer each one with y or n. Example: ${g.items.map((_, n) => (n % 2 ? 'n' : 'y')).join(' ')}`;
}
function doValidate(text) {
  if (!pending || pending.type !== 'validate') { pending = { type: 'validate', i: 0, a: {} }; return "Let's run it. Be honest, bro, this only works if it's real.\n\n" + askGroup(0); }
  const g = GROUPS[pending.i];
  const ans = (text.toLowerCase().match(/\b(yes|yeah|yep|no|nope|y|n)\b/g) || []).map((x) => x[0] === 'y');
  if (ans.length !== g.items.length) return `I need ${g.items.length} answers for this one, y or n each.\n\n` + askGroup(pending.i);
  g.items.forEach(([k], n) => { pending.a[k] = ans[n]; });
  if (++pending.i < GROUPS.length) return askGroup(pending.i);
  const a = pending.a; pending = null;
  const acts = A.activeAccounts();
  const st = acts.length === 1 ? A.statusOf(acts[0]) : null;
  const res = T.gradeSetup({ ...a, trend: a.counter ? 'Counter-trend' : 'With trend', account_ok: st ? !st.daily_limit_hit && !st.breached : null });
  return [res.line, ...res.notes, st ? `${st.name}: ${room(st)}` : null, 'That is the grade and the gaps. The call is yours.'].filter(Boolean).join('\n');
}

function accountsText() {
  const list = A.getAccountStatus('all');
  if (!list.length) return 'No accounts yet, bro. Set one up in Settings and I can track the room.';
  return list.map((a) => `${a.name} (${a.stage}): balance ${money(a.current_balance)}. ${room(a)}${a.danger_zone ? ' Danger zone.' : ''}${a.daily_limit_hit ? ' Daily limit hit, done for the day.' : ''}${a.consistency_flag ? ' Consistency flag.' : ''}`).join('\n');
}
function statsText(days) {
  const s = A.getStats({ days });
  if (!s.trade_count) return `Nothing logged in the last ${days} days. Log a trade and I have something to work with.`;
  return `Last ${days} days: ${s.trade_count} trades, ${money(s.total_pnl)}. Win rate ${pct(s.win_rate)}, average R ${num(s.avg_r)}, profit factor ${num(s.profit_factor)}.\nBest session ${s.best_session}, worst ${s.worst_session}. Best model ${s.best_model}.\nPlan-follow rate ${pct(s.plan_follow_rate)}. That last number is the one to watch.`;
}
function reviewText() {
  const d = T.today(), ts = A.tradesIn({ date_from: d, date_to: d });
  if (!ts.length) return 'No trades logged today. Sitting out is a decision too.';
  const s = T.stats(ts);
  const tilt = s.losing_streak >= 3 ? '\nThree losses in a row. Step away, bro. Only going for winning days.' : '';
  return `Today: ${ts.length} ${ts.length === 1 ? 'trade' : 'trades'}, ${money(s.total_pnl)}. Followed the plan on ${ts.filter((t) => t.followed_plan).length} of ${ts.length}.${tilt}\nWhat is the one thing you do differently tomorrow?`;
}

export async function reply(text) {
  const s = text.trim(), low = s.toLowerCase();
  try {
    if (/^(cancel|stop|nevermind|never mind)$/.test(low)) { pending = null; return 'Dropped it.'; }
    if (/which (prop )?firm|buy (another|an|a new) eval|best prop firm/.test(low)) return "Not my call, bro. Compare the firms' rules on their own sites and pick the one whose rules fit how you trade.";
    if (/where.*(going|headed)|predict|forecast|should i (buy|sell|take|long|short|enter)|will (it|nq|es|price|the market)|signal|what.*(trade|setup).*(take|today)/.test(low)) return NO_CALL;
    if (/how much (can|will|could) i make|get funded|pass (the|my) eval|payout/.test(low)) return "Timmy's payouts are Timmy's. I can't tell you what you'll make. I can show you what you've done: type stats.";
    if (/^(help|hi|hey|yo|hello|commands|\?)\b/.test(low)) { pending = null; return HELP; }
    if (/^accounts?\b/.test(low)) { pending = null; return accountsText(); }
    if (/^stats?\b/.test(low)) { pending = null; return statsText(+(low.match(/\d+/) || [30])[0] || 30); }
    if (/^review\b/.test(low)) { pending = null; return reviewText(); }
    if (/^validate\b/.test(low)) { pending = null; return doValidate(s); }
    if (pending && pending.type === 'validate') return doValidate(s);
    if (/^log\b/.test(low) || /\b(short|long|sold|bought)\b/.test(low)) return await doLog(parseTrade(s));
    if (pending && pending.type === 'log') return await doLog(parseTrade(s, pending.t));
    return "I only know a few moves, bro.\n\n" + HELP;
  } catch (e) { return e.message; }
}

function render(el, ctx) {
  if (S.profile && S.profile.ai_access) return renderAI(el, ctx);
  if (!shown.length) shown.push({ who: 'ai', text: `Yo, welcome to the Dungeon. I'm Timmy's shortcut desk.\n\n${A.activeAccounts().length ? 'Tell me what you took and I will log it.' : 'First thing: set up your account in Settings so I have something to track.'}\n\n${HELP}` });
  const log = h('div', { class: 'chat' });
  const input = h('textarea', { rows: 2, placeholder: 'log short NQ 2 in 20150 stop 20180 out 20090' });
  const draw = () => { log.replaceChildren(...shown.map((m) => h('div', { class: 'msg ' + m.who }, m.text))); log.lastElementChild?.scrollIntoView({ block: 'nearest' }); };
  const go = async (text) => {
    text = (text || '').trim();
    if (!text) return;
    input.value = '';
    shown.push({ who: 'me', text }); draw();
    shown.push({ who: 'ai', text: await reply(text) }); draw();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(input.value); } });
  el.append(h('div', { class: 'card' }, log,
    h('div', { class: 'row', style: { marginBottom: '10px' } }, ['validate', 'accounts', 'stats', 'review', 'help'].map((c) => btn(c, () => go(c), 'ghost sm'))), input,
    h('div', { class: 'row between', style: { marginTop: '10px' } }, btn('Send', () => go(input.value)), btn('Clear', () => { shown = []; pending = null; ctx.refresh(); }, 'ghost sm'))),
    h('p', { class: 'ital' }, 'Timmy here is a set of shortcuts, not an AI. He logs what you tell him and reads your own numbers back. He does not call trades, predict price, or give financial advice.'),
    S.mode === 'live' ? unlockCard(ctx) : null);
  draw();
}

function unlockCard(ctx) {
  const inp = h('input', { placeholder: 'Mentorship code', style: { maxWidth: '240px' } });
  const msg = h('span', { class: 'mut' });
  return h('div', { class: 'card', style: { marginTop: '20px' } }, h('h3', null, 'Unlock AI Timmy'),
    h('p', { class: 'mut' }, 'Mentorship clients get the full AI Timmy: a real coach in his voice who understands anything you type. Enter the code from your coach.'),
    h('div', { class: 'row' }, inp, btn('Unlock', async () => {
      try {
        if (!inp.value.trim()) return;
        await db.redeem(inp.value.trim());
        await db.loadProfile();
        if (S.profile.ai_access) { shown = []; pending = null; ctx.refresh(); } else msg.textContent = 'That code does not unlock AI Timmy. Check it with your coach.';
      } catch (e) { msg.textContent = e.message; }
    }, 'sm'), msg));
}

export default [{ slug: 'timmy', title: 'Timmy', desc: 'Log trades, check your room and run the checklist by typing. Everything he saves lands in your Journal and Dashboard.', render }];
