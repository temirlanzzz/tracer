// textsim.js — tokenising, 5-gram shingles, exact Jaccard, MinHash, matched spans.
// Pure functions, no DOM: the same module runs in the browser and under Node
// (scripts/parity.mjs), and server/tracer/textsim.py mirrors it bit-for-bit.

export const K = 5;            // words per shingle
export const NUM_PERM = 128;   // MinHash permutations
const P = 2147483647;          // Mersenne prime 2^31 - 1

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Normalise one word: lowercase, strip diacritics and apostrophes. */
export function normWord(w) {
  return w.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '');
}

/** Tokens with character offsets into the original string (for highlighting). */
export function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(WORD)) {
    const t = normWord(m[0]);
    if (t) out.push({ t, s: m.index, e: m.index + m[0].length });
  }
  return out;
}

/** Map shingle string -> list of start token indexes. */
export function shingles(tokens, k = K) {
  const map = new Map();
  const n = tokens.length;
  if (n === 0) return map;
  if (n < k) { map.set(tokens.map(x => x.t).join(' '), [0]); return map; }
  for (let i = 0; i + k <= n; i++) {
    let s = tokens[i].t;
    for (let j = 1; j < k; j++) s += ' ' + tokens[i + j].t;
    const arr = map.get(s);
    if (arr) arr.push(i); else map.set(s, [i]);
  }
  return map;
}

const enc = new TextEncoder();
/** 32-bit FNV-1a over UTF-8 bytes. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const b of enc.encode(str)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic permutation parameters shared with Python. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

export const PERMS = (() => {
  const r = mulberry32(42), A = [], B = [];
  for (let i = 0; i < NUM_PERM; i++) {
    A.push(1 + (r() % (P - 1)));
    B.push(r() % P);
  }
  return { A, B };
})();

// (a * x) mod P without overflowing 2^53: split a into 16-bit halves.
function mulmod(a, x) {
  const hi = a >>> 16, lo = a & 0xffff;
  return (((hi * x) % P) * 65536 + lo * x) % P;
}

/** MinHash signature (Uint32Array of NUM_PERM). */
export function minhash(shingleKeys) {
  const sig = new Array(NUM_PERM).fill(P);
  for (const s of shingleKeys) {
    const x = fnv1a(s) % P;
    for (let i = 0; i < NUM_PERM; i++) {
      const v = (mulmod(PERMS.A[i], x) + PERMS.B[i]) % P;
      if (v < sig[i]) sig[i] = v;
    }
  }
  return sig;
}

export function minhashSim(a, b) {
  let eq = 0;
  for (let i = 0; i < NUM_PERM; i++) if (a[i] === b[i]) eq++;
  return eq / NUM_PERM;
}

/** Exact set statistics between suspect shingles A and candidate shingles B. */
export function overlap(A, B) {
  let inter = 0;
  for (const k of A.keys()) if (B.has(k)) inter++;
  const union = A.size + B.size - inter;
  return {
    inter,
    jaccard: union ? inter / union : 0,
    containment: A.size ? inter / A.size : 0,   // share of the suspect found in the candidate
  };
}

/** Boolean mask of tokens covered by any shared shingle, for both sides. */
export function matchMasks(tokA, A, tokB, B, k = K) {
  const ma = new Uint8Array(tokA.length), mb = new Uint8Array(tokB.length);
  const kk = Math.min(k, tokA.length, tokB.length) || 1;
  for (const [s, starts] of A) {
    const other = B.get(s);
    if (!other) continue;
    for (const i of starts) for (let j = 0; j < kk; j++) ma[i + j] = 1;
    for (const i of other) for (let j = 0; j < kk; j++) mb[i + j] = 1;
  }
  return { ma, mb };
}

/** Longest run of consecutive matched tokens in a mask. */
export function longestRun(mask) {
  let best = 0, cur = 0;
  for (const v of mask) { cur = v ? cur + 1 : 0; if (cur > best) best = cur; }
  return best;
}

