import { NativeRunEventWireSchema, NotePageSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { browserActionMessage } from "../../../src/models/events/types.js";
import type { RunLogSnapshot } from "../../../src/dashboard/state/run-wiring-adapter.js";

export type PersonLookupLogScenario = "success" | "multiple-matches" | "no-match" | "crm-off" | "failed";
export const PERSON_LOOKUP_LOG_SCENARIOS: readonly PersonLookupLogScenario[] = ["success", "multiple-matches", "no-match", "crm-off", "failed"];

const RUN = "00000000-0000-4000-8000-000000000090", TRACE = "pl-100000-0090";
const id = (number: number) => `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const person = (n: number) => ({ emplId: `1000000${n}`, name: ["Lee, Jordan", "Park, Sam", "Rivera, Alex"][n - 1], department: "Campus Dining", jobTitle: "Student assistant", hrStatus: "Active" });
type Direction = "read" | "write";
type Step =
  | Readonly<{ kind: "observed"; node: string; step: string; system: string; fields: readonly (readonly [Direction, string, string])[] }>
  | Readonly<{ kind: "gesture"; node: string; gesture: "clicked" | "opened" | "typed" | "read"; target: string; label: string; system: string; value?: string }>
  | Readonly<{ kind: "log"; node: string; message: string; fields: Readonly<Record<string, string>> }>
  | Readonly<{ kind: "capture"; node: string }>;

const fieldOf = (label: string) => label.split(" ").map((word, index) => index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()).join("");
const observed = (node: string, step: string, system: string, fields: readonly (readonly [Direction, string, string])[]): Step => ({ kind: "observed", node, step, system, fields });
const gesture = (node: string, system: string, g: "clicked" | "opened" | "typed" | "read", target: string, label: string, value?: string): Step =>
  ({ kind: "gesture", node, gesture: g, target, label, system, ...(value === undefined ? {} : { value }) });
const candidateFields = (n: number) => (["Employee ID", "Name", "Department", "Job title", "HR status"] as const).map((label, index) => ["read", label,
  [person(n).emplId, person(n).name, person(n).department, person(n).jobTitle, person(n).hrStatus][index]] as const);
const searchUcpath = (candidates: number): readonly Step[] => [
  gesture("searching", "ucpath", "opened", "ucpath.person-org.summary", "Person Organizational Summary"),
  gesture("searching", "ucpath", "typed", "ucpath.person-org.eid-input", "Person Org EID input"),
  gesture("searching", "ucpath", "clicked", "ucpath.person-org.search-button", "Person Org Search button"),
  gesture("searching", "ucpath", "read", "ucpath.person-org.search-results", "Person Org results grid"),
  ...(candidates === 0 ? [{ kind: "capture", node: "searching" } as const] : []),
  ...Array.from({ length: candidates }, (_, index): readonly Step[] => [
    gesture("searching", "ucpath", "clicked", "ucpath.person-org.result-drill-in", "Person Org result drill-in control"),
    observed("searching", "Search for person", "ucpath", candidateFields(index + 1)),
    gesture("searching", "ucpath", "clicked", "ucpath.person-org.employment-instances-view-all", "Person Org Employment Instances View All toggle"),
    ...(index === 0 ? [{ kind: "capture", node: "searching" } as const] : []),
  ]).flat(),
];
const crmCheck = (found: boolean): readonly Step[] => [
  gesture("cross-verify", "crm", "opened", "crm.onboarding.record", "CRM onboarding record"),
  gesture("cross-verify", "crm", "read", "crm.onboarding.record", "CRM onboarding record"),
  ...(found ? [{ kind: "capture", node: "cross-verify" } as const] : []),
  observed("crm-identity", "Cross-check identity", "crm", [["read", "CRM", found ? "Found" : "Not found"], ["read", "How found", found ? "Employee ID agrees with CRM" : "No match"]]),
  { kind: "log", node: "crm-identity", message: "Identity cross-check", fields: { method: found ? "eid-match" : "no-match", candidates: "1" } },
];
const status = (state: string, crm: string, note?: string): readonly Step[] => [
  observed("active-status", "Read employment status", "local", [["read", "Employment status", state], ["read", "UCPath", state === "Not found" ? "Not found" : "Found"], ["read", "CRM", crm], ...(note === undefined ? [] : [["read", "Status note", note] as const])]),
  { kind: "log", node: "active-status", message: "Employment status", fields: { status: state.toLowerCase() } },
];

const SCENARIO_STEPS: Readonly<Record<PersonLookupLogScenario, readonly Step[]>> = {
  success: [...searchUcpath(1), observed("search-identity", "Search for person", "ucpath", [["read", "How found", "UCPath search"]]), ...crmCheck(true), ...status("Active", "Found")],
  "multiple-matches": [...searchUcpath(3), observed("search-identity", "Search for person", "ucpath", [["read", "How found", "Multiple matches"]]),
    ...status("Multiple matches", "Not checked", "Several people match this search")],
  "no-match": [...searchUcpath(0), observed("search-identity", "Search for person", "ucpath", [["read", "How found", "No match"]]), ...crmCheck(false), ...status("Not found", "Not found")],
  "crm-off": [...searchUcpath(1), observed("search-identity", "Search for person", "ucpath", [["read", "How found", "UCPath search"]]), ...status("Active", "Not checked")],
  failed: [...searchUcpath(1), observed("search-identity", "Search for person", "ucpath", [["read", "How found", "UCPath search"]]),
    gesture("cross-verify", "crm", "opened", "crm.onboarding.record", "CRM onboarding record")],
};

const CATEGORIES = [["searching", "Search for person", "ucpath", ["searching", "search-identity"]], ["cross-verify", "Cross-check identity", "crm", ["cross-verify", "crm-identity"]],
  ["active-status", "Read employment status", "local", ["active-status"]], ["crm-dates", "Read CRM dates", "crm", ["crm-dates"]]] as const;
const STATES: Readonly<Record<PersonLookupLogScenario, readonly string[]>> = {
  success: ["done", "done", "done", "skipped"], "multiple-matches": ["done", "skipped", "done", "skipped"], "no-match": ["done", "done", "done", "skipped"],
  "crm-off": ["done", "skipped", "done", "skipped"], failed: ["done", "failed", "pending", "pending"],
};
const timelineStateOf = (state: string) => state as "done" | "skipped" | "failed" | "pending";

export function personLookupLogSnapshot(scenario: PersonLookupLogScenario): RunLogSnapshot {
  let order = 1;
  const nativeOf = (nodeId: string, n = order++) => NativeRunEventWireSchema.parse({ eventId: id(n), order: n * 100, runId: RUN, attempt: 1, traceId: TRACE, nodeId, spanPath: `${TRACE}/${nodeId}#1` });
  const clock = (n: number) => new Date(Date.UTC(2026, 7, 3, 17, 10, n * 2)).toISOString();
  const associations: { bundleId: string; artifactId: string; sessionId: string; nodeId: string; at: string }[] = [];
  const rows = SCENARIO_STEPS[scenario].map((step, index) => {
    const n = nativeOf(step.node), at = clock(index), logId = id(1000 + index);
    if (step.kind === "observed") return { kind: "observed" as const, native: n, logId, sequence: index, at, attempt: 1, traceId: TRACE, spanPath: n.spanPath,
      producer: { nodeId: step.node, step: step.step, taskId: "ucpath/search-person-org", ...(step.system === "local" ? {} : { system: step.system }) },
      displayFields: step.fields.map(([direction, label, value]) => ({ direction, label, value })),
      points: step.fields.map(([direction, label, value]) => ({ direction, field: fieldOf(label), values: [{ key: fieldOf(label), state: "allowed", classification: "safe-diagnostic", transform: "allow", value }] })) };
    const base = { native: n, noteId: logId, runId: RUN, sequence: index, at };
    if (step.kind === "gesture") return { kind: "note" as const, native: n, logId, sequence: index, note: { ...base, level: "info",
      message: browserActionMessage({ kind: step.gesture, targetId: step.target, ...(step.value === undefined ? {} : { value: step.value }) }),
      operatorAction: { kind: step.gesture === "typed" ? "fill" : step.gesture === "read" ? "read" : "click", label: step.label, system: step.system, registryLabel: true } } };
    if (step.kind === "log") return { kind: "note" as const, native: n, logId, sequence: index, note: { ...base, level: "info", message: step.message,
      fields: Object.entries(step.fields).map(([key, value]) => ({ key, kind: "text", value })) } };
    const association = { bundleId: id(2000 + index), artifactId: id(3000 + index), sessionId: id(4000 + index) };
    associations.push({ ...association, nodeId: step.node, at });
    return { kind: "note" as const, native: n, logId, sequence: index, note: { ...base, level: "info",
      message: browserActionMessage({ kind: "screenshot", targetId: "ucpath.task-capture", value: `${association.bundleId}:${association.artifactId}` }), screenshot: association } };
  });
  const logs = NotePageSchema.parse({ runId: RUN, rows, notes: rows.flatMap(row => row.kind === "note" ? [row.note] : []), nextCursor: { state: "absent", reason: "end-of-page" } });
  const states = STATES[scenario];
  const steps = CATEGORIES.map(([key, label, system, nodes], index) => ({ key, label, system, state: timelineStateOf(states[index]),
    members: nodes.map(nodeId => ({ nodeId, categoryKey: key, label, state: timelineStateOf(states[index]) })) }));
  const eventOrder = (index: number) => {
    const own = rows.filter(row => CATEGORIES[index][3].includes(row.native.nodeId as never)).map(row => row.native.order);
    return own.length > 0 ? Math.min(...own) - 50 + index : Math.max(0, ...rows.filter(row => CATEGORIES.slice(0, index).some(category => category[3].includes(row.native.nodeId as never))).map(row => row.native.order)) + 50 + index;
  };
  const eventNative = (key: string, index: number) => NativeRunEventWireSchema.parse({ eventId: id(500 + index), order: eventOrder(index), runId: RUN, attempt: 1, traceId: TRACE, nodeId: key, spanPath: `${TRACE}/${key}#1` });
  const events = CATEGORIES.map(([key, label], index) => ({ native: eventNative(key, index), categoryKey: key, noteId: id(600 + index), sequence: index, at: clock(Math.floor(eventOrder(index) / 100)),
    label, state: timelineStateOf(states[index]), notRun: states[index] === "skipped" ? { state: "present", reason: "condition-false" } : { state: "absent", reason: "ran" } }));
  const failed = scenario === "failed";
  const detail = RunDetailWireSchema.parse({ runId: RUN, rowRevision: 1, panelKind: "run", header: { runId: RUN, traceId: TRACE, workflowId: "person-lookup", title: "10000001", status: failed ? "failed" : "done", attempt: 1 },
    timeline: { steps, events }, gate: { state: "absent", reason: "no gate" }, outcome: { state: "absent", reason: "fixture has no receipt section" },
    context: { dataFacts: 2, evidenceFacts: 1, attempts: 1 }, availableSections: failed ? ["logs", "captures", "failure"] : ["logs", "captures"] });
  const captures = RunDetailSectionResponseSchema.parse({ section: "captures", payload: { runId: RUN, artifacts: associations.map(association => ({
    artifact: { mediaKind: "image", mediaType: "image/png", artifactId: association.artifactId, sha256: "a".repeat(64), byteLength: 1, sensitivity: "restricted", redaction: "restricted-access", width: 850, height: 300 },
    origins: [{ bundleId: association.bundleId, originKind: "operator-request", capturedAt: association.at, browserCapture: { nodeId: association.nodeId, attempt: 1, sessionId: association.sessionId } }] })) } });
  const summary = "CRM check failed.";
  const failure = RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: {
    runId: RUN, failureId: id(800), native: nativeOf("cross-verify", 700), traceId: TRACE, attempt: 1, workflowId: "person-lookup", nodeId: "cross-verify", taskId: "crm/read-onboarding-record",
    display: { title: "Step could not be completed", observation: "The step stopped unexpectedly. Open Details to review the recorded error." },
    resolution: { capability: { state: "available" }, capture: { runId: RUN, failureId: id(800), resolution: { status: "unresolved", version: 1 } } },
    fingerprint: "e".repeat(64), code: "PERSON_LOOKUP_CRM_CHECK_FAILED", summary, transient: false, writeState: "not-attempted",
    subject: { state: "present", expected: { kind: "eid", digest: "1".repeat(64), displayRedacted: "••••0001" }, observed: { kind: "eid", digest: "2".repeat(64), displayRedacted: "••••0002" } },
    action: { operation: "read", sequence: 3 }, causeChain: [{ code: "PERSON_LOOKUP_CRM_CHECK_FAILED", summary, role: "primary", transient: false }],
    remediation: [{ kind: "operator-action", message: "Confirm which EID is correct at the source before re-running; nothing was written." }],
    sameFingerprintSeen: 1, diagnosticBundle: { state: "absent", reason: "fixture" }, occurredAt: clock(40) } } });
  return { detail, logs, sections: failed ? [captures, failure] : [captures], unavailableEvidence: [] };
}
