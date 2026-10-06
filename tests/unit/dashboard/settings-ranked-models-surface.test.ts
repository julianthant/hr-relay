import { readSettings } from "../../../src/server/settings-runtime.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it, vi } from "vitest";
import { draftError, settingsLeaves } from "../../../src/dashboard/surfaces/settings/editor/settings-draft-model.js";
import { modelRaw, modelRows, reorderModelRows } from "../../../src/dashboard/surfaces/settings/providers/settings-ranked-models.js";
import { mountSettingsHarness, syntheticSettingsAuthority } from "./helpers/settings-harness.js";
import { fixtureSettingsDocument } from "../../parity/helpers/fixture-settings.js";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

async function setup(models: readonly string[] = []) {
  const authority = syntheticSettingsAuthority({ configuredModels: models }); cleanups.push(authority.close);
  const readDocument = () => {
    const current = authority.read();
    const persisted = readSettings(authority.database.authority).settings;
    return fixtureSettingsDocument(persisted, current.revision, models);
  };
  const mounted = await mountSettingsHarness(authority, "providers", readDocument); cleanups.push(mounted.close);
  return { ...mounted, authority };
}

function modelArea(host: HTMLElement): HTMLElement {
  const area = host.querySelector('[data-settings-path="providers.gemini.models"]');
  if (!(area instanceof HTMLElement)) throw new Error("Gemini model area missing");
  return area;
}

async function inputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    // React's controlled-input tracker requires the native setter bypass here.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter === undefined) throw new Error("input setter missing");
    Reflect.apply(setter, input, [value]);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("provider budgets and models", () => {
  it("renders every served budget and model leaf once with the approved groups", async () => {
    const { host } = await setup(["first", "second"]);
    assert.deepEqual([...host.querySelectorAll("h1")].map(node => node.textContent), ["Provider budgets & models"]);
    assert.match(host.textContent ?? "", /Request limits and model preferences for each provider\./u);
    assert.deepEqual([...host.querySelectorAll("h2")].map(node => node.textContent), ["Request budgets", "Model priority"]);
    assert.equal(host.querySelectorAll(".settings-provider-disclosure").length, 9);
    assert.equal(host.querySelectorAll(".settings-provider-budget, .settings-provider-models").length, 2, "only expanded disclosures mount their controls");
    assert.deepEqual([...host.querySelectorAll(".settings-provider-grid [data-settings-path]")].map(node => node.getAttribute("data-settings-path")).sort(), [
      "providers.ocrExtract.concurrency", "providers.ocrExtract.costLimitUsdMicros", "providers.ocrExtract.dailyRequestLimit", "providers.ocrExtract.requestsPerMinute", "providers.ocrExtract.timeoutMs",
    ]);
    assert.equal(host.querySelectorAll("textarea").length, 0);
    assert.equal(host.querySelectorAll(".settings-provider-grid input").length, 5);
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item").length, 2);
    assert.equal(host.textContent?.includes("5 limits"), false);
  });

  it("keeps duplicate rows distinct through moves without edit or removal controls", async () => {
    const { host, controller } = await setup(["same", "same", "third"]);
    const area = modelArea(host);
    assert.equal(area.querySelectorAll("input").length, 0);
    assert.equal(area.querySelector('[aria-label^="Remove "]'), null);
    const before = [...area.querySelectorAll(".ds-ranked-item")];
    const handle = area.querySelector('button[aria-label="Move same. Position 2 of 3. Use arrow keys to reorder."]');
    if (!(handle instanceof HTMLButtonElement)) throw new Error("move handle missing");
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    assert.equal((controller().draft["providers.gemini.models"] as { raw: string }).raw, "same\nsame\nthird");
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item").length, 3);
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item")[0], before[1]);
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item")[1], before[0]);
  });

  it("leaves unconfigured providers empty with no add control", async () => {
    const { host } = await setup();
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item").length, 0);
    assert.match(modelArea(host).textContent ?? "", /No models are configured/u);
    assert.doesNotMatch(modelArea(host).textContent ?? "", /Add model/u);
  });

  it("submits a reordered chain with the exact configured membership", async () => {
    const { host, commands, controller } = await setup(["one", "two"]);
    vi.useFakeTimers();
    const area = modelArea(host);
    const handle = area.querySelector('button[aria-label="Move two. Position 2 of 2. Use arrow keys to reorder."]');
    if (!(handle instanceof HTMLButtonElement)) throw new Error("move handle missing");
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    assert.equal(area.querySelector('button[aria-label="Actions for Gemini model order"]'), null);
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(commands.length, 1);
    assert.deepEqual((commands[0] as { payload: { patch: unknown } }).payload.patch, { "providers.gemini.models": { set: ["two", "one"] } });
    assert.equal(controller().save.state, "applied");
  });

  it("retains the reordered draft on a genuine revision conflict", async () => {
    const { host, authority, controller, commands } = await setup(["one", "two"]);
    await act(async () => { controller().update("providers.gemini.models", "two\none"); });
    const competing = authority.apply({ "providers.gemini.models": { set: ["one", "two"] } });
    assert.equal(competing.state, "applied");
    await act(async () => { controller().submit(); });
    assert.equal(commands.length, 1);
    assert.equal(controller().save.state, "conflict");
    assert.equal((controller().draft["providers.gemini.models"] as { raw: string }).raw, "two\none");
    assert.match(modelArea(host).textContent ?? "", /Current value: \["one","two"\]/u);
  });

  it("enforces model length, characters and count through the served schema", () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const leaf = settingsLeaves(authority.read()).find(row => row.path === "providers.gemini.models");
    assert.ok(leaf);
    for (const raw of ["", "a b", "a,b", "x".repeat(257), Array.from({ length: 33 }, () => "x").join("\n")]) {
      assert.ok(draftError(leaf, { kind: "set", raw }), raw);
    }
    assert.equal(draftError(leaf, { kind: "set", raw: "same\nsame" }), undefined);
    const rows = modelRows("same\nsame", [], () => crypto.randomUUID());
    assert.notEqual(rows[0]?.id, rows[1]?.id);
    assert.equal(modelRaw(reorderModelRows(rows, [rows[1]?.id ?? "", rows[0]?.id ?? ""])), "same\nsame");
  });

  it("blocks an invalid budget draft and submits its complete corrected object", async () => {
    const { host, commands, controller } = await setup();
    vi.useFakeTimers();
    const timeout = host.querySelector('input[aria-label="OCR extraction: Request timeout"]');
    if (!(timeout instanceof HTMLInputElement)) throw new Error("budget timeout input missing");
    await inputValue(timeout, "0");
    assert.ok(controller().errors["providers.ocrExtract"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(commands.length, 0);
    await inputValue(timeout, "120001");
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(commands.length, 1);
    assert.deepEqual((commands[0] as { payload: { patch: unknown } }).payload.patch, { "providers.ocrExtract": { set: {
      timeoutMs: 120001, concurrency: 4, requestsPerMinute: 10, dailyRequestLimit: 250, costLimitUsdMicros: 0,
    } } });
  });

});
