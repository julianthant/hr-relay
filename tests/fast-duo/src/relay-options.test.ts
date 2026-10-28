// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { it, vi } from "vitest";

it("renders the approved extension states and keeps card selection, guards and focus aligned with the selector", async () => {
  const { mountRelayOptions } = await import(pathToFileURL(resolve("fast-duo/src/relay-options.js")).href) as { mountRelayOptions(this: void, profile: unknown): Promise<void> };
  vi.useFakeTimers();
  document.body.innerHTML = readFileSync("fast-duo/src/options.html", "utf8");
  let profile = { operationId: "synthetic-operation", profileId: "synthetic-profile", methods: { key: { state: "idle" }, touch: { state: "idle" } } };
  let release: (() => void) | undefined;
  const calls: string[] = [];
  vi.stubGlobal("chrome", { runtime: { sendMessage: async ({ type }: { type: string }) => {
    calls.push(type);
    if (type === "RELAY_OPEN_PORTAL") await new Promise<void>(resolve => { release = resolve; });
    return { success: true, result: { relaySetup: true, profile } };
  } } });
  const cards = () => [...document.querySelectorAll<HTMLButtonElement>(".relay-method-card")];
  const select = () => document.querySelector<HTMLSelectElement>("#transport")!;
  try {
    await mountRelayOptions(profile);
    assert.deepEqual(cards().map(card => card.querySelector("strong")?.textContent), ["Security key", "Touch ID"]);
    assert.equal(select().options[1].textContent, "Touch ID on this Mac (native)");
    cards()[1].focus(); cards()[1].click();
    assert.equal(select().value, "internal"); assert.equal(cards()[1].getAttribute("aria-pressed"), "true");
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(document.activeElement, cards()[1]);
    select().value = "usb"; select().dispatchEvent(new Event("change"));
    assert.equal(cards()[0].getAttribute("aria-pressed"), "true");
    document.querySelector<HTMLButtonElement>("#openLogin")!.click();
    assert.ok(cards().every(card => card.disabled)); assert.equal(select().disabled, true);
    assert.ok(release); release(); await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    assert.ok(cards().every(card => !card.disabled));
    for (const [state, label, tones] of [
      ["idle", "Not started", ["off", "off", "off"]],
      ["pending", "Pending", ["complete", "pending", "off"]],
      ["complete", "Completed", ["complete", "complete", "complete"]],
      ["unknown", "Failed", ["complete", "failed", "off"]],
      ["unavailable", "Failed", ["complete", "failed", "off"]],
    ] as const) {
      profile = { ...profile, methods: { key: { state }, touch: { state: "idle" } } };
      await vi.advanceTimersByTimeAsync(1000);
      assert.equal(cards()[0].querySelector(".relay-method-pill")?.textContent, label);
      assert.deepEqual([...cards()[0].querySelectorAll<HTMLElement>("ol li")].map(step => step.dataset.state), tones);
      assert.equal(document.getElementById("accountCount")?.textContent, `${state === "complete" ? 1 : 0} of 2 completed`);
      assert.equal(select().disabled, state === "pending");
      assert.ok(cards().every(card => card.disabled === (state === "pending")));
      assert.equal(cards()[0].querySelectorAll("svg").length, 2);
      if (state === "unknown" || state === "unavailable") {
        assert.match(cards()[0].textContent ?? "", /Not confirmed/);
        assert.match(cards()[0].textContent ?? "", /do not repeat this attempt/);
      }
    }
    assert.ok(calls.includes("STATE"));
    assert.equal(document.querySelector(".relay-method-sync")?.textContent, "Same status as the Relay sign-up step. Updated every second.");
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});
