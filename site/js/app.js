import { h, btn, guard, toast, form } from './ui.js';
import * as db from './db.js';
import core from './pages/core.js';
import tools from './pages/tools.js';
import simple from './pages/simple.js';
import guardPages from './pages/guard.js';
import timmy from './pages/timmy.js';

const { S } = db;
// The simple layout: six pages. The other tools are still in the code and can be switched back on here.
const pick = (list, slug, title) => ({ ...list.find((p) => p.slug === slug), title });
const PAGES = Object.fromEntries([simple[0], timmy[0], pick(tools, 'validator', 'Trade Validator'), pick(core, 'journal', 'Trading Journal'),
  guardPages[0], simple[1]].map((p) => [p.slug, p]));
const NAV = Object.keys(PAGES);
const ALIAS = { 'risk-calc': 'pre-trade', tracker: 'settings', plan: 'settings', today: 'dashboard', lessons: 'journal' };
const app = document.getElementById('app');
const slugNow = () => { const s = location.hash.slice(2); const a = ALIAS[s] || s; return PAGES[a] ? a : 'dashboard'; };
const go = (slug) => { slug = ALIAS[slug] || slug; if (slugNow() === slug) render(); else location.hash = '#/' + slug; };

function render() {
  const slug = slugNow();
  const page = PAGES[slug];
  document.title = page.title + ' · Dungeon Lab';
  const side = h('nav', { class: 'side' },
    h('div', { class: 'brand' }, h('b', null, 'DUNGEON LAB'), h('span', { class: 'label' }, "Timmy's Dungeon")),
    h('div', { style: { marginTop: '20px' } }, NAV.map((s) => h('a', { class: 'item' + (s === slug ? ' on' : ''), href: '#/' + s, style: { padding: '10px', fontSize: '14px' } }, h('i'), PAGES[s].title))),
    h('div', { class: 'out' },
      h('div', { class: 'label', style: { padding: '0 10px 8px', textTransform: 'none', letterSpacing: 0 } }, S.mode === 'live' ? S.user.email : 'Preview mode'),
      S.mode === 'live' ? h('a', { class: 'item', href: '#', onclick: (e) => { e.preventDefault(); db.signOut(); } }, h('i'), 'Sign out') : null));
  const body = h('div');
  const main = h('main', { class: 'main' }, h('div', { class: 'col' },
    S.mode !== 'live' ? h('div', { class: 'banner info noprint' }, 'Preview mode. Nothing is connected yet, so data saves in this browser only.') : null,
    h('div', { class: 'row noprint', style: { justifyContent: 'flex-end', marginBottom: '8px' } }, btn('Validate', () => go('validator'), 'sm'), btn('Pre-Trade Check', () => go('pre-trade'), 'ghost sm')),
    page.bare ? null : [h('h1', null, page.title), h('p', { class: 'desc' }, page.desc)], body,
    h('div', { class: 'foot' }, 'Dungeon Lab is a tracking tool. It does not give trade signals, predictions, or financial advice.')));
  const menu = h('button', { class: 'btn ghost sm menu', onclick: () => side.classList.toggle('open') }, 'Menu');
  app.replaceChildren(h('div', { class: 'shell' }, menu, side, main));
  try { page.render(body, { go, refresh: render }); } catch (e) { console.error(e); body.append(h('div', { class: 'banner' }, 'This page hit an error: ' + e.message)); }
  window.scrollTo(0, 0);
}

function authScreen() {
  let mode = 'in';
  const draw = () => {
    const f = form([{ key: 'email', label: 'Email', type: 'email', span: 3 }, { key: 'password', label: 'Password', type: 'password', span: 3 }]);
    const submit = guard(async () => {
      const { email, password } = f.get();
      if (!email || !password) throw new Error('Enter your email and a password.');
      if (mode === 'up') {
        if (password.length < 8) throw new Error('Use at least 8 characters for the password.');
        const signedIn = await db.signUp(email, password);
        if (!signedIn) { toast('Check your email to confirm, then sign in.'); mode = 'in'; draw(); return; }
      } else await db.signIn(email, password);
      await afterSignIn();
    });
    f.inputs.password.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(e); });
    app.replaceChildren(h('div', { class: 'auth' },
      h('div', { class: 'brand mb' }, h('h1', null, 'Dungeon Lab'), h('span', { class: 'label' }, "Timmy's Dungeon")),
      h('div', { class: 'card' }, h('h2', null, mode === 'up' ? 'Create your account' : 'Sign in'), f.el,
        h('div', { class: 'row between', style: { marginTop: '18px' } }, btn(mode === 'up' ? 'Create account' : 'Sign in', submit),
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); mode = mode === 'up' ? 'in' : 'up'; draw(); } }, mode === 'up' ? 'I already have an account' : 'Create an account')),
        mode === 'in' ? h('p', { style: { marginTop: '14px', fontSize: '12px' } }, h('a', { href: '#', onclick: guard(async (e) => {
          e.preventDefault();
          const { email } = f.get();
          if (!email) throw new Error('Type your email first.');
          await db.resetPassword(email); toast('Password reset email sent.');
        }) }, 'Forgot password')) : null),
      h('p', { class: 'foot' }, 'Dungeon Lab is a tracking tool. It does not give trade signals, predictions, or financial advice.')));
  };
  draw();
}

function codeScreen() {
  const f = form([{ key: 'code', label: 'Access code', span: 3 }]);
  app.replaceChildren(h('div', { class: 'auth' },
    h('div', { class: 'brand mb' }, h('h1', null, 'Dungeon Lab'), h('span', { class: 'label' }, "Timmy's Dungeon")),
    h('div', { class: 'card' }, h('h2', null, 'Unlock your Lab'),
      h('p', { class: 'mut' }, 'Enter the access code your coach gave you on the call. You only do this once.'), f.el,
      h('div', { class: 'row between', style: { marginTop: '18px' } },
        btn('Unlock', guard(async () => {
          const { code } = f.get();
          if (!code) throw new Error('Enter your access code.');
          if (!(await db.redeem(code))) throw new Error('That code is not valid. Check it with your coach.');
          await enter();
        })),
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); db.signOut(); } }, 'Sign out')))));
}

async function enter() {
  await db.loadAll();
  window.addEventListener('hashchange', render);
  render();
}
async function afterSignIn() {
  const p = await db.loadProfile();
  if (!p.has_access) return codeScreen();
  await enter();
}

(async () => {
  try {
    await db.init();
    if (!S.user) return authScreen();
    await afterSignIn();
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('div', { class: 'boot' }, 'Dungeon Lab could not start: ' + e.message));
  }
})();
