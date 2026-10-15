import {
  validateCase,
  safeUrl,
  evidenceReport,
  MAX_FILE_BYTES,
} from "./casefile.js";
import {
  prepare,
  compare,
  classify,
  sentences,
  tokenize,
  units,
  coverage,
  T as TH,
  CLASS_LABEL,
} from "./textsim.js";
import { firstSeenProbe } from "./wayback.js";
import { wikiTitle, fetchWikipedia, fetchDirect } from "./sources.js";
import { renderGraph, autoResize } from "./graph.js";

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (x, d = 2) => (x == null ? "—" : x.toFixed(d));
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
const RANK = { exact: 0, near: 1, paraphrase: 2, partial: 3, unrelated: 4 };

// ---------- theme ----------
$("#theme").addEventListener("click", () => {
  const root = document.documentElement;
  const cur =
    root.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch (e) {
    /* storage off */
  }
  if (lastResult) renderGraph($("#graph"), lastResult);
});

// ---------- inputs ----------
const sus = $("#suspect");
const candsEl = $("#cands");
let preset = null; // loaded example (carries recorded server evidence)
let lastResult = null;
let controller = null;
let runId = 0;
// A slow example response must never replace newer user work.
let inputGeneration = 0;
$(".demo").addEventListener("input", () => {
  inputGeneration++;
});
function stopRun() {
  runId++;
  controller?.abort();
  if (lastResult && lastResult.status === "partial")
    lastResult.status = "cancelled-partial";
  controller = null;
  import("./embed.js").then((m) => m.cancel());
  $("#run").disabled = false;
  $("#run").textContent = "Compare sources";
  $("#cancel").hidden = true;
  $("#example").disabled = false;
}
$("#cancel").addEventListener("click", () => {
  stopRun();
  log(
    "Investigation cancelled. Partial results, if shown, are incomplete.",
    "err",
  );
});

const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
sus.addEventListener("input", () => {
  $("#sus-count").textContent = words(sus.value) + " words";
});

function addCand(c = {}) {
  if (candsEl.children.length >= 30) {
    log("Maximum 30 candidate sources per case.", "err");
    return;
  }
  const el = document.createElement("div");
  el.className = "cand";
  el.innerHTML = `
    <div class="cand-row"><span class="n"></span>
      <input type="text" class="lbl" aria-label="Source label" maxlength="200" placeholder="label (optional)" spellcheck="false">
      <button class="x" type="button" aria-label="Remove source">×</button></div>
    <div class="cand-row"><span class="n"></span>
      <input type="url" class="url mono" aria-label="Source URL" maxlength="2048" placeholder="https://… (optional if you paste text)" spellcheck="false"></div>
    <textarea class="txt" aria-label="Source text" maxlength="100000" spellcheck="false" placeholder="page text (paste here when the site can't be fetched)"></textarea>`;
  el.querySelector(".lbl").value = c.label || "";
  el.querySelector(".url").value = c.url || "";
  el.querySelector(".txt").value = c.text || "";
  el.dataset.note = c.note || "";
  el.querySelector(".x").addEventListener("click", () => {
    inputGeneration++;
    el.remove();
    renumber();
  });
  candsEl.appendChild(el);
  renumber();
}
function renumber() {
  [...candsEl.children].forEach((el, i) => {
    el.querySelector(".n").textContent = i + 1;
  });
  $("#cand-count").textContent = candsEl.children.length + " sources";
}
function readCands() {
  return [...candsEl.children]
    .map((el, i) => ({
      id: "c" + i,
      label: el.querySelector(".lbl").value.trim(),
      url: el.querySelector(".url").value.trim(),
      text: el.querySelector(".txt").value,
      note: el.dataset.note || "",
    }))
    .filter((c) => c.url || c.text.trim());
}
$("#add").addEventListener("click", () => {
  inputGeneration++;
  addCand();
});