/** Turn a token mask into merged character ranges [[s,e],...] in the original text. */
export function maskToRanges(tokens, mask) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!mask[i]) continue;
    const s = tokens[i].s; let e = tokens[i].e;
    while (i + 1 < tokens.length && mask[i + 1]) { i++; e = tokens[i].e; }
    out.push([s, e]);
  }
  return out;
}

/** Rough sentence split with offsets (keeps it dependency-free). */
export function sentences(text) {
  const out = [];
  const re = /[^.!?\n]+(?:[.!?]+["'”’)\]]*|\n|$)/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t.split(/\s+/).length >= 4) out.push({ text: t, s: m.index + lead, e: m.index + lead + t.length });
  }
  return out;
}

// Thresholds (containment = share of the suspect's 5-grams found in the candidate).
export const T = { exact: 0.9, near: 0.4, partial: 0.05, para: 0.35, unitCos: 0.6 };

const wc = s => s.split(/\s+/).length;

/** Suspect units for the semantic pass: sentences merged until each has >= minW words. */
export function units(text, minW = 12) {
  const out = [];
  let cur = [], w = 0;
  for (const s of sentences(text)) {
    cur.push(s); w += wc(s.text);
    if (w >= minW) { out.push(cur); cur = []; w = 0; }
  }
  if (cur.length) { if (out.length && w < minW / 2) out[out.length - 1].push(...cur); else out.push(cur); }
  return out.map(c => ({ text: c.map(x => x.text).join(' '), s: c[0].s, e: c[c.length - 1].e, w: c.reduce((a, x) => a + wc(x.text), 0) }));
}

/** Candidate windows: every run of 1..k consecutive sentences (paraphrases merge and split sentences). */
export function windows(text, k = 3, limit = 700) {
  const ss = sentences(text).slice(0, limit), out = [];
  for (let i = 0; i < ss.length; i++)
    for (let j = 1; j <= k && i + j <= ss.length; j++) {
      const g = ss.slice(i, i + j);
      out.push({ text: g.map(x => x.text).join(' '), s: g[0].s, e: g[g.length - 1].e });
    }
  return out;
}

/**
 * Semantic coverage: share of suspect words sitting in units whose best cosine to any candidate
 * window is >= T.unitCos. best[i] = [cos, windowIndex] per suspect unit.
 */
export function coverage(A, best) {
  let tot = 0, hit = 0;
  A.forEach((u, i) => { tot += u.w; if (best[i][0] >= T.unitCos) hit += u.w; });
  return tot ? hit / tot : 0;
}

/**
 * Classify one candidate.
 * semantic: mean over suspect sentences of best cosine to any candidate sentence (or null).
 */
export function classify({ containment, jaccard }, semantic) {
  if (containment >= T.exact) return 'exact';
  if (containment >= T.near || jaccard >= T.near) return 'near';
  if (semantic != null && semantic >= T.para) return 'paraphrase';
  if (containment >= T.partial) return 'partial';
  return 'unrelated';
}

export const CLASS_LABEL = {
  exact: 'exact copy', near: 'near-duplicate', paraphrase: 'paraphrase',
  partial: 'partial quote', unrelated: 'unrelated',
};

/** Full lexical comparison of a prepared suspect against a candidate text. */
export function prepare(text) {
  const tokens = tokenize(text);
  const sh = shingles(tokens);
  return { text, tokens, sh, sig: minhash(sh.keys()) };
}

export function compare(sus, cand) {
  const ov = overlap(sus.sh, cand.sh);
  const { ma, mb } = matchMasks(sus.tokens, sus.sh, cand.tokens, cand.sh);
  return {
    ...ov,
    minhash: minhashSim(sus.sig, cand.sig),
    longestRun: longestRun(ma),
    rangesA: maskToRanges(sus.tokens, ma),
    rangesB: maskToRanges(cand.tokens, mb),
    shinglesA: sus.sh.size, shinglesB: cand.sh.size,
  };
}
