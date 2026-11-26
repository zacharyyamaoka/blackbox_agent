const SESSION_STATUS = {
  working: 'Working', blocked: 'Blocked', error: 'Error', idle: 'Idle',
  done: 'Done', archived: 'Archived', unknown: 'Unknown',
};
const ORDER = Object.keys(SESSION_STATUS);
const DASHBOARD = { current: 'Current', behind: 'Behind', unknown: 'Unknown' };
const ACTIVITY = { current: 'Current', stale: 'Stale', unknown: 'Unknown' };

export function sessionLink(links) {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const { href, label } = link || {};
    if (typeof href !== 'string') continue;
    // WHY only the adapter's chat destinations: the roster may receive resume commands or arbitrary URLs alongside them.
    const codex = /^codex:\/\/threads\/[0-9a-f-]+$/i.test(href);
    const claude = /^claude:\/\/code\/continue\?session=[a-z0-9_-]+$/i.test(href);
    const remote = /^https:\/\/claude\.ai\/code\/[a-z0-9_-]+$/i.test(href);
    if (codex || claude || remote) return { href, label: label || 'Open chat' };
  }
  return null;
}

function status(value, labels) {
  const key = Object.hasOwn(labels, value) ? value : 'unknown';
  return { key, label: labels[key] };
}

export function liveAgents(snapshot) {
  if (!snapshot) return null;
  const { freshness = {}, fetch_error: fetchError } = snapshot;
  // WHY a cache hit's last rows may still be useful to open a chat, but its labels must become last-observed after
  // an activity lapse or transport failure. A fetched response may itself contain stale source data.
  const dashboard = status(fetchError ? 'unknown' : freshness.dashboard, DASHBOARD);
  const activity = status(fetchError ? 'unknown' : freshness.activity, ACTIVITY);
  const agents = (snapshot.agents || []).map((agent) => ({
    ...agent, status: status(agent.status, SESSION_STATUS), link: sessionLink(agent.open),
  }));
  agents.sort((a, b) => ORDER.indexOf(a.status.key) - ORDER.indexOf(b.status.key)
    || (Date.parse(b.last_activity) || 0) - (Date.parse(a.last_activity) || 0)
    || a.sid.localeCompare(b.sid));
  return {
    agents, dashboard, activity, head: freshness.head, built: freshness.built,
    observedAt: snapshot.observed_at, checkedAt: snapshot.checked_at, fetchError,
    issues: Array.isArray(freshness.issues) ? freshness.issues : [],
  };
}
