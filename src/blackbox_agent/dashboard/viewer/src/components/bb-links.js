/* <bb-links>: where a box's words came from (the linking round's splice; PICKS, proposals-linking/).

   view: answer     Matrix's one line on top of the Spec / Feedback tab: "3 of 4 specs trace to Zach's own words · 1 to
                    nothing yet", the objective's page one click away, each gap in plain words, each note a link.
   view: objective  Margin: the objective's page is its spec note (what it is, why, how it is calculated, how it is
                    checked), drawn as a document; each citation's words sit beside it in the margin, and "Show where"
                    opens the source under the paragraph in source-highlighter, at the exact words.
   view: node       Wiki: one page per spec, feedback note and source: Came from under the title, the note, and Linked
                    mentions at its foot (a source's: what its words became).

   Public build: a private source is its label, whose words, and the quote the box publishes, in a quiet card that opens
   nothing. Local build (`blackbox serve`): it opens at the words. A source the build could not resolve is said, never
   marked (CRITERIA F4: never a guessed mark). Links are the page's own hashes (#objective, #node=<id>) through the
   context's patterns, so Back walks them. */
import { BBElement, esc } from '../core/element.js';
import { register } from '../core/registry.js';
import { fill } from '../core/context.js';
import { marked } from '../../vendor/marked/marked.esm.js';
import schema from './bb-links.schema.js';

export const VIEWS = { answer: 'One line (Matrix)', objective: "The objective's page (Margin)", node: 'A note or source page (Wiki)' };
const STATE_WORDS = {
  located: 'opens at the words', 'not-located': 'its words are not located', broken: 'does not resolve here',
  private: 'private: opens only on its author’s machine', web: 'a public page', missing: 'not in SOURCES.md',
};
const REL_WORDS = { from_feedback: 'became this requirement', cites: 'cites it', explained_by: 'explains the objective' };

const stripFront = (md) => String(md || '').replace(/^---\n[\s\S]*?\n---\n/, '');
const sourceBy = (links, key) => (links.sources || []).find((s) => s.key === key)
  || { id: `source:${key}`, key, label: key, whose: '', quotes: [], private: true, missing: true };
const nodeBy = (links, id) => (links.nodes || []).find((n) => n.id === id);

/** The one line for a tab, its gaps, and the objective's page, or null with no slice. */
export function answerLine(links, about = 'spec') {
  if (!links || !links.answer) return null;
  const a = links.answer[about] || links.answer.spec;
  const kinds = [about === 'feedback' ? 'feedback:' : 'spec:', 'source:'];
  const gaps = (links.problems || []).filter((p) => kinds.some((k) => String(p.node || '').startsWith(k))).map((p) => p.text);
  const o = links.objective || {};
  return { text: a.text, gaps, objective: o.node ? { name: o.name, node: o.node } : null };
}

/** What can honestly be said about opening a source here. */
export function sourceState(src) {
  if (!src || src.missing) return 'missing';
  if (!src.private) return 'web';
  if (!src.local) return 'private';
  return src.local.status === 'located' ? 'located' : src.local.status === 'not-located' ? 'not-located' : 'broken';
}

/** A note's citations in reading order, each with its source and its state. */
export function citesIn(links, path) {
  return (links.cites || []).filter((c) => c.path === path)
    .sort((a, b) => a.line - b.line || Number(a.n) - Number(b.n))
    .map((c) => { const source = sourceBy(links, c.key); return { ...c, source, state: sourceState(source) }; });
}

/** Where a source opens: locally source-highlighter at the words (its link is relative to state.json), a public page
    live, a private source in a public build nowhere. */
export function openHref(src, stateUrl, { embed = false } = {}) {
  if (!src || src.missing) return null;
  if (!src.private) return src.url || (src.local && src.local.open) || null;
  if (!src.local || !src.local.open) return null;
  const u = new URL(src.local.open, stateUrl || (typeof location !== 'undefined' ? location.href : 'http://localhost/'));
  if (embed) u.searchParams.set('embed', '1');
  return u.href;
}

