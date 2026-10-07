// The one code path for reading and writing trading data.
// Every page calls these, so the numbers can never disagree.
import * as db from './db.js';
import * as T from './lib/trading.js';

const { S } = db;
export const nav = { prefill: null }; // one-shot hand-off between pages (Validator -> Journal, trade -> Lesson)

export const isActive = (a) => a.stage === 'Evaluation' || a.stage === 'Funded';
export const activeAccounts = () => S.accounts.filter(isActive);
export const accName = (id) => S.accounts.find((a) => a.id === id)?.name || 'Deleted account';
export const statusOf = (a, day) => T.accountStatus(a, S.trades, day);

export function resolveAccount(ref) {
  const act = activeAccounts();
  if (!ref) {
    if (act.length === 1) return act[0];
    throw new Error(act.length ? `Which account? Options: ${act.map((a) => a.name).join(', ')}.` : 'There are no active accounts yet. Set one up in Settings first.');
  }
  const q = String(ref).trim().toLowerCase();
  const hit = S.accounts.find((a) => a.id === ref) || S.accounts.find((a) => a.name.toLowerCase() === q);
  if (hit) return hit;
  const part = S.accounts.filter((a) => a.name.toLowerCase().includes(q));
  if (part.length === 1) return part[0];
  throw new Error(`No single account matches "${ref}". Options: ${S.accounts.map((a) => a.name).join(', ') || 'none yet'}.`);
}

function summary(a) {
  const s = statusOf(a);
  const { days, ...rest } = s;
  return rest;
}

function cleanTrade(input) {
  const need = ['direction', 'contracts', 'entry_price', 'stop_price', 'exit_price'];
  const missing = need.filter((k) => input[k] == null || input[k] === '');
  if (missing.length) throw new Error('Missing: ' + missing.map((k) => k.replace('_', ' ')).join(', ') + '.');
  const t = { ...input };
  t.instrument = t.instrument || 'NQ';
  t.direction = /^s/i.test(t.direction) ? 'Short' : 'Long';
  t.date = t.date || T.today();
  for (const k of ['contracts', 'entry_price', 'stop_price', 'exit_price']) {
    t[k] = +t[k];
    if (!Number.isFinite(t[k])) throw new Error(`${k.replace('_', ' ')} must be a number.`);
  }
  if (t.contracts <= 0) throw new Error('Contracts must be more than zero.');
  if (typeof t.followed_plan === 'string') t.followed_plan = /^(y|t)/i.test(t.followed_plan);
  return { ...t, ...T.calcTrade(t) };
}

export async function logTrade(input) {
  const a = resolveAccount(input.account_id || input.account);
  const t = cleanTrade({ ...input, account_id: a.id });
  const trade = await db.add('trades', t);
  const account = summary(a);
  return { trade, account, warning: T.roomWarning(account) || null };
}

export async function updateTrade(id, input) {
  const t = cleanTrade(input);
  const trade = await db.update('trades', id, t);
  const a = S.accounts.find((x) => x.id === trade.account_id);
  return { trade, warning: a ? T.roomWarning(statusOf(a)) || null : null };
}

export function getAccountStatus(ref) {
  const list = !ref || ref === 'all' ? activeAccounts() : [resolveAccount(ref)];
  return list.map(summary).sort((x, y) => Number(y.danger_zone) - Number(x.danger_zone));
}

export function tradesIn({ account, date_from, date_to } = {}) {
  const id = account && account !== 'all' ? resolveAccount(account).id : null;
  return S.trades
    .filter((t) => (!id || t.account_id === id) && (!date_from || t.date >= date_from) && (!date_to || t.date <= date_to))
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (x.created_at || '') < (y.created_at || '') ? 1 : -1));
}
export function getTrades(q = {}) {
  return tradesIn(q).slice(0, 60).map(({ screenshot_path, ...t }) => ({ ...t, account: accName(t.account_id) }));
}

export function getStats({ account, days, date_from, date_to } = {}) {
  const to = date_to || T.today();
  const from = date_from || (days ? T.addDays(to, -(+days)) : null);
  const { daily, equity, ...s } = T.stats(tradesIn({ account, date_from: from, date_to: to }), db.list('scorecard'), to);
  return { from, to, ...s };
}

const todaysScorecard = (date) => db.list('scorecard').some((s) => s.date === date);

export async function saveDebrief(d) {
  const date = d.date || T.today();
  const rec = await db.add('debrief', { ...d, date });
  return { saved: true, id: rec.id, needs_scorecard: !todaysScorecard(date) };
}

export async function saveScorecard(s) {
  const date = s.date || T.today();
  const clamp = (v) => Math.max(0, Math.min(10, Math.round(+v || 0)));
  const body = { date, account_id: s.account_id || (s.account ? resolveAccount(s.account).id : null),
    followed_plan_score: clamp(s.followed_plan_score), risk_discipline_score: clamp(s.risk_discipline_score),
    patience_score: clamp(s.patience_score), emotion_score: clamp(s.emotion_score), notes: s.notes || null };
  const rec = await db.add('scorecard', body);
  return { saved: true, id: rec.id, day_score: T.scoreOf(body) };
}

export async function saveLesson(l) {
  if (!l.title) throw new Error('A lesson needs a title.');
  const rec = await db.add('lesson', { date: l.date || T.today(), title: l.title, body: l.body || '', tag: l.tag || 'Execution', trade_id: l.trade_id || null });
  return { saved: true, id: rec.id };
}

export function weekSummary(week_start) {
  const from = week_start || T.weekStart(T.today());
  const to = T.addDays(from, 6);
  const s = getStats({ date_from: from, date_to: to });
  const per_account = activeAccounts().map((a) => ({ account: a.name, pnl: T.sum(tradesIn({ account: a.id, date_from: from, date_to: to }), (t) => t.pnl) }));
  return { week_start: from, week_end: to, ...s, discipline_score: T.disciplineScore(db.list('scorecard'), from, to), per_account };
}
export async function saveWeeklyReview(w) {
  const summary = weekSummary(w.week_start);
  const rec = await db.add('weekly', { week_start: summary.week_start, summary, what_worked: w.what_worked || '', what_didnt: w.what_didnt || '', next_focus: w.next_focus || '' });
  return { saved: true, id: rec.id, summary };
}

export const getTradingPlan = () => db.doc('trading_plan', null) || { note: 'The Trading Plan page has not been filled in yet.' };
export const getTodayPrep = () => db.list('prep').filter((p) => p.date === T.today()).pop() || { note: 'No Premarket Prep saved for today.' };
export const latestPrep = () => [...db.list('prep')].sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
