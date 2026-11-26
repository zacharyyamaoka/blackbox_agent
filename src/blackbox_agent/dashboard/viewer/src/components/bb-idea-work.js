import { esc } from '../core/element.js';

const OPEN = 'in_progress';
const CLOSED = 'done';
const IN_PROGRESS = 'In progress';
const DONE = 'Done';
const ACTIONS = { claim: 'Claim', release: 'Release', done: 'Mark done' };
const ENDED = new Set(['done', 'archived']);

const WORK_PROPERTIES = {
  work_board: { type: 'text', label: 'Status', derived: 'Idea claims and the committed queue' },
  work_owner: { type: 'text', label: 'Owner', width: 170 },
};

function ownerLabel(claim, agents) {
  return claim.owner_name || agents.get(claim.owner)?.title || claim.owner || 'Unknown owner';
}

function writePaused(snapshot) {
  return snapshot.fetch_error || ['behind', 'unknown'].includes(snapshot.freshness?.dashboard);
}

/** Overlay the live queue on the folded idea IDs. Its completion never implies a scored result. */
export function workRows(rows, snapshot) {
  const claims = new Map((snapshot.ideas || []).map((claim) => [claim.idea, claim]));
  const agents = new Map((snapshot.agents || []).map((agent) => [agent.sid, agent]));
  return rows.map((row) => {
    const claim = claims.get(row.id);
    if (row.done || ![OPEN, CLOSED].includes(claim?.status)) return { ...row, work_board: row.board };
    const label = ownerLabel(claim, agents);
    return {
      ...row,
      work_board: claim.status === OPEN ? IN_PROGRESS : DONE,
      work_owner: label,
    };
  });
}

export function workViews(doc) {
  const views = doc.views.flatMap((view) => {
    if (view.name !== 'Board') return [view];
    const live = { ...view, order: [...view.order.slice(0, 2), 'work_owner', ...view.order.slice(2)],
      groupBy: { property: 'work_board' }, groupOrder: [...view.groupOrder.slice(0, 2), IN_PROGRESS, DONE, ...view.groupOrder.slice(2)] };
    const owned = { ...live, name: IN_PROGRESS, filters: 'work_board == "In progress"',
      groupBy: { property: 'work_owner' }, groupOrder: [] };
    return [live, owned];
  });
  return { ...doc, facets: doc.facets.map((name) => name === 'board' ? 'work_board' : name), views };
}

function controls(row, snapshot, busy, message) {
  if (!snapshot || row.done) return '';
  const claim = (snapshot.ideas || []).find((item) => item.idea === row.id);
  const disabled = busy || writePaused(snapshot) ? ' disabled' : '';
  const button = (action, label = ACTIONS[action]) => `<button class="dv-btn" type="button" data-idea-work-action="${action}"${disabled}>${label}</button>`;
  const agents = (snapshot.agents || []).filter((agent) => agent.registered && !ENDED.has(agent.status));
  const names = new Map(agents.map((agent) => [agent.sid, agent]));
  let fields = '';
  if (claim?.status === CLOSED) {
    fields = `<span>Marked done · ${esc(ownerLabel(claim, names))}</span>${button('release', 'Reopen')}`;
  } else if (claim?.status === OPEN) {
    fields = `<span>Claimed by ${esc(ownerLabel(claim, names))}</span><div>${button('release')}${button('done')}</div>`;
  } else {
    const options = agents.map((agent) => `<option value="${esc(agent.sid)}">${esc(agent.title || agent.sid)}${agent.title ? ` · ${esc(agent.agent)}` : ''}</option>`).join('');
    fields = `<label>Owner <select data-idea-work-owner${disabled}><option value="">Me</option>${options}</select></label>${button('claim')}`;
  }
  return `<div class="bbiv-work" data-idea-work="${esc(row.id)}">${fields}<p class="bbiv-work-result" role="status">${esc(message || '')}</p></div>`;
}

/** Keep one stock view mounted while local registration and claims change. */
export function watchIdeaWork(views, context, dataset, doc, setBase, notice) {
  if (typeof context.watchWork !== 'function') return () => {};
  let snapshot = null;
  let rowsKey = null;
  let controlsKey = null;
  let disposed = false;
  const pending = new Set();
  const messages = new Map();

  if (typeof context.changeWork === 'function') {
    views.peekExtra = (row) => controls(row, snapshot, pending.has(row.id), messages.get(row.id));
  }

  const click = async (event) => {
    const button = event.target.closest?.('[data-idea-work-action]');
    if (!button || !snapshot || writePaused(snapshot)) return;
    const section = button.closest('[data-idea-work]');
    const idea = section.dataset.ideaWork;
    if (pending.has(idea)) return;
    const action = button.dataset.ideaWorkAction;
    const owner = section.querySelector('[data-idea-work-owner]')?.value;
    const result = section.querySelector('[role="status"]');
    pending.add(idea);
    messages.set(idea, 'Saving…');
    if (result) result.textContent = 'Saving…';
    for (const field of section.querySelectorAll('button, select')) field.disabled = true;
    try {
      await context.changeWork({ idea, action, ...(action === 'claim' && owner ? { owner } : {}) });
      messages.set(idea, action === 'claim' ? 'Claim saved.' : action === 'release' ? 'Claim released.' : 'Marked done.');
    } catch (error) {
      messages.set(idea, String(error?.message || error));
    } finally {
      pending.delete(idea);
      if (!disposed) views.refreshPeek?.();
    }
  };
  views.addEventListener('click', click);

  const off = context.watchWork((value) => {
    const next = value?.schema === 'bb-live-work/1' ? value : null;
    const modeChanged = Boolean(next) !== Boolean(snapshot);
    snapshot = next;
    const paused = next && writePaused(next);
    notice.hidden = !paused;
    notice.textContent = next?.fetch_error ? 'Live updates are unavailable. Showing the last received claims.'
      : paused ? 'The dashboard is updating. Idea changes are paused.' : '';
    if (modeChanged) setBase(next ? workViews(doc) : doc);

    // WHY exclude observation time: a heartbeat alone must not redraw a board with an open card.
    const key = next && JSON.stringify([next.ideas, (next.agents || []).map(({ sid, title }) => [sid, title])]);
    if (key !== rowsKey) {
      rowsKey = key;
      views.data = next ? { ...dataset, properties: { ...dataset.properties, ...WORK_PROPERTIES }, rows: workRows(dataset.rows, next) } : dataset;
    }
    const detailKey = next && JSON.stringify([key, paused, (next.agents || []).map(({ status, registered }) => [status, registered])]);
    if (detailKey !== controlsKey) {
      controlsKey = detailKey;
      views.refreshPeek?.();
    }
  });
  return () => {
    disposed = true;
    off?.();
    views.removeEventListener('click', click);
  };
}
