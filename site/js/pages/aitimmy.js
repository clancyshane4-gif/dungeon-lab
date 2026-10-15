// AI Timmy chat (clients with AI Timmy switched on). The model runs on the server; its tools run here,
// on the client's own data, through the same functions the Journal uses.
import { h, btn } from '../ui.js';
import * as db from '../db.js';
import * as T from '../lib/trading.js';
import * as A from '../actions.js';
import { tiltStatus } from './guard.js';

const { S } = db;
let history = [], shown = [];

const TOOLS = {
  log_trade: (i) => A.logTrade(i).then(({ trade, account, warning }) => ({ saved: true, pnl: trade.pnl, risk: trade.risk, r_multiple: trade.r_multiple, account, warning })),
  get_account_status: (i) => A.getAccountStatus(i.account),
  get_trades: (i) => A.getTrades(i),
  get_stats: (i) => A.getStats({ days: 30, ...i }),
  get_week_summary: (i) => A.weekSummary(i.week_start),
  get_tilt_status: () => { const t = tiltStatus(); return { level: t.level, stop_reasons: t.stop, warnings: t.warn, trades_today: t.trades, pnl_today: t.pnl, rules: t.rules }; },
  get_my_rules: () => { const p = db.doc('trading_plan', {}) || {}; return { max_risk_per_trade: p.max_risk_per_trade ?? null, daily_max_loss: p.daily_max_loss ?? null, max_trades_per_day: p.max_trades_per_day ?? null }; },
  grade_setup: (i) => {
    let account_ok = null;
    if (i.account || A.activeAccounts().length === 1) { const s = A.statusOf(A.resolveAccount(i.account)); account_ok = !s.daily_limit_hit && !s.breached; }
    const { grade, missing, rule, notes, line } = T.gradeSetup({ ...i, account_ok });
    return { grade, missing, rule, notes, line };
  },
};

async function ask() {
  const res = await fetch('/api/timmy', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await db.token()) }, body: JSON.stringify({ messages: history }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'AI Timmy is unavailable right now.');
  return data;
}
// A "typed" turn is what the member sent (text, or a chart screenshot plus text); tool results are not.
const typed = (m) => m.role === 'user' && (typeof m.content === 'string' || m.content.every((b) => b.type !== 'tool_result'));
function trim() {
  while (history.length > 40) {
    history.shift();
    while (history.length && !typed(history[0])) history.shift();
  }
}

// Shrink a chart screenshot in the browser so it uploads fast and costs little: longest side 1400px, JPEG.
export function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, 1400 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.82);
      resolve({ media_type: 'image/jpeg', data: dataUrl.split(',')[1], dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image. Drop in a screenshot of your chart.')); };
    img.src = url;
  });
}

export async function send(text, onUpdate, image) {
  if (image) {
    // Only the newest chart travels with the chat; older ones are replaced by a note so the request stays small.
    for (const m of history) if (typed(m) && Array.isArray(m.content)) m.content = m.content.map((b) => b.type === 'image' ? { type: 'text', text: '[chart screenshot sent earlier]' } : b);
    history.push({ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } }, { type: 'text', text }] });
  } else history.push({ role: 'user', content: text });
  shown.push({ who: 'me', text, img: image ? image.dataUrl : null }); onUpdate(); trim();
  try {
    for (let step = 0; step < 8; step++) {
      const out = await ask();
      history.push({ role: 'assistant', content: out.content });
      const said = out.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (said) { shown.push({ who: 'ai', text: said }); onUpdate(); }
      const calls = out.content.filter((b) => b.type === 'tool_use');
      if (out.stop_reason !== 'tool_use' || !calls.length) return;
      const results = [];
      for (const c of calls) {
        let result, failed = false;
        try { if (!TOOLS[c.name]) throw new Error('Unknown tool'); result = await TOOLS[c.name](c.input || {}); } catch (e) { result = { error: e.message }; failed = true; }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(result).slice(0, 12000), ...(failed ? { is_error: true } : {}) });
      }
      history.push({ role: 'user', content: results });
    }
    shown.push({ who: 'sys', text: 'That took too many steps. Ask again in a shorter message.' });
  } catch (e) {
    while (history.length && !(history[history.length - 1].role === 'assistant' && history[history.length - 1].content.every((b) => b.type !== 'tool_use'))) history.pop();
    shown.push({ who: 'sys', text: e.message });
  } finally { onUpdate(); }
}

