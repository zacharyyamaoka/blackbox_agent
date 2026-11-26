/* <bb-data-page>: a tab's stock body (Zach's layout ruling, viewer/CONTRACT.md §11): a data-ui <data-views> over ONE
   state.json slice, with the page's .base file as its presets (view tabs), the <data-facets> rail and the side panel
   on row click. The .base file is hosted unchanged: its `data:` key is replaced by the slice's rows. No .base file =
   one table over every field. Set settings before state (bb-page does): the slice it is handed is the one `slice`
   names, and no other. */
import { BBElement, esc } from '../core/element.js';
import { register } from '../core/registry.js';
import { get, splitOf } from '../core/slices.js';
import { loadViews } from '../core/kit.js';
import { noteRows, notePages } from '../core/notes.js';
import { deriveRows } from '../core/derive.js';
import schema from './bb-data-page.schema.js';

let uid = 0;

/** The stock row view: one table, scalar and list fields in first-seen order (objects stay for the side panel). */
export function stockBase(rows, slice) {
  const order = [];
  for (const r of rows.slice(0, 50)) for (const [k, v] of Object.entries(r)) {
    // `_` keys ride with the row and are never columns (a note's text: `_note`, CONTRACT §17)
    if (order.includes(k) || k.startsWith('_') || (v && typeof v === 'object' && !Array.isArray(v))) continue;
    order.push(k);
  }
  const properties = {};
  for (const k of order) {
    const nums = rows.map((r) => r[k]).filter((v) => typeof v === 'number');
    if (nums.length && nums.some((v) => !Number.isInteger(v))) properties[k] = { digits: 4 };
  }
  return { properties, views: [{ type: 'table', name: `All ${slice}`, order }] };
}

export function rowsOf(list) {
  return list.map((r, i) => {
    const row = r && typeof r === 'object' ? { ...r } : { value: r };
    if (row.id === undefined || row.id === null) row.id = row.n ?? i + 1;
    row.id = String(row.id);
    return row;
  });
}

/** The other slices the page's settings name (`also`, comma separated): the datasets a .base view reads with `from:`. */
export const alsoOf = (s) => String((s && s.also) || '').split(',').map((x) => x.trim()).filter(Boolean);

/** A .base `links:` entry between `other` and `own` as [their property, our property], either way round; null when none. */
export function linkOf(links, own, other) {
  for (const l of Array.isArray(links) ? links : []) {
    if (!l || typeof l.from !== 'string' || typeof l.to !== 'string') continue;
    const [a, ap] = [l.from.slice(0, l.from.indexOf('.')), l.from.slice(l.from.indexOf('.') + 1)];
    const [b, bp] = [l.to.slice(0, l.to.indexOf('.')), l.to.slice(l.to.indexOf('.') + 1)];
    if (a === other && b === own) return [ap, bp];
    if (a === own && b === other) return [bp, ap];
  }
  return null;
}

/** CONTRACT §28: one rail over two grains. Each row of another slice gains its linked row's fields (by the .base's
    `links:`, e.g. task_results.solution -> iterations.id) that the other slice never carries itself, so a rail facet on
    verdict, family or dev error means the same on a task result as on its iteration. WHY in the host, not data-ui: a
    data-ui link is a semi-join that never adds a column (its CONTRACT §10/§17), and `<data-views>` has no `from:` of its
    own yet (a gap named in CONTRACT §28.4); objects and `_` keys stay with their own row. */
export function joinRows(rows, own, link) {
  if (!link) return rows;
  const [theirs, ours] = link;
  const by = new Map(own.map((r) => [String(r[ours]), r]));
  const keys = new Set();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  return rows.map((r) => {
    const o = by.get(String(r[theirs]));
    if (!o) return r;
    const out = { ...r };
    for (const [k, v] of Object.entries(o)) {
      if (keys.has(k) || k === 'id' || k.startsWith('_') || (v && typeof v === 'object' && !Array.isArray(v))) continue;
      out[k] = v;
    }
    return out;
  });
}

export class BBDataPage extends BBElement {
  static schema = schema;
  static css = `
bb-data-page .bbd { display: flex; gap: 12px; min-width: 0; }
bb-data-page .bbd > data-facets { flex: 0 0 220px; min-width: 0; }
bb-data-page .bbd > data-views { flex: 1 1 auto; min-width: 0; }
@media (max-width: 700px) { bb-data-page .bbd { flex-direction: column; } bb-data-page .bbd > data-facets { flex: none; } }
/* CONTRACT §22.4: a row whose status badge says obsolete is kept, greyed and struck through (feedback that no longer
   applies, a trigger dropped). WHY keyed on the stock badge (data-ui's display: status writes data-state): data-ui has no
   row tone of its own (a gap named in §22.6), and the badge is what the row's own data says. */
bb-data-page [data-id]:has(.dv-state[data-state="obsolete"]) { opacity: .55; }
bb-data-page [data-id]:has(.dv-state[data-state="obsolete"]) :is(td, .dv-cell, .dv-card-title) { text-decoration: line-through; }
`;

  readList() { return [this.settings.slice, ...alsoOf(this.settings)]; }

