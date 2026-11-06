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
    if (type === "RELAY_START") await new Promise<void>(resolve => { release = resolve; });
    return { success: true, result: { relaySetup: true, profile } };
  } } });
  const cards = () => [...document.querySelectorAll<HTMLButtonElement>(".relay-method-card")];
  const title = () => document.getElementById("editorTitle")?.textContent;
  try {
    await mountRelayOptions(profile);
    assert.deepEqual(cards().map(card => card.querySelector("strong")?.textContent), ["Security key", "Touch ID"]);
    assert.equal(document.querySelector("select"), null); assert.equal(document.getElementById("transport"), null);
    assert.equal(title(), "Set up Security key");
    cards()[1].focus(); cards()[1].click();
    assert.equal(cards()[1].getAttribute("aria-pressed"), "true"); assert.equal(title(), "Set up Touch ID");
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(document.activeElement, cards()[1]);
    cards()[0].click();
    assert.equal(cards()[0].getAttribute("aria-pressed"), "true");
    document.querySelector<HTMLButtonElement>("#primaryAction")!.click();
    assert.ok(cards().every(card => card.disabled));
    assert.ok(release); release(); await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    assert.ok(cards().every(card => !card.disabled));
    for (const [state, label] of [
      ["idle", "Not started"],
      ["pending", "Pending"],
      ["complete", "Completed"],
      ["unknown", "Not confirmed"],
      ["unavailable", "Unavailable"],
    ] as const) {
      profile = { ...profile, methods: { key: { state }, touch: { state: "idle" } } };
      await vi.advanceTimersByTimeAsync(1000);
      assert.equal(cards()[0].querySelector(".relay-method-pill")?.textContent, label);
      assert.equal(cards()[0].querySelector(".relay-method-track"), null);
      assert.doesNotMatch(cards()[0].textContent ?? "", /Started|Added in Duo|Confirmed by Relay/);
      assert.equal(cards()[0].querySelector(".relay-method-identity strong")?.textContent, "Security key");
      assert.equal(cards()[0].querySelector(".relay-method-identity > span")?.textContent, "Fast Duo in this browser");
      assert.equal(document.getElementById("accountCount")?.textContent, `${state === "complete" ? 1 : 0} of 2 completed`);
      assert.ok(cards().every(card => !card.disabled));
      assert.equal(cards()[0].querySelectorAll("svg").length, 2);
      if (state === "unknown" || state === "unavailable") {
        assert.match(cards()[0].textContent ?? "", state === "unknown" ? /Not confirmed/ : /Unavailable/);
        cards()[0].click();
        assert.equal(title(), state === "unknown" ? "Check Security key in Duo" : "Security key unavailable");
        assert.match(document.getElementById("instruction")?.textContent ?? "", state === "unknown" ? /remove any device you do not recognize, then start over/ : /Return to Relay to check setup/);
      }
    }
    assert.ok(calls.includes("STATE"));
    assert.equal(document.querySelector(".relay-method-sync"), null);
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});

