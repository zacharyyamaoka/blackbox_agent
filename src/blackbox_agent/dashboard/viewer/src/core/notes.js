/* A row that is a Markdown file opens as the note itself, in data-ui's Obsidian-parity viewer (viewer/CONTRACT.md §17).

   Zach, 2026-11-24: "I can also just have like plain markdown files I write"; data-ui CONTRACT §54: "A record opens as the
   note", drawn by like_obsidian_md_viewer (vendored with data-ui at like-obsidian/). The fold carries each such file's
   whole text in the row's `_note` (data-ui never makes a column of a `_` key), so nothing is fetched: the state is the one
   thing a component reads.

   WHY a host page renderer and not data-ui's own note page: data-ui's fetches `<notes.root><id>.md`, and a viewer
   component loads nothing but its state (CONTRACT §7, §9.3). This hands the same viewer the same text, in data-ui's own
   page frame (`.dv-note-page > .dv-obsidian`), so data-ui's note-page.css themes it from the host's tokens exactly as it
   themes its own. A follow-up for data-ui: let a host give a row's text (then this file shrinks to that one line).

   A note's pictures draw from the box (mediaUrl): read from the note's own folder, as GitHub reads them, and fetched from
   where `blackbox build` carries them (site/<x> is the site's <x>; any other box file is data/files/<its path>). One that
   leaves the box draws as its alt text plus "image outside the box".

   notePages(views, rows)         -> el.pageRenderer for a <data-views>: (host, {row}) => {update, destroy}
   mountNotePage(host, {text, title, path}) -> one note on its own (NOTES.md, a custom .md tab), {destroy}
   noteRows(rows)                 -> whether any row carries a note
   mediaUrl(src, {note, site})    -> {url, path, outside}: where a note's picture is served from */
import { loadNoteViewer, ensureKitCss } from './kit.js';
import { isDark, onTheme, adoptCss } from './tokens.js';

const SOURCE_KEY = 'data-ui/note-source-mode'; // data-ui's own note page remembers Source mode under this key: one choice for both
const remembered = () => { try { return localStorage.getItem(SOURCE_KEY) === '1'; } catch { return false; } };
const remember = (on) => { try { localStorage.setItem(SOURCE_KEY, on ? '1' : '0'); } catch { /* no storage: it holds for this visit */ } };
const theme = () => (isDark() ? 'dark' : 'light');
const safeUrl = (url) => (typeof url === 'string' && /^(https?|mailto):/i.test(url) ? url : null);

export const noteRows = (rows) => Array.isArray(rows) && rows.some((r) => r && typeof r._note === 'string');

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Where a note's picture is served from in the box's built site. `src` as the note writes it, read from the note's own
    folder (`note`, its path in the box; a leading / is the box's root, as on GitHub); `site` is the site's root URL.
    site/<x> is the site's own <x> (the build carries site/); any other file of the box is data/files/<its path> (the
    build carries each picture a note shows there). A web picture draws as written. {url: null, outside: true} for one
    that leaves the box (../ past its root, or a scheme the page cannot fetch: file:, chat:, a notes:// root);
    {url: null, outside: false} with no site to fetch from. */
export function mediaUrl(src, { note = '', site = null } = {}) {
  const raw = String(src ?? '').trim();
  if (/^(https?:\/\/|\/\/|data:image\/)/i.test(raw)) return { url: raw, path: null, outside: false };
  if (!raw) return { url: null, path: null, outside: false };
  if (SCHEME.test(raw)) return { url: null, path: null, outside: true };
  let p = raw.split('#')[0].split('?')[0];
  try { p = decodeURIComponent(p); } catch { /* a stray %: the name as written */ }
  const parts = [];
  for (const seg of (p.startsWith('/') ? p : `${dir(note)}/${p}`).split('/')) {
    if (seg === '..') { if (!parts.length) return { url: null, path: null, outside: true }; parts.pop(); }
    else if (seg && seg !== '.') parts.push(seg);
  }
  const path = parts.join('/');
  if (!path || !site) return { url: null, path: path || null, outside: false };
  const rel = path.startsWith('site/') ? path.slice(5) : `data/files/${path}`;
  return { url: new URL(rel.split('/').map(encodeURIComponent).join('/'), site).href, path, outside: false };
}

/** The site's root URL, from the state the component was handed (data/state.json sits one folder down), else null. */
function siteOf(el) {
  for (let n = el; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) {
    const url = n.context && n.context.stateUrl;
    if (url) return new URL('../', url).href;
  }
  return null;
}

/** Each picture the viewer draws in `root` gets its box URL (mediaUrl) before it loads; one with none becomes its alt
    text plus why. WHY after the viewer draws, not in the text it is handed: the text stays as the file is written (Source
    mode shows the file), and the viewer has no hook for a Markdown picture's URL (resolveMedia is only for ![[x.png]]).
    WHY nothing is fetched first: the viewer marks each picture lazy as it makes it, and this runs before layout (at once
    on the first draw, then a microtask after CodeMirror attaches a widget). CodeMirror's own empty widget-buffer <img>s
    are left alone. Returns the stop. */
function drawPictures(root, where) {
  const fix = (img) => {
    if (img.dataset.bbMedia || img.classList.contains('cm-widgetBuffer') || !img.hasAttribute('src')) return;
    const raw = img.getAttribute('src');
    const got = mediaUrl(raw, where);
    img.dataset.bbMedia = got.url ? 'box' : got.outside ? 'outside' : 'unresolved';
    if (got.url) { if (raw !== got.url) img.setAttribute('src', got.url); return; }
    const say = document.createElement('span');
    say.className = 'bb-note-noimg';
    say.dataset.bbMedia = img.dataset.bbMedia;
    say.title = raw;
    say.textContent = `${img.alt || raw} (${got.outside ? 'image outside the box' : 'image not in this page\'s site'})`;
    img.replaceWith(say);
  };
  const sweep = (node) => { if (node.nodeType !== 1) return; if (node.tagName === 'IMG') fix(node); else node.querySelectorAll('img').forEach(fix); };
  sweep(root);
  const mo = new MutationObserver((records) => { for (const r of records) r.addedNodes.forEach(sweep); });
  mo.observe(root, { childList: true, subtree: true });
  return () => mo.disconnect();
}

/** Obsidian's property types for the rows' own keys (data-ui note-page.js propertyTypes, read from the values): a list,
    a number, a true/false, a plain date. Only types every value fits, or Obsidian would draw a mismatch it does not show. */
export function propertyTypes(rows) {
  const out = {};
  const keys = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!k.startsWith('_')) keys.add(k);
  for (const k of keys) {
    const vs = rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined && v !== '');
    if (!vs.length) continue;
    if (vs.every(Array.isArray)) out[k] = 'multitext';
    else if (vs.every((v) => typeof v === 'number')) out[k] = 'number';
    else if (vs.every((v) => typeof v === 'boolean')) out[k] = 'checkbox';
    else if (vs.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) out[k] = 'date';
  }
  return out;
}

