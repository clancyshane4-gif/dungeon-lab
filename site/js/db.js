// Data layer. Two backends behind one API:
//   - Supabase (production): logins, one private data set per customer, enforced by row-level security.
//   - Local preview: used only when the site has no Supabase settings yet. Data stays in this browser.
// Everything is loaded once after sign-in and kept in S, so pages can read synchronously.

export const S = { mode: 'preview', user: null, profile: null, accounts: [], trades: [], rec: {} };

const ACC = ['name', 'firm', 'account_size', 'stage', 'start_date', 'profit_target', 'max_drawdown', 'drawdown_type', 'daily_loss_limit',
  'consistency_rule_pct', 'min_trading_days', 'starting_balance', 'adjustment', 'payout_threshold', 'last_payout_date', 'status_notes', 'closed_date'];
const TRD = ['account_id', 'date', 'instrument', 'point_value', 'direction', 'contracts', 'entry_price', 'stop_price', 'exit_price', 'pnl', 'risk',
  'r_multiple', 'setup_grade', 'session', 'model', 'emotion', 'followed_plan', 'notes', 'screenshot_path'];
const COLS = { accounts: ACC, trades: TRD };
const pick = (o, keys) => { const r = {}; for (const k of keys) if (k in o) r[k] = o[k] === '' ? null : o[k]; return r; };

let sb = null;
const LS = 'dungeon_lab_preview';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export async function init() {
  let cfg = null;
  try { const r = await fetch('/api/config'); if (r.ok) cfg = await r.json(); } catch { /* preview */ }
  if (cfg && cfg.url && cfg.anonKey && window.supabase) {
    sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    S.mode = 'live';
    const { data } = await sb.auth.getSession();
    S.user = data.session ? data.session.user : null;
  } else {
    S.mode = 'preview';
    S.user = { id: 'preview', email: 'preview' };
    S.profile = { has_access: true };
  }
}

// ---------- Auth (live only) ----------
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  S.user = data.user;
}
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  if (!data.session) return false; // email confirmation is switched on in Supabase
  S.user = data.user;
  return true;
}
export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  if (error) throw new Error(error.message);
}
export async function signOut() { if (sb) await sb.auth.signOut(); S.user = null; location.hash = ''; location.reload(); }
export async function token() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session?.access_token || null; }
export async function loadProfile() {
  if (S.mode !== 'live') return S.profile;
  const rows = ok(await sb.from('profiles').select('*').eq('id', S.user.id));
  S.profile = rows[0] || { has_access: false };
  return S.profile;
}
export async function redeem(code) {
  const good = ok(await sb.rpc('redeem_code', { p_code: code }));
  if (good) S.profile = { ...(S.profile || {}), has_access: true };
  return !!good;
}

// ---------- Load ----------
async function all(tableName, order) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = ok(await sb.from(tableName).select('*').order(order, { ascending: true }).range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
export async function loadAll() {
  S.rec = {};
  let recs;
  if (S.mode === 'live') {
    [S.accounts, S.trades, recs] = await Promise.all([all('accounts', 'created_at'), all('trades', 'created_at'), all('records', 'created_at')]);
    recs = recs.map((r) => ({ kind: r.kind, id: r.id, created_at: r.created_at, ...r.data }));
  } else {
    const d = JSON.parse(localStorage.getItem(LS) || '{}');
    S.accounts = d.accounts || []; S.trades = d.trades || []; recs = d.records || [];
  }
  for (const r of recs) (S.rec[r.kind] ??= []).push(r);
}
function persistLocal() {
  const records = Object.values(S.rec).flat();
  localStorage.setItem(LS, JSON.stringify({ accounts: S.accounts, trades: S.trades, records }));
}

// ---------- CRUD ----------
// kind is 'accounts', 'trades', or any record kind (scorecard, lesson, prep, debrief, weekly, payout, news, doc).
export const list = (kind) => (kind === 'accounts' ? S.accounts : kind === 'trades' ? S.trades : S.rec[kind] || []);

export async function add(kind, obj) {
  let row;
  if (COLS[kind]) {
    const body = pick(obj, COLS[kind]);
    row = S.mode === 'live' ? ok(await sb.from(kind).insert(body).select().single()) : { id: uid(), created_at: new Date().toISOString(), ...body };
    S[kind].push(row);
  } else {
    const { id: _i, kind: _k, created_at: _c, ...data } = obj;
    if (S.mode === 'live') {
      const r = ok(await sb.from('records').insert({ kind, data }).select().single());
      row = { kind, id: r.id, created_at: r.created_at, ...r.data };
    } else row = { kind, id: uid(), created_at: new Date().toISOString(), ...data };
    (S.rec[kind] ??= []).push(row);
  }
  if (S.mode !== 'live') persistLocal();
  return row;
}

export async function update(kind, id, patch) {
  const arr = list(kind);
  const i = arr.findIndex((r) => r.id === id);
  if (i < 0) throw new Error('That record no longer exists.');
  if (COLS[kind]) {
    const body = pick(patch, COLS[kind]);
    arr[i] = S.mode === 'live' ? ok(await sb.from(kind).update(body).eq('id', id).select().single()) : { ...arr[i], ...body };
  } else {
    const merged = { ...arr[i], ...patch };
    const { id: _i, kind: _k, created_at: _c, ...data } = merged;
    if (S.mode === 'live') ok(await sb.from('records').update({ data }).eq('id', id).select().single());
    arr[i] = merged;
  }
  if (S.mode !== 'live') persistLocal();
  return arr[i];
}

export async function remove(kind, id) {
  if (S.mode === 'live') ok(await sb.from(COLS[kind] ? kind : 'records').delete().eq('id', id).select());
  if (kind === 'accounts') S.trades = S.trades.filter((t) => t.account_id !== id);
  const arr = list(kind);
  const i = arr.findIndex((r) => r.id === id);
  if (i >= 0) arr.splice(i, 1);
  if (S.mode !== 'live') persistLocal();
}

// ---------- Single documents (trading plan, playbook, reference tables) ----------
export function doc(key, fallback) {
  const r = (S.rec.doc || []).find((d) => d.key === key);
  return r ? r.value : fallback;
}
export async function setDoc(key, value) {
  const r = (S.rec.doc || []).find((d) => d.key === key);
  if (r) await update('doc', r.id, { value, updated: new Date().toISOString() });
  else await add('doc', { key, value, updated: new Date().toISOString() });
}
export const docUpdated = (key) => (S.rec.doc || []).find((d) => d.key === key)?.updated || null;

// ---------- Chart screenshots ----------
export async function upload(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Screenshot is over 5 MB. Use a smaller image.');
  if (S.mode !== 'live') {
    return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  }
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${S.user.id}/${uid()}.${ext}`;
  ok(await sb.storage.from('screens').upload(path, file, { contentType: file.type }));
  return path;
}
export async function fileUrl(path) {
  if (!path) return null;
  if (path.startsWith('data:')) return path;
  if (S.mode !== 'live') return null;
  const d = ok(await sb.storage.from('screens').createSignedUrl(path, 3600));
  return d.signedUrl;
}