function noteOf(state, path) {
  const req = ((state.spec || {}).requirements || []).find((r) => r.source === path);
  if (req && req._note) return req._note;
  const fb = (state.feedback || []).find((f) => f.path === path);
  return fb ? fb._note : null;
}

/** A cited line as a reader sees it: links as their text, a citation as [n]. */
export const plainContext = (md) => String(md || '').replace(/\[([^\]]+)\]\([^)]*\)/g, (m, t) => (/SOURCES\.md#/.test(m) ? `[${t}]` : t))
  .replace(/[*_`]+/g, '');

/** Margin's model: the objective's spec note and its numbered margin notes, or null when the box names no page. */
export function marginModel(state) {
  const links = state && state.links;
  const o = links && links.objective;
  if (!o || !o.path) return null;
  const node = nodeBy(links, o.node) || { title: o.name };
  const note = noteOf(state, o.path);
  return {
    name: o.name, node: o.node, title: node.title, path: o.path, raw: note || '', body: stripFront(note),
    notes: citesIn(links, o.path).map((c) => ({ n: c.n, key: c.key, source: c.source, state: c.state, line: c.line })),
    mentions: (links.edges || []).filter((e) => e.to === o.node).map((e) => ({ node: e.from, rel: e.rel, title: (nodeBy(links, e.from) || {}).title })),
  };
}

/** Wiki's model for one node: a note's Came from and Linked mentions, or a source's mentions (what its words became). */
export function nodeModel(state, id) {
  const links = state && state.links;
  if (!links) return null;
  const src = (links.sources || []).find((s) => s.id === id);
  if (src) {
    return {
      kind: 'source', id, title: src.label, source: src, state: sourceState(src),
      mentions: (links.cites || []).filter((c) => c.key === src.key)
        .map((c) => ({ node: c.node, path: c.path, line: c.line, n: c.n, context: c.context, title: (nodeBy(links, c.node) || {}).title || c.path })),
    };
  }
  const node = nodeBy(links, id);
  if (!node || !node.path) return null;
  const raw = noteOf(state, node.path) || '';
  return {
    kind: node.kind, id, title: node.title, path: node.path, raw, body: stripFront(raw),
    cameFrom: citesIn(links, node.path),
    via: (links.edges || []).filter((e) => e.from === id && e.rel === 'from_feedback').map((e) => ({ node: e.to, title: (nodeBy(links, e.to) || {}).title })),
    mentions: (links.edges || []).filter((e) => e.to === id).map((e) => ({ node: e.from, rel: e.rel, title: (nodeBy(links, e.from) || {}).title })),
  };
}

const STYLE = `
bb-links { display: block; font-size: 14px; line-height: 1.55; }
bb-links a { color: var(--bb-accent); }
bb-links .bbl-line { margin: 0; font-size: 15px; }
bb-links .bbl-line b { font-weight: 600; }
bb-links .bbl-sub { margin: 4px 0 0; color: var(--bb-muted); font-size: 13px; }
bb-links .bbl-gaps { margin: 6px 0 0; padding-left: 18px; color: var(--bb-muted); font-size: 13px; }
bb-links .bbl-chip { display: inline-flex; gap: 6px; align-items: baseline; border: 1px solid var(--bb-border); border-radius: 999px;
  padding: 1px 9px; margin: 2px 4px 2px 0; font-size: 12.5px; text-decoration: none; color: inherit; background: var(--bb-card, transparent); }
bb-links a.bbl-chip:hover { background: var(--bb-hover); }
bb-links .bbl-chip .k { color: var(--bb-muted); font-family: var(--bb-mono); font-size: 11.5px; }
bb-links .bbl-state { font-size: 11.5px; color: var(--bb-muted); }
bb-links .bbl-state[data-state="not-located"], bb-links .bbl-state[data-state="broken"], bb-links .bbl-state[data-state="missing"] { color: var(--bb-warn); }
bb-links .bbl-kicker { color: var(--bb-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
bb-links .bbl-title { font-size: 22px; line-height: 1.3; margin: 2px 0 6px; overflow-wrap: anywhere; }
bb-links .bbl-meta { color: var(--bb-muted); font-size: 13px; margin: 0 0 14px; overflow-wrap: anywhere; }
bb-links .bbl-doc { position: relative; padding-right: 300px; max-width: 1080px; overflow-wrap: anywhere; }
bb-links .bbl-doc code { word-break: break-word; }
bb-links .bbl-doc h1 { display: none; }
bb-links .bbl-doc h2 { font-size: 16px; margin: 22px 0 6px; }
bb-links .bbl-doc blockquote { margin: 0; padding: 2px 14px; border-left: 3px solid var(--bb-border); color: var(--bb-muted); }
bb-links .bbl-doc pre { overflow-x: auto; background: var(--bb-subtle); padding: 10px 12px; border-radius: var(--bb-radius); font: 13px/1.5 var(--bb-mono); }
bb-links .bbl-doc code { font-family: var(--bb-mono); font-size: .92em; }
bb-links .bbl-doc table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; }
bb-links .bbl-doc th, bb-links .bbl-doc td { border: 1px solid var(--bb-border); padding: 3px 7px; }
bb-links sup.bbl-cite > button { font: 600 11px var(--bb-font); color: var(--bb-accent); background: none; border: 0; padding: 0 1px; cursor: pointer; }
bb-links .bbl-side { float: right; clear: right; width: 268px; margin: 2px -300px 10px 0; padding: 8px 10px; box-sizing: border-box;
  border-left: 2px solid var(--bb-border); font-size: 12.5px; line-height: 1.45; text-align: left; font-style: normal; color: var(--bb-fg); }
bb-links .bbl-side.on { border-left-color: var(--bb-accent); background: var(--bb-subtle); }
bb-links .bbl-side .n { font-weight: 700; color: var(--bb-accent); margin-right: 4px; }
bb-links .bbl-side q, bb-links .bbl-card q { display: block; margin: 4px 0; color: var(--bb-fg); font-style: italic; }
bb-links .bbl-side .acts { margin-top: 4px; display: flex; gap: 10px; flex-wrap: wrap; }
bb-links .bbl-side button.show { font: inherit; color: var(--bb-accent); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
bb-links .bbl-peek { margin: 8px 0 14px; border: 1px solid var(--bb-border); border-radius: var(--bb-radius); overflow: hidden; }
bb-links .bbl-peek-head { display: flex; justify-content: space-between; gap: 8px; padding: 6px 10px; background: var(--bb-subtle); font-size: 12.5px; }
bb-links .bbl-peek-head button { font: inherit; background: none; border: 0; cursor: pointer; color: var(--bb-muted); }
bb-links iframe.bbl-frame { display: block; width: 100%; height: 360px; border: 0; background: var(--bb-bg); }
bb-links .bbl-card { border: 1px dashed var(--bb-border); border-radius: var(--bb-radius); padding: 10px 12px; color: var(--bb-muted); font-size: 13px; max-width: 760px; }
bb-links .bbl-card b { color: var(--bb-fg); }
bb-links .bbl-sec { margin: 18px 0 0; font-size: 13px; color: var(--bb-muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
bb-links ul.bbl-mentions { margin: 6px 0 0; padding-left: 18px; }
bb-links ul.bbl-mentions li { margin: 3px 0; }
bb-links ul.bbl-mentions .ctx { color: var(--bb-muted); font-size: 13px; }
bb-links .bbl-tools { display: flex; gap: 12px; align-items: center; margin: 0 0 8px; font-size: 12.5px; }
bb-links .bbl-tools button { font: inherit; color: var(--bb-accent); background: none; border: 1px solid var(--bb-border); border-radius: var(--bb-radius); padding: 1px 8px; cursor: pointer; }
bb-links pre.bbl-raw { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bb-subtle); padding: 10px 12px; border-radius: var(--bb-radius); font: 12.5px/1.5 var(--bb-mono); max-width: 780px; }
@media (max-width: 1100px) {
  bb-links .bbl-doc { padding-right: 0; }
  bb-links .bbl-side { float: none; display: block; width: auto; margin: 8px 0; }
}
`;

export class BBLinks extends BBElement {
  static schema = schema;
  static css = STYLE;

  href(kind, id) {
    const links = this.context.links || {};
    if (kind === 'objective') return links.objective ? fill(links.objective, {}) : this.context.href('page', { page: 'objective' });
    return links.node ? fill(links.node, { id }) : `#node=${encodeURIComponent(id)}`;
  }

  render() {
    const links = this.data.links;
    if (!links) return this.empty();
    const v = this.settings.view;
    if (v === 'objective') return this.drawObjective();
    if (v === 'node') return this.drawNode(this.settings.id);
    return this.drawAnswer();
  }

  chip(src, n) {
    const st = sourceState(src);
    const page = this.href('node', src.id);
    const inner = `${n ? `<span class="k">[${esc(n)}]</span>` : ''}${esc(src.label)}${st === 'private' ? ' <span aria-label="private">🔒</span>' : ''}`
      + ` <span class="bbl-state" data-state="${st}">${esc(STATE_WORDS[st])}</span>`;
    return `<a class="bbl-chip" data-src="${esc(src.key)}" href="${esc(page)}">${inner}</a>`;
  }

  drawAnswer() {
    const links = this.data.links;
    const about = this.settings.about;
    const a = answerLine(links, about);
    const kind = about === 'feedback' ? 'feedback' : 'spec';
    const nodes = (links.nodes || []).filter((n) => n.kind === kind);
    const obj = a.objective
      ? ` · <a class="bbl-obj" href="${esc(this.href('objective'))}">The objective's page: <code>${esc(a.objective.name)}</code> →</a>` : '';
    const mode = links.mode === 'local'
      ? 'On this machine: every private source opens at its words.'
      : (links.sources || []).some((s) => s.private) ? 'Public build: private sources show their label and quote only.' : '';
    this.innerHTML = `<div class="bbl-answer" data-view="answer">
      <p class="bbl-line"><b>${esc(a.text)}</b>${obj}</p>
      ${nodes.length ? `<p class="bbl-sub">${nodes.map((n) => `<a class="bbl-chip" href="${esc(this.href('node', n.id))}"><span class="k">${esc(n.id.split(':')[1])}</span>${esc(n.title)}</a>`).join('')}</p>` : ''}
      ${a.gaps.length ? `<ul class="bbl-gaps">${a.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
      ${mode ? `<p class="bbl-sub">${esc(mode)}</p>` : ''}</div>`;
  }

  /** The note's markdown as HTML, each citation a numbered button (with its sidenote after it when `side`), each link
      to another note of the box routed to that note's page. */
  noteHtml(body, path, { side = false } = {}) {
    const links = this.data.links;
    const cites = citesIn(links, path);
    const wrap = document.createElement('div');
    wrap.innerHTML = marked.parse(body, { async: false, gfm: true });
    const dir = path.split('/').slice(0, -1);
    for (const a of [...wrap.querySelectorAll('a[href]')]) {
      const href = a.getAttribute('href');
      const m = href.match(/(?:^|\/)SOURCES\.md#([A-Za-z0-9_-]+)$/);
      if (m) {
        const n = a.textContent.trim();
        const c = cites.find((x) => x.key === m[1] && x.n === n) || { n, key: m[1], source: sourceBy(links, m[1]), state: 'missing' };
        const sup = document.createElement('sup');
        sup.className = 'bbl-cite';
        sup.innerHTML = `<button type="button" data-key="${esc(c.key)}" data-n="${esc(n)}" title="${esc(c.source.label)}">${esc(n)}</button>`;
        a.replaceWith(sup);
        if (side) sup.insertAdjacentHTML('afterend', this.sidenote(c));
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; continue; }
      const parts = [...dir];
      for (const seg of href.split('#')[0].split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
      const target = (links.nodes || []).find((n) => n.path === parts.join('/'));
      if (target) a.setAttribute('href', this.href('node', target.id));
      else { a.removeAttribute('href'); a.title = `${parts.join('/')} in the box's repo`; }
    }
    return wrap.innerHTML;
  }

  sidenote(c) {
    const s = c.source;
    const q = (s.quotes || [])[0];
    const open = c.state === 'located' || c.state === 'not-located'
      ? `<button type="button" class="show" data-show="${esc(s.key)}" data-n="${esc(c.n)}">Show where</button>`
      : c.state === 'web' ? `<a href="${esc(openHref(s, this.context.stateUrl))}" target="_blank" rel="noopener">Open ↗</a>` : '';
    return `<span class="bbl-side" data-side="${esc(s.key)}" data-n="${esc(c.n)}"><span class="n">${esc(c.n)}</span><b>${esc(s.label)}</b>`
      + `${s.whose ? ` · ${esc(s.whose)}` : ''}${q ? `<q>${esc(q)}</q>` : ''}`
      + (c.state === 'web' ? '' : `<span class="bbl-state" data-state="${c.state}">${esc(c.state === 'not-located' ? `${STATE_WORDS[c.state]}: ${(s.local || {}).why || ''}` : STATE_WORDS[c.state])}</span>`)
      + `<span class="acts">${open}<a href="${esc(this.href('node', s.id))}">Its page</a></span></span>`;
  }

  peek(after, src, n) {
    const shown = this.querySelector('.bbl-peek');
    if (shown) { const same = shown.dataset.src === src.key; shown.remove(); this.querySelectorAll('.bbl-side.on').forEach((x) => x.classList.remove('on')); if (same) return; }
    const st = sourceState(src);
    const box = document.createElement('div');
    box.className = 'bbl-peek';
    box.dataset.src = src.key;
    const full = openHref(src, this.context.stateUrl);
    const lines = src.local && src.local.lines ? ` · ${src.local.file || ''}, line${src.local.lines[0] === src.local.lines[1] ? '' : 's'} ${src.local.lines[0]}${src.local.lines[0] === src.local.lines[1] ? '' : `–${src.local.lines[1]}`}` : '';
    box.innerHTML = `<div class="bbl-peek-head"><span><b>${esc(n ? `${n} · ` : '')}${esc(src.label)}</b>${esc(lines)}</span>
      <span>${full ? `<a href="${esc(full)}" target="_blank" rel="noopener">Open full ↗</a> ` : ''}<button type="button" aria-label="Close">Close ✕</button></span></div>
      ${st === 'not-located' ? `<div class="bbl-card">Not located: ${esc((src.local || {}).why || '')}. Nothing is marked.</div>` : ''}
      <iframe class="bbl-frame" title="${esc(src.label)}" src="${esc(openHref(src, this.context.stateUrl, { embed: true }))}"></iframe>`;
    box.querySelector('button').addEventListener('click', () => { box.remove(); this.querySelectorAll('.bbl-side.on').forEach((x) => x.classList.remove('on')); });
    const para = after.closest('p, li, blockquote, h2, h3, table') || after;
    para.after(box);
    this.querySelectorAll('.bbl-side').forEach((x) => x.classList.toggle('on', x.dataset.side === src.key && x.dataset.n === String(n)));
  }

  wire(root) {
    const links = this.data.links;
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-show], sup.bbl-cite > button');
      if (!btn) return;
      const key = btn.dataset.show || btn.dataset.key;
      const src = sourceBy(links, key);
      const st = sourceState(src);
      if (st === 'located' || st === 'not-located') this.peek(btn, src, btn.dataset.n);
      else {
        const side = [...root.querySelectorAll('.bbl-side')].find((x) => x.dataset.side === key && x.dataset.n === btn.dataset.n);
        this.querySelectorAll('.bbl-side.on').forEach((x) => x.classList.remove('on'));
        if (side) { side.classList.add('on'); side.scrollIntoView({ block: 'nearest' }); } else location.hash = this.href('node', src.id).replace(/^#?/, '#');
      }
    });
    const raw = root.querySelector('button[data-raw]');
    if (raw) raw.addEventListener('click', () => {
      const pre = root.querySelector('pre.bbl-raw'), doc = root.querySelector('.bbl-doc');
      pre.hidden = !pre.hidden;
      doc.hidden = !pre.hidden;
      raw.textContent = pre.hidden ? 'Source mode' : 'Reading view';
    });
  }

  drawObjective() {
    const m = marginModel(this.data);
    const o = this.data.objective || {};
    if (!m) {
      return this.empty(`The objective ${o.name || ''} has no page yet. Its page is the spec note whose front matter says objective: ${o.name || '<name>'}: what it is, why, how it is calculated, with each claim cited.`);
    }
    const meta = [o.direction ? `${o.direction === 'higher' ? 'higher' : 'lower'} is better` : '', o.unit, o.ruler ? `ruler ${o.ruler}` : '', o.frozen ? `frozen ${o.frozen}` : '']
      .filter(Boolean).map(esc).join(' · ');
    const counts = m.notes.length ? `${m.notes.length} citation${m.notes.length === 1 ? '' : 's'} in the margin` : 'no citations yet';
    this.innerHTML = `<article class="bbl-objective" data-view="objective">
      <div class="bbl-kicker">The objective</div>
      <h2 class="bbl-title"><code>${esc(m.name)}</code></h2>
      <p class="bbl-meta">${meta}${meta ? ' · ' : ''}its page: ${esc(m.title)} (${esc(m.path)}) · ${esc(counts)}</p>
      <div class="bbl-tools"><button type="button" data-raw>Source mode</button><span class="bbl-state">${esc(this.data.links.mode === 'local' ? 'On this machine: each citation opens at its words.' : 'Public build: private sources show their label and quote only.')}</span></div>
      <div class="bbl-doc">${this.noteHtml(m.body, m.path, { side: true })}</div>
      <pre class="bbl-raw" hidden>${esc(m.raw)}</pre>
      ${m.mentions.filter((x) => x.node !== 'objective').length ? `<div class="bbl-sec">Linked mentions</div><ul class="bbl-mentions">${m.mentions.filter((x) => x.node !== 'objective').map((x) => `<li><a href="${esc(this.href('node', x.node))}">${esc(x.title || x.node)}</a> <span class="ctx">${esc(REL_WORDS[x.rel] || x.rel)}</span></li>`).join('')}</ul>` : ''}
    </article>`;
    this.wire(this.querySelector('article'));
  }

  drawNode(id) {
    const m = nodeModel(this.data, id);
    if (!m) return this.empty(`No page for ${id || 'this node'}. A page is a spec, a feedback note or a SOURCES.md key of the box.`);
    if (m.kind === 'source') return this.drawSource(m);
    const kicker = m.kind === 'feedback' ? 'Feedback' : 'Spec';
    const from = m.cameFrom.length
      ? m.cameFrom.map((c) => this.chip(c.source, c.n)).join('')
      : m.via.length ? m.via.map((v) => `<a class="bbl-chip" href="${esc(this.href('node', v.node))}"><span class="k">feedback</span>${esc(v.title || v.node)}</a>`).join('')
        : '<span class="bbl-state" data-state="missing">nothing yet: it cites no source and names no feedback</span>';
    const viaFb = m.cameFrom.length && m.via.length
      ? `<p class="bbl-sub">Filed as feedback: ${m.via.map((v) => `<a href="${esc(this.href('node', v.node))}">${esc(v.title || v.node)}</a>`).join(', ')}</p>` : '';
    this.innerHTML = `<article class="bbl-node" data-view="node" data-kind="${esc(m.kind)}">
      <div class="bbl-kicker">${kicker} · ${esc(m.path)}</div>
      <h2 class="bbl-title">${esc(m.title)}</h2>
      <p class="bbl-sub"><b>Came from</b> ${from}</p>${viaFb}
      <div class="bbl-tools" style="margin-top:10px"><button type="button" data-raw>Source mode</button></div>
      <div class="bbl-doc" style="padding-right:0">${this.noteHtml(m.body, m.path)}</div>
      <pre class="bbl-raw" hidden>${esc(m.raw)}</pre>
      <div class="bbl-sec">Linked mentions</div>
      ${m.mentions.length ? `<ul class="bbl-mentions">${m.mentions.map((x) => `<li>${x.node === 'objective' ? `<a href="${esc(this.href('objective'))}">The objective's page</a>` : `<a href="${esc(this.href('node', x.node))}">${esc(x.title || x.node)}</a>`} <span class="ctx">${esc(x.rel === 'from_feedback' && m.kind === 'feedback' ? 'the requirement it became' : REL_WORDS[x.rel] || x.rel)}</span></li>`).join('')}</ul>` : '<p class="bbl-sub">Nothing in the box links here yet.</p>'}
    </article>`;
    this.wire(this.querySelector('article'));
  }

  drawSource(m) {
    const s = m.source;
    const st = m.state;
    const quotes = (s.quotes || []).map((q) => `<q>${esc(q)}</q>`).join('');
    let body;
    if (st === 'located' || st === 'not-located') {
      const full = openHref(s, this.context.stateUrl);
      const lines = s.local.lines ? `${s.local.file || ''}, line${s.local.lines[0] === s.local.lines[1] ? '' : 's'} ${s.local.lines[0]}${s.local.lines[0] === s.local.lines[1] ? '' : `–${s.local.lines[1]}`}` : '';
      body = `${st === 'not-located' ? `<div class="bbl-card">Not located: ${esc(s.local.why || '')}. Nothing is marked.</div>` : ''}
        <div class="bbl-peek" data-src="${esc(s.key)}"><div class="bbl-peek-head"><span>${esc(lines)}</span><a href="${esc(full)}" target="_blank" rel="noopener">Open full ↗</a></div>
        <iframe class="bbl-frame" style="height:420px" title="${esc(s.label)}" src="${esc(openHref(s, this.context.stateUrl, { embed: true }))}"></iframe></div>`;
    } else if (st === 'web') {
      body = `<div class="bbl-card"><b>A public page.</b> It opens live: <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)} ↗</a></div>`;
    } else if (st === 'broken') {
      body = `<div class="bbl-card"><b>Does not resolve on this machine.</b> ${esc((s.local || {}).why || '')}</div>`;
    } else {
      body = `<div class="bbl-card"><b>🔒 A private source.</b> It opens only on its author's machine; this page keeps its label${quotes ? ' and the words the box quotes' : ''}.${quotes}</div>`;
    }
    this.innerHTML = `<article class="bbl-node" data-view="node" data-kind="source">
      <div class="bbl-kicker">Source · SOURCES.md#${esc(s.key)}</div>
      <h2 class="bbl-title">${esc(s.label)}</h2>
      <p class="bbl-sub">${esc(s.whose || '')}${s.whose ? ' · ' : ''}<span class="bbl-state" data-state="${st}">${esc(STATE_WORDS[st])}</span></p>
      ${st === 'located' || st === 'not-located' ? quotes : ''}
      ${body}
      <div class="bbl-sec">What its words became</div>
      ${m.mentions.length ? `<ul class="bbl-mentions">${m.mentions.map((x) => `<li><a href="${esc(x.node ? this.href('node', x.node) : '#')}">${esc(x.title)}</a> <span class="ctx">${esc(plainContext(x.context))}</span></li>`).join('')}</ul>` : '<p class="bbl-sub">Nothing in the box cites it yet.</p>'}
    </article>`;
  }
}
register(BBLinks);
