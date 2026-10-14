// Writes server/tests/fixtures/parity.json from the browser module, so the
// Python mirror (server/tracer/textsim.py) can be checked against it in pytest.
import { writeFileSync } from 'node:fs';
import { tokenize, fnv1a, prepare, compare, PERMS, sentences, units, windows } from '../assets/js/textsim.js';

const a = "It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife. Café owners don’t agree!";
const b = "IT is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. Naïve readers disagree.";
const pa = prepare(a), pb = prepare(b);
const c = compare(pa, pb);
const out = {
  a, b,
  tokens: tokenize(a).map(t => [t.t, t.s, t.e]),
  fnv: ['', 'a', 'hello world', 'naïve café'].map(s => [s, fnv1a(s)]),
  permA: PERMS.A.slice(0, 4), permB: PERMS.B.slice(0, 4),
  sigA: pa.sig.slice(0, 8),
  compare: { inter: c.inter, jaccard: c.jaccard, containment: c.containment, minhash: c.minhash,
             longestRun: c.longestRun, rangesA: c.rangesA, rangesB: c.rangesB },
  sentences: sentences(a),
  units: units(a + ' ' + b, 12),
  windows: windows(b + ' ' + a, 3),
};
writeFileSync(new URL('../server/tests/fixtures/parity.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.compare));
