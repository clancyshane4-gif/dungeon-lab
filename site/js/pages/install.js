// "Add to home screen" nudge for phones. Shown once until dismissed; never shown once the Lab is installed.
import { h, btn } from '../ui.js';

let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });

const KEY = 'dl_install_hidden';
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.matchMedia('(max-width: 860px)').matches;
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
let hidden = false;
try { hidden = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked */ }

export function installCard() {
  if (hidden || isStandalone() || !isPhone()) return null;
  const el = h('div', { class: 'card', style: { borderLeft: '2px solid var(--gold)' } });
  const hide = () => { hidden = true; try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } el.remove(); };
  el.append(h('div', { class: 'row between' }, h('h3', null, 'Put the Lab next to your chart'), btn('Hide', hide, 'ghost sm')),
    h('p', { class: 'mut', style: { margin: '8px 0 10px' } }, 'Add it to your home screen and the Pre-Trade Check is one tap away before every trade.'),
    deferred ? btn('Add to home screen', async () => { deferred.prompt(); const r = await deferred.userChoice; deferred = null; if (r.outcome === 'accepted') hide(); })
      : isIOS() ? h('p', { style: { margin: 0 } }, 'In Safari: tap the Share button, then "Add to Home Screen".')
        : h('p', { style: { margin: 0 } }, 'In Chrome: open the browser menu, then "Add to Home screen" or "Install app".'));
  return el;
}
