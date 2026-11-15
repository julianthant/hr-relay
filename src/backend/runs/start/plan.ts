import { WorkbookActiveSelectionSchema } from "../../../models/dashboard/workbook-library.js";
import { type ProtectedInputBinding } from "../../../models/write-safety/protected-input.js";
import { admitProtectedInput, hasProtectedSubject, protectedSubjectDisplay, protectedSubjectMatchKey } from "./protected-input.js";
import { errorText } from "../lifecycle/support.js";
import type { ProtectedSecretSource } from "../../../models/config/secrets.js";
import type { SchemaBoundCanonicalValue } from "../../../models/validation/schema-bound-value.js";

import type { RerunPlan } from "../../../models/run/rerun.js";
import { workflowDryRunSupport, workflowPlanning, workflowProjections } from "../../../workflow-kit/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { deriveItemId } from "../../../rules/identity/identifiers.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import {
  IsoInstantSchema,
  PositiveIntSchema,
} from "../../../rules/identity/ids.js";
import type { BrowserPresentationMode, InstanceSelection, RunPriority, RunShape } from "../../../models/run/envelope.js";
import type { StepOmissions } from "../../../models/workflow/step-omission.js";
import { InstanceSelectionSchema } from "../../../models/run/envelope.js";
import { isTerminalRunState, type RunRecord } from "../../../models/run/record.js";
import { startSupersedeTargets } from "../../../models/run/start-supersede.js";
import {
  deriveCanonicalInputDigest,
  derivePlannedInputFingerprint,
  PlannedRunSchema,
  StartPlanRecordSchema,
} from "../../../models/run/start-plan.js";
import type { PlannedRun, StartPlanRecord, StartRefusal } from "../../../models/run/start-plan.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { bindRunWorkbookReference, parseRunWorkbookReference, type WorkbookReferenceLookup } from "../../../models/dashboard/workbooks.js";
import type { WorkbookLibraryService } from "../../workbooks/workbook-library-service.js";
import { WorkbookLibraryError } from "../../workbooks/workbook-library-error.js";
import { MAX_SELECTED_WORKBOOK_SOURCES } from "../../../rules/spreadsheets/workbook-size.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { parseTypedDate, type TypedDateControl } from "../../../models/workflow/ingress.js";
import { z } from "zod";
import { workbookInputBinding } from "../workbooks.js";


export interface StartPlannerDeps {
  readonly workbooks?: Pick<WorkbookLibraryService, "createReferenceCapture">;
  readonly protectedSecrets?: ProtectedSecretSource;

  readonly authority: Readonly<{
    authority: Readonly<{ runs: Readonly<{ listByItem(input: unknown): readonly RunRecord[] }> }>;
  }>;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** How long a confirmation stays valid before it must be re-planned. */
  readonly planTtlMs: number;
}

export interface StartPlanRequest {
  readonly workbookReferences?: readonly z.infer<typeof WorkbookActiveSelectionSchema>[];
  readonly descriptor: AnyWorkflowDescriptor;
  readonly protectedSubmissionBindings?: readonly ProtectedInputBinding[];
  readonly retainedInputs?: readonly SchemaBoundCanonicalValue[];
  /** Raw submissions in the operator's order; entry numbers are 1-based. */
  readonly submissions: readonly unknown[];
  readonly requestedInstance?: InstanceSelection;
  readonly dryRun: boolean;
  // Dashboard starts require explicit choices; retained non-dashboard callers may omit them.
  readonly browserMode?: BrowserPresentationMode;
  /** Omission retains the pre-capture behavior (no browser screenshot). */
  readonly captureBrowserScreenshots?: boolean;

  readonly stepOmissions?: StepOmissions;
  readonly priority: RunPriority;
  readonly shape: RunShape;
  readonly configFingerprint: string;
  readonly configSnapshotId: string;
  readonly plannedBy: string;
  readonly rerun?: RerunPlan;
}

