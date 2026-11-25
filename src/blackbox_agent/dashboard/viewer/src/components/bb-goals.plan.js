/* bb-goals.plan.js: `type: plan`, the Goals tab's Timeline preset (viewer/CONTRACT.md §25): V5's plan view
   (proposals-goals/05-plan-in-the-queue, as round 2 shares it in proposals-goals-v2/_shared/plan-timeline.js), ported
   to load data-ui's stock timeline from the viewer's vendored kit. data-ui's stock timeline (views/timeline.js: vis-
   timeline, rows → bars and points, lanes from groupBy, colour from `color`) with the one thing it lacks for a plan, a
   per-row SHAPE (the named data-ui gap; the timeline has no key for an item's kind of mark). It reads `plan.shape`
   (a property) and turns
     band  → a background band across its lane (the desired window: set → want by)
     bar   → the stock bar (an agent idea, scheduled from now)
     later → a hatched dashed bar (an agent idea behind a wait on Zach: drawn at the latest it can start)
     wait  → a dashed bar, open on the right (a wait on Zach: drawn to its answer-by, never sized)
     tick  → a dot with no label (a done idea, at its solution's scored time)
     flag  → a box drawn as a flag (want by, the estimate, met)
   and adds `plan.now` (the as-of line) and `plan.window` ([from, to]). Everything else (items, lanes, colours, the click →
   host.open, the status line) is the stock view's own code. Registered by bb-goals as data-ui's `plan` type. */
import { loadKitView } from '../core/kit.js';

const PLAN_CSS = `
.dv-view-timeline .vis-item.pl-band { background: var(--pl-band, rgba(113,113,122,.10)); border: 0; border-left: 2px solid var(--pl-desired, #71717a); border-right: 2px solid var(--pl-desired, #71717a); border-radius: 0; }
.dv-view-timeline .vis-item.pl-band .vis-item-content { display: none; }
.dv-view-timeline .vis-item.dv-tl-item.pl-wait { border-style: dashed; border-width: 1.5px; border-left-width: 3px; border-right: 0;
  background: linear-gradient(90deg, color-mix(in srgb, var(--dv-item) 16%, var(--dv-bg)), transparent); }
.dv-view-timeline .vis-item.dv-tl-item.pl-later { border-style: dashed; border-width: 1.5px; border-left-width: 3px;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--dv-item) 18%, var(--dv-bg)) 0 6px, var(--dv-bg) 6px 10px); }
.dv-view-timeline .vis-item.dv-tl-item.pl-flag.vis-box { background: none; border: 0; font-weight: 600; border-radius: 0; }
.dv-view-timeline .vis-item.dv-tl-item.pl-flag.vis-box .vis-item-content { padding: 2px 4px 2px 0; }
.dv-view-timeline .vis-item.dv-tl-item.pl-flag .vis-item-content::before { content: "⚑ "; color: var(--dv-item); }
.dv-view-timeline .vis-item.dv-tl-item.pl-flag.vis-line { display: none; }
.dv-view-timeline .vis-item.dv-tl-item.pl-flag.pl-off { visibility: hidden; }
/* WHY: vis leaves a box item it has never laid out at the lane's left edge with no transform; G3's Dec 12 'want by'
   read as due on Wednesday (all three round-2 lanes hit it). Hidden until vis places it. */
.dv-view-timeline .vis-item.dv-tl-item.pl-flag.vis-box:not([style*="transform"]):not([style*="translate"]) { visibility: hidden; }
.dv-view-timeline .vis-item.dv-tl-item.pl-flag.vis-dot { display: none; }
.dv-view-timeline .vis-item.dv-tl-item.pl-tick .vis-item-content { display: none; }
.dv-view-timeline .vis-item.dv-tl-item.pl-tick.vis-dot { width: 7px; height: 7px; }
.dv-view-timeline .vis-custom-time.pl-now { background-color: var(--dv-fg); width: 1px; opacity: .55; pointer-events: none; }
`;

