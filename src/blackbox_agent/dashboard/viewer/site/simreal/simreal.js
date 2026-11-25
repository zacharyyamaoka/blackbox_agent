/* The Sim × Real workspace on a box's own site (viewer/CONTRACT.md §21): <bb-site-nav> on top, then the viewer's own
   template pages/site/simreal.json (one bb-simreal section) over the box's state.json. `blackbox build` ships this file at
   dashboard/viewer/site/simreal/simreal.js and the page that loads it (site/simreal/index.html beside it here) at
   simreal/index.html, when the box's site/nav.json names the dashboard; never edit the copy.

   The page's <body> names the state, relative to the page: <body data-state="../data/state.json">.
   window.__simreal = {ready, errors} is what a headless check waits on (ready = every chart of the workspace drew). */
import '../../src/components/index.js';

const TEMPLATE = new URL('../../pages/site/simreal.json', import.meta.url).href;
const STATE = new URL(document.body.dataset.state || '../data/state.json', location.href).href;
window.__simreal = { ready: false, errors: [] };

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const bar = document.querySelector('bb-site-nav');
  const view = document.querySelector('main[data-view]') || document.body.appendChild(document.createElement('main'));
  const [state, template] = await Promise.all([json(STATE), json(TEMPLATE)]);
  if (bar) bar.state = state;
  document.title = `${template.name} · ${state.box || 'Black box'}`;
  const el = document.createElement('bb-page');
  el.pageUrl = TEMPLATE;
  el.stateUrl = STATE;
  el.template = template;
  el.state = state;
  view.replaceChildren(el);
  // ready once the workspace drew every chart (or its empty state): ≤ 30 s, then ready with what drew
  for (let i = 0; i < 300 && !view.querySelector('bb-simreal[data-drew]'); i++) await new Promise((ok) => setTimeout(ok, 100));
  window.__simreal.ready = true;
}

main().catch((e) => {
  window.__simreal.errors.push(String(e && e.message || e));
  console.error(e);
  const view = document.querySelector('main[data-view]');
  if (view) view.innerHTML = `<div class="bb-error" role="alert"><b>The Sim × Real workspace could not load.</b><pre>${String(e && e.message || e).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre></div>`;
  window.__simreal.ready = true;
});