export function resolveInstances(
  descriptor: AnyWorkflowDescriptor,
  requested: InstanceSelection | undefined,
): InstanceSelection {
  const systems = workflowProjections(descriptor).systems;
  const resolved: Record<string, string> = {};
  for (const system of systems) resolved[system] = "prod";
  for (const [system, instance] of Object.entries(requested ?? {})) {
    if (instance === "test") {
      throw new Error(`${descriptor.id} requested a retired test instance for ${system}`);
    }
    if (!systems.includes(system)) {
      throw new Error(`${descriptor.id} never reaches ${system}; it cannot resolve an instance for it`);
    }
    resolved[system] = instance;
  }
  return InstanceSelectionSchema.parse(resolved);
}


export function supportsDryRun(descriptor: AnyWorkflowDescriptor): boolean {
  return workflowDryRunSupport(descriptor).state === "supported";
}


export function dryRunRefusalMessage(descriptor: AnyWorkflowDescriptor): string {
  const support = workflowDryRunSupport(descriptor);
  if (support.state === "supported") {
    throw new Error(`${descriptor.id} supports a dry run; there is no refusal to describe`);
  }
  if (support.reason === "no-transaction-node") {
    return `${descriptor.id} has no transaction node, so a dry run would be indistinguishable from a real `
      + "run; start it for real or not at all";
  }
  if (support.reason === "descendant-declares-unsupported") {
    return `${descriptor.id} reaches ${support.workflowId} transaction node "${support.nodeId}", which declares dryRun:"unsupported"; start it for real or not at all`;
  }
  return `${descriptor.id} transaction node "${support.nodeId}" declares dryRun:"unsupported"; `
    + "start it for real or not at all";
}

/** Each declared date control is one value for the whole start: any entry without a valid MM/DD/YYYY date, or with a different one, refuses every entry; otherwise the ingress parse receives its ISO date. */
function applyTypedDates(descriptor: AnyWorkflowDescriptor, submissions: readonly JsonValue[]):
  Readonly<{ submissions: readonly JsonValue[] }> | Readonly<{ refusal: string }> {
  const surface = descriptor.surfaces.inputRun?.typedInput;
  const controls = (surface?.controls ?? []).filter((control): control is TypedDateControl => "kind" in control && control.kind === "date");
  if (surface === undefined || controls.length === 0) return { submissions };
  const records = submissions.map(submission => {
    const fields = z.record(z.string(), JsonValueSchema).safeParse(submission);
    return fields.success ? { ...fields.data } : undefined;
  });
  for (const control of controls) {
    const dates = new Set<string>();
    for (const record of records) {
      if (record === undefined) {
        if (control.required) return { refusal: control.refusal };
        continue;
      }
      const mode = surface.submitsMode === false ? surface.modes[0].value : record[surface.modeField];
      if (typeof mode !== "string" || !control.modes.includes(mode) || !control.requires.every(field => record[field] === true)) continue;
      const typed = record[control.field];
      if ((typed === undefined || typed === "") && !control.required) {
        delete record[control.field];
        continue;
      }
      const date = typeof typed === "string" ? parseTypedDate(typed) : undefined;
      if (date === undefined) return { refusal: control.refusal };
      dates.add(date);
      record[control.field] = date;
    }
    if (dates.size > 1) return { refusal: `${control.label} must be one date for every entry in this start.` };
  }
  return { submissions: submissions.map((submission, index) => records[index] ?? submission) };
}

