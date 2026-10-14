// graph.js — origin graph drawn on a timeline (plain SVG, sized to its container 1:1 so text stays legible).

const NS = 'http://www.w3.org/2000/svg';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yearFrac = d => { const t = new Date(d + 'T00:00:00Z'); return t.getUTCFullYear() + (t - Date.UTC(t.getUTCFullYear(), 0, 1)) / (365.25 * 864e5); };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const LABEL = { exact: 'exact copy', near: 'near-dup', paraphrase: 'paraphrase', partial: 'partial quote' };

function marks(c) {
  const m = [];
  if (c.archive && c.archive.iso) m.push({ d: c.archive.iso.slice(0, 10), k: 'arch', t: 'archived' });
  if (c.recorded && c.recorded.iso && !(c.archive && c.archive.iso && c.archive.iso.slice(0, 10) === c.recorded.iso.slice(0, 10)))
    m.push({ d: c.recorded.iso.slice(0, 10), k: 'arch', t: 'cdx' });
  if (c.firstRevision) m.push({ d: c.firstRevision, k: 'wiki', t: 'first rev' });
  if (c.claimed && c.claimed.published) m.push({ d: c.claimed.published.slice(0, 10), k: 'claim', t: 'claims' });
  if (c.claimed && c.claimed.updated && c.claimed.updated !== c.claimed.published) m.push({ d: c.claimed.updated.slice(0, 10), k: 'claim', t: 'updated' });
  return m;
}

export function renderGraph(host_, res) {
  const W = Math.max(300, Math.round(host_.clientWidth || 700));
  const today = new Date().toISOString().slice(0, 10);
  const name = c => c.label || (c.url ? host(c.url) : 'pasted text');
  const rows = res.candidates.filter(c => c.cls !== 'unrelated').map(c => {
    const mk = marks(c);
    const ind = mk.filter(x => x.k !== 'claim').sort((a, b) => a.d.localeCompare(b.d))[0];
    return { c, mk, ind, key: ind ? ind.d : '9999' };
  }).sort((a, b) => a.key.localeCompare(b.key));
  if (!rows.length) { host_.innerHTML = ''; return; }

  const all = rows.flatMap(r => r.mk.map(x => x.d));
  const y0 = Math.floor(Math.min(...all.map(yearFrac), yearFrac(today) - 4)) - 1;
  const y1 = Math.floor(yearFrac(today)) + 1;
  const wide = W >= 640;
  const labW = wide ? Math.min(260, W * 0.3) : 0;
  const padL = wide ? labW + 20 : 14, padR = W < 520 ? 54 : 70, top = 36, rowH = wide ? 40 : 62;
  const trunc = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const lab = (y, a, b) => wide
    ? `<text class="t-row" x="0" y="${y - 1}">${esc(trunc(a, Math.floor(labW / 7.4)))}</text><text class="t-sm" x="0" y="${y + 13}">${esc(b)}</text>`
    : `<text class="t-row" x="${padL}" y="${y - 24}">${esc(trunc(a, Math.floor((W - padL) / 7.4)))}</text><text class="t-sm" x="${padL}" y="${y - 10}">${esc(b)}</text>`;
  const X = d => padL + (yearFrac(d) - y0) / (y1 - y0) * (W - padL - padR);
  const H = top + (rows.length + 1) * rowH + 8;

  let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Timeline of when each matching source was first seen, with arrows from the earliest source">`;
  // axis
  const span = y1 - y0, step = span > 24 ? 5 : span > 12 ? 4 : span > 6 ? 2 : 1;
  s += `<line class="axis" x1="${padL}" x2="${W - padR}" y1="${top - 12}" y2="${top - 12}"/>`;
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    const x = X(`${y}-01-01`);
    s += `<line class="axis" x1="${x}" x2="${x}" y1="${top - 16}" y2="${H - 6}" stroke-dasharray="1 4"/>`;
    s += `<text class="t-sm" x="${x}" y="${top - 20}" text-anchor="middle">${y}</text>`;
  }
  const xNow = X(today);
  s += `<text class="t-sm" x="${Math.min(xNow, W - 6)}" y="${H - 2}" text-anchor="end">today</text>`;

  const originId = res.origin && res.origin.id;
  const origin = rows.find(r => r.c.id === originId);
  const oy = origin ? top + rows.indexOf(origin) * rowH + 22 : 0;
  const ox = origin && origin.ind ? X(origin.ind.d) : origin ? X(res.origin.date) : 0;

  let edges = '', nodes = '';
  const edge = (x, y, label) => {
    if (!origin) return;
    const mx = (ox + x) / 2;
    edges += `<path class="edge" d="M${ox},${oy} C${ox},${(oy + y) / 2} ${mx},${y} ${x - 6},${y}"/>`;
    edges += `<path d="M${x - 6},${y - 3.5} L${x},${y} L${x - 6},${y + 3.5}" fill="var(--accent)"/>`;
    if (label) edges += `<text class="t-acc" x="${x - 10}" y="${y + 15}" text-anchor="end">${esc(label)}</text>`;
  };

  rows.forEach((r, i) => {
    const y = top + i * rowH + 22;
    const isO = r.c.id === originId;
    nodes += lab(y, name(r.c), LABEL[r.c.cls] || '');
    nodes += `<line class="rowline" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
    const ind = r.mk.filter(x => x.k !== 'claim');
    const cl = r.mk.filter(x => x.k === 'claim');
    if (ind.length && cl.length) {
      const xs = [...ind, ...cl].map(m => X(m.d));
      nodes += `<line class="gap" x1="${Math.min(...xs)}" x2="${Math.max(...xs)}" y1="${y}" y2="${y}"/>`;
    }
    for (const m of r.mk) {
      const x = X(m.d);
      const orig = isO && r.ind && m === r.ind;
      if (m.k === 'claim') nodes += `<circle class="m-claim" cx="${x}" cy="${y}" r="4.5"><title>${esc(m.t)} ${m.d}</title></circle>`;
      else if (m.k === 'wiki') nodes += `<rect class="${orig ? 'm-origin' : 'm-arch'}" x="${x - 4.5}" y="${y - 4.5}" width="9" height="9"><title>${esc(m.t)} ${m.d}</title></rect>`;
      else nodes += `<circle class="${orig ? 'm-origin' : 'm-arch'}" cx="${x}" cy="${y}" r="5"><title>${esc(m.t)} ${m.d}</title></circle>`;
      if (orig) nodes += `<circle class="ring" cx="${x}" cy="${y}" r="9"/>`;
    }
    if (isO && r.ind) nodes += `<text class="t-acc" x="${X(r.ind.d) + 12}" y="${y + 15}">${esc(r.ind.d)} · earliest</text>`;
    if (!r.mk.length) nodes += `<text class="t-sm" x="${W - padR + 6}" y="${y + 4}">undated</text>`;
    if (!isO) {
      const tx = r.ind ? X(r.ind.d) : Math.min(xNow, W - padR);
      edge(tx, y, '');
    }
  });
  // suspect row
  const ys = top + rows.length * rowH + 22;
  nodes += lab(ys, 'suspect text', 'pasted now');
  nodes += `<line class="rowline" x1="${padL}" x2="${W - padR}" y1="${ys}" y2="${ys}"/>`;
  nodes += `<circle class="m-claim" cx="${xNow}" cy="${ys}" r="4.5"/>`;
  edge(xNow - 6, ys, '');

  s += edges + nodes + '</svg>';
  host_.innerHTML = s;
}

let raf = 0;
export function autoResize(host_, getRes) {
  addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { const r = getRes(); if (r) renderGraph(host_, r); });
  });
}
