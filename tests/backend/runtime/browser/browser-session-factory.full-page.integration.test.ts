import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { chromium, type Browser, type Page } from "playwright";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { fixtureDuoCeremonyGate } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { captureFullPage, FullPageCaptureRestoreError } from "../../../../src/backend/runtime/browser/full-page-capture.js";
import { PlaywrightWorkerSessionFactory, type BrowserSessionFactoryOptions } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import type { WorkerBrowserResource } from "../../../../src/workflow-kit/session.js";

const clock = manualClock(new Date("2026-10-17T09:00:00Z"));
const workerId = WorkerIdSchema.parse("person-lookup-worker-1");
const fixtures = createBrowserSessionFactoryFixtures(clock, "00000000-0000-4000-8000-000000000001", { schedule: () => ({ cancel: () => undefined }) });
const content = '<div style="height:1000px;background:rgb(210,20,30)"></div><div style="height:1000px;background:rgb(20,210,30)"></div><div style="height:1000px;background:rgb(20,30,210)"></div>';
const html = (body: string) => `<style>html,body{margin:0}*{box-sizing:border-box}</style>${body}`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

async function withPage(body: string, check: (page: Page, resource: WorkerBrowserResource, retries: readonly string[]) => Promise<void>, authenticated = true) {
  await fixtures.withTempRuntime(async ({ config }) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    await page.setContent(html(body));
    const harness = { ...fixtures.fakeLauncher(), launcher: {
      launch: async (input: { profileDirectory: string }) => { mkdirSync(input.profileDirectory, { recursive: true, mode: 0o700 }); return context; },
    } };
    const retries: string[] = [];
    class ObservedFactory extends PlaywrightWorkerSessionFactory {
      constructor(options: BrowserSessionFactoryOptions) {
        super({ ...options, onDebug: (_worker, event) => {
          if (event.reason === "capture-band-retry" && event.message !== undefined) retries.push(event.message);
        } });
      }
    }
    const factory = fixtures.factoryFor(config, harness, fixtures.recordingBindings({ verify: fixtures.verifierFor({ authenticated }).verify }), undefined, undefined, ObservedFactory);
    const resource = await factory.open({ workerId, workflowId: WorkflowIdSchema.parse("person-lookup"), system: "ucpath", instance: "prod", configFingerprint: FingerprintSchema.parse("ab".repeat(32)), acceptDownloads: false, exclusive: false, signal: new AbortController().signal, duoCeremony: await fixtureDuoCeremonyGate("ucpath", workerId, clock) });
    try { await check(page, resource, retries); }
    finally { await resource.close({ reason: "worker-stop" }); }
  });
}

async function image(resource: WorkerBrowserResource) {
  const evidence = await resource.screenshot?.();
  assert.equal(evidence?.state, "available");
  assert.ok(evidence?.state === "available");
  const png = PNG.sync.read(Buffer.from(evidence.bytes));
  assert.deepEqual({ width: evidence.width, height: evidence.height }, { width: png.width, height: png.height });
  return png;
}
const pixel = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];

