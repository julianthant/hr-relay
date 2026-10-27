// @vitest-environment jsdom
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, vi } from "vitest";
import { createServedOnboardingPort, duoSummary, mockOnboardingPort as port, parseDuoMessage, useDuoBrowser, useMockDuoSetup, usePublicProfileSession, useServedDuoSetup } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";

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


it("uses the served profile client without accepting demo credentials or mock Duo confirmation", async () => {
  const requests: { path: string; body: unknown }[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: async (url, init) => {
    requests.push({ path: new URL(url).pathname, body: JSON.parse(typeof init?.body === "string" ? init.body : "null") });
    return Response.json({ state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
  } });
  const settled: unknown[] = [];
  const served = createServedOnboardingPort(client, value => { settled.push(value); });
  const details = { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" };
  assert.deepEqual(await served.submit("login", details), { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
  assert.deepEqual(requests, [{ path: "/api/v1/profile/sign-in", body: { email: details.email, password: details.password } }]);
  assert.equal(settled.length, 1);
  assert.equal("confirm" in served, false);
});

it("opens the served setup while refusing forged mock Duo readiness", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), open = vi.spyOn(window, "open").mockReturnValue(null);
  let browser!: ReturnType<typeof useDuoBrowser>, methods = { key: false, touch: false };
  function Probe() { const [value, change] = useState(methods); methods = value; browser = useDuoBrowser(value, change, "served"); return null; }
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => { browser.open(); window.dispatchEvent(new MessageEvent("message", { origin: location.origin,
      source: window, data: { type: "hub-duo-mock", key: true, touch: true } })); });
    assert.equal(open.mock.calls.length, 1); assert.equal(browser.status, "error");
    assert.deepEqual(methods, { key: false, touch: false });
  } finally { await act(async () => root.unmount()); open.mockRestore(); host.remove(); }
});

it("ignores superseded session reads and login settlements after logout or unmount", async () => {
  const replies: ((response: Response) => void)[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: () => new Promise<Response>(resolve => { replies.push(resolve); }) });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let session!: ReturnType<typeof usePublicProfileSession>;
  function Probe() { session = usePublicProfileSession(client, true); return null; }
  const details = { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" };
  try {
    await act(async () => root.render(createElement(Probe)));
    let login!: ReturnType<typeof session.port.submit>, logout!: Promise<void>;
    await act(async () => { login = session.port.submit("login", details); });
    await act(async () => { logout = session.logout(); });
    await act(async () => { replies[2](Response.json({ state: "signed-out" })); await logout; });
    await act(async () => { replies[1](Response.json({ state: "refused", code: "PROFILE_SIGN_IN_REFUSED" })); await assert.rejects(login);
      replies[0](Response.json({ state: "cancelling", operationId: "00000000-0000-4000-8000-000000000001" })); });
    assert.deepEqual(session.state, { state: "signed-out" });
    await act(async () => { login = session.port.submit("login", details); });
    await act(async () => root.unmount());
    await act(async () => { replies[3](Response.json({ state: "refused", code: "PROFILE_SIGN_IN_REFUSED" })); await assert.rejects(login); });
    assert.deepEqual(session.state, { state: "signed-out" });
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("never carries selected public-session authority into a replacement client", async () => {
  const response = Promise.withResolvers<Response>();
  const a = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: async () => Response.json({ state: "active",
    profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready" }) });
  const b = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: () => response.promise });
  const host = document.createElement("div"), root = createRoot(host);
  const seen: ReturnType<typeof usePublicProfileSession>["state"][] = [];
  function Probe({ client }: { client: typeof a }) { seen.push(usePublicProfileSession(client, true).state); return null; }
  try {
    await act(async () => root.render(createElement(Probe, { client: a })));
    assert.equal(seen.at(-1)?.state, "active");
    const boundary = seen.length;
    await act(async () => root.render(createElement(Probe, { client: b })));
    assert.ok(seen.slice(boundary).every(state => state === undefined));
    await act(async () => { response.resolve(Response.json({ state: "signed-out" })); });
    assert.deepEqual(seen.at(-1), { state: "signed-out" });
  } finally { await act(async () => root.unmount()); host.remove(); }
});


const draftMethod = (state: "idle" | "pending" | "complete" | "unknown" = "idle") => ({ state,
  ceremonyObserved: state === "complete", portalAccepted: state === "complete", operatorConfirmed: state === "complete", exactCredentialRequestObserved: false });
const onboardingDraft = () => ({ state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001",
  profileId: "00000000-0000-4000-8000-000000000002", step: "duo" as const, methods: { key: draftMethod(), touch: draftMethod() } });

it("signup can only settle a draft, never a premature active session", async () => {
  const settled: unknown[] = [];
  let value: unknown = onboardingDraft();
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async () => Response.json(value) });
  const served = createServedOnboardingPort(client, state => settled.push(state));
  const details = { firstName: "Test", lastName: "Operator", email: "test@example.invalid", password: "synthetic-test-password" };
  assert.equal((await served.submit("signup", details)).state, "onboarding");
  value = { state: "active", profileId: onboardingDraft().profileId, epoch: 1, duoState: "ready" };
  await assert.rejects(served.submit("signup", details));
  assert.equal(settled.length, 1);
});

it("served Duo keeps partial completion and unknown custody under server authority", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  let draft = onboardingDraft(), calls = 0;
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async () => { calls++; return Response.json(draft); } });
  let setup!: ReturnType<typeof useServedDuoSetup>;
  function Probe() { setup = useServedDuoSetup(createServedOnboardingPort(client, () => {}, draft)); return null; }
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => { await setup.start("key"); });
    assert.equal(calls, 1); assert.deepEqual(setup.methods, { key: false, touch: false });
    draft = { ...draft, methods: { key: draftMethod("complete"), touch: draftMethod("unknown") } };
    await act(async () => root.render(createElement(Probe)));
    assert.deepEqual(setup.methods, { key: true, touch: false });
    await act(async () => { setup.start("touch"); window.dispatchEvent(new MessageEvent("message", { data: { type: "duo-methods", key: true, touch: true } })); });
    assert.equal(calls, 1); assert.equal(setup.methods.touch, false);
  } finally { await act(async () => root.unmount()); }
});