for (const lateFailure of [false, true]) it(`keeps actions available during a state poll and ignores its superseded ${lateFailure ? "failure" : "reply"}`, async () => {
  const { mountRelayOptions } = await import(pathToFileURL(resolve("fast-duo/src/relay-options.js")).href) as { mountRelayOptions(this: void, profile: unknown): Promise<void> };
  vi.useFakeTimers();
  document.body.innerHTML = readFileSync("fast-duo/src/options.html", "utf8");
  const initial = { operationId: "synthetic-operation", profileId: "synthetic-profile", methods: { key: { state: "idle" }, touch: { state: "idle" } } };
  const pending = { ...initial, methods: { ...initial.methods, key: { state: "pending", attemptId: "synthetic-attempt" } } };
  let settle: (() => void) | undefined;
  const calls: string[] = [];
  vi.stubGlobal("chrome", { runtime: { sendMessage: async ({ type }: { type: string }) => {
    calls.push(type);
    if (type === "STATE") return new Promise((resolve, reject) => {
      settle = () => lateFailure ? reject(new Error("synthetic obsolete state read")) : resolve({ success: true, result: { relaySetup: true, profile: initial } });
    });
    assert.ok(type === "RELAY_START" || type === "RELAY_OPEN_PORTAL");
    return { success: true, result: { relaySetup: true, profile: pending } };
  } } });
  try {
    await mountRelayOptions(initial);
    await vi.advanceTimersByTimeAsync(1000);
    assert.ok(settle);
    const start = document.querySelector<HTMLButtonElement>("#primaryAction")!;
    assert.equal(start.disabled, false);
    start.click();
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(calls, ["STATE", "RELAY_START", "RELAY_OPEN_PORTAL"]);
    assert.equal(document.querySelector<HTMLButtonElement>("#cancelCapture")!.disabled, false);
    settle();
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(document.querySelector<HTMLButtonElement>("#cancelCapture")!.disabled, false);
    assert.equal(document.querySelector<HTMLElement>('.relay-method-card[data-method="key"]')!.dataset.state, "pending");
    assert.equal(document.getElementById("message")!.hidden, true);
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});

it("a refused action leaves setup usable and an unconfirmed method can start over", async () => {
  const { mountRelayOptions } = await import(pathToFileURL(resolve("fast-duo/src/relay-options.js")).href) as { mountRelayOptions(this: void, profile: unknown): Promise<void> };
  vi.useFakeTimers();
  document.body.innerHTML = readFileSync("fast-duo/src/options.html", "utf8");
  const profile = { operationId: "synthetic-operation", profileId: "synthetic-profile",
    methods: { key: { state: "unknown", attemptId: "synthetic-attempt" }, touch: { state: "idle" } } };
  const calls: string[] = [];
  vi.stubGlobal("chrome", { runtime: { sendMessage: async ({ type, method }: { type: string; method?: string }) => {
    calls.push(method === undefined ? type : `${type}:${method}`);
    if (type === "RELAY_START" && method === "touch") return { success: false };
    return { success: true, result: { relaySetup: true, profile } };
  } } });
  const start = () => document.querySelector<HTMLButtonElement>("#primaryAction")!;
  try {
    await mountRelayOptions(profile);
    assert.equal(start().hidden, false); assert.equal(start().disabled, false); assert.equal(start().textContent, "Start Security key over");
    document.querySelector<HTMLButtonElement>('.relay-method-card[data-method="touch"]')!.click();
    start().click();
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(document.getElementById("message")!.hidden, false);
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(start().disabled, false); assert.equal(document.querySelector<HTMLButtonElement>("#returnRelay")!.disabled, false);
    assert.equal(document.getElementById("editorTitle")!.textContent, "Set up Touch ID");
    start().click();
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(calls.filter(call => call.startsWith("RELAY_START")), ["RELAY_START:touch", "RELAY_START:touch"]);
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});

for (const [portalFailure, expected] of [
  ["sign-in", "Relay could not sign in to Duo. Select Sign in to Duo to open the trusted sign-in page."],
  ["untrusted", "Relay could not trust this Duo page. Do not enter your password. Close the Duo tab, then try Show Duo again."],
  [undefined, "Relay could not finish that action. Try again, or return to Relay."],
  ["unrecognized", "Relay could not finish that action. Try again, or return to Relay."],
] as const) it(`uses only the closed portal recovery advice for ${portalFailure ?? "missing"} proof`, async () => {
  const { mountRelayOptions } = await import(pathToFileURL(resolve("fast-duo/src/relay-options.js")).href) as { mountRelayOptions(this: void, profile: unknown): Promise<void> };
  vi.useFakeTimers();
  document.body.innerHTML = readFileSync("fast-duo/src/options.html", "utf8");
  const profile = { operationId: "synthetic-operation", profileId: "synthetic-profile",
    methods: { key: { state: "pending", attemptId: "synthetic-attempt" }, touch: { state: "idle" } } };
  let openings = 0, manual = 0;
  vi.stubGlobal("chrome", { runtime: { sendMessage: async ({ type }: { type: string }) => {
    if (type === "RELAY_SHOW_PORTAL") { manual++; return { success: true, result: { relaySetup: true, profile } }; }
    if (type === "RELAY_OPEN_PORTAL") { openings++; return { success: false, portalFailure }; }
    return { success: true, result: { relaySetup: true, profile } };
  } } });
  try {
    await mountRelayOptions(profile);
    const button = document.querySelector<HTMLButtonElement>("#primaryAction")!;
    assert.equal(button.textContent, "Show Duo");
    button.click(); await vi.advanceTimersByTimeAsync(0);
    assert.equal(document.getElementById("message")!.textContent, expected);
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(document.getElementById("message")!.textContent, expected);
    assert.equal(button.disabled, false);
    button.click(); await vi.advanceTimersByTimeAsync(0);
    assert.equal(openings, portalFailure === "sign-in" ? 1 : 2);
    assert.equal(manual, portalFailure === "sign-in" ? 1 : 0);
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});