describe("whole-page factory screenshots", () => {
  it("adds a visible dry-run sample banner without hiding any form pixels and removes the temporary label", async () => {
    await withPage(content, async (page, resource) => {
      const plain = await image(resource);
      const evidence = await resource.screenshot?.(["dry-run sample: UCPath transaction number = T000000000000"]);
      assert.ok(evidence?.state === "available");
      const labelled = PNG.sync.read(Buffer.from(evidence.bytes));
      assert.equal(labelled.width, plain.width);
      assert.ok(labelled.height > plain.height);
      const bannerHeight = labelled.height - plain.height;
      assert.deepEqual(pixel(labelled, 2, 2), [255, 240, 179]);
      const form = new PNG({ width: plain.width, height: plain.height });
      PNG.bitblt(labelled, form, 0, bannerHeight, form.width, form.height, 0, 0);
      assert.deepEqual(form.data, plain.data, "the banner must not cover or change any form pixel");
      assert.equal(await page.locator("#relay-dry-run-sample-banner").count(), 0);
      assert.deepEqual(page.viewportSize(), { width: 800, height: 600 });
    });
  });

  for (const target of ["window", "element", "iframe"] as const) {
    it(`captures the complete painted ${target} content as one image`, async () => {
      const body = target === "window" ? content : target === "element" ? `<div style="height:600px;overflow:auto">${content}</div>` : `<iframe style="border:0;width:100%;height:600px" srcdoc='${html(content)}'></iframe>`;
      await withPage(body, async (_page, resource) => {
        const png = await image(resource);
        assert.equal(png.height, 3000);
        assert.deepEqual(pixel(png, 20, 20), [210, 20, 30]);
        assert.deepEqual(pixel(png, 20, 1500), [20, 210, 30]);
        assert.deepEqual(pixel(png, 20, 2980), [20, 30, 210]);
      });
    });
  }
  it("captures a page whose body scrolls under a clipped root as one image", async () => {
    await withPage(`<style>html{overflow:hidden;height:100%}body{height:100%;overflow-y:auto}</style>${content}`, async (page, resource) => {
      const png = await image(resource);
      assert.equal(png.height, 3000);
      assert.deepEqual(pixel(png, 20, 20), [210, 20, 30]);
      assert.deepEqual(pixel(png, 20, 1500), [20, 210, 30]);
      assert.deepEqual(pixel(png, 20, 2980), [20, 30, 210]);
      assert.equal(await page.evaluate(() => document.body.scrollTop), 0);
    });
  });
  for (const target of ["window", "element", "iframe"] as const) {
    it(`refuses residual horizontal overflow at the width limit for a ${target}`, async () => {
      const wide = '<div style="width:7000px;height:620px;background:rgb(20,30,210)"></div>';
      const body = target === "window" ? wide : target === "element" ? `<div style="height:600px;overflow:auto">${wide}</div>` : `<iframe style="border:0;width:100%;height:600px" srcdoc='${html(wide)}'></iframe>`;
      await withPage(body, async (page, resource) => {
        const evidence = await resource.screenshot?.();
        assert.ok(evidence?.state === "unavailable");
        assert.equal(evidence.reason, "horizontal-overflow");
        assert.deepEqual(page.viewportSize(), { width: 800, height: 600 });
      });
    });
  }
  it("captures a fixed-width grid viewport that scrolls on both axes, as the Kronos timecard does", async () => {
    // New Kronos renders its timecard in an Angular ui-grid: a pinned date viewport beside a data viewport wider than its box.
    const quadrants = '<div style="display:grid;grid-template-columns:1200px 1200px;grid-template-rows:1200px 1200px">'
      + '<div style="background:rgb(210,20,30)"></div><div style="background:rgb(20,210,30)"></div>'
      + '<div style="background:rgb(20,30,210)"></div><div style="background:rgb(230,200,20)"></div></div>';
    const grid = '<div style="display:flex;width:780px"><div class="ui-grid-viewport" style="width:80px;height:500px;overflow:hidden"><div style="height:2400px"></div></div>'
      + `<div class="ui-grid-viewport" id="data" style="width:700px;height:500px;overflow:auto">${quadrants}</div></div>`;
    await withPage(grid, async (page, resource) => {
      const png = await image(resource);
      assert.deepEqual(pixel(png, 10, 10), [210, 20, 30]);
      assert.deepEqual(pixel(png, png.width - 10, 10), [20, 210, 30]);
      assert.deepEqual(pixel(png, 10, png.height - 10), [20, 30, 210]);
      assert.deepEqual(pixel(png, png.width - 10, png.height - 10), [230, 200, 20]);
      assert.ok(png.width >= 2400 && png.height >= 2400, `stitched ${png.width}x${png.height}`);
      assert.deepEqual(await page.locator("#data").evaluate(el => [el.scrollLeft, el.scrollTop]), [0, 0]);
      assert.deepEqual(page.viewportSize(), { width: 800, height: 600 });
    });
  });
  for (const inset of ["left", "top"] as const) {
    it(`refuses a grid whose first pixels are clipped at the ${inset} edge`, async () => {
      const shift = inset === "left" ? "translateX(-40px)" : "translateY(-40px)";
      const grid = `<div style="width:800px;height:500px;overflow:auto;transform:${shift}">${content}</div>`;
      await withPage(grid, async (_page, resource) => {
        const evidence = await resource.screenshot?.();
        assert.equal(evidence?.state, "unavailable");
        assert.ok(evidence?.state === "unavailable");
        assert.equal(evidence.reason, "unpainted-gap");
        assert.equal("bytes" in evidence, false);
      });
    });
  }
  it("stitches only grid pixels after a scroll handler changes the band geometry", async () => {
    const grid = '<div id="grid" style="width:700px;height:500px;overflow:auto">'
      + '<div style="width:1500px;height:900px;background:linear-gradient(to right,rgb(210,20,30) 670px,rgb(20,30,210) 670px)"></div></div>';
    await withPage(grid, async (page, resource) => {
      await page.locator("#grid").evaluate(grid => {
        grid.addEventListener("scroll", () => {
          requestAnimationFrame(() => { grid.style.marginLeft = grid.scrollLeft > 0 ? "-40px" : "0"; });
        });
      });
      const png = await image(resource);
      assert.deepEqual(pixel(png, 650, 100), [210, 20, 30]);
      assert.deepEqual(pixel(png, 670, 100), [20, 30, 210]);
      assert.deepEqual(pixel(png, 1499, 899), [20, 30, 210]);
      assert.deepEqual([png.width, png.height], [1500, 900]);
    });
  });
  it("recaptures the complete form after a late section reflows during a screenshot band", async () => {
    await withPage(`<main style="overflow-anchor:none">${content}</main>`, async (page, resource, retries) => {
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands === 2) await page.locator("main").evaluate(form => {
          const section = document.createElement("div");
          section.style.cssText = "height:200px;background:rgb(230,200,20)";
          form.prepend(section);
        });
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "available", evidence?.state === "unavailable" ? evidence.detail : undefined);
      const png = PNG.sync.read(Buffer.from(evidence.bytes));
      assert.equal(png.height, 3200);
      assert.deepEqual(pixel(png, 20, 0), [230, 200, 20]);
      assert.deepEqual(pixel(png, 20, 200), [210, 20, 30]);
      assert.deepEqual(pixel(png, 20, 1200), [20, 210, 30]);
      assert.deepEqual(pixel(png, 20, 3199), [20, 30, 210]);
      assert.deepEqual(retries, ["band-geometry-changed contentHeight=3000->3200"]);
    });
  });
  it("refuses an image when the grid keeps moving during screenshot bands", async () => {
    await withPage(`<div id="grid" style="width:800px;height:500px;overflow:auto">${content}</div>`, async (page, resource, retries) => {
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        await page.locator("#grid").evaluate((grid, band) => { grid.style.transform = `translate(${band * 10}px, ${band * 3}px)`; }, ++bands);
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.equal(evidence?.state, "unavailable");
      assert.ok(evidence?.state === "unavailable");
      assert.deepEqual([evidence.reason, evidence.detail], ["unpainted-gap", "band-geometry-changed x=10->20 y=3->6"]);
      assert.deepEqual(retries, ["band-geometry-changed x=0->10 y=0->3"]);
      assert.equal("bytes" in evidence, false);
      assert.equal(bands, 2);
    });
  });
  for (const target of ["element", "iframe"] as const) {
    it(`captures the final20px of near-viewport ${target} overflow`, async () => {
      const nearViewport = '<div style="height:600px;background:rgb(210,20,30)"></div><div style="height:20px;background:rgb(20,30,210)"></div>';
      const body = target === "element" ? `<div style="height:600px;overflow:auto">${nearViewport}</div>` : `<iframe style="border:0;width:100%;height:600px" srcdoc='${html(nearViewport)}'></iframe>`;
      await withPage(body, async (_page, resource) => {
        const png = await image(resource);
        assert.equal(png.height, 620);
        assert.deepEqual(pixel(png, 20, 610), [20, 30, 210]);
      });
    });
  }
  it("captures responsive wide content that fits after resizing", async () => {
    await withPage('<div style="width:100%;height:180px;background:rgb(20,30,210)"></div>', async (page, resource) => {
      await page.setViewportSize({ width: 7000, height: 600 });
      const png = await image(resource);
      assert.equal(png.width, 6000);
      assert.deepEqual(pixel(png, 5980, 20), [20, 30, 210]);
      assert.deepEqual(page.viewportSize(), { width: 7000, height: 600 });
    });
  });
  it("keeps a short page tight and restores width, scroll and fixed overlays", async () => {
    await withPage('<div style="height:180px;background:rgb(20,30,210)"></div>', async (page, resource) => {
      const png = await image(resource);
      assert.equal(png.height, 180);
      assert.deepEqual(page.viewportSize(), { width: 800, height: 600 });
    });
    await withPage(`<aside style="position:fixed;top:0;width:100%;height:60px;background:black">overlay</aside>${content}`, async (page, resource) => {
      await page.evaluate(() => window.scrollTo(0, 230));
      const png = await image(resource);
      assert.deepEqual(pixel(png, 20, 20), [210, 20, 30]);
      assert.equal(await page.evaluate(() => window.scrollY), 230);
      assert.equal(await page.locator("aside").evaluate(el => el.style.display), "");
      assert.deepEqual(page.viewportSize(), { width: 800, height: 600 });
    });
  });
  for (const target of ["window", "element", "iframe"] as const) it(`masks SSNs in every ${target} band`, async () => {
    const fields = [0, 1, 2].map(i => `<div style="height:1000px;padding-top:200px;background:white"><input id="DERIVED_HCR_SM_SM_CHAR_INPUT$0" style="width:200px;height:40px;background:red" value="fixture-${i}"></div>`).join("");
    const body = target === "window" ? fields : target === "element" ? `<div style="height:600px;overflow:auto">${fields}</div>` : `<iframe style="border:0;width:100%;height:600px" srcdoc='${html(fields)}'></iframe>`;
    await withPage(body, async (_page, resource) => {
      const png = await image(resource);
      assert.equal(png.height, 3000);
      for (const y of [220, 1220, 2220]) assert.deepEqual(pixel(png, 30, y), [255, 0, 255]);
    });
  });
  // The I-9 creation form, the I-9 search dialog and the UCPath Hire wizard each label their SSN control on the top-level page.
  const recipeForms = [{ label: "U.S. Social Security Number", wrap: (fields: string) => fields },
    { label: "Social Security Number", wrap: (fields: string) => `<div role="dialog" aria-label="Search for Existing Employee">${fields}</div>` },
    { label: "National ID", wrap: (fields: string) => fields }];
  const recipeFields = (label: string) => [0, 1, 2].map(i => `<div style="height:1000px;padding-top:200px;background:white"><label for="ssn-${i}" style="display:block;height:20px">${label}</label><input id="ssn-${i}" style="width:200px;height:40px;background:red" value="fixture-${i}"></div>`).join("");
  for (const { label, wrap } of recipeForms) {
    for (const target of ["window", "element"] as const) it(`masks the "${label}" control in every ${target} band`, async () => {
      const fields = wrap(recipeFields(label));
      await withPage(target === "window" ? fields : `<div style="height:600px;overflow:auto">${fields}</div>`, async (_page, resource) => {
        const png = await image(resource);
        for (const y of [240, 1240, 2240]) assert.deepEqual(pixel(png, 30, y), [255, 0, 255]);
      });
    });
    it(`refuses the "${label}" control in a child frame, where no driver addresses it`, async () => {
      await withPage(`<iframe style="border:0;width:100%;height:600px" srcdoc='${html(wrap(recipeFields(label)))}'></iframe>`, async (_page, resource) => {
        const evidence = await resource.screenshot?.();
        assert.ok(evidence?.state === "unavailable");
        assert.equal(evidence.reason, "secret-controls-present");
        assert.equal("bytes" in evidence, false);
      });
    });
  }
  for (const child of [false, true]) {
    it(`refuses a painted SSN control in the ${child ? "child frame" : "page"} that no form recipe masks`, async () => {
      const field = '<label for="unmasked">Employee SSN</label><input id="unmasked" value="fixture-value">';
      await withPage(`${content}${child ? `<iframe srcdoc='${html(field)}'></iframe>` : field}`, async (_page, resource) => {
        const evidence = await resource.screenshot?.();
        assert.ok(evidence?.state === "unavailable");
        assert.equal(evidence.reason, "secret-controls-present");
        assert.equal("bytes" in evidence, false);
      });
    });
  }
  it("refuses an unmasked SSN control painted during a band", async () => {
    await withPage(content, async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async options => {
        await page.evaluate(() => document.body.insertAdjacentHTML("afterbegin", '<input aria-label="Social Security No." value="fixture-value">'));
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
    });
  });
  it("refuses a painted SSN control left out of the accessibility tree, which no role recipe masks", async () => {
    await withPage(`<div aria-hidden="true"><label for="hidden-ssn">U.S. Social Security Number</label><input id="hidden-ssn" value="fixture-value"></div>${content}`, async (_page, resource) => {
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal("bytes" in evidence, false);
    });
  });
  it("refuses an unmasked SSN control painted only during a band", async () => {
    await withPage(`${content}<input id="transient-ssn" aria-label="Employee SSN" value="fixture-value" style="display:none">`, async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands !== 2) return screenshot(options);
        await page.locator("#transient-ssn").evaluate(el => { el.style.display = "block"; });
        try { return await screenshot(options); }
        finally { await page.locator("#transient-ssn").evaluate(el => { el.style.display = "none"; }); }
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal("bytes" in evidence, false);
      assert.equal(bands, 2);
    });
  });
  it("masks a recipe SSN control in every band while an ARIA-hidden ancestor ends its recipe match", async () => {
    await withPage(recipeFields("U.S. Social Security Number"), async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      const hide = (hidden: boolean) => page.evaluate(hidden => {
        for (const field of document.querySelectorAll("body > div")) if (hidden) field.setAttribute("aria-hidden", "true"); else field.removeAttribute("aria-hidden");
      }, hidden);
      page.screenshot = async options => {
        await hide(true);
        try { return await screenshot(options); }
        finally { await hide(false); }
      };
      const png = await image(resource);
      for (const y of [240, 1240, 2240]) assert.deepEqual(pixel(png, 30, y), [255, 0, 255]);
    });
  });
  it("masks a recipe SSN control in every band while a nested label change ends its recipe match", async () => {
    const fields = [0, 1, 2].map(i => `<div style="height:1000px;padding-top:200px;background:white"><label for="ssn-${i}" style="display:block;height:20px"><span>U.S. Social Security Number</span></label><input id="ssn-${i}" style="width:200px;height:40px;background:red" value="fixture-${i}"></div>`).join("");
    await withPage(fields, async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      const relabel = (text: string) => page.evaluate(text => { for (const span of document.querySelectorAll("label span")) span.textContent = text; }, text);
      page.screenshot = async options => {
        await relabel("Reference");
        try { return await screenshot(options); }
        finally { await relabel("U.S. Social Security Number"); }
      };
      const png = await image(resource);
      for (const y of [240, 1240, 2240]) assert.deepEqual(pixel(png, 30, y), [255, 0, 255]);
    });
  });
  it("captures a page whose non-sensitive label changes during a band", async () => {
    await withPage(`<label for="name">Name</label><input id="name" value="fixture-value">${content}`, async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async options => {
        await page.locator("label").evaluate(label => {
          if (!(label instanceof HTMLLabelElement)) throw new Error("Expected the fixture label");
          label.textContent = "Full name";
          label.title = "Full name";
        });
        return screenshot(options);
      };
      assert.ok((await image(resource)).height >= 3000);
    });
  });
  it("captures a page that removes a control named through aria-labelledby during a band", async () => {
    await withPage(`<span id="ref-label" style="position:absolute;top:0;left:300px">Reference</span><input id="ref" aria-labelledby="ref-label" value="fixture-value" style="position:absolute;top:0;left:400px">${content}`, async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands === 2) await page.locator("#ref").evaluate(input => { input.remove(); });
        return screenshot(options);
      };
      assert.ok((await image(resource)).height >= 3000);
    });
  });
  it("refuses an SSN control moved into a closed shadow root in the change that removes a control named through aria-labelledby", async () => {
    await withPage(`<span id="ref-label">Reference</span><input id="ref" aria-labelledby="ref-label" value="fixture-value"><div id="closed-host" style="position:absolute;top:1500px;left:0"></div>${content}<input id="moved-ssn" aria-label="Employee SSN" value="fixture-value" style="display:none;width:200px;height:40px">`, async (page, resource) => {
      await page.evaluate(() => { (window as Window & { closedRoot?: ShadowRoot }).closedRoot = document.querySelector("#closed-host")!.attachShadow({ mode: "closed" }); });
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands === 2) await page.evaluate(() => {
          document.querySelector("#ref")!.remove();
          const ssn = document.querySelector<HTMLElement>("#moved-ssn")!;
          (window as Window & { closedRoot?: ShadowRoot }).closedRoot!.append(ssn);
          ssn.style.display = "block";
        });
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal("bytes" in evidence, false);
    });
  });
  it("refuses a text-entry control in an open shadow root that shows as an SSN control only while a band paints", async () => {
    await withPage(`<div id="paint-host"></div>${content}`, async (page, resource) => {
      await page.locator("#paint-host").evaluate(host => { host.attachShadow({ mode: "open" }).innerHTML = '<input id="paint-ssn" aria-label="Reference" style="display:none;width:200px;height:40px">'; });
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      const reveal = (shown: boolean) => page.locator("#paint-ssn").evaluate((input: HTMLInputElement, shown) => {
        input.style.display = shown ? "block" : "none";
        input.setAttribute("aria-label", shown ? "Employee SSN" : "Reference");
        input.value = shown ? "fixture-value" : "";
      }, shown);
      page.screenshot = async options => {
        if (++bands !== 2) return screenshot(options);
        await reveal(true);
        try { return await screenshot(options); }
        finally { await reveal(false); }
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal("bytes" in evidence, false);
    });
  });
  it("refuses a recipe SSN control named by an external label that moves into a closed shadow root", async () => {
    await withPage(`<div id="closed-host" style="position:absolute;top:1500px;left:0"></div><label for="moved-ssn">U.S. Social Security Number</label><input id="moved-ssn" value="fixture-value" style="width:200px;height:40px">${content}`, async (page, resource) => {
      await page.evaluate(() => { (window as Window & { closedRoot?: ShadowRoot }).closedRoot = document.querySelector("#closed-host")!.attachShadow({ mode: "closed" }); });
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands === 2) await page.evaluate(() => { (window as Window & { closedRoot?: ShadowRoot }).closedRoot!.append(document.querySelector("#moved-ssn")!); });
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal("bytes" in evidence, false);
    });
  });
  it("refuses an unmasked SSN control the wider capture viewport reveals without a DOM change", async () => {
    await withPage(`<style>@media (min-width: 1000px) { #wide-ssn { display: block !important; } }</style>${content}<input id="wide-ssn" aria-label="Employee SSN" value="fixture-value" style="display:none">`, async (_page, resource) => {
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal("bytes" in evidence, false);
    });
  });
  it("refuses a painted SSN control inside an open shadow root", async () => {
    await withPage(`<div id="ssn-host"></div>${content}`, async (page, resource) => {
      await page.locator("#ssn-host").evaluate(host => { host.attachShadow({ mode: "open" }).innerHTML = '<input aria-label="Employee SSN" value="fixture-value">'; });
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal("bytes" in evidence, false);
    });
  });
  it("captures a page whose unmasked SSN control is never painted", async () => {
    await withPage(`${content}<input aria-label="Employee SSN" value="fixture-value" hidden>`, async (_page, resource) => {
      assert.equal((await image(resource)).height, 3000);
    });
  });
  for (const target of ["window", "element", "iframe"] as const) {
    it(`restores the ${target} scroll position after capture`, async () => {
      const body = target === "window" ? content : target === "element" ? `<div id="scroller" style="height:600px;overflow:auto">${content}</div>` : `<iframe style="border:0;width:100%;height:600px" srcdoc='${html(content)}'></iframe>`;
      await withPage(body, async (page, resource) => {
        await page.evaluate(target => {
          if (target === "window") window.scrollTo(0, 270);
          if (target === "element") document.querySelector("#scroller")!.scrollTop = 270;
          if (target === "iframe") document.querySelector("iframe")!.contentWindow!.scrollTo(0, 270);
        }, target);
        await image(resource);
        const y = await page.evaluate(target => target === "window" ? window.scrollY : target === "element" ? document.querySelector("#scroller")!.scrollTop : document.querySelector("iframe")!.contentWindow!.scrollY, target);
        assert.equal(y, 270);
      });
    });
  }
  for (const reason of ["authentication-unverified", "secret-controls-present", "page-closed", "page-changed", "verification-failed"] as const) {
    it(`preserves the ${reason} refusal`, async () => {
      await withPage(content, async (page, resource) => {
        if (reason === "secret-controls-present") await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<input type="password">'));
        if (reason === "page-closed") await page.close();
        if (reason === "page-changed" || reason === "verification-failed") {
          const screenshot = page.screenshot.bind(page);
          page.screenshot = async options => {
            if (reason === "verification-failed") throw new Error("fixture capture failure");
            await page.goto(`data:text/html,${encodeURIComponent(html(content))}`);
            return screenshot(options);
          };
        }
        const evidence = await resource.screenshot?.();
        assert.equal(evidence?.state, "unavailable");
        assert.ok(evidence?.state === "unavailable");
        assert.equal(evidence.reason, reason);
        if (reason === "authentication-unverified") assert.equal(evidence.detail, "sign-in-check-application-route");
        assert.equal("bytes" in evidence, false);
      }, reason !== "authentication-unverified");
    });
  }
  for (const child of [false, true]) {
    it(`refuses a transient secret in the ${child ? "child frame" : "page"} during capture`, async () => {
      await withPage(`${content}${child ? '<iframe srcdoc="<p>fixture</p>"></iframe>' : ""}`, async (page, resource) => {
        const screenshot = page.screenshot.bind(page);
        page.screenshot = async options => {
          const frame = child ? page.frames()[1] : page.mainFrame();
          await frame.evaluate(() => { const input = document.createElement("input"); input.type = "password"; document.body.append(input); input.remove(); });
          return screenshot(options);
        };
        const evidence = await resource.screenshot?.();
        assert.ok(evidence?.state === "unavailable");
        assert.equal(evidence.reason, "secret-controls-present");
      });
    });
  }
  for (const target of ["element", "iframe"] as const) {
    it(`captures the bottom of a partially clipped ${target}`, async () => {
      const body = target === "element" ? `<div style="height:100px"></div><div id="offset-target" style="height:700px;overflow:auto;scroll-behavior:smooth">${content}</div>` : `<div style="height:100px"></div><iframe id="offset-target" style="border:0;width:100%;height:700px" srcdoc='${html(content)}'></iframe>`;
      await withPage(body, async (page, resource) => {
        const style = await page.locator("#offset-target").getAttribute("style");
        const png = await image(resource);
        assert.equal(png.height, 3000);
        assert.deepEqual(pixel(png, 20, 2980), [20, 30, 210]);
        assert.equal(await page.locator("#offset-target").getAttribute("style"), style);
        assert.equal(await page.evaluate(() => window.scrollY), 0);
      });
    });
  }
  it("captures all content when the original viewport is taller than a band", async () => {
    await withPage(content, async (page, resource) => {
      await page.setViewportSize({ width: 800, height: 1440 });
      const png = await image(resource);
      assert.equal(png.height, 3000);
      assert.deepEqual(pixel(png, 20, 2980), [20, 30, 210]);
      assert.deepEqual(page.viewportSize(), { width: 800, height: 1440 });
    });
  });
  it("captures all content after hiding a sticky overlay", async () => {
    await withPage(`<header style="position:sticky;top:0;height:80px;background:black">overlay</header>${content}`, async (page, resource) => {
      const png = await image(resource);
      assert.equal(png.height, 3000);
      assert.deepEqual(pixel(png, 20, 2980), [20, 30, 210]);
      assert.equal(await page.locator("header").evaluate(el => el.style.display), "");
    });
  });
  it("restores fixed overlays inside the selected frame", async () => {
    await withPage(`<iframe style="border:0;width:100%;height:600px" srcdoc='${html(`<header style="position:fixed;top:0;height:70px;width:100%;background:black"></header>${content}`)}'></iframe>`, async (page, resource) => {
      const png = await image(resource);
      assert.deepEqual(pixel(png, 20, 20), [210, 20, 30]);
      assert.equal(await page.frames()[1].locator("header").evaluate(el => el.style.display), "");
    });
  });
  for (const attribute of ["type", "autocomplete"] as const) {
    it(`refuses a transient ${attribute} secret attribute between bands`, async () => {
      await withPage(`${content}<input id="transient" type="text">`, async (page, resource) => {
        const screenshot = page.screenshot.bind(page);
        let bands = 0;
        page.screenshot = async options => {
          if (++bands === 2) await page.evaluate(attribute => {
            const input = document.querySelector<HTMLInputElement>("#transient")!;
            input.setAttribute(attribute, attribute === "type" ? "password" : "one-time-code");
            input.setAttribute(attribute, attribute === "type" ? "text" : "off");
          }, attribute);
          return screenshot(options);
        };
        const evidence = await resource.screenshot?.();
        assert.ok(evidence?.state === "unavailable");
        assert.equal(evidence.reason, "secret-controls-present");
        assert.equal(bands, 2);
      });
    });
  }
  // The I-9 app keeps a closed change-password form in every page (live probe, onboarding-served-switch-05).
  const hiddenPasswordForm = '<div id="change-password" style="display:none"><input type="password" id="OldPassword"><input type="password" id="WebPassword"><input type="password" id="ConfirmWebPassword"></div>';
  it("captures a page whose only secret controls are never painted", async () => {
    await withPage(`${content}${hiddenPasswordForm}`, async (_page, resource) => {
      const png = await image(resource);
      assert.equal(png.height, 3000);
    });
  });
  it("captures through the tsx loader the dashboard runs on", async () => {
    // Vitest compiles without keepNames; tsx wraps named inner functions in a __name helper the page realm lacks (live run 6).
    const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { chromium } from "playwright";
      import { captureFullPage } from "./src/backend/runtime/browser/full-page-capture.ts";
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(${JSON.stringify(html(`${content}${hiddenPasswordForm}`))});
        const capture = await captureFullPage(page, { assertCurrent: () => undefined, assertSafe: async () => undefined, mask: () => [],
          secretControls: 'input[type="password"]', afterCapture: async () => undefined });
        process.stdout.write(JSON.stringify({ height: capture.height }));
      } catch (error) { process.stdout.write(JSON.stringify({ failed: error.message.split("\\n")[0] })); }
      finally { await browser.close(); }
    `], { cwd: fileURLToPath(new URL("../../../..", import.meta.url)), encoding: "utf8" });
    assert.deepEqual(JSON.parse(output), { height: 3000 });
  });
  it("refuses an unpainted secret control painted only during a band", async () => {
    await withPage(`${content}${hiddenPasswordForm}`, async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands !== 2) return screenshot(options);
        await page.locator("#change-password").evaluate(el => { el.style.display = "block"; });
        try { return await screenshot(options); }
        finally { await page.locator("#change-password").evaluate(el => { el.style.display = "none"; }); }
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal(bands, 2);
    });
  });
  it("refuses an unpainted secret control in a shadow tree the capture observer cannot watch", async () => {
    await withPage(`<div id="shadow-host"></div>${content}`, async (page, resource) => {
      await page.locator("#shadow-host").evaluate(host => {
        host.attachShadow({ mode: "open" }).innerHTML = '<input id="otp" autocomplete="one-time-code" style="display:none;width:200px;height:40px;background:rgb(255,0,255)">';
      });
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands !== 1) return screenshot(options);
        const otp = page.locator("#otp");
        await otp.evaluate(el => { el.style.display = "block"; });
        try { return await screenshot(options); }
        finally { await otp.evaluate(el => { el.style.display = "none"; }); }
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal(bands, 0);
    });
  });
  it("refuses an unpainted secret control that leaves the watched light DOM during a band", async () => {
    await withPage(`<div id="shadow-host"></div>${content}<input id="otp" autocomplete="one-time-code" style="display:none;width:200px;height:40px;background:rgb(255,0,255)">`, async (page, resource) => {
      await page.locator("#shadow-host").evaluate(host => { host.attachShadow({ mode: "open" }); });
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands !== 1) return screenshot(options);
        await page.evaluate(() => { document.querySelector("#shadow-host")!.shadowRoot!.append(document.querySelector("#otp")!); });
        await page.evaluate(() => { document.querySelector<HTMLElement>("#shadow-host")!.shadowRoot!.querySelector<HTMLElement>("#otp")!.style.display = "block"; });
        try { return await screenshot(options); }
        finally {
          await page.evaluate(() => {
            const otp = document.querySelector("#shadow-host")!.shadowRoot!.querySelector<HTMLElement>("#otp")!;
            otp.style.display = "none";
            document.body.append(otp);
          });
        }
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "secret-controls-present");
      assert.equal(bands, 1);
    });
  });
  it("refuses a frame attached and removed between bands", async () => {
    await withPage(content, async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands === 2) await page.evaluate(async () => {
          const frame = document.createElement("iframe");
          const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
          document.body.append(frame);
          await loaded;
          frame.remove();
        });
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "page-changed");
      assert.equal(bands, 2);
    });
  });
  it("restores all changed state after a band fails", async () => {
    await withPage(`<header style="position:fixed;top:0;height:50px">overlay</header>${content}`, async (page, resource) => {
      await page.evaluate(() => window.scrollTo(0, 220));
      const screenshot = page.screenshot.bind(page);
      let bands = 0;
      page.screenshot = async options => {
        if (++bands === 2) throw new Error("fixture band failure");
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.deepEqual([evidence.reason, evidence.detail], ["verification-failed", "page-capture-error"]);
      assert.deepEqual(page.viewportSize(), { width: 800, height: 600 });
      assert.equal(await page.evaluate(() => window.scrollY), 220);
      assert.equal(await page.locator("header").evaluate(el => el.style.display), "");
    });
  });
  it("refuses a missing secret observer during capture", async () => {
    await withPage(content, async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async options => {
        await page.evaluate(() => Reflect.deleteProperty(window, "__relayCaptureSecrets"));
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "observer-unavailable");
    });
  });
  it("refuses when the SSN observer fails during a band even after the control is removed", async () => {
    await withPage(content, async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async options => {
        await page.evaluate(() => {
          const input = document.createElement("input");
          input.id = "fixture-ssn";
          input.setAttribute("aria-label", "Employee SSN");
          input.checkVisibility = () => { throw new Error("fixture observer scan failure"); };
          document.body.append(input);
        });
        await page.locator("#fixture-ssn").evaluate(input => { input.remove(); });
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "observer-unavailable");
      assert.equal("bytes" in evidence, false);
    });
  });
  it("refuses a capture that cannot reach the content bottom and names the measured heights", async () => {
    await withPage(content, async (page, resource) => {
      await page.evaluate(() => { window.scrollTo = () => undefined; });
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "content-bottom-unreached");
      assert.equal(evidence.detail, "page-capture-covered-600-of-3000px");
    });
  });
  it("captures to the bottom of a scroller clipped at a sub-pixel offset, as the Kronos timecard grid is", async () => {
    // The page cannot scroll the grid's 120.1875px top to zero, so its clipped height is fractional while clientHeight rounds up.
    const grid = '<div style="height:120.1875px"></div><div style="height:700px;overflow:auto">'
      + '<div style="height:2000px;background:rgb(210,20,30)"></div><div style="height:191px;background:rgb(20,30,210)"></div></div>';
    await withPage(grid, async (_page, resource) => {
      const png = await image(resource);
      assert.equal(png.height, 2191);
      assert.deepEqual(pixel(png, 20, 20), [210, 20, 30]);
      assert.deepEqual(pixel(png, 20, 2189), [20, 30, 210]);
    });
  });
  it("names an unpainted gap when scroll snapping moves a band past the covered content", async () => {
    const sections = Array.from({ length: 6 }, () => '<section style="height:700px;scroll-snap-align:start;background:rgb(20,30,210)"></section>').join("");
    await withPage(`<main style="height:600px;overflow:auto;scroll-snap-type:y mandatory">${sections}</main>`, async (_page, resource) => {
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "unpainted-gap");
    });
  });
  it("names the band limit for a page too long to capture", async () => {
    await withPage('<div style="height:48000px;background:rgb(20,30,210)"></div>', async (_page, resource) => {
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "band-limit");
    });
  });
  it("counts discarded screenshots toward the band limit when replanning", async () => {
    await withPage('<main style="height:800px"></main>', async (page, resource) => {
      const screenshot = page.screenshot.bind(page);
      let shots = 0;
      page.screenshot = async options => {
        // A 600px viewport with 120px overlap needs all 30 bands at this height.
        if (++shots === 1) await page.locator("main").evaluate(form => { form.style.height = "14520px"; });
        return screenshot(options);
      };
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "band-limit");
      assert.equal("bytes" in evidence, false);
      assert.equal(shots, 1);
    });
  });
  it("preserves an undefined capture failure and skips final authentication", async () => {
    await withPage(content, async (page, _resource) => {
      let finalProofs = 0;
      page.screenshot = async () => { runInNewContext("throw undefined"); return Buffer.alloc(0); };
      const capture = () => captureFullPage(page, {
        assertCurrent: () => undefined,
        assertSafe: async () => undefined,
        afterCapture: async () => { finalProofs += 1; },
        mask: () => [],
        secretControls: 'input[type="password"]',
      });
      await assert.rejects(capture(), (error: unknown) => error === undefined);
      assert.equal(finalProofs, 0);
      const resize = page.setViewportSize.bind(page);
      page.setViewportSize = async size => {
        if (size.width === 800) throw new Error("fixture restore failure");
        return resize(size);
      };
      await assert.rejects(capture(), error => error instanceof FullPageCaptureRestoreError
        && error.errors.length === 2 && error.errors[0] === undefined
        && error.errors[1] instanceof Error && error.errors[1].message === "fixture restore failure");
      assert.equal(finalProofs, 0);
      page.setViewportSize = resize;
    });
  });
  it("keeps capture and restoration failures named and attempts remaining cleanup", async () => {
    await withPage(`<header style="position:fixed;top:0;height:50px">overlay</header>${content}`, async (page, resource) => {
      const resize = page.setViewportSize.bind(page);
      page.setViewportSize = async size => {
        if (size.width === 800) throw new Error("fixture restore failure");
        return resize(size);
      };
      page.screenshot = async () => { throw new Error("fixture capture failure"); };
      await assert.rejects(resource.screenshot!(), error => error instanceof FullPageCaptureRestoreError
        && error.errors.length === 2
        && error.errors[0] instanceof Error && error.errors[0].message === "fixture capture failure"
        && error.errors[1] instanceof Error && error.errors[1].message === "fixture restore failure");
      assert.equal(await page.locator("header").evaluate(el => el.style.display), "");
      assert.equal(await page.evaluate(() => "__relayCaptureSecrets" in window), false);
      page.setViewportSize = resize;
    });
  });

});