async function loadPreset(generation = ++inputGeneration) {
  let loaded = preset;
  if (!loaded) {
    const r = await fetch("assets/data/preset.json");
    loaded = await r.json();
  }
  if (generation !== inputGeneration) return false;
  preset = loaded;
  sus.value = preset.suspect;
  sus.dispatchEvent(new Event("input"));
  candsEl.innerHTML = "";
  preset.candidates.forEach(addCand);
  $("#server").value = "";
  return true;
}
$("#example").addEventListener("click", async () => {
  try {
    if (!(await loadPreset())) return;
    $("#case-title").value = "Austen / a trail through the web";
    run();
  } catch (e) {
    log("Example could not load: " + e.message, "err");
  }
});

// ---------- log ----------
const logEl = $("#log");
function log(msg, cls = "") {
  const li = document.createElement("li");
  li.textContent = msg;
  if (cls) li.className = cls;
  logEl.appendChild(li);
  logEl.scrollTop = logEl.scrollHeight;
  return li;
}

// ---------- pipeline (browser) ----------
async function resolveText(c, signal) {
  if (c.text.trim()) {
    c.source = "pasted";
    return;
  }
  if (!c.url) return;
  if (wikiTitle(c.url)) {
    try {
      const w = await fetchWikipedia(c.url, signal);
      Object.assign(c, {
        text: w.text,
        firstRevision: w.firstRevision,
        claimed: w.claimed,
        source: "fetched-wikipedia",
      });
      log(
        `wikipedia: fetched ${words(w.text).toLocaleString()} words live, first revision ${w.firstRevision}`,
        "ok",
      );
      return;
    } catch (e) {
      if (signal.aborted) throw e;
      c.needsPaste = true;
      c.error = e.message;
      log(`${host(c.url)}: Wikipedia fetch failed — paste source text`, "err");
      return;
    }
  }
  try {
    const d = await fetchDirect(c.url, signal);
    Object.assign(c, { text: d.text, claimed: d.claimed, source: "fetched" });
    log(
      `${host(c.url)}: fetched ${words(d.text).toLocaleString()} words`,
      "ok",
    );
  } catch (e) {
    if (signal.aborted) throw e;
    c.needsPaste = true;
    c.error = e.message;
    log(
      `${host(c.url)}: ${e.message} — paste the page text to compare it`,
      "err",
    );
  }
}

async function wikiFirstRevisionOnly(c, signal) {
  // pasted Wikipedia text still gets its independent first-revision date
  if (c.firstRevision || !wikiTitle(c.url)) return;
  try {
    const w = await fetchWikipedia(c.url, signal);
    c.firstRevision = w.firstRevision;
    c.claimed = c.claimed || w.claimed;
  } catch {
    /* optional */
  }
}

// Candidate side of the semantic pass. Each sentence is embedded once; a 1-3 sentence window is the
// word-weighted mean of its sentence vectors (re-normalised). On long pages only the 50 sentences
// sharing most words with the suspect, plus two neighbours each side, are embedded.
async function candidateWindows(em, text, susTokens, keep = 50) {
  const ss = sentences(text).slice(0, 2000);
  let idx = [...ss.keys()];
  if (ss.length > 80) {
    const vocab = new Set(
      susTokens.map((t) => t.t).filter((t) => t.length > 3),
    );
    const top = ss
      .map((s, i) => [i, tokenize(s.text).filter((t) => vocab.has(t.t)).length])
      .sort((a, b) => b[1] - a[1])
      .slice(0, keep)
      .map((x) => x[0]);
    const set = new Set();
    for (const i of top)
      for (let k = i - 2; k <= i + 2; k++)
        if (k >= 0 && k < ss.length) set.add(k);
    idx = [...set].sort((a, b) => a - b);
  }
  const vecs = await em.embed(idx.map((i) => ss[i].text));
  const V = new Map(idx.map((i, n) => [i, vecs[n]]));
  const out = [];
  for (const i of idx)
    for (let len = 1; len <= 3; len++) {
      if (![...Array(len).keys()].every((d) => V.has(i + d))) break;
      const v = new Float32Array(384);
      for (let d = 0; d < len; d++) {
        const w = ss[i + d].text.split(/\s+/).length,
          x = V.get(i + d);
        for (let q = 0; q < 384; q++) v[q] += x[q] * w;
      }
      let n = 0;
      for (let q = 0; q < 384; q++) n += v[q] * v[q];
      n = Math.sqrt(n) || 1;
      for (let q = 0; q < 384; q++) v[q] /= n;
      out.push({ v, s: ss[i].s, e: ss[i + len - 1].e });
    }
  return { windows: out, embedded: idx.length };
}