export function renderAI(el, ctx) {
  if (!shown.length) shown.push({ who: 'ai', text: A.activeAccounts().length
    ? "Yo, welcome back to the Dungeon. I'm AI Timmy.\n\nTell me about a trade and I'll log it, run a setup through the checklist with me, or ask me anything about how I trade."
    : "Yo, welcome to the Dungeon. I'm AI Timmy.\n\nFirst thing: set up your account in Accounts & rules so I can track your room. Then tell me about a trade, run a setup through the checklist with me, or ask me anything about how I trade." });
  const log = h('div', { class: 'chat' });
  const input = h('textarea', { rows: 2, placeholder: 'Short NQ 2 contracts, in 20150, stop 20180, out 20090. Clean IFG.' });
  let busy = false, pending = null;
  const draw = () => {
    log.replaceChildren(...shown.map((m) => h('div', { class: 'msg ' + m.who }, m.img ? h('img', { class: 'chart-thumb', src: m.img, alt: 'Chart screenshot' }) : null, m.text)), busy ? h('div', { class: 'msg sys' }, 'Timmy is thinking') : '');
    log.lastElementChild?.scrollIntoView({ block: 'nearest' });
  };
  const go = async (text) => {
    text = (text || '').trim();
    if (busy) return;
    if (!text && !pending) return;
    if (!text) text = 'Here is my setup. Critique it.';
    const image = pending; pending = null; drawPending();
    busy = true; input.value = '';
    await send(text, draw, image);
    busy = false; draw();
  };
  // Chart screenshot picker. The image is shrunk in the browser; nothing is stored, it only goes to Timmy with this message.
  const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const preview = h('div', { class: 'row', style: { marginBottom: '8px' } });
  const drawPending = () => preview.replaceChildren(pending ? [h('img', { class: 'chart-thumb', src: pending.dataUrl, alt: 'Chart to send' }), h('span', { class: 'mut', style: { fontSize: '12.5px' } }, 'Chart attached. Say what you see, or just hit Send.'), btn('Remove', () => { pending = null; drawPending(); }, 'ghost sm')] : []);
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    try { pending = await shrinkImage(f); } catch (e) { shown.push({ who: 'sys', text: e.message }); draw(); return; }
    drawPending(); input.focus();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(input.value); } });
  input.addEventListener('paste', async (e) => {
    const it = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'));
    if (!it) return;
    e.preventDefault();
    try { pending = await shrinkImage(it.getAsFile()); drawPending(); } catch (err) { shown.push({ who: 'sys', text: err.message }); draw(); }
  });
  el.append(h('div', { class: 'card' }, log,
    h('div', { class: 'row', style: { marginBottom: '10px' } }, [['Check my accounts', 'How are my accounts looking?'], ['My stats', 'How have my last 30 days gone?'], ['Grade a setup', 'I want to run a setup through the checklist.'], ['Review today', "Let's review today."]].map(([l, t]) => btn(l, () => go(t), 'ghost sm')), btn('Critique my chart', () => file.click(), 'ghost sm')),
    preview, file, input,
    h('div', { class: 'row between', style: { marginTop: '10px' } }, h('div', { class: 'row' }, btn('Send', () => go(input.value)), btn('Add chart', () => file.click(), 'ghost')), btn('New chat', () => { history = []; shown = []; ctx.refresh(); }, 'ghost sm'))),
    h('p', { class: 'ital' }, 'AI Timmy coaches, logs, critiques your chart screenshots and reads your own numbers back. He does not call trades, predict price, or give financial advice. Screenshots are not stored.'));
  draw();
}
