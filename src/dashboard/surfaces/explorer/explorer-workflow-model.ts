import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { MOCK_FORM_TYPES, mockWorkflow, type MockWorkflowId } from "../workflows/mocks/workflow-mock-catalog.js";
import { initialMockDraft, type MockRun } from "../workflows/mocks/workflow-mock-model.js";
import { mockFieldValue, mockStepNode } from "../workflows/mocks/workflow-result-model.js";
import { mockOperations, mockOperationValue } from "../workflows/mocks/workflow-operation-model.js";
import { workflowPreviewGraph, type PreviewNode } from "../workflows/mocks/workflow-preview-contracts.js";
import type { FieldSource, FlowField, FlowPart, FlowStep } from "./explorer-flow-model.js";
import type { MockFlow } from "./explorer-mock-fixtures.js";

type Choice = Readonly<{ key: string; label: string; options: readonly (readonly [string, string])[] }>;
export type WorkflowChoices = Readonly<Record<string, string>>;
const choice = (key: string, label: string, options: Choice["options"]): Choice => ({ key, label, options });
const review = choice("review", "Record review", [["approved", "Approved records"], ["waiting", "Waiting for review"], ["discarded", "Discarded preparation"]]);
const rehearsal = choice("posture", "Execution path", [["write", "Illustrate completion"], ["dry", "Dry run"]]);
export function workflowChoices(id: MockWorkflowId): readonly Choice[] {
  const options: Record<string, readonly Choice[]> = {
    "fixture-person-lookup": [choice("mode", "Lookup path", [["search", "Search"], ["match", "Match"], ["delegated", "Delegated batch"]]), choice("crm", "CRM cross-check", [["on", "Enabled"], ["off", "Disabled"]]), choice("identifier", "Search identifier", [["name", "Name"], ["eid", "Employee ID"]]), choice("dates", "Caller CRM dates", [["none", "Not requested"], ["requested", "Requested by parent"]])],
    "fixture-i9-lookup": [choice("profile", "Portal result", [["found", "Profile found"], ["absent", "No profile"], ["unavailable", "Portal unavailable"]])],
    "fixture-oath-signature": [choice("input", "Input path", [["typed", "Employee IDs"], ["pdf", "PDF preparation"]]), review, choice("existing", "Saved oath", [["absent", "No saved oath"], ["present", "Oath already recorded"]]), rehearsal],
    "fixture-oath-upload": [choice("mode", "Processing mode", [["full", "Full process"], ["upload-only", "Upload-only"]]), review, choice("signers", "Linked signatures", [["complete", "All succeeded"], ["failed", "One failed"], ["cancelled", "One cancelled"]]), rehearsal],
    "fixture-onbase": [review, choice("keyset", "Employee Lookup keyset", [["found", "Employee found"], ["missing", "No match; required keywords missing"]]), rehearsal],
    "fixture-kronos-pay-rule": [choice("action", "Election decision", [["change", "Rule must change"], ["unchanged", "Current rule is correct"], ["missing", "Employee absent from tracker"]])],
    "fixture-ocr": [review, choice("form", "Form type", MOCK_FORM_TYPES.map(type => [type.value, type.label] as const))],
    "fixture-i9-check": [choice("pair", "Packet identity", [["complete", "Section 1 and Section 2 paired"], ["missing", "Missing person identity"]])],
    "fixture-crm-doc-download": [choice("record", "CRM search result", [["found", "Record with attached PDFs"], ["empty", "Record without attachments"], ["missing", "No matching record"]])],
    "fixture-old-kronos-reports": [choice("pdf", "Report validation", [["valid", "PDF identity matches"], ["empty", "No data returned"], ["mismatch", "PDF identity mismatch"]])],
  };
  return options[`fixture-${id}`] ?? [];
}
export const DEFAULT_EXPLORER_WORKFLOW_ID = "fixture-separations";
const DEFAULT_EXPLORER_PREVIEW = mockWorkflow(DEFAULT_EXPLORER_WORKFLOW_ID.replace(/^fixture-/u, ""));
export function explorerRecoveryWorkflow(catalog: readonly WorkflowCatalogEntry[]): string {
  return catalog.some(entry => entry.id === DEFAULT_EXPLORER_PREVIEW.id && entry.source === "served") ? DEFAULT_EXPLORER_PREVIEW.id : DEFAULT_EXPLORER_WORKFLOW_ID;
}
export function initialWorkflowChoices(id: MockWorkflowId = DEFAULT_EXPLORER_PREVIEW.id): WorkflowChoices { return Object.fromEntries(workflowChoices(id).map(item => [item.key, item.options[0][0]])); }
export function updateWorkflowChoice(id: MockWorkflowId, values: WorkflowChoices, key: string, value: string): WorkflowChoices {
  const option = workflowChoices(id).find(item => item.key === key);
  if (!option?.options.some(([candidate]) => candidate === value)) throw new Error(`EXPLORER_CHOICE_INVALID: ${id}:${key}:${value}`);
  return { ...values, [key]: value };
}
const systems: Readonly<Record<string, FlowStep["system"]>> = { ucpath: "UCPath", crm: "CRM", kuali: "Kuali", kronos: "Kronos", i9: "I-9", onbase: "OnBase", servicenow: "ServiceNow", sharepoint: "SharePoint" };
const action = (text: string, icon: Extract<FlowPart, { kind: "action" }>["icon"] = "verify"): FlowPart => ({ kind: "action", text, icon });
export function workflowNodes(id: MockWorkflowId, values: WorkflowChoices): readonly PreviewNode[] {
  const key = `fixture-${id}`;
  let nodes = [...workflowPreviewGraph(id).nodes];
  if (key === "fixture-person-lookup") nodes = nodes.filter(node => values.mode === "match" ? node.lane === "Match mode" : values.mode === "delegated" ? node.lane !== "Match mode" : node.lane === "Per person" && node.id !== "CRM dates").filter(node => values.crm !== "off" || !["Cross-verification", "Match CRM check", "CRM dates"].includes(node.id)).filter(node => !(node.id === "Cross-verification" && values.identifier === "eid") && !(node.id === "CRM dates" && values.dates !== "requested"));
  if (key === "fixture-oath-signature" && values.input !== "pdf") nodes = nodes.filter(node => node.lane === "Per signer");
  if (key === "fixture-oath-upload" && values.mode === "upload-only") nodes = nodes.filter(node => node.id === "File ticket");
  if (key === "fixture-ocr") nodes = nodes.filter(node => node.id !== "Done");
  // A packet's terminal rollup follows its per-person lane, never precedes it.
  return [...nodes.filter(node => node.id !== "Rollup" && node.id !== "Report back"), ...nodes.filter(node => node.id === "Rollup" || node.id === "Report back")];
}
function previewRun(id: MockWorkflowId, values: WorkflowChoices): MockRun {
  const flow = mockWorkflow(id);
  return { id: `explorer:${id}`, workflowId: id, title: flow.example, subject: flow.example, approved: values.review === "approved", approvedCount: values.review === "approved" ? 1 : 0, seeded: true,
    draft: { ...initialMockDraft(id), text: flow.example, files: [{ name: flow.example.endsWith(".pdf") ? flow.example : "source-packet.pdf", size: 2048, digest: "explorer-source" }], dryRun: values.posture === "dry", formType: values.form ?? initialMockDraft(id).formType, lookupMode: values.mode === "match" ? "match" : "search" } };
}
function operationStep(run: MockRun, node: PreviewNode) {
  const ocrKeys: Readonly<Record<string, string>> = { "Read forms": "prep:ocr", "Roster match": "prep:loading-roster", "Person lookup": "prep:person-lookup", "Your review": "prep:awaiting-approval" };
  const key = run.workflowId === "ocr" ? ocrKeys[node.id] : undefined;
  return key ? { key, label: node.id, message: node.purpose } : mockWorkflow(run.workflowId).steps.find(step => mockStepNode(run, step)?.id === node.id);
}
export function buildWorkflowMock(id: MockWorkflowId, values: WorkflowChoices): Omit<MockFlow, "completion"> {
  const key = `fixture-${id}`;
  const graph = workflowPreviewGraph(id), nodes = workflowNodes(id, values), run = previewRun(id, values);
  const controls = workflowChoices(id).map<FlowPart>(item => ({ kind: "mock-choice", id: `workflow:${item.key}`, label: item.label, value: values[item.key], options: item.options }));
  const steps: FlowStep[] = [{ number: 1, title: graph.label, system: "You", parts: [{ kind: "note", text: graph.summary }, ...controls] }];
  let stopAfter: number | undefined;
  for (const [index, node] of nodes.entries()) {
    const number = index + 2;
    const blocked = node.kind === "gate" && values.review !== "approved" || key === "fixture-oath-upload" && node.id === "Wait signatures" && values.signers !== "complete" || key === "fixture-onbase" && node.id === "Fill keywords" && values.keyset === "missing" || key === "fixture-kronos-pay-rule" && node.id === "CSV lookup" && values.action === "missing" || key === "fixture-crm-doc-download" && node.id === "Search record" && values.record === "missing" || key === "fixture-i9-check" && node.id === "OCR extraction" && values.pair === "missing" || key === "fixture-i9-lookup" && values.profile === "unavailable";
    const skip = values.posture === "dry" && node.skippedInDryRun || key === "fixture-oath-signature" && node.id === "Sign oath" && values.existing === "present" || key === "fixture-kronos-pay-rule" && node.id === "Update pay rule" && values.action === "unchanged" || key === "fixture-crm-doc-download" && ["Download", "Archive"].includes(node.id) && values.record === "empty";
    const operation = operationStep(run, node);
    const blockedEvidence = key === "fixture-i9-lookup" && values.profile === "absent" || key === "fixture-old-kronos-reports" && values.pdf !== "valid";
    const operations = operation && !blocked && !skip && !blockedEvidence ? mockOperations(run, operation) : [];
    const detailedLabels = new Set(operations.flatMap(item => item.fields?.map(([label]) => label.toLowerCase()) ?? []));
    const contract = node.contract.map((item, fieldIndex) => ({ item, fieldIndex })).filter(({ item }) => !detailedLabels.has((item.field === "EID" ? "Employee ID" : item.field).toLowerCase()));
    const parts: FlowPart[] = [{ kind: "note", text: node.purpose }];
    if (node.when) parts.push({ kind: "note", text: `Condition: ${node.when}.` });
    if (node.delegatesTo) parts.push(action(`Delegate to ${mockWorkflow(node.delegatesTo.replace(/^fixture-/u, "")).label}; preserve its separate outcome.`, "compute"));
    if (blocked) parts.push(action(values.review === "discarded" ? "Preparation discarded. No downstream work is started." : key === "fixture-oath-upload" ? "A linked signer did not succeed. Stop before opening ServiceNow or filing the ticket." : "Required evidence is unavailable. Stop before downstream work; no successful result is inferred.", "stop"));
    else if (skip) parts.push(action(values.posture === "dry" ? "Dry run: this mutation is skipped." : values.existing === "present" ? "Saved oath exists: read its date and skip adding or saving another oath." : "No change is needed. Skip this step.", "rejoin"));
    else if (node.contract.length) {
      if (contract.length) parts.push({ kind: "form", id: `contract-${index}`, title: node.id, mode: node.kind === "output" ? "File output" : node.kind === "write" ? "Fill and verify" : "Read and process", parts: [{ kind: "rows", fields: contract.map(({ item, fieldIndex }) => ({
        id: `contract-${index}-${fieldIndex}`, label: item.field === "EID" ? "Employee ID" : item.field,
        value: key === "fixture-i9-lookup" && values.profile === "absent" ? item.field === "I-9 status" ? "No profile found" : "Not available · no profile" : key === "fixture-old-kronos-reports" && values.pdf !== "valid" ? item.field === "Files saved" ? "No retained PDF" : `Tracker outcome: ${values.pdf === "empty" ? "No Data Returned" : "MISMATCH"}` : mockFieldValue(run, item.field),
        mode: item.dir === "write" && node.kind !== "output" && node.kind !== "fanout" ? "fill" : "read", source: `contract:${index}:${fieldIndex}`,
      })) }] });
      const proof = [...new Set(node.contract.filter(item => item.proof).map(item => item.proof))];
      if (proof.length) parts.push(action(`Verify: ${proof.join("; ")}.`));
    }
    operations.forEach((item, operationIndex) => {
      if (item.click) parts.push(action(item.click, "click"));
      if (item.fields) parts.push({ kind: "form", id: `operation-${index}-${operationIndex}`, title: item.label, mode: item.fields.some(row => row[2] === "fill") ? "Fill" : "Read", parts: [{ kind: "rows", fields: item.fields.map(([label, value, mode], fieldIndex) => ({ id: `operation-${index}-${operationIndex}-${fieldIndex}`, label, value: mockOperationValue(run, value), mode: mode ?? "read", source: `operation:${index}:${operationIndex}:${fieldIndex}` })) }] });
      if (item.verify) parts.push(action(item.verify));
    });
    if (key === "fixture-ocr" && node.id === "Read forms") parts.push({ kind: "note", text: values.form === "i9" ? "Pair Section 1 and Section 2 identities for OCR review before downstream retention processing." : `Extract ${values.form === "oath" ? "printed name, Employee ID, signed date and signature flags" : "employee identity, contact name, relationship, phones and contact address"}. OCR owns corrections and approval; downstream workflows consume the approved record.` });
    if (key === "fixture-old-kronos-reports" && node.id === "Downloading") parts.push(action(values.pdf === "valid" ? "Retain the matching Time Detail PDF and append Done to the tracker." : "Delete the empty or mismatched PDF and append the explicit tracker outcome.", "read"));
    steps.push({ number, title: node.id, system: node.delegatesTo === "fixture-ocr" || key === "fixture-ocr" && node.system === "i9" || key === "fixture-i9-check" && node.system === "i9" ? "OCR" : node.system ? systems[node.system] ?? "Local" : "Local", parts });
    if (blocked && stopAfter === undefined) stopAfter = number;
  }
  return { steps, summary: graph.summary, path: { step: 1, control: controls.length ? `preview-workflow:${workflowChoices(id)[0].key}` : "explorer-step-1" }, stopAfter };
}
export function workflowContractSource(id: MockWorkflowId, values: WorkflowChoices, field: FlowField, step: number): FieldSource | undefined {
  const operation = /^operation:(\d+):(\d+):(\d+)$/u.exec(field.source ?? "");
  if (operation) {
    const node = workflowNodes(id, values)[Number(operation[1])], run = previewRun(id, values), definition = node && operationStep(run, node);
    const group = definition && mockOperations(run, definition)[Number(operation[2])], row = group?.fields?.[Number(operation[3])];
    if (!row) throw new Error(`EXPLORER_OPERATION_SOURCE_MISSING: ${id}:${field.source}`);
    return { origin: id === "work-study" && row[0] === "Effective date" ? "Operator effective date" : `${node.system ? systems[node.system] ?? node.system : "Local"} · ${group.label}`, detail: node.purpose,
      ...(group.verify ? { chain: [{ step, title: "Verify the result", detail: group.verify }] } : {}) };
  }
  const match = /^contract:(\d+):(\d+)$/u.exec(field.source ?? "");
  if (!match) return undefined;
  const nodes = workflowNodes(id, values), nodeIndex = Number(match[1]), node = nodes[nodeIndex], row = node?.contract[Number(match[2])];
  if (!row) throw new Error(`EXPLORER_SOURCE_MISSING: ${id}:${field.source}`);
  const readIndex = nodes.findIndex((item, index) => index < nodeIndex && item.contract.some(candidate => candidate.dir === "read" && candidate.field === row.field));
  return { origin: readIndex < 0 ? id === "work-study" && row.field === "Effective date" ? "Operator effective date" : `${systems[row.system] ?? row.system} · ${node.id}` : undefined,
    detail: `${node.purpose}${row.when ? ` Condition: ${row.when}.` : ""}`,
    ...(readIndex >= 0 ? { reads: [{ system: systems[nodes[readIndex].system ?? row.system] ?? "Local", page: nodes[readIndex].id, field: row.field, step: readIndex + 2, fieldId: `contract-${readIndex}-${nodes[readIndex].contract.findIndex(candidate => candidate.dir === "read" && candidate.field === row.field)}` }] } : {}),
    ...(row.proof ? { chain: [{ step, title: "Verify the result", detail: row.proof }] } : {}) };
}
export function explorerWorkflowOptions(catalog: readonly WorkflowCatalogEntry[]) {
  return catalog.map(entry => ({ id: entry.source === "served" ? entry.id : `fixture-${entry.id}`, title: entry.label,
    count: entry.preview ? workflowPreviewGraph(entry.preview.id).nodes.length : 0, disabled: entry.source !== "served" && entry.preview === undefined }));
}
