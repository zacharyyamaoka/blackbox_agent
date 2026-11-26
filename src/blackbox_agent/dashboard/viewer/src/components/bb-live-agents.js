import { BBElement, esc } from '../core/element.js';
import { register } from '../core/registry.js';
import { liveAgents } from './bb-live-agents.model.js';
import schema from './bb-live-agents.schema.js';

const dateFormat = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function time(value, empty = 'Unknown') {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return empty;
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  const relative = minutes < 0 ? dateFormat.format(ms) : minutes < 1 ? 'Just now'
    : minutes < 60 ? `${minutes} min ago` : minutes < 24 * 60 ? `${Math.floor(minutes / 60)} h ago` : dateFormat.format(ms);
  return `<time datetime="${esc(value)}" title="${esc(`${dateFormat.format(ms)} · ${value}`)}">${esc(relative)}</time>`;
}

function revision(value) {
  if (!value) return 'unknown';
  return `<code title="${esc(value)}">${esc(value.length > 10 ? `${value.slice(0, 10)}…` : value)}</code>`;
}

function summary(model) {
  const { dashboard, activity, observedAt, checkedAt, issues, fetchError, head, built } = model;
  const build = dashboard.key === 'behind' && (built || head)
    ? `<span>Showing ${revision(built)} · HEAD ${revision(head)}</span>` : '';
  const observation = observedAt ? `<span>${activity.key === 'current' ? 'Observed' : 'Last observed'} ${time(observedAt)}</span>`
    : `<span>${checkedAt ? `Checked ${time(checkedAt)} · no activity observation` : 'No activity observation'}</span>`;
  const trouble = issues.length ? `<ul class="bbla-issues">${issues.map(({ source, since, detail }) => (
    `<li>${source ? `<b>${esc(source)}</b> ` : ''}${esc(detail || '')}${since ? ` · since ${time(since)}` : ''}</li>`)).join('')}</ul>` : '';
  const previousRows = model.agents.length && activity.key !== 'current' ? '<p class="bbla-empty">Showing last observed session states.</p>' : '';
  return `<div class="bbla-facts">
    <div class="bbla-fact"><span>Dashboard</span><b data-freshness="${dashboard.key}">${dashboard.label}</b>${build}</div>
    <div class="bbla-fact"><span>Activity</span><b data-freshness="${activity.key}">${activity.label}</b>${observation}</div>
  </div>${fetchError ? `<p class="bbla-problem">Live work could not refresh. ${esc(fetchError)}</p>` : ''}${trouble}${previousRows}`;
}

function roster({ agents, activity }) {
  if (!agents.length) return `<p class="bbla-empty">${activity.key === 'current' ? schema.empty : 'Agent session status is unavailable.'}</p>`;
  const rows = agents.map(({ sid, agent, title, branch, link, status, last_activity: lastActivity }) => {
    const titleLine = link ? `<a href="${esc(link.href)}" title="${esc(link.label)}">${esc(title || sid)}</a>` : `<b>${esc(title || sid)}</b>`;
    return `<li class="bbla-row" data-session="${esc(sid)}">
      <div>${titleLine}<div class="bbla-detail"><code>${esc(sid)}</code>${agent && !sid.startsWith(`${agent}:`) ? ` · ${esc(agent)}` : ''}${branch ? ` · ${esc(branch)}` : ''}</div></div>
      <div><span class="bbla-state" data-status="${status.key}">${status.label}</span></div>
      <div class="bbla-time">${time(lastActivity)}</div>
    </li>`;
  }).join('');
  const label = activity.key === 'current' ? 'Status' : 'Last observed status';
  return `<div class="bbla-columns" aria-hidden="true"><span>Session</span><span>${label}</span><span>Last activity</span></div>
    <ul class="bbla-rows" aria-label="Agent sessions · ${label}">${rows}</ul>`;
}