// WHY a flag is a box (left-aligned), not a point: vis draws a point up to a quarter-window outside the view, so a
// flag far off to the left still printed its label at the left edge; a box shows only when its label overlaps the view.
const SHAPES = { band: 'background', bar: 'range', later: 'range', wait: 'range', tick: 'point', flag: 'box' };

/** The `plan` view module ({default, css}) over the vendored stock timeline (loaded from the same URL data-ui uses). */
export async function loadPlanView(cellValue) {
  const tl = await loadKitView('timeline');
  const Stock = tl.default;
  class PlanView extends Stock {
    constructor(host, el) {
      super(host, el);
      // WHY: the host names the slot after the type (dv-view-plan); the stock stylesheet is written for dv-view-timeline
      el.classList.add('dv-view-timeline');
    }

    update(input) {
      const spec = (input.view && input.view.plan) || {};
      const prop = spec.shape || 'shape';
      const byId = new Map(input.rows.map((r) => [String(r.id), r]));
      // WHY wrap add(): the stock update() builds every item and adds them once; shaping them on the way in keeps one draw
      const items = this.items;
      const add = items.add.bind(items);
      items.add = (list) => add(list.map((it) => {
        const row = byId.get(String(it.id));
        const shape = row ? String(cellValue(row[prop]) ?? 'bar') : 'bar';
        const out = { ...it, className: `${it.className} pl-${shape}` };
        // a bar or wait with no length (a wait whose answer-by has already passed) is drawn as a flag at its start
        const type = SHAPES[shape] === 'range' && !it.end ? 'box' : SHAPES[shape];
        if (type && type !== it.type) out.type = type;
        if (type === 'box' && shape !== 'flag') out.className += ' pl-flag';
        if (shape === 'band') delete out.title;
        return out;
      }));
      let result;
      try { result = super.update(input); } finally { delete items.add; }
      if (this.timeline && !this._aligned) {
        this.timeline.setOptions({ align: 'left' });
        // a flag whose date is left of the view would print a label cut at the edge: hide it until it is in view
        this.timeline.on('changed', () => {
          const edge = this.el.querySelector('.vis-panel.vis-center');
          if (!edge) return;
          const left = edge.getBoundingClientRect().left;
          for (const box of this.el.querySelectorAll('.vis-item.pl-flag.vis-box')) box.classList.toggle('pl-off', box.getBoundingClientRect().left < left - 1);
        });
        this._aligned = true;
      }
      if (spec.now && this.timeline) {
        const at = new Date(spec.now);
        try { this.timeline.setCustomTime(at, 'pl-now'); } catch { this.timeline.addCustomTime(at, 'pl-now'); }
        const bar = this.el.querySelector('.vis-custom-time');
        if (bar) bar.classList.add('pl-now');
      }
      const w = Array.isArray(spec.window) ? spec.window : null;
      if (this.timeline && !this._fitWrapped) {
        // WHY: vis-timeline fits itself once its first items are drawn; with a window from the .base, every such fit lands
        // on that window instead of on all the rows
        const fit = this.timeline.fit.bind(this.timeline);
        this.timeline.fit = (o) => (this._window ? this.timeline.setWindow(new Date(this._window[0]), new Date(this._window[1]), { animation: false }) : fit(o));
        this._fitWrapped = true;
      }
      const key = w ? w.join('|') : null;
      this._window = w;
      if (w && key !== this._winKey && this.timeline) {
        this.timeline.setWindow(new Date(w[0]), new Date(w[1]), { animation: false });
        this._winKey = key;
      }
      return result;
    }
  }
  return { default: PlanView, css: `${tl.css}\n${PLAN_CSS}` };
}

/** data-ui's `plan` type, once per page (a host page that registered it first keeps its own). */
export function registerPlan(core) {
  try {
    core.registerView('plan', { name: 'Plan', icon: 'gantt-chart', load: () => loadPlanView(core.cellValue) });
  } catch (e) {
    if (!/already registered/.test(String(e?.message))) throw e;
  }
}
