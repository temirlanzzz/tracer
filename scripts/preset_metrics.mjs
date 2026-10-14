// Lexical metrics for the preset, computed by the same module the browser uses.
import { readFileSync } from 'node:fs';
import { prepare, compare, classify } from '../assets/js/textsim.js';
const p = JSON.parse(readFileSync(new URL('../assets/data/preset.json', import.meta.url), 'utf8'));
const S = prepare(p.suspect);
const t = performance.now();
for (const c of p.candidates) {
  if (!c.text) { console.log(c.label, '(fetched live in browser)'); continue; }
  const m = compare(S, prepare(c.text));
  console.log(c.label.padEnd(44), 'C', m.containment.toFixed(3), 'J', m.jaccard.toFixed(3), 'MH', m.minhash.toFixed(3), 'run', m.longestRun, '->', classify(m, null));
}
console.log('lexical ms', (performance.now() - t).toFixed(1), 'suspect shingles', S.sh.size);