it("draft commands reject foreign operation settlements and cancel through the scoped port", async () => {
  const draft = onboardingDraft(), settled: unknown[] = [], calls: string[] = [];
  let foreign = true;
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async url => {
    calls.push(new URL(url).pathname);
    return Response.json(foreign ? { ...draft, operationId: "00000000-0000-4000-8000-000000000003" } : { state: "signed-out" });
  } });
  const served = createServedOnboardingPort(client, value => settled.push(value), draft);
  await assert.rejects(served.start("key")); assert.equal(settled.length, 0);
  foreign = false;
  assert.deepEqual(await served.cancel(), { state: "signed-out" });
  assert.deepEqual(calls, ["/api/v1/profile/onboarding/duo/start", "/api/v1/profile/onboarding/cancel"]);
});


it("exact-attempt cancellation preserves the other method and rejects premature activation", async () => {
  const attemptId = "00000000-0000-4000-8000-000000000003";
  const draft = { ...onboardingDraft(), methods: { key: draftMethod("complete"), touch: { ...draftMethod("pending"), attemptId } } };
  let activate = false;
  const requests: unknown[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json(activate ? { state: "active", profileId: draft.profileId, epoch: 1, duoState: "ready" }
      : { ...draft, methods: { ...draft.methods, touch: draftMethod("unknown") } });
  } });
  const settled: unknown[] = [], served = createServedOnboardingPort(client, state => settled.push(state), draft);
  const result = await served.cancelDuo("touch", attemptId);
  assert.equal(result.state, "onboarding");
  if (result.state === "onboarding") { assert.equal(result.methods.key.state, "complete"); assert.equal(result.methods.touch.state, "unknown"); }
  assert.deepEqual(requests, [{ operationId: draft.operationId, method: "touch", attemptId }]);
  activate = true;
  await assert.rejects(served.confirmDuo({ operationId: draft.operationId, profileId: draft.profileId, method: "touch", attemptId, generation: 0, authorityScope: undefined }));
  assert.equal(settled.length, 1);
});