function originOf(cands) {
  let related = cands.filter((c) =>
    ["exact", "near", "paraphrase"].includes(c.cls),
  );
  if (!related.length) related = cands.filter((c) => c.cls === "partial");
  const ind = related
    .map((c) => ({ c, d: independentDate(c) }))
    .filter((x) => x.d);
  if (ind.length) {
    const best = ind.sort((a, b) => a.d.date.localeCompare(b.d.date))[0];
    return { id: best.c.id, date: best.d.date, basis: best.d.basis };
  }
  const cl = related
    .map((c) => ({ c, d: c.claimed && c.claimed.published }))
    .filter((x) => x.d)
    .sort((a, b) => a.d.localeCompare(b.d));
  return cl.length
    ? { id: cl[0].c.id, date: cl[0].d.slice(0, 10), basis: "claimed" }
    : null;
}

function independentDate(c) {
  const opts = [];
  if (c.archive && c.archive.iso)
    opts.push({ date: c.archive.iso.slice(0, 10), basis: "archive" });
  if (c.recorded && c.recorded.iso)
    opts.push({ date: c.recorded.iso.slice(0, 10), basis: "archive (cdx)" });
  if (c.firstRevision)
    opts.push({ date: c.firstRevision, basis: "first revision" });
  return opts.sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

async function runLocal(text, cands, signal, onPartial) {
  const useSem = $("#opt-sem").checked,
    useWb = $("#opt-wb").checked;
  const T = { start: performance.now() };

  // attach evidence recorded by the server for the example (clearly labelled in the UI)
  for (const c of cands) {
    const rec = preset && preset.recorded && preset.recorded.byUrl[c.url];
    if (rec && preset.candidates.some((p) => p.url === c.url)) {
      c.recorded = rec.archive
        ? { ...rec.archive, on: preset.recorded.date }
        : null;
      c.claimed =
        rec.claimed && Object.keys(rec.claimed).length
          ? rec.claimed
          : c.claimed;
      c.claimedBy = "htmldate, recorded " + preset.recorded.date;
    }
  }

  // 1) text + 2) wayback probes, concurrently
  const tf = performance.now();
  const textJobs = Promise.all(
    cands.map((c) =>
      resolveText(c, signal).then(() => wikiFirstRevisionOnly(c, signal)),
    ),
  ).then(() => {
    T.fetch = performance.now() - tf;
  });
  const wbJobs = useWb
    ? Promise.all(
        cands
          .filter((c) => c.url)
          .map(async (c) => {
            const li = log(`wayback: probing ${host(c.url)}…`);
            c.archivePending = true;
            const r = await firstSeenProbe(c.url, {
              signal,
              batch: 4,
              onProgress: (p) => {
                li.textContent = `wayback: probing ${host(c.url)} · ${p.probes} probes, up to ${p.upTo}${p.failed ? ` · ${p.failed} refused` : ""}`;
              },
            }).catch((e) => {
              if (signal.aborted) throw e;
              return { error: e.message, probes: 0 };
            });
            c.archivePending = false;
            if (r.error) {
              c.archiveError = r.error;
              li.textContent = `wayback: ${host(c.url)} — ${r.error} (${r.probes} probes)`;
              li.className = "err";
            } else if (r.none) {
              c.archive = null;
              c.archiveNone = true;
              li.textContent = `wayback: ${host(c.url)} — no capture found in ${r.probes} probes`;
              li.className = "ok";
            } else {
              c.archive = r;
              li.textContent = `wayback: ${host(c.url)} — earliest capture found ${r.iso} (${r.probes} probes)`;
              li.className = "ok";
            }
          }),
      ).then(() => {
        T.wayback = performance.now() - tf;
      })
    : Promise.resolve();

  // model download can overlap with network work
  let modelP = null;
  if (useSem) {
    const li = log("model: loading MiniLM…");
    const tm = performance.now();
    const seen = {};
    modelP = import("./embed.js")
      .then((m) =>
        m
          .loadModel((p) => {
            if (p.status === "progress" && p.file && p.total) {
              seen[p.file] = [p.loaded, p.total];
              const [l, t] = Object.values(seen).reduce(
                (a, [x, y]) => [a[0] + x, a[1] + y],
                [0, 0],
              );
              li.textContent = `model: downloading ${(l / 1e6).toFixed(1)} / ${(t / 1e6).toFixed(1)} MB`;
            }
          })
          .then(() => {
            T.model = performance.now() - tm;
            li.textContent = `model: MiniLM ready in ${(T.model / 1000).toFixed(1)} s`;
            li.className = "ok";
            return m;
          }),
      )
      .catch((e) => {
        li.textContent =
          "model: could not load (" +
          e.message +
          ") — paraphrase detection off";
        li.className = "err";
        return null;
      });
  }

  wbJobs.catch(() => {}); // rejection is observed immediately; awaited below after analysis
  await textJobs;
  signal.throwIfAborted();
  const tl = performance.now();
  const S = prepare(text);
  for (const c of cands) {
    const m = compare(S, prepare(c.text || ""));
    c.metrics = {
      jaccard: m.jaccard,
      containment: m.containment,
      minhash: m.minhash,
      longestRun: m.longestRun,
      inter: m.inter,
      shinglesA: m.shinglesA,
      shinglesB: m.shinglesB,
      semantic: null,
    };
    c.rangesA = m.rangesA;
    c.rangesB = m.rangesB;
    c.paraPairs = [];
  }
  T.lexical = performance.now() - tl;

  const em = modelP ? await modelP : null;
  signal.throwIfAborted();
  if (em) {
    const te = performance.now();
    const A = units(text);
    const aVec = await em.embed(A.map((u) => u.text));
    let nSent = 0;
    for (const c of cands) {
      signal.throwIfAborted();
      if (!c.text) continue;
      const { windows: B, embedded } = await candidateWindows(
        em,
        c.text,
        S.tokens,
      );
      if (!B.length) continue;
      nSent += embedded;
      const best = aVec.map((a) => {
        let bc = -1,
          bj = 0;
        B.forEach((b, j) => {
          const d = em.dot(a, b.v);
          if (d > bc) {
            bc = d;
            bj = j;
          }
        });
        return [bc, bj];
      });
      c.metrics.semantic = coverage(A, best);
      c.paraPairs = best
        .map(([cos, j], i) => ({
          a: [A[i].s, A[i].e],
          b: [B[j].s, B[j].e],
          cos,
        }))
        .filter((p) => p.cos >= TH.unitCos);
    }
    T.embed = performance.now() - te;
    log(
      `model: embedded ${A.length} suspect passages and ${nSent.toLocaleString()} candidate sentences in ${(T.embed / 1000).toFixed(1)} s`,
      "ok",
    );
  }
  signal.throwIfAborted();
  for (const c of cands) {
    c.noText = !c.text;
    c.cls = c.text ? classify(c.metrics, c.metrics.semantic) : "unrelated";
  }
  const result = {
    engine: "browser",
    embeddings: !!em,
    suspect: { text },
    candidates: cands,
    origin: originOf(cands),
    timings: T,
  };
  T.analysis = performance.now() - T.start;
  if (onPartial && useWb) {
    T.total = T.analysis;
    onPartial(result);
  }
  await wbJobs;
  result.origin = originOf(cands);
  T.total = performance.now() - T.start;
  return result;
}

async function runServer(base, text, cands, signal) {
  const t0 = performance.now();
  const body = {
    text,
    search: $("#opt-search").checked,
    candidates: cands.map((c) => ({
      url: c.url || undefined,
      text: c.text.trim() ? c.text : undefined,
      label: c.label || undefined,
    })),
  };
  log(
    `server: POST ${base}/api/trace${body.search ? " (with web search)" : ""}…`,
  );
  const r = await fetch(base.replace(/\/$/, "") + "/api/trace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw new Error("server answered HTTP " + r.status);
  const d = await r.json();
  d.candidates.forEach((c, i) => {
    c.label = c.label || (cands[i] && cands[i].label) || "";
  });
  d.timings = { total: performance.now() - t0, server: d.timings };
  log(
    `server: ${d.candidates.length} sources compared in ${(d.timings.total / 1000).toFixed(1)} s (embeddings ${d.embeddings ? "on" : "off"})`,
    "ok",
  );
  return d;
}

async function run() {
  const text = sus.value;
  const cands = readCands();
  try {
    validateCase({
      kind: "tracer-case",
      version: 1,
      title: $("#case-title").value,
      suspect: text,
      candidates: cands,
    });
  } catch (e) {
    log(e.message, "err");
    return;
  }
  if ($("#server").value.trim() && !safeUrl($("#server").value.trim())) {
    log("Server must be an HTTP or HTTPS URL without credentials.", "err");
    return;
  }
  if (words(text) < 5) {
    log("paste at least a sentence of suspect text first", "err");
    return;
  }
  if (
    !cands.length &&
    !($("#server").value.trim() && $("#opt-search").checked)
  ) {
    log("add at least one candidate source", "err");
    return;
  }
  if (controller) controller.abort();
  controller = new AbortController();
  const id = ++runId,
    signal = controller.signal;
  $("#cancel").hidden = false;
  $("#example").disabled = true;
  $("#results").hidden = true;
  lastResult = null;
  const btn = $("#run");
  btn.disabled = true;
  btn.textContent = "tracing…";
  logEl.innerHTML = "";
  try {
    const base = $("#server").value.trim();
    const res = base
      ? await runServer(base, text, cands, signal)
      : await runLocal(text, cands, signal, (partial) => {
          if (id !== runId || signal.aborted) return;
          lastResult = partial;
          render(partial, true);
          log(
            `text analysis done in ${(partial.timings.analysis / 1000).toFixed(1)} s — results shown, archive dates still coming in`,
            "ok",
          );
        });
    if (id !== runId || signal.aborted) return;
    lastResult = res;
    render(res);
    log(`done in ${(res.timings.total / 1000).toFixed(1)} s`, "ok");
    window.__tracer = { result: res };
  } catch (e) {
    if (id === runId && e.name !== "AbortError") {
      log("failed: " + e.message, "err");
      console.error(e);
    }
  } finally {
    if (id === runId) {
      btn.disabled = false;
      btn.textContent = "Compare sources";
      $("#cancel").hidden = true;
      $("#example").disabled = false;
      controller = null;
    }
  }
}
$("#run").addEventListener("click", run);

// ---------- rendering ----------
function displayName(c) {
  return (
    c.label || (c.url ? host(c.url) : "pasted text " + c.id.replace(/\D/g, ""))
  );
}

function render(res, partial = false) {
  res.status = partial ? "partial" : "complete";
  $("#results").hidden = false;
  const cands = [...res.candidates].sort(
    (a, b) =>
      (res.origin && a.id === res.origin.id ? -1 : 0) -
        (res.origin && b.id === res.origin.id ? -1 : 0) ||
      RANK[a.cls] - RANK[b.cls] ||
      b.metrics.containment - a.metrics.containment,
  );
  const n = (k) => res.candidates.filter((c) => c.cls === k).length;
  const o = res.origin && res.candidates.find((c) => c.id === res.origin.id);
  const flags = res.candidates
    .filter((c) => c.cls !== "unrelated")
    .map(flagFor)
    .filter(Boolean);
  const basisText = {
    archive: "First archived by the Wayback Machine",
    "archive (cdx)": "First archived by the Wayback Machine (CDX)",
    "first revision": "First Wikipedia revision",
    claimed: "Only the date the page claims; no independent evidence",
  };
  $("#verdict").innerHTML = `
    <div>
      <span class="label">assessment · ${res.engine === "server" ? "server" : "in your browser"} · ${partial ? "waiting for live archive probes…" : (res.timings.total / 1000).toFixed(1) + " s"}</span>
      ${
        o
          ? `<h2>Earliest evidence: <em>${esc(displayName(o))}</em>, ${esc(res.origin.date)}.</h2>
      <p>${esc(basisText[res.origin.basis] || res.origin.basis)}. This dates the page only. The matching passage may have been added later; an earlier source may be missing from this investigation.</p>`
          : `<h2>No dated source among the matches.</h2><p>Add URLs so the archive can date them.</p>`
      }
      ${flags.length ? `<p class="flag">${flags.map(esc).join("<br>")}</p>` : ""}
    </div>
    <div class="counts">
      <div><span class="label">exact copies</span><div class="v acc">${n("exact")}</div></div>
      <div><span class="label">near-dups</span><div class="v">${n("near")}</div></div>
      <div><span class="label">paraphrases</span><div class="v">${n("paraphrase")}</div></div>
      <div><span class="label">partial quotes</span><div class="v">${n("partial")}</div></div>
      <div><span class="label">unrelated</span><div class="v">${n("unrelated")}</div></div>
      <div><span class="label">sources</span><div class="v">${res.candidates.length}</div></div>
    </div>`;
  renderGraph($("#graph"), res);
  $("#graph-note").textContent = res.candidates.some(
    (c) => c.cls !== "unrelated",
  )
    ? ""
    : "nothing related to plot";
  $("#cards").innerHTML = "";
  cands.forEach((c) => $("#cards").appendChild(card(c, res)));
}

function flagFor(c) {
  const ind = independentDate(c);
  const claim = c.claimed && c.claimed.published;
  if (ind && claim && claim.slice(0, 4) !== ind.date.slice(0, 4)) {
    const y = claim.slice(0, 10),
      iy = ind.date;
    return claim > iy
      ? `${displayName(c)} dates itself ${y}, but the ${ind.basis} shows it on ${iy}.`
      : `${displayName(c)} claims ${y}, earlier than any independent evidence (${iy}); not independently verified.`;
  }
  return null;
}

function bar(label, v, main, title) {
  const na = v == null;
  return `<div class="bar${main ? " main" : ""}${na ? " na" : ""}" title="${esc(title)}"><span>${label}</span>
    <div class="track"><div class="fill" style="width:${na ? 0 : Math.max(0, Math.min(1, v)) * 100}%"></div></div><span class="v">${fmt(v)}</span></div>`;
}

function card(c, res) {
  const el = document.createElement("article");
  el.className = "panel rc";
  const isOrigin = res.origin && res.origin.id === c.id;
  const m = c.metrics;
  const dates = [];
  if (c.archivePending)
    dates.push(["first archived", "probing the Wayback Machine…"]);
  else if (c.archive && c.archive.iso)
    dates.push([
      "first archived",
      `<a href="${esc(safeUrl(c.archive.snapshot))}" target="_blank" rel="noopener">${esc(c.archive.iso.slice(0, 10))}</a> · ${c.archive.source === "wayback-cdx" ? "wayback cdx" : `live probe, ${c.archive.probes} requests`}`,
    ]);
  else if (c.archiveError)
    dates.push([
      "first archived",
      `<span class="flag">${esc(c.archiveError)}</span>`,
    ]);
  else if (c.archiveNone)
    dates.push([
      "first archived",
      "no capture found in this probe (not proof of absence)",
    ]);
  if (c.recorded)
    dates.push([
      "cdx (recorded)",
      `<a href="${esc(safeUrl(c.recorded.snapshot))}" target="_blank" rel="noopener">${esc(c.recorded.iso.slice(0, 10))}</a> · server run ${esc(c.recorded.on)}`,
    ]);
  if (c.firstRevision)
    dates.push(["first revision", esc(c.firstRevision) + " · wikipedia api"]);
  if (c.claimed && c.claimed.published)
    dates.push([
      "page claims",
      esc(c.claimed.published) +
        " published" +
        (c.claimedBy ? ` · ${esc(c.claimedBy)}` : ""),
    ]);
  if (
    c.claimed &&
    c.claimed.updated &&
    c.claimed.updated !== c.claimed.published
  )
    dates.push(["page claims", esc(c.claimed.updated) + " last updated"]);
  const flag = flagFor(c);
  const srcNote = c.noText
    ? "no text to compare — paste the page text into this source and run again"
    : c.source === "pasted"
      ? c.note || "text pasted"
      : c.source === "fetched-wikipedia"
        ? "text fetched live from the Wikipedia API"
        : c.source === "fetched"
          ? "text fetched live"
          : c.note || "";
  el.innerHTML = `
    <div class="rc-head">
      <div>
        <div class="rc-title"><b>${esc(displayName(c))}</b>
          <span class="chip ${c.cls}">${c.noText ? "not compared" : CLASS_LABEL[c.cls]}</span>
          ${isOrigin ? '<span class="chip origin">earliest evidence</span>' : ""}</div>
        ${c.url ? `<a class="rc-url" href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">${esc(c.url)}</a>` : ""}
        ${dates.length ? `<div class="dates">${dates.map(([k, v]) => `<div><span class="k">${k}</span><span>${v}</span></div>`).join("")}</div>` : ""}
        ${flag ? `<div class="note flag">${esc(flag)}</div>` : ""}
        ${srcNote ? `<div class="note">${esc(srcNote)}</div>` : ""}
      </div>
      <div class="bars">
        ${bar("containment", m.containment, true, "share of the suspect's 5-grams found in this source")}
        ${bar("jaccard", m.jaccard, false, "exact Jaccard of the two 5-gram sets")}
        ${bar("minhash", m.minhash, false, "128-permutation MinHash estimate of Jaccard")}
        ${bar("semantic", m.semantic, false, "share of suspect passages with a close MiniLM match (cosine >= 0.6)")}
        <div class="note">${m.inter} of ${m.shinglesA} suspect 5-grams shared · longest run ${m.longestRun} words</div>
      </div>
    </div>
    ${
      c.text
        ? `<details><summary>show evidence side by side</summary><div class="side-by-side">
      <div><span class="label">suspect · highlighted where it matches</span><div class="doc">${highlight(
        res.suspect.text,
        c.rangesA,
        c.paraPairs.map((p) => p.a),
        false,
      )}</div></div>
      <div><span class="label">${esc(displayName(c))} · ${(c.text.length / 1000).toFixed(1)}k chars${c.text.length > 6000 ? ", excerpts" : ""}</span><div class="doc">${highlight(
        c.text,
        c.rangesB,
        c.paraPairs.map((p) => p.b),
        c.text.length > 6000,
      )}</div></div>
    </div></details>`
        : ""
    }`;
  return el;
}

/** Render text with <mark> for shared 5-gram spans and dotted underline for paraphrase sentences. */
function highlight(text, ranges, paraRanges, excerpt) {
  const n = text.length;
  const f = new Uint8Array(n);
  for (const [s, e] of paraRanges || [])
    for (let i = s; i < e && i < n; i++) f[i] = 2;
  for (const [s, e] of ranges || [])
    for (let i = s; i < e && i < n; i++) f[i] = 1;
  let vis = null;
  if (excerpt) {
    vis = new Uint8Array(n);
    const W = 160;
    let any = false;
    for (let i = 0; i < n; i++)
      if (f[i]) {
        any = true;
        for (let k = Math.max(0, i - W); k < Math.min(n, i + W); k++)
          vis[k] = 1;
      }
    if (!any) for (let k = 0; k < Math.min(n, 1200); k++) vis[k] = 1;
  }
  let out = "",
    i = 0;
  while (i < n) {
    if (vis && !vis[i]) {
      let j = i;
      while (j < n && !vis[j]) j++;
      out += `<span class="gap">\n… ${(j - i).toLocaleString()} chars …\n</span>`;
      i = j;
      continue;
    }
    let j = i;
    while (j < n && f[j] === f[i] && (!vis || vis[j])) j++;
    const seg = esc(text.slice(i, j));
    out +=
      f[i] === 1
        ? `<mark>${seg}</mark>`
        : f[i] === 2
          ? `<span class="para">${seg}</span>`
          : seg;
    i = j;
  }
  return out;
}

// ---------- case shelf (explicit opt-in; input-only imports) ----------
const SHELF_KEY = "tracer.cases.v1";
function status(msg) {
  $("#case-status").textContent = msg;
}
function currentCase() {
  return validateCase({
    kind: "tracer-case",
    version: 1,
    title: $("#case-title").value.trim() || "Untitled investigation",
    suspect: sus.value,
    candidates: readCands(),
  });
}
function shelf() {
  const data = JSON.parse(localStorage.getItem(SHELF_KEY) || "[]");
  if (!Array.isArray(data)) throw new Error("Saved shelf is invalid.");
  return data;
}
function refreshShelf() {
  const select = $("#saved-cases");
  select.replaceChildren(new Option("Choose a saved investigation", ""));
  try {
    shelf().forEach((c, i) => select.add(new Option(c.title, String(i))));
  } catch {
    status("Local storage is unavailable. You can still export case files.");
  }
}
function applyCase(raw) {
  const c = validateCase(raw);
  inputGeneration++;
  stopRun();
  preset = null;
  lastResult = null;
  $("#results").hidden = true;
  logEl.replaceChildren();
  sus.value = c.suspect;
  sus.dispatchEvent(new Event("input"));
  $("#case-title").value = c.title;
  candsEl.replaceChildren();
  c.candidates.forEach(addCand);
  renumber();
  $("#server").value = "";
  $("#opt-search").checked = false;
  status("Case opened. Compare sources to produce fresh results.");
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#save-case").addEventListener("click", () => {
  try {
    const c = currentCase(),
      all = shelf();
    const i = all.findIndex((x) => x.title === c.title);
    if (i >= 0) all[i] = c;
    else all.unshift(c);
    if (all.length > 20)
      throw new Error(
        "Shelf is full (20 cases). Export and delete an older case first.",
      );
    localStorage.setItem(SHELF_KEY, JSON.stringify(all));
    refreshShelf();
    status("Saved in this browser. Saving the same title replaces that case.");
  } catch (e) {
    status("Could not save: " + e.message + " Export a case file instead.");
  }
});
$("#open-case").addEventListener("click", () => {
  try {
    if ($("#saved-cases").value === "")
      return status("Choose a saved case first.");
    applyCase(shelf()[Number($("#saved-cases").value)]);
  } catch (e) {
    status(e.message);
  }
});
$("#delete-case").addEventListener("click", () => {
  try {
    if ($("#saved-cases").value === "")
      return status("Choose a saved case first.");
    const all = shelf();
    all.splice(Number($("#saved-cases").value), 1);
    localStorage.setItem(SHELF_KEY, JSON.stringify(all));
    refreshShelf();
    status("Removed from this browser. The open text is unchanged.");
  } catch (e) {
    status(e.message);
  }
});
$("#export-case").addEventListener("click", () => {
  try {
    download(
      JSON.stringify(currentCase(), null, 2),
      "tracer-case.json",
      "application/json",
    );
    status(
      "Case exported. It contains passage and source text, not verified results.",
    );
  } catch (e) {
    status(e.message);
  }
});
$("#import-case").addEventListener("click", () => $("#case-file").click());
$("#case-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    if (f.size > MAX_FILE_BYTES) throw new Error("File exceeds 2 MB.");
    applyCase(JSON.parse(await f.text()));
  } catch (err) {
    status("Could not import: " + err.message);
  } finally {
    e.target.value = "";
  }
});
$("#export-report").addEventListener("click", () => {
  if (lastResult)
    download(
      evidenceReport(lastResult, $("#case-title").value),
      "tracer-evidence.txt",
      "text/plain",
    );
});
refreshShelf();

// ---------- boot ----------
autoResize($("#graph"), () => lastResult);
const bootGeneration = inputGeneration;
loadPreset(bootGeneration)
  .then((applied) => {
    if (applied && new URLSearchParams(location.search).has("run")) run();
  })
  .catch(() => {
    if (bootGeneration !== inputGeneration) return;
    addCand();
    addCand();
  });
