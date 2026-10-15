/** Portable input-only case files. Results must be recomputed, never trusted on import. */
export const CASE_VERSION = 1;
export const MAX_FILE_BYTES = 2_000_000;
export function safeUrl(value) {
  if (!value) return "";
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
export function validateCase(raw) {
  if (!raw || raw.version !== CASE_VERSION || raw.kind !== "tracer-case")
    throw new Error("Not a supported Tracer case file (version 1).");
  const str = (v, max, name) => {
    if (typeof v !== "string" || v.length > max)
      throw new Error(`${name} is missing or too large.`);
    return v;
  };
  const title = str(raw.title, 120, "Case title");
  const suspect = str(raw.suspect, 50_000, "Passage");
  if (!Array.isArray(raw.candidates) || raw.candidates.length > 30)
    throw new Error("A case can contain at most 30 sources.");
  const candidates = raw.candidates.map((c) => {
    if (!c || typeof c !== "object") throw new Error("Invalid source.");
    const url = str(c.url || "", 2048, "Source URL");
    if (url && !safeUrl(url))
      throw new Error(
        "Source URLs must use HTTP or HTTPS, without credentials.",
      );
    return {
      label: str(c.label || "", 200, "Source label"),
      url,
      text: str(c.text || "", 100_000, "Source text"),
    };
  });
  if (
    suspect.length + candidates.reduce((n, c) => n + c.text.length, 0) >
    1_000_000
  )
    throw new Error("Combined text exceeds one million characters.");
  return {
    kind: "tracer-case",
    version: CASE_VERSION,
    title,
    suspect,
    candidates,
  };
}
export function evidenceReport(result, title = "Untitled investigation") {
  const lines = [
    `TRACER / ${title}`,
    `Exported: ${new Date().toISOString()}`,
    `Run status: ${result.status || "unknown"}`,
    `Engine: ${result.engine}; semantic model: ${result.embeddings ? "enabled" : "not available / disabled"}`,
    "",
    "IMPORTANT: Similarity is not proof of copying or authorship. Archive dates establish page availability, not that the matching passage existed in that capture. Sources are a selected sample; classifications use heuristic thresholds, not calibrated confidence.",
    "",
    `PASSAGE\n${result.suspect.text}`,
    "",
    "SOURCES",
  ];
  for (const c of result.candidates) {
    lines.push(
      "",
      `${c.label || c.url || c.id} — ${c.noText ? "not compared" : c.cls}`,
      c.url || "(pasted text; no URL)",
      `Containment: ${c.metrics.containment}; Jaccard: ${c.metrics.jaccard}; Semantic coverage: ${c.metrics.semantic ?? "not measured"}`,
    );
    for (const [name, evidence] of [
      ["Live archive", c.archive],
      ["Recorded archive", c.recorded],
    ])
      if (evidence?.iso)
        lines.push(`${name}: ${evidence.iso}; ${evidence.snapshot || ""}`);
    if (c.firstRevision)
      lines.push(
        `First Wikipedia revision: ${c.firstRevision} (not passage-specific)`,
      );
    if (c.claimed?.published)
      lines.push(`Page-claimed date (unverified): ${c.claimed.published}`);
    if (c.error || c.archiveError)
      lines.push(`Incomplete evidence: ${c.error || c.archiveError}`);
  }
  return lines.join("\n");
}