it("served Open Duo browser opens existing confirmation UI without starting capture", async () => {
  const host = document.createElement("div"), root = createRoot(host), open = vi.spyOn(window, "open").mockReturnValue(null);
  const draft = onboardingDraft(); let calls = 0;
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async () => { calls++; return Response.json(draft); } });
  let setup!: ReturnType<typeof useServedDuoSetup>;
  function Probe() { setup = useServedDuoSetup(createServedOnboardingPort(client, () => {}, draft)); return null; }
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => setup.open(false));
    assert.equal(open.mock.calls.length, 1); assert.equal(calls, 0);
    assert.deepEqual(setup.methods, { key: false, touch: false });
    await act(async () => setup.open(true));
    assert.equal(calls, 1); assert.equal(open.mock.calls.length, 1);
  } finally { await act(async () => root.unmount()); open.mockRestore(); }
});


it("confirmation retains the displayed attempt and rejects replacement, expiry, method and owner generations", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  const firstAttempt = "00000000-0000-4000-8000-000000000003", secondAttempt = "00000000-0000-4000-8000-000000000004";
  let draft = { ...onboardingDraft(), methods: { key: { ...draftMethod("pending"), attemptId: firstAttempt }, touch: draftMethod() } };
  let authorityScope = {}, signedOut = false;
  const requests: unknown[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body))); return Response.json(draft);
  } });
  let setup!: ReturnType<typeof useServedDuoSetup>;
  function Probe() { setup = useServedDuoSetup(signedOut ? undefined : { ...createServedOnboardingPort(client, () => {}, draft), authorityScope }); return null; }
  try {
    await act(async () => root.render(createElement(Probe)));
    const oldConfirm = setup.confirm;
    let displayed!: Awaited<ReturnType<typeof setup.start>>;
    await act(async () => { displayed = await setup.start("key"); });
    assert.ok(displayed); assert.equal(displayed.attemptId, firstAttempt);
    await act(async () => { await setup.start("key"); });
    assert.equal(setup.matchesConfirmation(displayed), false);
    await act(async () => oldConfirm(displayed!)); assert.equal(requests.length, 0);
    draft = { ...draft, methods: { ...draft.methods, key: { ...draft.methods.key, attemptId: secondAttempt } } };
    await act(async () => root.render(createElement(Probe)));
    await act(async () => oldConfirm(displayed!)); assert.equal(requests.length, 0);
    assert.equal(setup.matchesConfirmation(displayed), false);
    let replacement!: Awaited<ReturnType<typeof setup.start>>;
    await act(async () => { replacement = await setup.start("key"); }); assert.ok(replacement);
    await act(async () => setup.setMethod("touch"));
    await act(async () => oldConfirm(replacement!)); assert.equal(requests.length, 0);
    await act(async () => setup.setMethod("key"));
    await act(async () => { replacement = await setup.start("key"); }); assert.ok(replacement);
    authorityScope = {};
    await act(async () => root.render(createElement(Probe)));
    await act(async () => oldConfirm(replacement!)); assert.equal(requests.length, 0);
    await act(async () => { replacement = await setup.start("key"); }); assert.ok(replacement);
    draft = { ...draft, methods: { ...draft.methods, key: { ...draftMethod("unknown"), attemptId: secondAttempt } } };
    await act(async () => root.render(createElement(Probe)));
    await act(async () => oldConfirm(replacement!)); assert.equal(requests.length, 0);
    draft = { ...draft, operationId: "00000000-0000-4000-8000-000000000005", methods: { ...draft.methods, key: { ...draftMethod("pending"), attemptId: secondAttempt } } };
    await act(async () => root.render(createElement(Probe)));
    await act(async () => oldConfirm(displayed!)); assert.equal(requests.length, 0);
    await act(async () => { replacement = await setup.start("key"); }); assert.ok(replacement);
    await act(async () => setup.dismissConfirmation(replacement!));
    await act(async () => oldConfirm(replacement!)); assert.equal(requests.length, 0);
    await act(async () => { replacement = await setup.start("key"); }); assert.ok(replacement);
    await act(async () => setup.confirm(replacement!));
    assert.deepEqual(requests, [{ operationId: replacement.operationId, method: "key", attemptId: secondAttempt, operatorConfirmed: true }]);
    signedOut = true;
    await act(async () => root.render(createElement(Probe)));
    await act(async () => oldConfirm(replacement!)); assert.equal(requests.length, 1);
    await act(async () => root.unmount());
    await act(async () => oldConfirm(replacement!)); assert.equal(requests.length, 1);
  } finally { await act(async () => root.unmount()); }
});
