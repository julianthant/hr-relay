import { readSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it, vi } from "vitest";
import { draftError, settingsLeaves } from "../../../../../src/dashboard/surfaces/settings/editor/settings-draft-model.js";
import { mountSettingsHarness, syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";
import { fixtureSettingsDocument } from "../../../../support/fixtures/dashboard/fixture-settings.js";

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

describe("provider budgets and models", () => {
  it("retires the provider page without changing the served budget inventory", async () => {
    const { host, controller } = await setup(["first", "second"]);
    assert.match(host.textContent ?? "", /Provider settings retired/u);
    assert.match(host.textContent ?? "", /ChatGPT sign-in is available in General/u);
    assert.equal(host.querySelectorAll("input, textarea, .ds-ranked-item").length, 0);
    assert.equal(controller().leaves.filter(leaf => leaf.path.startsWith("providers.")).length, 9);
  });

  it("keeps an unconfigured adapter empty without rendering model controls", async () => {
    const { host } = await setup();
    assert.equal(host.querySelectorAll(".ds-ranked-item, input").length, 0);
    assert.doesNotMatch(host.textContent ?? "", /Add model/u);
  });

  it("submits the retained reordered chain with the exact configured membership", async () => {
    const { commands, controller } = await setup(["one", "two"]);
    vi.useFakeTimers();
    await act(async () => { controller().update("providers.gemini.models", "two\none"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(commands.length, 1);
    assert.deepEqual((commands[0] as { payload: { patch: unknown } }).payload.patch, { "providers.gemini.models": { set: ["two", "one"] } });
    assert.equal(controller().save.state, "applied");
  });

  it("retains the adapter draft on a genuine revision conflict", async () => {
    const { authority, controller, commands } = await setup(["one", "two"]);
    await act(async () => { controller().update("providers.gemini.models", "two\none"); });
    const competing = authority.apply({ "providers.gemini.models": { set: ["one", "two"] } });
    assert.equal(competing.state, "applied");
    await act(async () => { controller().submit(); });
    assert.equal(commands.length, 1);
    assert.equal(controller().save.state, "conflict");
    assert.equal((controller().draft["providers.gemini.models"] as { raw: string }).raw, "two\none");
    assert.deepEqual(controller().leaves.find(leaf => leaf.path === "providers.gemini.models")?.effectiveValue, ["one", "two"]);
  });

  it("enforces model length, characters and count through the served schema", () => {
    const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
    const leaf = settingsLeaves(authority.read()).find(row => row.path === "providers.gemini.models");
    assert.ok(leaf);
    for (const raw of ["", "a b", "a,b", "x".repeat(257), Array.from({ length: 33 }, () => "x").join("\n")]) {
      assert.ok(draftError(leaf, { kind: "set", raw }), raw);
    }
    assert.equal(draftError(leaf, { kind: "set", raw: "same\nsame" }), undefined);
  });

  it("blocks an invalid budget adapter draft and submits its complete corrected object", async () => {
    const { commands, controller } = await setup();
    vi.useFakeTimers();
    const budget = { timeoutMs: "0", concurrency: "4", requestsPerMinute: "10", dailyRequestLimit: "250", costLimitUsdMicros: "0" };
    await act(async () => { controller().update("providers.ocrExtract", budget); });
    assert.ok(controller().errors["providers.ocrExtract"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(commands.length, 0);
    await act(async () => { controller().update("providers.ocrExtract", { ...budget, timeoutMs: "120001" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(commands.length, 1);
    assert.deepEqual((commands[0] as { payload: { patch: unknown } }).payload.patch, { "providers.ocrExtract": { set: {
      timeoutMs: 120001, concurrency: 4, requestsPerMinute: 10, dailyRequestLimit: 250, costLimitUsdMicros: 0,
    } } });
  });
});
