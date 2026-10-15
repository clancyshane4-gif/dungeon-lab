// Member profile: a display name and a picture. Stored as a small document (the picture is shrunk to 160px, a few KB),
// so it lives with the member's own data and needs no file storage.
import { h, btn, card, guard, toast } from '../ui.js';
import * as db from '../db.js';

const { S } = db;
export const profile = () => db.doc('profile', {}) || {};
export const displayName = () => (profile().name || '').trim() || (S.mode === 'live' ? (S.user.email || '').split('@')[0] : 'Preview');
export const initials = () => displayName().split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// Round avatar, or initials on a blue disc until a picture is set.
export function avatar(size = 32) {
  const p = profile();
  const st = { width: size + 'px', height: size + 'px' };
  return p.avatar
    ? h('img', { class: 'avatar', src: p.avatar, alt: '', style: st })
    : h('span', { class: 'avatar initials', style: { ...st, fontSize: Math.round(size * 0.4) + 'px' } }, initials());
}

export function shrinkAvatar(file, px = 160) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const c = document.createElement('canvas'); c.width = c.height = px;
      const s = Math.min(img.width, img.height); // centre crop to a square
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, px, px);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image.')); };
    img.src = url;
  });
}

export function profileCard(ctx) {
  const p = profile();
  let pending = p.avatar || null;
  const name = h('input', { type: 'text', maxlength: 40, placeholder: 'How Timmy should address you', value: p.name || '' });
  const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const pic = h('div');
  const drawPic = () => pic.replaceChildren(pending ? h('img', { class: 'avatar', src: pending, alt: '', style: { width: '72px', height: '72px' } }) : h('span', { class: 'avatar initials', style: { width: '72px', height: '72px', fontSize: '28px' } }, initials()));
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    try { pending = await shrinkAvatar(f); drawPic(); } catch (e) { toast(e.message, true); }
  });
  drawPic();
  return card('Your profile',
    h('div', { class: 'row', style: { gap: '16px', alignItems: 'center' } }, pic,
      h('div', { class: 'row' }, btn('Choose picture', () => file.click(), 'ghost sm'), pending ? btn('Remove', () => { pending = null; drawPic(); }, 'ghost sm') : null)),
    file,
    h('div', { class: 'fld', style: { marginTop: '14px', maxWidth: '360px' } }, h('span', { class: 'label' }, 'Display name'), name),
    h('div', { style: { marginTop: '14px' } }, btn('Save profile', guard(async () => {
      await db.setDoc('profile', { name: name.value.trim().slice(0, 40), avatar: pending });
      toast('Profile saved'); ctx.refresh();
    }))));
}