export class BBLiveAgents extends BBElement {
  static schema = schema;
  static css = `
bb-live-agents[hidden], .bb-section[data-type="bb-live-agents"][hidden] { display: none; }
bb-live-agents .bbla { padding: 15px 16px 9px; font-size: 13px; }
bb-live-agents .bbla h2 { margin: 0 0 10px; font-size: 16px; font-weight: 650; }
bb-live-agents .bbla-facts { display: flex; flex-wrap: wrap; gap: 5px 20px; color: var(--bb-muted); }
bb-live-agents .bbla-fact { display: flex; flex-wrap: wrap; gap: 4px 7px; }
bb-live-agents .bbla-fact b { color: var(--bb-fg); }
bb-live-agents .bbla-fact [data-freshness="behind"], bb-live-agents .bbla-fact [data-freshness="stale"] { color: var(--bb-warn); }
bb-live-agents .bbla-problem, bb-live-agents .bbla-issues { margin: 8px 0; color: var(--bb-fg); overflow-wrap: anywhere; }
bb-live-agents .bbla-issues { padding-left: 17px; }
bb-live-agents .bbla-columns, bb-live-agents .bbla-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(140px, 20%) minmax(105px, 17%); gap: 8px 14px; }
bb-live-agents .bbla-columns { margin-top: 12px; padding: 8px 0 4px; color: var(--bb-muted); font-size: 12px; }
bb-live-agents .bbla-rows { padding: 0; margin: 0; list-style: none; }
bb-live-agents .bbla-row { align-items: baseline; padding: 8px 0; border-top: 1px solid var(--bb-rule); overflow-wrap: anywhere; }
bb-live-agents .bbla-row a { font-weight: 650; }
bb-live-agents .bbla-detail, bb-live-agents .bbla-time, bb-live-agents .bbla-empty { color: var(--bb-muted); }
bb-live-agents .bbla-detail { margin-top: 2px; font-size: 12px; }
bb-live-agents .bbla-state[data-status="working"] { color: var(--bb-good); }
bb-live-agents .bbla-state[data-status="blocked"] { color: var(--bb-warn); }
bb-live-agents .bbla-state[data-status="error"] { color: var(--bb-bad); }
@media (max-width: 620px) {
  bb-live-agents .bbla-columns { display: none; }
  bb-live-agents .bbla-rows { margin-top: 10px; }
  bb-live-agents .bbla-row { grid-template-columns: minmax(0, 1fr) auto; }
  bb-live-agents .bbla-row > :first-child { grid-column: 1 / -1; }
}
`;

  connectedCallback() {
    this.setPanelHidden(true);
    super.connectedCallback();
  }

  setPanelHidden(hidden) {
    this.hidden = hidden;
    const section = this.parentElement;
    // WHY a native hidden state on the section: a static page has no live
    // work feed, so the entire section is absent from the dashboard layout.
    if (section?.matches('.bb-section[data-type="bb-live-agents"]')) section.hidden = hidden;
  }

  render() {
    if (!this.firstElementChild) this.innerHTML = `<section class="bb-card bbla" aria-label="Agent sessions">
      <h2>Agent sessions</h2><div data-fresh aria-live="polite"></div><div data-roster></div></section>`;
    const context = this.context;
    if (this.workWatch?.context === context) return;
    this.teardown();
    this.setPanelHidden(true);
    const watch = this.workWatch = { context };
    watch.stop = context.watchWork?.((snapshot) => {
      if (!this.isConnected || this.workWatch !== watch) return;
      const model = liveAgents(snapshot);
      this.setPanelHidden(!model);
      if (!model) return;
      const fresh = this.querySelector('[data-fresh]');
      const rows = this.querySelector('[data-roster]');
      const nextSummary = summary(model), nextRows = roster(model);
      if (fresh.innerHTML !== nextSummary) fresh.innerHTML = nextSummary;
      // WHY activity polls should not interrupt a reader navigating the same session list by keyboard.
      if (rows.innerHTML !== nextRows) rows.innerHTML = nextRows;
    });
  }

  teardown() {
    this.workWatch?.stop?.();
    this.workWatch = null;
  }
}

register(BBLiveAgents);