export function planStart(deps: StartPlannerDeps, request: StartPlanRequest): StartPlanRecord {
  const { descriptor } = request;
  const selections = WorkbookActiveSelectionSchema.array().parse(request.workbookReferences ?? []);
  if (selections.some(selection => selection.entry > request.submissions.length)) throw new WorkbookLibraryError("WORKBOOK_INVALID");

  const rawSubmissions: JsonValue[] = [];
  for (let index = 0; index < request.submissions.length; index += 1) {
    if (!Object.hasOwn(request.submissions, index)) {
      throw new Error(
        `start plan ${descriptor.id} entry ${String(index + 1)} is missing; submissions must be a dense array`,
      );
    }
    const submission = request.submissions[index];
    try {
      rawSubmissions.push(JsonValueSchema.parse(submission));
    } catch (error) {
      throw new Error(
        `start plan ${descriptor.id} entry ${String(index + 1)} is not strict JSON and cannot be retained: ${errorText(error)}`,
        { cause: error },
      );
    }
  }
  const typedDates = applyTypedDates(descriptor, rawSubmissions);
  const admittedSubmissions = admitProtectedInput(descriptor, "submissions" in typedDates ? typedDates.submissions : rawSubmissions,
    deps.protectedSecrets, request.retainedInputs, request.protectedSubmissionBindings);
  const planning = workflowPlanning(descriptor);
  const inputBinding = workbookInputBinding(descriptor.canonicalInput);
  const now = IsoInstantSchema.parse(deps.clock.now().toISOString());
  const ingressSchemaHash = deriveSchemaHash(descriptor.input, "input");
  const canonicalSchemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  const resolvedInstance = resolveInstances(descriptor, request.requestedInstance);

  const planned: PlannedRun[] = [];
  const refused: StartRefusal[] = [];
  const seenItemIds = new Set<string>();
  const captureReference = deps.workbooks?.createReferenceCapture();

  for (const [index, rawInput] of rawSubmissions.entries()) {
    const entry = PositiveIntSchema.parse(index + 1);
    const refuse = (code: StartRefusal["code"], message: string): void => {
      refused.push({ entry, rawInput, code, message });
    };

    if (request.dryRun && !supportsDryRun(descriptor)) {
      refuse("dry-run-unsupported", dryRunRefusalMessage(descriptor));
      continue;
    }
    if ("refusal" in typedDates) {
      refuse("input-invalid", typedDates.refusal);
      continue;
    }

    let parsed: unknown;
    let canonicalInput: unknown;
    let lookups: readonly WorkbookReferenceLookup[];
    try {
      // This is the one and only ingress parse for this raw submission.
      inputBinding?.assertSubmission(rawInput);
      const admitted = planning.parseInput(admittedSubmissions[index].admitted);
      parsed = admitted.input;
      lookups = admitted.lookups;
    } catch (error) {
      refuse("input-invalid", admittedSubmissions[index].bindings.length > 0 ? "workflow input is invalid" : errorText(error));
      continue;
    }

    const references = selections.filter(selection => selection.entry === entry);
    const requirement = planning.workbookReference;
    if (lookups.length !== (requirement === undefined ? 0 : 1)
      || lookups.some(lookup => lookup.typeId !== requirement?.id)) {
      refuse("capability-unavailable", ERROR_CATALOG.WORKBOOK_INVALID.text); continue;
    }
    const sourceIdentity = (selection: typeof references[number]) => JSON.stringify([selection.libraryId, selection.versionId, selection.sheetId]);
    if ((requirement === undefined ? references.length !== 0 : references.length < 1 || references.length > MAX_SELECTED_WORKBOOK_SOURCES)
      || new Set(references.map(sourceIdentity)).size !== references.length) {
      refuse("capability-unavailable", ERROR_CATALOG.WORKBOOK_INVALID.text); continue;
    }
    let workbookReferences: SchemaBoundCanonicalValue[] | undefined;
    if (references.length > 0) {
      if (captureReference === undefined) { refuse("capability-unavailable", ERROR_CATALOG.WORKBOOK_PROVIDER_UNAVAILABLE.text); continue; }
      try {
        workbookReferences = references.map(({ entry: _entry, ...selection }) => {
          const lookup = lookups[0];
          if (lookup === undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
          if (selection.selectedRow !== undefined) {
            const capability = descriptor.surfaces.inputRun?.workbookRows;
            const fields = z.record(z.string(), z.unknown()).safeParse(parsed).data;
            const inputKey = z.string().safeParse(capability === undefined || fields === undefined ? undefined : fields[capability.inputField]).data;
            if (capability === undefined || requirement === undefined || capability.typeId !== requirement.id
              || "mode" in lookup || inputKey === undefined || !lookup.keys.includes(inputKey)) throw new WorkbookLibraryError("WORKBOOK_INVALID");
          }
          if (requirement === undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
          const reference = { ...lookup, libraryId: selection.libraryId, versionId: selection.versionId,
            ...(selection.selectedRow === undefined ? {} : { selectedRow: selection.selectedRow }),
            ...("mode" in lookup ? { expectedVersion: selection.expectedVersion } : {}) };
          const snapshot = captureReference({ kind: "selected-source", typeId: requirement.id,
            keyFieldId: requirement.keyFieldId, fields: planning.requiredWorkbookFields,
            writableFields: requirement.writableFields,
            mode: requirement.mode, keys: "mode" in lookup ? [] : lookup.keys,
            libraryId: selection.libraryId, versionId: selection.versionId, sheetId: selection.sheetId,
            expectedVersion: selection.expectedVersion,
            ...(selection.selectedRow === undefined ? {} : { selectedRow: selection.selectedRow }) });
          return bindRunWorkbookReference(reference, snapshot);
        });
      } catch (error) {
        if (!(error instanceof WorkbookLibraryError)) throw error;
        refuse("capability-unavailable", error.message); continue;
      }
    }
    try {
      canonicalInput = planning.parseCanonicalInput(inputBinding === undefined
        ? parsed : inputBinding.bind(parsed, workbookReferences, now));
    } catch (error) {
      refuse("input-invalid", admittedSubmissions[index].bindings.length > 0 ? "workflow input is invalid" : errorText(error));
      continue;
    }

    const bindings = admittedSubmissions[index].bindings;
    const protectedSubject = hasProtectedSubject(bindings);
    const matchKey = protectedSubject ? protectedSubjectMatchKey(bindings, canonicalInput) : planning.matchKey(canonicalInput);
    const itemId = deriveItemId(descriptor.id, matchKey);
    if (seenItemIds.has(itemId)) {
      refuse("active-run-exists", `entry ${String(entry)} repeats ${matchKey}, which is already in this plan`);
      continue;
    }

    if (descriptor.enqueue === "reject-active") {
      const active = deps.authority.authority.runs
        .listByItem({ workflow: descriptor.id, itemId })
        .filter((run) => !isTerminalRunState(run.lifecycle));
      if (active.length > 0) {
        refuse("active-run-exists", `${matchKey} already has an active run (${active[0].envelope.traceId})`);
        continue;
      }
    }

    const display = protectedSubjectDisplay(bindings, () => ({ title: planning.title(canonicalInput), subtitle: planning.subtitle(canonicalInput) }));
    // A dry run publishes nothing, so it plans no outputs.
    const outputs = request.dryRun ? [] : planning.plannedOutputs(canonicalInput, (workbookReferences ?? []).map(reference => parseRunWorkbookReference(reference)));
    seenItemIds.add(itemId);
    planned.push(PlannedRunSchema.parse({
      ...(outputs.length === 0 ? {} : { outputs }),
      ...(workbookReferences === undefined ? {} : { workbookReferences }),
      ...(descriptor.enqueue !== "supersede-active" ? {} : { supersedeTargets: startSupersedeTargets(
        deps.authority.authority.runs.listByItem({ workflow: descriptor.id, itemId })) }),
      itemId,
      ...display,
      rawInput,
      input: { schemaHash: canonicalSchemaHash, value: canonicalInput,
        protectedBindings: admittedSubmissions[index].bindings },
      canonicalInputDigest: deriveCanonicalInputDigest(canonicalInput, admittedSubmissions[index].bindings),
      matchKey,
    }));
  }

  return StartPlanRecordSchema.parse({
    startPlanId: deps.ids.uuid(),
    workflowId: descriptor.id,
    descriptorVersion: descriptor.version,
    descriptorFingerprint: descriptor.contractFingerprint,
    configFingerprint: request.configFingerprint,
    configSnapshotId: request.configSnapshotId,
    ingressSchemaHash,
    canonicalInputSchemaHash: canonicalSchemaHash,
    inputFingerprint: derivePlannedInputFingerprint(planned, ingressSchemaHash, canonicalSchemaHash, request.rerun, request.stepOmissions),
    ...(request.requestedInstance === undefined ? {} : { requestedInstance: request.requestedInstance }),
    resolvedInstance,
    shape: request.shape,
    priority: request.priority,
    dryRun: request.dryRun,
    ...(request.browserMode === undefined ? {} : { browserMode: request.browserMode }),
    captureBrowserScreenshots: request.captureBrowserScreenshots ?? false,
    ...(request.stepOmissions === undefined ? {} : { stepOmissions: request.stepOmissions }),
    ...(request.rerun === undefined ? {} : { rerun: request.rerun }),
    planned,
    refused,
    plannedBy: request.plannedBy,
    plannedAt: now,
    expiresAt: IsoInstantSchema.parse(new Date(deps.clock.nowMs() + deps.planTtlMs).toISOString()),
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
}
