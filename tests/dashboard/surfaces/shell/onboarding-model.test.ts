// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, vi } from "vitest";
import { duoSummary, mockOnboardingPort as port, parseDuoMessage, useDuoBrowser, useMockDuoSetup } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";

describe("HUB mock onboarding boundary", () => {
  const details = { firstName: "Alex", lastName: "Rivera", email: "alex.rivera@ucsd.edu", password: "Relay-demo-42" };
  it("validates every signup field and accepts only UCSD email", () => {
    assert.equal(port.source, "mock");
    assert.deepEqual(Object.keys(port.validate("signup", { firstName: " ", lastName: "", email: "alex@example.edu", password: "short" })), ["firstName", "lastName", "email", "password"]);
    assert.deepEqual(port.validate("signup", details), {});
    for (const email of ["alex@ucsd.edu.evil", "a@b@ucsd.edu", "a b@ucsd.edu"]) assert.ok(port.validate("login", { ...details, email }).email);
  });
  it("keeps synthetic login rejection and individual Duo confirmations distinct", () => {
    assert.equal(port.login(details), "accepted");
    assert.equal(port.login({ ...details, email: "other@ucsd.edu" }), "unknown-email");
    assert.equal(port.login({ ...details, password: "incorrect" }), "incorrect-password");
    const empty = { key: false, touch: false };
    const key = port.confirm("key", empty);
    assert.deepEqual(empty, { key: false, touch: false });
    assert.equal(duoSummary(key), "Security key ready · Touch ID not added");
    assert.equal(duoSummary(port.confirm("touch", key)), "Security key and Touch ID ready");
    assert.equal(duoSummary(port.confirm("touch", empty)), "Touch ID ready · Security key not added");
  });
  it("rejects malformed popup messages rather than interpreting readiness", () => {
    for (const message of [null, "ready", {}, { type: "hub-duo-ready", key: true, touch: true }, { type: "hub-duo-mock", key: "true", touch: true }]) assert.equal(parseDuoMessage(message), undefined);
    assert.deepEqual(parseDuoMessage({ type: "hub-duo-mock", key: true, touch: false }), { key: true, touch: false });
  });
});

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("requires an owned popup and retains both confirmations delivered together", async () => {
  const host = document.createElement("div"), frame = document.createElement("iframe");
  document.body.append(host, frame);
  const child = frame.contentWindow!;
  vi.spyOn(child, "close").mockImplementation(() => {});
  vi.spyOn(window, "open").mockReturnValue(child);
  const root = createRoot(host);
  let browser: ReturnType<typeof useDuoBrowser>, methods = { key: false, touch: false };
  function Probe() { const [value, change] = useState(methods); methods = value; browser = useDuoBrowser(value, change); return null; }
  const send = (source: Window | null, key: boolean, touch: boolean, origin = location.origin) => window.dispatchEvent(new MessageEvent("message", { source, origin, data: { type: "hub-duo-mock", key, touch } }));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => { send(null, true, true); });
    assert.deepEqual(methods, { key: false, touch: false });
    await act(async () => browser.open());
    await act(async () => { send(null, true, true); send(child, true, true, "https://wrong.example"); });
    assert.deepEqual(methods, { key: false, touch: false });
    await act(async () => { send(child, true, false); send(child, false, true); });
    assert.deepEqual(methods, { key: true, touch: true });
  } finally { await act(async () => root.unmount()); vi.restoreAllMocks(); host.remove(); frame.remove(); }
});

it("keeps a standalone setup disconnected when a message has no sender", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let setup!: ReturnType<typeof useMockDuoSetup>;
  function Probe() { setup = useMockDuoSetup(); return null; }
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => { window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: null, data: { type: "hub-duo-mock", key: true, touch: true } })); });
    assert.equal(setup.connected, false);
    assert.deepEqual(setup.methods, { key: false, touch: false });
  } finally { await act(async () => root.unmount()); host.remove(); }
});
