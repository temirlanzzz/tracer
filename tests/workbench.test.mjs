import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("workbench compares, saves/restores, cancels and ignores stale server results", async () => {
  const dom = new JSDOM(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
    { url: "http://localhost/", pretendToBeVisual: true },
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
  let serverResolve;
  globalThis.fetch = async (url) => {
    if (url === "assets/data/preset.json")
      return {
        json: async () =>
          JSON.parse(
            await readFile(
              new URL("../assets/data/preset.json", import.meta.url),
              "utf8",
            ),
          ),
      };
    return new Promise((resolve) => {
      serverResolve = resolve;
    });
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
  const $ = (selector) => w.document.querySelector(selector);
  await import("../assets/js/app.js");
  await tick();
  assert.equal(w.document.querySelectorAll(".cand").length, 6);
  $("#opt-sem").checked = false;
  $("#opt-wb").checked = false;
  w.document.querySelectorAll(".x").forEach((x) => x.click());
  $("#add").click();
  const passage =
    "One memorable sentence has more than five words to match across both supplied sources.";
  $("#suspect").value = passage;
  $(".txt").value = passage;
  $("#case-title").value = "Local case";
  $("#save-case").click();
  $("#run").click();
  await tick();
  assert.equal(w.__tracer.result.candidates[0].cls, "exact");
  assert.match($("#cards").textContent, /exact copy/);
  assert.ok($("#cards mark"));
  $("#suspect").value = "changed";
  $("#saved-cases").value = "0";
  $("#open-case").click();
  await tick();
  assert.equal($("#suspect").value, passage);
  assert.equal($("#results").hidden, true);
  $("#server").value = "http://localhost:8787";
  $("#run").click();
  await tick();
  assert.equal($("#cancel").hidden, false);
  $("#cancel").click();
  await tick();
  assert.equal($("#run").disabled, false);
  $("#server").value = "";
  $("#run").click();
  await tick();
  const result = w.__tracer.result;
  serverResolve({ ok: false, status: 500 });
  await tick();
  assert.equal(w.__tracer.result, result);
  assert.doesNotMatch($("#log").textContent, /failed:/);
  assert.equal($("#results").hidden, false);
  assert.equal($("#run").disabled, false);
  dom.window.close();
});
