import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

for (const action of ["open", "import", "edit", "failed-boot"]) {
  test(`delayed boot preserves newer ${action} work`, async () => {
    const dom = new JSDOM(
      await readFile(new URL("../index.html", import.meta.url), "utf8"),
      { url: "http://localhost/?run", pretendToBeVisual: true },
    );
    const w = dom.window;
    for (const key of [
      "window",
      "document",
      "localStorage",
      "location",
      "Event",
      "Option",
    ])
      globalThis[key] = key === "window" ? w : w[key];
    globalThis.addEventListener = w.addEventListener.bind(w);
    globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w);
    globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
    globalThis.matchMedia = () => ({ matches: false });
    let resolvePreset, rejectPreset;
    globalThis.fetch = () =>
      new Promise((resolve, reject) => {
        resolvePreset = resolve;
        rejectPreset = reject;
      });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
    const $ = (selector) => w.document.querySelector(selector);
    const saved = {
      kind: "tracer-case",
      version: 1,
      title: "MY CASE",
      suspect:
        "My own passage must never be silently replaced by a delayed example.",
      candidates: [{ label: "My source", url: "", text: "My source text" }],
    };
    localStorage.setItem("tracer.cases.v1", JSON.stringify([saved]));
    await import(`../assets/js/app.js?race=${action}`);
    if (action === "open") {
      $("#saved-cases").value = "0";
      $("#open-case").click();
    } else if (action === "import") {
      Object.defineProperty($("#case-file"), "files", {
        value: [{ size: 500, text: async () => JSON.stringify(saved) }],
      });
      $("#case-file").dispatchEvent(new w.Event("change"));
      await tick();
    } else {
      $("#case-title").value = saved.title;
      $("#case-title").dispatchEvent(new w.Event("input", { bubbles: true }));
      $("#suspect").value = saved.suspect;
      $("#suspect").dispatchEvent(new w.Event("input", { bubbles: true }));
      $("#add").click();
      $(".txt").value = saved.candidates[0].text;
    }
    if (action === "failed-boot") rejectPreset(new Error("offline"));
    else
      resolvePreset({
        json: async () => ({
          suspect: "Austen",
          candidates: [{ text: "Austen source" }],
        }),
      });
    await tick();
    assert.equal($("#case-title").value, saved.title);
    assert.equal($("#suspect").value, saved.suspect);
    assert.equal($(".txt").value, saved.candidates[0].text);
    assert.equal(w.document.querySelectorAll(".cand").length, 1);
    assert.equal($("#results").hidden, true);
    assert.equal($("#run").disabled, false);
    assert.equal(
      w.__tracer,
      undefined,
      "stale boot must not auto-run newer user inputs",
    );
    dom.window.close();
  });
}
