/* A tab's deep link (viewer/CONTRACT.md §20): `#<tab>?<key>=<value>&…`. Each key is handed to the page's sections whose
   component schema declares a setting of that id (bb-goals' and bb-idea-views' `goal`), so a link names a filtered tab
   (`#ideas?goal=G2`, "Its 4 ideas →" on the Goals tab) and survives a reload; a key no section declares is ignored.
   Pure: no DOM. */

/** "ideas?goal=G2" -> {page: "ideas", query: {goal: "G2"}}; the part before `?` is the page as before. */
export function splitRoute(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const at = h.indexOf('?');
  if (at < 0) return { page: h, query: {} };
  return { page: h.slice(0, at), query: Object.fromEntries(new URLSearchParams(h.slice(at + 1))) };
}

/** `#ideas?goal=G2` from a page id and a query ({} -> just the page). */
export function routeOf(page, query = {}) {
  const q = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return `${page}${[...q.keys()].length ? `?${q}` : ''}`;
}

/** A copy of a page template with each query key set on every section whose schema has that setting. */
export function withQuery(template, query, schemas) {
  const keys = Object.keys(query || {});
  if (!keys.length) return template;
  const t = JSON.parse(JSON.stringify(template));
  const byTag = Object.fromEntries((schemas || []).map((s) => [s.tag, s]));
  for (const s of Object.values(t.sections || {})) {
    const ids = new Set((byTag[s.type]?.settings || []).map((d) => d.id));
    for (const k of keys) if (ids.has(k)) s.settings = { ...(s.settings || {}), [k]: query[k] };
  }
  return t;
}
