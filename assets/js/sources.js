// sources.js — getting candidate text and dates into the browser, honestly.
// Wikipedia's API sends CORS headers (origin=*), so Wikipedia URLs are fetched live, with the
// first-revision date as independent evidence. Any other URL is tried directly; most sites
// don't allow cross-origin reads, and then the user is asked to paste the text.

export function wikiTitle(url) {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z-]+)\.(?:m\.)?wikipedia\.org$/);
    if (!m || !u.pathname.startsWith('/wiki/')) return null;
    return { lang: m[1], title: decodeURIComponent(u.pathname.slice(6)) };
  } catch { return null; }
}

async function wikiApi(lang, params, signal) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', redirects: '1', ...params });
  const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${qs}`, { signal });
  if (!r.ok) throw new Error('Wikipedia API HTTP ' + r.status);
  return r.json();
}

export async function fetchWikipedia(url, signal) {
  const w = wikiTitle(url);
  const [ext, first, last] = await Promise.all([
    wikiApi(w.lang, { action: 'query', prop: 'extracts', explaintext: '1', titles: w.title }, signal),
    wikiApi(w.lang, { action: 'query', prop: 'revisions', rvprop: 'timestamp', rvdir: 'newer', rvlimit: '1', titles: w.title }, signal),
    wikiApi(w.lang, { action: 'query', prop: 'revisions', rvprop: 'timestamp', rvlimit: '1', titles: w.title }, signal),
  ]);
  const page = ext.query.pages[0];
  if (!page || page.missing) throw new Error('no such Wikipedia page');
  return {
    text: page.extract || '',
    firstRevision: first.query.pages[0].revisions[0].timestamp.slice(0, 10),
    claimed: { updated: last.query.pages[0].revisions[0].timestamp.slice(0, 10) },
    source: 'fetched',
  };
}

/** Pull main text + self-reported dates out of an HTML string (browser DOMParser). */
export function readHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = n => doc.querySelector(`meta[property="${n}"],meta[name="${n}"],meta[itemprop="${n}"]`)?.getAttribute('content');
  let published = meta('article:published_time') || meta('datePublished') || meta('date') || meta('DC.date.issued');
  const updated = meta('article:modified_time') || meta('dateModified') || meta('last-modified');
  if (!published) {
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      const m = s.textContent.match(/"datePublished"\s*:\s*"([^"]+)"/);
      if (m) { published = m[1]; break; }
    }
  }
  if (!published) published = doc.querySelector('time[datetime]')?.getAttribute('datetime');
  doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,form').forEach(n => n.remove());
  const root = doc.querySelector('article') || doc.querySelector('main') || doc.body;
  const text = (root?.innerText || root?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const claimed = {};
  if (published) claimed.published = published.slice(0, 10);
  if (updated) claimed.updated = updated.slice(0, 10);
  return { text, claimed };
}

/** Try a direct cross-origin read. Throws a 'cors' error when the site doesn't allow it. */
export async function fetchDirect(url, signal) {
  let r;
  try { r = await fetch(url, { signal }); }
  catch (e) {
    if (signal && signal.aborted) throw e;
    const err = new Error('this site does not allow browsers on other origins to read it (no CORS)');
    err.code = 'cors';
    throw err;
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return { ...readHtml(await r.text()), source: 'fetched' };
}