  async render() {
    const s = this.settings;
    const list = get(this.data, s.slice);
    if (!Array.isArray(list) || !list.length) {
      // the page's sentence: its first sentence as the headline, the rest (how to add a row) under it
      const cut = s.empty.indexOf('. ');
      return cut > 0 ? this.empty(s.empty.slice(0, cut + 1), esc(s.empty.slice(cut + 2)))
        : this.empty(s.empty || `No rows in ${s.slice} yet.`, s.empty ? '' : `The fold fills <span class="bb-mono">${esc(s.slice)}</span> from the box's committed files at its next commit (viewer/CONTRACT.md §3.2 says which file).`);
    }
    this.innerHTML = `<div class="bb-muted" style="font-size:13px">Loading the ${esc(s.slice)} row view…</div>`;
    const core = await loadViews();
    let text = s.base_text || (s.base ? await this.context.asset(s.base) : '');
    const doc = text ? core.parseBase(text) : stockBase(list, s.slice);
    delete doc.data; // WHY: hosted unchanged; the rows are the slice's, whatever file the preset was written against
    let changed = relabelObjective(doc, this.data.objective);
    // CONTRACT §28: a view that reads another slice (`from:`) is offered only when the state holds that slice's rows
    const others = {};
    for (const name of alsoOf(s)) { const l = get(this.data, name); if (Array.isArray(l) && l.length) others[name] = l; }
    if (Array.isArray(doc.views) && doc.views.some((v) => v && v.from && v.from !== s.slice && !others[v.from])) {
      doc.views = doc.views.filter((v) => !(v && v.from && v.from !== s.slice && !others[v.from]));
      changed = true;
    }
    if (changed) text = core.stringifyBase(doc);
    // CONTRACT §16.3: the page's own filter ANDed with the file's (data-ui's andFilters), so a preset written against
    // iterations-only data is hosted unchanged over a slice that also holds ablation runs (costs: kind == "iteration")
    if (s.filters) doc.filters = core.andFilters(doc.filters, s.filters);
    if (!text) text = core.stringifyBase(doc);
    const views = document.createElement('data-views');
    views.id = `bbd-${s.slice.replace(/\W/g, '-')}-${++uid}`;
    views.setAttribute('no-url', '');
    views.setAttribute('aria-label', `${this.data.box || 'Box'}: ${s.slice}`);
    if (s.view) views.setAttribute('view', s.view);
    views.style.setProperty('--data-height', `${s.height}px`);
    views.addEventListener('data-views-render', (e) => { this.dataset.drew = e.detail.type; }, { once: true });
    views.baseText = text;
    views.base = doc;
    // CONTRACT §22.4: display columns derived from the rows' own fields (feedback: standing, spec_link, bug)
    const rows = deriveRows(s.slice, rowsOf(list));
    // CONTRACT §17: a row that is a Markdown file (`_note`) opens as the note in the Obsidian-parity viewer; set before the
    // data, so data-ui keeps the host's page (its own would fetch the file)
    const notes = noteRows(rows);
    if (notes) views.pageRenderer = notePages(views, rows);
    // a note's panel is headed by its title, as Obsidian heads it by its name
    const titleProperty = notes && rows.every((r) => typeof r.title === 'string') ? 'title' : 'id';
    const sets = { [s.slice]: { id: `bb/${this.data.box || 'box'}/${s.slice}`, title: s.slice, titleProperty, rows } };
    for (const [name, list] of Object.entries(others)) {
      const theirs = joinRows(rowsOf(deriveRows(name, list)), rows, linkOf(doc.links, s.slice, name));
      sets[name] = { id: `bb/${this.data.box || 'box'}/${name}`, title: name, titleProperty: 'id', rows: theirs };
    }
    // the dataset a view reads: its `from:`, else the page's slice. data-views keeps the open view and the rail's
    // filters across a data swap only when told: the filters are put back by hand (routing round data-ui, §28.4)
    const fromOf = (name) => { const v = (doc.views || []).find((x) => x && x.name === name); return v && v.from && sets[v.from] ? v.from : s.slice; };
    let on = fromOf(s.view || (doc.views && doc.views[0] && doc.views[0].name));
    views.data = sets[on];
    if (Object.keys(sets).length > 1) {
      views.addEventListener('data-views-change', (e) => {
        const want = fromOf(e.detail && e.detail.name);
        if (want === on) return;
        on = want;
        const keep = views.filters;
        views.data = sets[want];
        if (keep) views.filters = keep;
        this.dataset.from = want;
      });
      this.dataset.from = on;
    }
    const row = document.createElement('div');
    row.className = 'bbd';
    if (s.facets) {
      const rail = document.createElement('data-facets');
      rail.setAttribute('for', views.id);
      row.append(rail);
    }
    row.append(views);
    this.replaceChildren(row);
  }
}
register(BBDataPage);

/** A stock preset names the objective in trajectory_tracking_agent's words ("Dev error", "Dev error (mm)"). Where those
    words do not fit the box (its objective is not ranked on a dev split, or its unit is not the one the preset names),
    the `objective` column and its facet take the box's own name and unit instead; a box they fit keeps the preset as
    picked. WHY (lane ES, 2026-11-24): robot_sdk_agent's max_stale_hours, in hours, was headed "Dev error (mm)", and
    a private box's unitless count too. Returns true when it changed the preset. The views' chart titles inside
    the preset are left as written (a follow-up: presets that name the objective from the state). */
export function relabelObjective(doc, o) {
  const prop = doc && doc.properties && doc.properties.objective;
  if (!prop || !o || !o.name) return false;
  const facets = (doc.facets || []).filter((f) => f && typeof f === 'object' && f.property === 'objective');
  const units = facets.map((f) => (/\(([^)]*)\)\s*$/.exec(String(f.label || '')) || [])[1]).filter(Boolean);
  const fits = splitOf(o) === 'dev' && units.every((u) => u === (o.unit || ''));
  if (fits) return false;
  const name = o.label || o.name;
  prop.displayName = name;
  for (const f of facets) f.label = `${name}${o.unit ? ` (${o.unit})` : ''}`;
  return true;
}

