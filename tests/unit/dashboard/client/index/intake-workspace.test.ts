// @vitest-environment jsdom
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { CommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { IntakeWorkspace } from "../../../../../src/dashboard/surfaces/intake/intake.js";
import { FIXTURE_INTAKE_VALIDATED } from "../../../../parity/helpers/fixture-intake.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
async function flush(work: () => void) { await act(async () => { work(); await Promise.resolve(); }); }
afterEach(async () => { await flush(() => root?.unmount()); root = undefined; document.body.replaceChildren(); });
async function mount(wire = FIXTURE_INTAKE_VALIDATED, options: {
  post?: (request: unknown, count: number) => Promise<Response>;
  read?: (count: number) => Promise<Response>;
} = {}) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const calls: unknown[] = []; let reads = 0;
  const client = createDashboardClient({ baseUrl: "http://intake.test", fetchImpl: (_url, init) => {
    if (init?.method === "POST") { calls.push(JSON.parse(typeof init.body === "string" ? init.body : (() => { throw new Error("expected JSON request body"); })())); return options.post?.(calls.at(-1), calls.length) ?? Promise.reject(new Error("Synthetic refusal to reach server")); }
    reads++; if (options.read !== undefined) return options.read(reads);
    return Promise.resolve(new Response(JSON.stringify(wire), { status: 200, headers: { "content-type": "application/json" } }));
  } });
  await flush(() => root?.render(createElement(DashboardClientProvider, { client, children: createElement(IntakeWorkspace, { workflowLabel: "Synthetic intake", actorId: "local-operator", supportsDryRun: true, sessionId: wire.intakeSessionId, onClose: () => {}, onEnqueued: () => {} }) })));
  const button = (text: string) => { const el = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === text); assert.ok(el, `Missing ${text}: ${host.textContent}`); return el; };
  return { host, button, calls };
}
it("acknowledging rejection history cannot enable unresolved rows", async () => {
  const h = await mount(); const checkbox = h.host.querySelector<HTMLButtonElement>('[role="checkbox"]'); assert.ok(checkbox);
  await flush(() => checkbox.click()); assert.equal(h.button(`Start ${String(FIXTURE_INTAKE_VALIDATED.validation.state === "validated" ? FIXTURE_INTAKE_VALIDATED.validation.validRows : 0)} runs`).disabled, true);
  assert.match(h.host.textContent ?? "", /unresolved/);
});
it("zero valid rows stay blocked even without rejection history", async () => {
  assert.equal(FIXTURE_INTAKE_VALIDATED.validation.state, "validated");
  if (FIXTURE_INTAKE_VALIDATED.validation.state !== "validated") throw new Error("fixture validation absent");
  const h = await mount({ ...FIXTURE_INTAKE_VALIDATED, validation: { ...FIXTURE_INTAKE_VALIDATED.validation, validRows: 0, unresolvedRows: [], rejected: [], excluded: [] } });
  assert.equal(h.button("Start 0 runs").disabled, true);
});
it("a failed correction preserves the editor draft", async () => {
  const h = await mount(); await flush(() => h.button("Fix cell").click());
  const input = h.host.querySelector<HTMLInputElement>('input[name="intake-corrected-value"]'); assert.ok(input);
  await flush(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "10456712"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush(() => h.button("Re-coerce this cell").click());
  assert.equal(h.calls.length, 1); assert.equal(input.value, "10456712"); assert.equal(input.isConnected, true);
});

function readyWire() {
  if (FIXTURE_INTAKE_VALIDATED.validation.state !== "validated") throw new Error("fixture validation absent");
  return { ...FIXTURE_INTAKE_VALIDATED, reviewBinding: FingerprintSchema.parse("a".repeat(64)), validation: { ...FIXTURE_INTAKE_VALIDATED.validation, unresolvedRows: [], rejected: [], validRows: 2 } };
}
function reply(request: unknown) {
  const parsed = CommandRequestSchema.parse(request);
  return new Response(JSON.stringify({ state: "applied", commandId: parsed.commandId, affectedTargets: [{ family: "intake", intakeSessionId: FIXTURE_INTAKE_VALIDATED.intakeSessionId }] }), { status: 200 });
}
async function confirm(h: Awaited<ReturnType<typeof mount>>) {
  const checkbox = h.host.querySelector<HTMLButtonElement>('[role="checkbox"]'); assert.ok(checkbox); await flush(() => checkbox.click());
}
it("requires explicit confirmation, then guards duplicate clicks and replays the exact envelope after a lost reply", async () => {
  const h = await mount(readyWire(), { post: (request, n) => n === 1 ? Promise.reject(new Error("lost response")) : Promise.resolve(reply(request)) });
  assert.equal(h.button("Start 2 runs").disabled, true); await confirm(h); assert.equal(h.button("Start 2 runs").disabled, false);
  await flush(() => { h.button("Start 2 runs").click(); h.button("Start 2 runs").click(); });
  assert.equal(h.calls.length, 1); assert.equal(h.button("Start 2 runs").disabled, true);
  await flush(() => h.button("Recover exact command").click()); assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1], h.calls[0]);
});
it("after an applied response, recovery rereads the exact session without reposting", async () => {
  const wire = readyWire();
  const h = await mount(wire, { post: request => Promise.resolve(reply(request)), read: count => count === 2 ? Promise.reject(new Error("readback failed")) : Promise.resolve(new Response(JSON.stringify(wire), { status: 200 })) });
  await confirm(h); await flush(() => h.button("Start 2 runs").click()); assert.equal(h.calls.length, 1);
  assert.match(h.host.textContent ?? "", /applied; session read failed/);
  await flush(() => h.button("Recover exact command").click()); assert.equal(h.calls.length, 1);
});
it("a served required target without a binding stays visible and blocks Start", async () => {
  const base = readyWire(); const target = base.targets[0];
  const h = await mount({ ...base, targets: [{ ...target, required: true }], bindings: [], constants: [] });
  assert.ok(h.host.textContent?.includes(`${target.label} is not bound`)); assert.equal(h.button("Start 2 runs").disabled, true);
});
