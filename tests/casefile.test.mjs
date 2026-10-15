import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCase,
  safeUrl,
  evidenceReport,
} from "../assets/js/casefile.js";
const example = () => ({
  kind: "tracer-case",
  version: 1,
  title: "Test",
  suspect: "A passage",
  candidates: [
    { label: "Source", url: "https://example.com", text: "The source" },
  ],
});
test("case roundtrip preserves inputs and discards untrusted results/options", () => {
  const raw = {
    ...example(),
    result: { origin: "forged" },
    server: "http://attacker",
    candidates: [
      { ...example().candidates[0], recorded: { iso: "1900-01-01" } },
    ],
  };
  assert.deepEqual(validateCase(JSON.parse(JSON.stringify(raw))), example());
});
test("rejects incompatible, oversized and malformed imports", () => {
  for (const raw of [
    null,
    {},
    { ...example(), version: 2 },
    { ...example(), candidates: Array(31).fill({}) },
    { ...example(), suspect: "x".repeat(50001) },
    { ...example(), candidates: [null] },
  ])
    assert.throws(() => validateCase(raw));
});
test("links cannot execute scripts or expose URL credentials", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "https://me:secret@example.com",
  ]) {
    assert.equal(safeUrl(url), "");
    assert.throws(() => validateCase({ ...example(), candidates: [{ url }] }));
  }
  assert.equal(safeUrl("https://example.com/a"), "https://example.com/a");
});
test("report includes evidence limitations and missing semantic data", () => {
  const report = evidenceReport({
    engine: "browser",
    embeddings: false,
    suspect: { text: "Passage" },
    candidates: [
      {
        id: "c0",
        cls: "exact",
        metrics: { containment: 1, jaccard: 1, semantic: null },
        archive: { iso: "2020-01-01", snapshot: "https://example.com" },
      },
    ],
  });
  assert.match(report, /not proof of copying/);
  assert.match(report, /not measured/);
  assert.match(report, /2020-01-01/);
});