const yaml = (v) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(', ')}]` : typeof v === 'string' ? JSON.stringify(v) : String(v));

/** A row with no file of its own (an HTML report, a chart) as a note: its own fields as the Properties block and a line
    that opens it, so every row of a tab opens the same way. Only what the row holds; nothing is made up. */
export function rowDoc(row, { skip = ['id', 'title', 'url'] } = {}) {
  const lines = Object.entries(row).filter(([k, v]) => !k.startsWith('_') && !skip.includes(k) && v !== null && v !== undefined && v !== ''
    && (typeof v !== 'object' || Array.isArray(v))).map(([k, v]) => `${k}: ${yaml(v)}`);
  const open = row.url ? `[Open ${row.path || row.title || 'it'} ↗](${row.url})` : '';
  return `${lines.length ? `---\n${lines.join('\n')}\n---\n\n` : ''}${open}\n`;
}

function frame(host, { bar = true } = {}) {
  const page = document.createElement('div');
  page.className = 'dv-note-page bb-note-page';
  const tools = document.createElement('div');
  tools.className = 'bb-note-bar';
  const msg = document.createElement('div');
  msg.className = 'dv-note-msg';
  msg.hidden = true;
  msg.setAttribute('role', 'status');
  const view = document.createElement('div');
  view.className = 'dv-obsidian';
  view.dataset.readOnly = '';
  const box = document.createElement('div');
  box.className = 'dv-note-view';
  box.innerHTML = '<p class="dv-note-loading">Opening the note…</p>';
  view.append(box);
  if (bar) page.append(tools);
  page.append(msg, view);
  host.append(page);
  return { page, tools, msg, box };
}

/** Mount one note: the text, its title, Source mode beside it; theme kept in step with the page. `media` ({note, site}):
    where its pictures are read from (mediaUrl); without it they are handed to the viewer as written. */
async function mount(parts, { text, title, links = {}, source = remembered(), types = {}, url = null, media = null }) {
  const mod = await loadNoteViewer();
  parts.box.textContent = '';
  const view = mod.mountNote(parts.box, {
    doc: text, title: title || '', theme: theme(), readOnly: true, sourceMode: source,
    properties: { types },
    resolveLink: async (target) => ({ exists: !!(links.row && links.row(target)) }),
    openLink: (target) => { const hit = links.row && links.row(target); if (hit && links.open) links.open(hit); },
    openUrl: (u) => {
      const safe = safeUrl(u);
      if (safe) { window.open(safe, '_blank', 'noopener'); return; }
      const hit = links.path && links.path(u);
      if (hit && links.open) links.open(hit);
    },
    resolveMedia: (target) => (media ? mediaUrl(target, media).url : null), // ![[x.png]]: null draws "x.png not found."
    resolveEmbed: () => null,
  });
  const unpictures = media ? drawPictures(parts.box, media) : () => {};
  let on = !!source;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dv-btn bb-note-source';
  const label = () => {
    btn.textContent = on ? 'Live Preview' : 'Source mode';
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Draw the note as Obsidian does' : 'The file as written, its properties as YAML';
  };
  label();
  btn.addEventListener('click', () => { on = !on; remember(on); view.setSourceMode(on); label(); });
  parts.tools.replaceChildren(btn);
  if (url) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'bb-note-open';
    a.textContent = 'On GitHub ↗';
    parts.tools.append(a);
  }
  const unTheme = onTheme(() => view.setTheme(theme()));
  return { view, stop: () => { unTheme(); unpictures(); } };
}

const norm = (p) => {
  const out = [];
  for (const s of String(p).split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
};
const dir = (p) => String(p || '').split('/').slice(0, -1).join('/');

/** el.pageRenderer for a <data-views> whose rows carry `_note`: each row opens as its note; a row without one opens as
    its own fields (rowDoc). A `[[link]]` or a relative `.md` link to another row of the table opens that row. */
export function notePages(views, rows) {
  const types = propertyTypes(rows);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const pathOf = (r) => r.path || r.source || `${r.id}.md`;
  // the row's own path in the box (a notes row's path, a spec row's source), never the id guess: a picture read from the
  // wrong folder would be said to be outside the box
  const boxPath = (r) => r.path || r.source || null;
  // data-ui's table and cards draw a row's pictures as thumbnails through this host hook (set here, before the data, so
  // it wins over data-ui's own, which resolves against the page): the same rule as the opened note. One that has no URL
  // gets an empty src, which is never fetched; a row with no path in the box keeps its src as written.
  views.resolveMedia = (src, { row } = {}) => {
    const note = row && boxPath(row);
    return note ? (mediaUrl(src, { note, site: siteOf(views) }).url || '') : src;
  };
  return function renderNote(host, { row }) {
    const parts = frame(host);
    const state = { gone: false, held: null, row };
    const links = {
      row: (target) => {
        const t = String(target).split('#')[0].split('|')[0].trim().replace(/\.md$/, '');
        return byId.get(t) || rows.find((r) => String(r.name || r.id).split('/').pop() === t.split('/').pop()) || null;
      },
      path: (href) => {
        const want = norm(`${dir(pathOf(state.row))}/${String(href).split('#')[0]}`);
        return rows.find((r) => norm(pathOf(r)) === want) || null;
      },
      open: (hit) => views.openPeek && views.openPeek(String(hit.id)),
    };
    const text = typeof row._note === 'string' ? row._note : rowDoc(row);
    const media = typeof row._note === 'string' && boxPath(row) ? { note: boxPath(row), site: siteOf(views) } : null;
    mount(parts, { text, title: row.title || row.name || String(row.id), links, types, url: row.url || null, media })
      .then((held) => { if (state.gone) { held.view.destroy(); held.stop(); } else state.held = held; })
      .catch((err) => { if (!state.gone) { parts.box.textContent = ''; parts.msg.hidden = false; parts.msg.textContent = `This note could not be drawn: ${err?.message || err}`; } });
    return {
      update(next) { if (next) state.row = byId.get(String(next.id)) || next; if (state.held) state.held.view.setTheme(theme()); },
      destroy() { state.gone = true; if (state.held) { state.held.view.destroy(); state.held.stop(); } state.held = null; },
    };
  };
}

/** One note on its own, as a page (NOTES.md, a custom .md tab): inside `.data-ui` so data-ui's tokens and its note-page
    colours apply outside a <data-views>. */
export function mountNotePage(host, { text, title = '', url = null, path = null }) {
  ensureKitCss();
  const wrap = document.createElement('div');
  wrap.className = 'data-ui bb-note-solo';
  host.append(wrap);
  const parts = frame(wrap);
  const state = { gone: false, held: null };
  const done = mount(parts, { text, title, url, types: {}, media: path ? { note: path, site: siteOf(host) } : null })
    .then((held) => { if (state.gone) { held.view.destroy(); held.stop(); } else state.held = held; return held; })
    .catch((err) => { if (!state.gone) { parts.box.textContent = ''; parts.msg.hidden = false; parts.msg.textContent = `This note could not be drawn: ${err?.message || err}`; } });
  return {
    ready: done,
    destroy() { state.gone = true; if (state.held) { state.held.view.destroy(); state.held.stop(); } state.held = null; },
  };
}

/** The CSS a host adds once for the note's bar and the solo page (the rest is data-ui's note-page.css). */
export const NOTE_CSS = `
.bb-note-bar { display: flex; gap: 10px; align-items: center; justify-content: flex-end; margin: 0 0 6px; font-size: 13px; }
.bb-note-bar .bb-note-open { color: var(--bb-accent); text-decoration: none; }
.bb-note-solo { background: var(--bb-bg); border: 1px solid var(--bb-border); border-radius: calc(var(--bb-radius) + 4px); padding: 12px 16px 4px; min-width: 0; }
.bb-note-solo .dv-obsidian { min-width: 0; }
.bb-note-noimg { display: inline-block; color: var(--bb-muted); font-style: italic; font-size: .92em; padding: 2px 0; }
/* WHY: Obsidian's 32 px file margins inside a card's own padding leave a 390 px phone ~215 px of text */
@media (max-width: 640px) { .bb-note-solo { padding: 8px 4px 2px; } .bb-note-solo .md-obsidian { --file-margins: 12px; } }
`;
adoptCss('bb-note', NOTE_CSS);
