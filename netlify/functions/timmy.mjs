// AI Timmy, for clients who have it unlocked (mentorship buyers).
// This function is a locked-down relay:
//   1. checks the caller is signed in and has AI Timmy switched on,
//   2. counts the message against their daily cap,
//   3. sends the conversation to the AI model with Timmy's instructions and tool list.
// The tools run in the client's browser against their own data, using the same code as the Journal,
// so this function never touches trading data and the AI key never leaves the server.

const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';
const DAILY_LIMIT = +(process.env.AI_DAILY_LIMIT || 40);

const INSTRUCTIONS = `You are AI Timmy, the trading coach inside Dungeon Lab, built for members of Timmy's Dungeon who trade NQ (and MNQ) using Timmy's approach and run prop firm evaluation accounts.

VOICE: You talk like Timmy. Casual, quick, confident, a little playful. Short sentences. Use his words naturally: bro, cooked, edged (stopped out by a tick), smacked TP, dub, light bulb trade, base hit, magnet, boom, "you know what I mean," "it's so simple," "it's just liquidity and discretion." Hype when they follow their rules, chill when they lose ("it's whatever, it happens, the stop was protected"). No emoji. Plain text only, no markdown, no bullet symbols. You are never a cheerleader for a bad trade and never a hater about a good one.

TIMMY'S FRAMEWORK (how you read everything and how you teach):
1. Look left on the 4H and 1H first. HTF gaps (FVG / IFG / weekly gap / NWOG), rejection wicks, and whether price is delivering out of a gap. Neutral day = react, don't predict.
2. Draw on liquidity: Asia H/L, London H/L, previous day H/L, previous week low, weekly gap, all-time highs, 8:30 data wicks. The DOL is a magnet.
3. Low resistance liquidity (stacked highs/lows) leading into the DOL, and a 15-minute trend that agrees.
4. ES has to agree. SMT is the best confirmation. ES and NQ moving opposite with no SMT = sit out.
5. No entries on the 9:29 or 9:30 candle. Wait 1 to 2 minutes in.
6. Entry = displacement, then an IFG on the 30-second or 1-minute, or a CISD close. Models: AMD / Judas swing, Stop hunt re-entry, IFG continuation, CISD late entry, Data wick trade, Counter-trend base hit.
7. Protected stops at the swing high/low or candle body. Big stops, not 20-point stops. Break-even at the internal level or when ES sweeps.
8. Base hits. Target the obvious swing before the full DOL, cut 5 to 10 points before the rejection block. Counter-trend = 1R to 1.5R only. Securing a winning day is a valid reason to take 20 points.

WHAT YOU DO:
- Talk trading with them like a coach: explain any part of the framework, break down a trade they describe, help them think through a mistake, keep them disciplined. Teach the concepts in plain language with examples.
- Log trades: when they describe a completed trade, call log_trade. Entry, stop, exit, direction and contracts are required; ask once for anything missing, then save. Confirm in one line, Timmy style, then give the drawdown room and daily loss room the tool returns and pass on any warning.
- Grade setups: when they want a setup checked, ask about each part of the checklist in a natural way (HTF, DOL and LRL, ES, timing, entry, stop, account), then call grade_setup and report its grade, what is missing and the rule. Never say "take it" or "skip it."
- Numbers: use get_account_status, get_stats, get_trades, get_week_summary and get_my_rules whenever they ask about their accounts, performance or rules. Never do P&L or room math yourself; the tools return the real numbers.

HARD RULES:
1. You never predict where price is going, never call a trade, never say a setup will work, and never comment on live price action. If asked, say: "I don't call trades, bro. Let's run it through the checklist and check it against your plan."
2. You never promise or estimate income, payouts, funding, or passing an evaluation. Timmy's payouts are Timmy's.
3. You never recommend which prop firm to buy or whether to buy another evaluation. Tell them to compare each firm's rules on its own site.
4. You never encourage trading after a daily loss limit is hit. If a tool shows it's hit, say so and stop helping with new trades on that account for the day.
5. You only use the user's own data from the tools. You do not invent trades or numbers.
6. If they're tilted (revenge emotion logged, three losses in a row, chasing, trading in chop), say it once plainly and tell them to step away. Timmy's line: "Only going for winning days."
7. You are not a financial advisor and nothing you say is financial advice. Stay on trading, discipline and this app; politely decline anything else.
8. Keep answers under 120 words unless they ask for a full breakdown.`;

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const numb = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const acct = str('Account name, or part of it. Leave out if the user has only one account.');
const TOOLS = [
  { name: 'log_trade', description: 'Save a completed trade to the Journal. Calculates P&L, risk and R, and returns the account room after the trade.',
    input_schema: { type: 'object', required: ['direction', 'contracts', 'entry_price', 'stop_price', 'exit_price'], properties: {
      account: acct, date: str('YYYY-MM-DD, defaults to today in New York'), instrument: str('Instrument', { enum: ['NQ', 'MNQ', 'ES', 'MES', 'Other'] }),
      direction: str('Direction', { enum: ['Long', 'Short'] }), contracts: numb('Number of contracts'), entry_price: numb('Entry price'), stop_price: numb('Stop price'), exit_price: numb('Exit price'),
      setup_grade: str('Grade', { enum: ['A+', 'A', 'B', 'C'] }), session: str('Session', { enum: ['Asia', 'London', 'NY AM', 'NY PM'] }),
      model: str('Model', { enum: ['AMD / Judas swing', 'Stop hunt re-entry', 'IFG continuation', 'CISD late entry', 'Data wick trade', 'Counter-trend base hit', 'Other'] }),
      emotion: str('Emotion', { enum: ['Calm', 'Confident', 'Anxious', 'Frustrated', 'Revenge', 'Bored'] }), followed_plan: bool('Did they follow their plan'), notes: str('Any notes') } } },
  { name: 'get_account_status', description: 'Balance, drawdown room, daily loss room, days and flags for one account or all active accounts.',
    input_schema: { type: 'object', properties: { account: str('Account name, or "all"') } } },
  { name: 'get_trades', description: 'Logged trades, newest first (up to 60).',
    input_schema: { type: 'object', properties: { account: acct, date_from: str('YYYY-MM-DD'), date_to: str('YYYY-MM-DD') } } },
  { name: 'get_stats', description: 'Win rate, average R, profit factor, P&L by session and model, plan-follow rate.',
    input_schema: { type: 'object', properties: { account: acct, days: numb('Look-back in days, default 30'), date_from: str('YYYY-MM-DD'), date_to: str('YYYY-MM-DD') } } },
  { name: 'get_week_summary', description: "This week's numbers (Monday to Sunday).",
    input_schema: { type: 'object', properties: { week_start: str('Monday, YYYY-MM-DD. Defaults to this week.') } } },
  { name: 'get_my_rules', description: "The user's own rules from Settings: max risk per trade, daily max loss, max trades per day.", input_schema: { type: 'object', properties: {} } },
  { name: 'grade_setup', description: "Grade a setup against Timmy's checklist. Returns the grade, what is missing and the matching rule. It does not predict anything.",
    input_schema: { type: 'object', properties: {
      htf_left: bool('Looked left on the 4H and 1H'), htf_gap: bool('Delivering out of or reacting off an HTF gap'), rejection: bool('Rejection wick or rejected level'),
      trend: str('15-minute trend', { enum: ['With trend', 'Neutral, reacting', 'Counter-trend'] }), dol: bool('Clear draw on liquidity'), lrl: bool('Low resistance liquidity leading in'),
      base_target: bool('Target is the obvious swing, not the full DOL'), es_looked: bool('Checked ES'), smt: bool('SMT with ES'), es_same: bool('ES delivering the same direction'),
      past_open: bool('At least 1 to 2 minutes past 9:30'), displacing: bool('Price is displacing, not chopping'), no_news: bool('No red-folder news in the next 5 minutes'),
      displacement_candle: bool('Clear displacement candle'), ifg_cisd: bool('IFG on the 30-second or 1-minute, or a CISD close'), model: str('Entry model'),
      protected_stop: bool('Stop at the protected swing or candle body'), be_level: bool('Clear break-even level'), lrl_at_stop: bool('Stacked LRL sitting at the stop'),
      secure_day: bool('Just securing a winning day'), account: acct } } },
];

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const { SUPABASE_URL, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ANTHROPIC_API_KEY) return json(503, { error: 'AI Timmy is not set up yet.' });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Sign in again.' });
  const sb = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: sb });
  if (!who.ok) return json(401, { error: 'Sign in again.' });
  const user = await who.json();
  const prof = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=has_access,ai_access&id=eq.${encodeURIComponent(user.id)}`, { headers: sb });
  const rows = prof.ok ? await prof.json() : [];
  if (!rows[0] || !rows[0].has_access || !rows[0].ai_access) return json(403, { error: 'AI Timmy is not switched on for this account.' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Bad request' }); }
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length || messages.length > 60 || JSON.stringify(messages).length > 120000) return json(400, { error: 'This chat got too long. Start a new chat.' });
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return json(400, { error: 'Bad request' });

  // Only messages the client typed count toward the cap, not the tool results sent back mid-answer.
  if (typeof last.content === 'string') {
    if (last.content.length > 4000) return json(400, { error: 'That message is too long.' });
    const bump = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bump_ai_usage`, { method: 'POST', headers: sb, body: '{}' });
    const used = bump.ok ? await bump.json() : null;
    if (used == null) return json(500, { error: 'Could not check usage. Try again.' });
    if (used > DAILY_LIMIT) return json(429, { error: `That's the daily limit of ${DAILY_LIMIT} messages, bro. I reset at midnight New York time.` });
  }

  const now = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' }).format(new Date());
  const ai = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 900,
      system: [{ type: 'text', text: INSTRUCTIONS, cache_control: { type: 'ephemeral' } }, { type: 'text', text: `It is ${now} in New York.` }],
      tools: TOOLS, messages,
    }),
  });
  if (!ai.ok) {
    console.error('AI error', ai.status, (await ai.text()).slice(0, 500));
    return json(502, { error: "I'm having trouble thinking right now. Give it a minute and try again." });
  }
  const out = await ai.json();
  return json(200, { content: out.content, stop_reason: out.stop_reason });
};
export const config = { path: '/api/timmy' };
