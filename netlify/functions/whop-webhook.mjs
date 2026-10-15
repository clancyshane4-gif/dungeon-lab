// Whop membership webhook. Whop is the only way into the Lab:
//   membership activated (paid)        -> create the member's account (if new) and switch access on
//   membership cancelled / expired     -> switch access off (the account stays, so their data is there if they come back)
// Whop signs every call (Standard Webhooks, HMAC-SHA256). Anything unsigned or stale is dropped.
// Needs: WHOP_WEBHOOK_SECRET, WHOP_API_KEY (to look up the buyer's email), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional: WHOP_PRODUCT_IDS (comma-separated prod_... ids). When set, only those products grant access.

import { createHmac, timingSafeEqual } from 'node:crypto';

const ACTIVE = new Set(['active', 'trialing', 'completed', 'past_due']);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function verify(raw, headers, secret) {
  const id = headers.get('webhook-id'), ts = headers.get('webhook-timestamp'), sig = headers.get('webhook-signature');
  if (!id || !ts || !sig || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const msg = `${id}.${ts}.${raw}`;
  // Standard Webhooks secrets are usually "<prefix>_<base64>"; some senders use the raw string. Accept either form.
  const bare = secret.replace(/^(whsec_|ws_)/, '');
  const keys = [Buffer.from(secret, 'utf8'), Buffer.from(bare, 'utf8')];
  try { keys.push(Buffer.from(bare, 'base64')); } catch { /* not base64 */ }
  const given = sig.split(' ').map((s) => s.split(',')[1]).filter(Boolean).map((s) => Buffer.from(s, 'base64'));
  for (const key of keys) {
    const mac = createHmac('sha256', key).update(msg).digest();
    if (given.some((g) => g.length === mac.length && timingSafeEqual(g, mac))) return true;
  }
  return false;
}

export function wanted(membership, productIds) {
  if (!productIds) return true;
  const allowed = productIds.split(',').map((s) => s.trim()).filter(Boolean);
  return !allowed.length || allowed.includes(membership.product_id);
}

async function memberEmail(memberId, apiKey) {
  if (!memberId) return null;
  const r = await fetch(`https://api.whop.com/api/v1/members/${encodeURIComponent(memberId)}`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Whop member lookup failed (${r.status})`);
  const m = await r.json();
  return (m.email || '').trim().toLowerCase() || null;
}

// Supabase admin helpers (service role; never shipped to the browser).
async function ensureUser(base, key, email) {
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const made = await fetch(`${base}/auth/v1/admin/users`, { method: 'POST', headers: h, body: JSON.stringify({ email, email_confirm: true }) });
  if (made.ok) return { id: (await made.json()).id, created: true };
  // Already registered: find the id without sending anything.
  const link = await fetch(`${base}/auth/v1/admin/generate_link`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'magiclink', email }) });
  if (!link.ok) throw new Error(`Supabase user lookup failed (${link.status})`);
  const d = await link.json();
  return { id: d.user?.id || d.id, created: false };
}
async function setAccess(base, key, id, email, on) {
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' };
  const r = await fetch(`${base}/rest/v1/profiles?on_conflict=id`, { method: 'POST', headers: h, body: JSON.stringify({ id, email, has_access: on, ai_access: on }) });
  if (!r.ok) throw new Error(`Supabase profile update failed (${r.status})`);
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const { WHOP_WEBHOOK_SECRET, WHOP_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHOP_PRODUCT_IDS } = process.env;
  if (!WHOP_WEBHOOK_SECRET || !WHOP_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(503, { error: 'Webhook is not set up yet.' });

  const raw = await req.text();
  if (!verify(raw, req.headers, WHOP_WEBHOOK_SECRET)) return json(401, { error: 'Bad signature' });

  let evt;
  try { evt = JSON.parse(raw); } catch { return json(400, { error: 'Bad JSON' }); }
  const m = evt.data || {};
  if (!/^membership\.(activated|updated)$/.test(evt.type || '')) return json(200, { ok: true, ignored: evt.type });
  if (!wanted(m, WHOP_PRODUCT_IDS)) return json(200, { ok: true, ignored: 'other product' });

  const on = ACTIVE.has(m.status);
  try {
    const email = await memberEmail(m.member_id, WHOP_API_KEY);
    if (!email) { console.warn('Whop membership without an email', m.id); return json(200, { ok: true, ignored: 'no email' }); }
    // Only create accounts for paid members. A cancelled membership for someone who never had an account changes nothing.
    if (!on) {
      const h = { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}`, { headers: h });
      const rows = r.ok ? await r.json() : [];
      if (!rows[0]) return json(200, { ok: true, ignored: 'no account' });
      await setAccess(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, rows[0].id, email, false);
      return json(200, { ok: true, access: false });
    }
    const u = await ensureUser(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, email);
    await setAccess(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, u.id, email, true);
    return json(200, { ok: true, access: true, created: u.created });
  } catch (e) {
    console.error('whop webhook', e.message);
    return json(500, { error: e.message }); // Whop retries on 5xx
  }
};
export const config = { path: '/api/whop' };
