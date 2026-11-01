import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { chromium, type Browser, type Page } from "playwright";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { fixtureDuoCeremonyGate } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { captureFullPage, FullPageCaptureRestoreError } from "../../../../src/backend/runtime/browser/full-page-capture.js";
import type { WorkerBrowserResource } from "../../../../src/workflow-kit/session.js";

const clock = manualClock(new Date("2026-10-17T09:00:00Z"));
const workerId = WorkerIdSchema.parse("person-lookup-worker-1");
const fixtures = createBrowserSessionFactoryFixtures(clock, "00000000-0000-4000-8000-000000000001", { schedule: () => ({ cancel: () => undefined }) });
const content = '<div style="height:1000px;background:rgb(210,20,30)"></div><div style="height:1000px;background:rgb(20,210,30)"></div><div style="height:1000px;background:rgb(20,30,210)"></div>';
const html = (body: string) => `<style>html,body{margin:0}*{box-sizing:border-box}</style>${body}`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

async function withPage(body: string, check: (page: Page, resource: WorkerBrowserResource) => Promise<void>, authenticated = true) {
  await fixtures.withTempRuntime(async ({ config }) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    await page.setContent(html(body));
    const harness = { ...fixtures.fakeLauncher(), launcher: {
      launch: async (input: { profileDirectory: string }) => { mkdirSync(input.profileDirectory, { recursive: true, mode: 0o700 }); return context; },
    } };
    const factory = fixtures.factoryFor(config, harness, fixtures.recordingBindings({ verify: fixtures.verifierFor({ authenticated }).verify }));
    const resource = await factory.open({ workerId, workflowId: WorkflowIdSchema.parse("person-lookup"), system: "ucpath", instance: "prod", configFingerprint: FingerprintSchema.parse("ab".repeat(32)), acceptDownloads: false, exclusive: false, signal: new AbortController().signal, duoCeremony: await fixtureDuoCeremonyGate("ucpath", workerId, clock) });
    try { await check(page, resource); }
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
  for (const target of ["window", "element", "iframe"] as const) {
    it(`refuses residual horizontal overflow at the width limit for a ${target}`, async () => {
      const wide = '<div style="width:7000px;height:620px;background:rgb(20,30,210)"></div>';
      const body = target === "window" ? wide : target === "element" ? `<div style="height:600px;overflow:auto">${wide}</div>` : `<iframe style="border:0;width:100%;height:600px" srcdoc='${html(wide)}'></iframe>`;
      await withPage(body, async (page, resource) => {
        const evidence = await resource.screenshot?.();
        assert.ok(evidence?.state === "unavailable");
        assert.equal(evidence.reason, "verification-failed");
        assert.deepEqual(page.viewportSize(), { width: 800, height: 600 });
      });
    });
  }
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
      assert.equal(evidence.reason, "verification-failed");
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
      assert.equal(evidence.reason, "verification-failed");
    });
  });
  it("refuses a capture that cannot reach the content bottom", async () => {
    await withPage(content, async (page, resource) => {
      await page.evaluate(() => { window.scrollTo = () => undefined; });
      const evidence = await resource.screenshot?.();
      assert.ok(evidence?.state === "unavailable");
      assert.equal(evidence.reason, "verification-failed");
    });
  });
  it("preserves an undefined capture failure and skips final authentication", async () => {
    await withPage(content, async (page, _resource) => {
      let finalProofs = 0;
      page.screenshot = async () => { runInNewContext("throw undefined"); return Buffer.alloc(0); };
      const capture = () => captureFullPage(page, {
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
