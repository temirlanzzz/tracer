// wayback.js — what the Wayback Machine will tell a *browser*.
//
// Measured on 2026-10-14 with `curl -H "Origin: https://temirlanzzz.github.io"`:
//   web.archive.org/cdx/search/cdx ........ 200, no Access-Control-Allow-Origin  -> blocked in browsers
//   web.archive.org/web/<ts>id_/<url> ..... 200, no ACAO                         -> can't read old page text
//   web.archive.org/__wb/sparkline ........ 200, no ACAO                         -> blocked
//   wayback-api.archive.org/wayback/available  200, ACAO: *                      -> usable
// The availability API only answers "closest capture to timestamp T" and only looks a few months
// around T, so a first-seen date has to be found by probing forward from 1996. The result is the
// earliest capture the probes hit: an upper bound on the true first capture, never a lower one.

const API = 'https://wayback-api.archive.org/wayback/available';
const START_YEAR = 1996;

export function tsToIso(ts) {
  const t = (ts + '00000000000000').slice(0, 14);
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

export function archiveKey(url) {
  try {
    const u = new URL(/^https?:\/\//.test(url) ? url : 'http://' + url);
    return u.host.replace(/^www\./, '') + u.pathname + u.search;
  } catch { return url; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function probeOnce(key, ts, signal) {
  const r = await fetch(`${API}?url=${encodeURIComponent(key)}&timestamp=${ts}`, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const c = j.archived_snapshots && j.archived_snapshots.closest;
  return c && c.available ? { timestamp: c.timestamp, snapshot: c.url.replace(/^http:/, 'https:') } : null;
}

async function probe(key, ts, signal) {
  // archive.org answers overload with an HTML "Temporarily Offline" page without CORS headers,
  // which surfaces as a TypeError here. One retry with backoff, then report the failure.
  try { return { hit: await probeOnce(key, ts, signal) }; }
  catch (e) {
    if (signal && signal.aborted) throw e;
    await sleep(1200);
    try { return { hit: await probeOnce(key, ts, signal) }; }
    catch (e2) { return { error: String(e2.message || e2) }; }
  }
}

/**
 * Probe Jan 1 and Jul 1 of every year from 1996, oldest first, a few at a time;
 * stop at the first round with a hit. Returns {timestamp, iso, snapshot, probes, failed} or
 * {none:true,...} or {error,...}.
 */
export async function firstSeenProbe(url, { signal, onProgress, batch = 6 } = {}) {
  const key = archiveKey(url);
  const now = new Date();
  const points = [];
  for (let y = START_YEAR; y <= now.getUTCFullYear(); y++) {
    points.push(`${y}0101000000`);
    if (y < now.getUTCFullYear() || now.getUTCMonth() >= 6) points.push(`${y}0701000000`);
  }
  let probes = 0, failed = 0;
  for (let i = 0; i < points.length; i += batch) {
    const round = points.slice(i, i + batch);
    const res = await Promise.all(round.map(ts => probe(key, ts, signal)));
    probes += round.length;
    failed += res.filter(r => r.error).length;
    onProgress && onProgress({ probes, failed, upTo: round[round.length - 1].slice(0, 4) });
    if (failed >= 8 && failed / probes > 0.5) return { error: 'archive.org is refusing or rate-limiting requests right now', probes, failed };
    const hits = res.filter(r => r.hit).map(r => r.hit).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (hits.length) return { ...hits[0], iso: tsToIso(hits[0].timestamp), probes, failed, source: 'wayback-availability-probe' };
  }
  return { none: true, probes, failed };
}
