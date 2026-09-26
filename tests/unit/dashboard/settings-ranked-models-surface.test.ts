// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it, vi } from "vitest";
import { draftError, settingsLeaves } from "../../../src/dashboard/surfaces/settings-draft-model.js";
import { modelRaw, modelRows, removeModelRow, reorderModelRows, updateModelRow } from "../../../src/dashboard/surfaces/settings-ranked-models.js";
import { mountSettingsHarness, settingsAction, syntheticSettingsAuthority } from "./helpers/settings-harness.js";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

async function setup(models: readonly string[] = []) {
  const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
  if (models.length > 0) {
    const result = authority.apply({ "providers.gemini.models": { set: [...models] } });
    assert.equal(result.state, "applied");
  }
  const mounted = await mountSettingsHarness(authority, "providers"); cleanups.push(mounted.close);
  return { ...mounted, authority };
}

function modelArea(host: HTMLElement): HTMLElement {
  const area = host.querySelector('[data-settings-path="providers.gemini.models"]');
  if (!(area instanceof HTMLElement)) throw new Error("Gemini model area missing");
  return area;
}

function click(host: HTMLElement, label: string): Promise<void> {
  const button = host.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button missing: ${label}`);
  return act(async () => { button.click(); });
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
    assert.equal(host.querySelectorAll("[data-settings-path]").length, 2, "only expanded disclosures mount their controls");
    assert.equal(host.querySelectorAll("textarea").length, 0);
    assert.equal(host.querySelectorAll(".settings-provider-grid input").length, 5);
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item").length, 2);
    assert.equal(host.textContent?.includes("5 limits"), false);
  });

  it("keeps duplicate rows distinct through edits, moves and removal", async () => {
    const { host, controller } = await setup(["same", "same", "third"]);
    const area = modelArea(host);
    const second = area.querySelector('input[aria-label="Gemini model 2"]');
    if (!(second instanceof HTMLInputElement)) throw new Error("second model input missing");
    await inputValue(second, "edited");
    assert.equal((controller().draft["providers.gemini.models"] as { raw: string }).raw, "same\nedited\nthird");
    const handle = area.querySelector('button[aria-label="Move edited. Position 2 of 3. Use arrow keys to reorder."]');
    if (!(handle instanceof HTMLButtonElement)) throw new Error("move handle missing");
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    assert.equal((controller().draft["providers.gemini.models"] as { raw: string }).raw, "edited\nsame\nthird");
    await click(host, "Remove Gemini model 2");
    assert.equal((controller().draft["providers.gemini.models"] as { raw: string }).raw, "edited\nthird");
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item").length, 2);
  });

  it("adds an empty row as an invalid visible draft and sends no command", async () => {
    const { host, commands, controller } = await setup(["one"]);
    vi.useFakeTimers();
    const add = [...modelArea(host).querySelectorAll("button")].find(button => button.textContent === "Add model");
    if (!(add instanceof HTMLButtonElement)) throw new Error("Add model missing");
    await act(async () => { add.click(); });
    assert.equal((controller().draft["providers.gemini.models"] as { raw: string }).raw, "one\n");
    assert.ok(controller().errors["providers.gemini.models"]);
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item").length, 2);
    assert.match(modelArea(host).textContent ?? "", /Enter a model name for each row, without spaces or commas\./u);
    assert.doesNotMatch(modelArea(host).textContent ?? "", /one model per line/u);
    assert.equal(modelArea(host).querySelector('input[aria-label="Gemini model 1"]')?.getAttribute("aria-invalid"), null);
    assert.equal(modelArea(host).querySelector('input[aria-label="Gemini model 2"]')?.getAttribute("aria-invalid"), "true");
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(commands.length, 0);
    await settingsAction(() => controller().reset("providers.gemini.models"));
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item").length, 1);
  });

  it("undoes an empty first model without leaving a phantom row", async () => {
    const { host, controller } = await setup();
    const add = [...modelArea(host).querySelectorAll("button")].find(button => button.textContent === "Add model");
    if (!(add instanceof HTMLButtonElement)) throw new Error("Add model missing");
    await act(async () => { add.click(); });
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item").length, 1);
    await settingsAction(() => controller().reset("providers.gemini.models"));
    assert.equal(modelArea(host).querySelectorAll(".ds-ranked-item").length, 0);
  });

  it("autosaves a valid reordered chain and retains restore and undo actions", async () => {
    const { host, commands, controller } = await setup(["one", "two"]);
    vi.useFakeTimers();
    const area = modelArea(host);
    const handle = area.querySelector('button[aria-label="Move two. Position 2 of 2. Use arrow keys to reorder."]');
    if (!(handle instanceof HTMLButtonElement)) throw new Error("move handle missing");
    await act(async () => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    assert.ok(area.querySelector('button[aria-label="Actions for Gemini model order"]'));
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(commands.length, 1);
    assert.deepEqual((commands[0] as { payload: { patch: unknown } }).payload.patch, { "providers.gemini.models": { set: ["two", "one"] } });
    assert.equal(controller().save.state, "applied");
    await settingsAction(() => controller().clear("providers.gemini.models"));
    assert.deepEqual(controller().draft["providers.gemini.models"], { kind: "clear" });
    await settingsAction(() => controller().reset("providers.gemini.models"));
    assert.equal(controller().draft["providers.gemini.models"], undefined);
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
    assert.equal(modelRaw(updateModelRow(rows, rows[1]?.id ?? "", "new")), "same\nnew");
    assert.equal(modelRaw(removeModelRow(rows, rows[0]?.id ?? "")), "same");
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

  it("retains a model draft on revision conflict and exposes the refreshed value", async () => {
    const { host, authority, controller, commands } = await setup(["original"]);
    await settingsAction(() => controller().update("providers.gemini.models", "draft"));
    const competing = authority.apply({ "providers.gemini.models": { set: ["remote"] } });
    assert.equal(competing.state, "applied");
    await settingsAction(() => controller().submit());
    assert.equal(commands.length, 1);
    assert.equal(controller().save.state, "conflict");
    assert.equal((controller().draft["providers.gemini.models"] as { raw: string }).raw, "draft");
    assert.match(modelArea(host).textContent ?? "", /Current value: \["remote"\]/u);
  });
});
