// Start a static server on port 8083 before running this script.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await page.goto("http://127.0.0.1:8083");
    await page.waitForFunction(
      () => document.querySelectorAll(".cand").length === 6,
    );
    await page.locator("#opt-sem").uncheck();
    await page.locator("#opt-wb").uncheck();
    const passage =
      "A very distinctive passage contains more than five memorable words in this exact sequence.";
    await page.locator("#suspect").fill(passage);
    await page.locator(".x").evaluateAll((xs) => xs.forEach((x) => x.click()));
    await page.locator("#add").click();
    await page.locator(".txt").fill(passage);
    await page.locator("#case-title").fill("Verification case");
    await page.locator("#save-case").click();
    await page.locator("#run").click();
    await page.waitForSelector("#results:not([hidden])");
    assert.match(await page.locator("#cards").textContent(), /exact copy/);

    const caseDownload = page.waitForEvent("download");
    await page.locator("#export-case").click();
    const casePath = await (await caseDownload).path();
    const caseData = JSON.parse(await fs.readFile(casePath, "utf8"));
    assert.equal(caseData.suspect, passage);
    assert.equal(caseData.kind, "tracer-case");
    assert.equal(caseData.result, undefined);

    const reportDownload = page.waitForEvent("download");
    await page.locator("#export-report").click();
    const report = await fs.readFile(
      await (await reportDownload).path(),
      "utf8",
    );
    assert.match(report, /not proof of copying/);
    assert.match(report, /Semantic coverage: not measured/);

    await page.locator("#suspect").fill("Changed content");
    await page.locator("#saved-cases").selectOption("0");
    await page.locator("#open-case").click();
    assert.equal(await page.locator("#suspect").inputValue(), passage);
    assert.equal(await page.locator("#results").isHidden(), true);

    await page
      .locator("#case-file")
      .setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"kind":"other"}'),
      });
    await page.waitForFunction(() =>
      document
        .querySelector("#case-status")
        .textContent.includes("Could not import"),
    );
    assert.equal(await page.locator("#suspect").inputValue(), passage);
    await page
      .locator("#case-file")
      .setInputFiles({
        name: "case.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            ...caseData,
            title: "Imported case",
            server: "https://attacker.example",
          }),
        ),
      });
    await page.waitForFunction(
      () => document.querySelector("#case-title").value === "Imported case",
    );
    assert.equal(await page.locator("#server").inputValue(), "");

    // A deliberately pending server run exercises cancellation, stale completion and retry.
    let release;
    await page.route("**/api/trace", async (route) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      await route
        .fulfill({ status: 500, body: "delayed failure" })
        .catch(() => {});
    });
    await page.locator("#adv").evaluate((el) => {
      el.open = true;
    });
    await page.locator("#server").fill("http://127.0.0.1:8083");
    const pendingRequest = page.waitForRequest("**/api/trace");
    await page.locator("#run").click();
    await pendingRequest;
    await page.waitForSelector("#cancel:not([hidden])");
    await page.locator("#cancel").click();
    if (release) release();
    assert.equal(await page.locator("#run").isEnabled(), true);
    assert.equal(await page.locator("#results").isHidden(), true);
    await page.locator("#server").fill("");
    await page.locator("#run").click();
    await page.waitForSelector("#results:not([hidden])");
    assert.match(await page.locator("#cards").textContent(), /exact copy/);
    await page.locator("#cards details summary").click();
    assert.ok(await page.locator("#cards mark").count());
    await page.screenshot({
      path: "docs/workbench-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "docs/workbench-mobile.png",
      fullPage: true,
    });
    await page.locator("#theme").click();
    await page.screenshot({
      path: "docs/workbench-mobile-dark.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Browser smoke passed: compare, save/open, export/report, import validation, cancel/retry, mobile overflow, console.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
