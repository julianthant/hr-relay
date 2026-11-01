import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { CredentialStore, CredentialStoreApplyOutcome } from "../../../models/config/credential-store.js";
import { CredentialEraseInputSchema } from "../../../models/config/credential-store.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, ProtectedSettingsLastAppliedSchema,
  ProtectedSettingsNameSchema, ProtectedStoreRecordSchema, PROTECTED_SETTINGS_SET_MARKER,
  initialProtectedStoreRecord, markProtectedSettingsPatch, type ProtectedSettingsApplyInput, type ProtectedStoreRecord,
} from "../../../models/config/protected-settings.js";
import { SettingsApplyRefusalSchema, type SettingsApplyRejectionCode } from "../../../models/config/settings.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { encodePrivate, privateEqual as privateEqualBounded } from "../../../rules/validation/private-equal.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners } from "../source-closure.js";
import { CanonicalCredentialError, createCanonicalCredentials, type CanonicalCredentialRecord } from "./canonical-credential-store.js";

const MAX_PRIVATE_REQUEST_BYTES = 64_000;
const MAX_CREDENTIAL_DOCUMENT_BYTES = 16 * 1024 * 1024;
const ProtectedSettingsApplyPreflightSchema = ProtectedSettingsApplyInputSchema
  .omit({ entries: true })
  .extend({ entries: z.unknown() });

const SetValueIdsSchema = z.strictObject({
  ucpathUserId: z.uuid().optional(),
  ucpathPassword: z.uuid().optional(),
  timekeeperName: z.uuid().optional(),
  sharepointOnboardingRosterUrl: z.uuid().optional(),
  activityPersonPseudonym: z.uuid().optional(),
});

const CredentialMarkedOperationSchema = z.union([
  z.strictObject({ set: z.literal(PROTECTED_SETTINGS_SET_MARKER) }),
  z.strictObject({ clear: z.literal(true) }),
  z.strictObject({ erase: z.literal(true) }),
]);

const CredentialMarkedPatchSchema = z.strictObject({
  ucpathUserId: CredentialMarkedOperationSchema.optional(),
  ucpathPassword: CredentialMarkedOperationSchema.optional(),
  timekeeperName: CredentialMarkedOperationSchema.optional(),
  sharepointOnboardingRosterUrl: CredentialMarkedOperationSchema.optional(),
  activityPersonPseudonym: CredentialMarkedOperationSchema.optional(),
});

const CredentialReplayReceiptSchema = ProtectedSettingsLastAppliedSchema.extend({ updatedAt: z.string().datetime({ offset: true }) });
export const CredentialHistoryEntrySchema = z.strictObject({ receipt: CredentialReplayReceiptSchema,
  marked: CredentialMarkedPatchSchema, setValueIds: SetValueIdsSchema });
const CredentialLatestRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("apply"), request: ProtectedSettingsApplyInputSchema }),
  z.strictObject({ kind: z.literal("erase"), request: CredentialEraseInputSchema, repairedExpectedRevision: z.number().int().safe().positive().optional() }),
]);
export const CredentialDocumentSchema = z.strictObject({
  schemaVersion: z.literal(4),
  record: ProtectedStoreRecordSchema,
  historyBaseRevision: z.number().int().safe().positive(),
  history: z.array(CredentialHistoryEntrySchema),
  retiredLegacy: z.strictObject({ commandIds: z.array(z.uuid()).max(100_000), writeIds: z.array(z.uuid()).max(100_000), valueIds: z.array(z.uuid()).max(100_000) }),
  latestRequest: CredentialLatestRequestSchema.optional(),
});

export type CredentialHistoryEntry = z.infer<typeof CredentialHistoryEntrySchema>;
export type CredentialDocument = z.infer<typeof CredentialDocumentSchema>;
export interface CredentialStoreIds { readonly randomUUID: () => string; }
export interface CredentialStoreHooks {
  readonly beforeRename?: () => void;
  readonly afterRename?: () => void;
}
export interface CredentialStoreOptions {
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  readonly ids?: CredentialStoreIds;
  readonly hooks?: CredentialStoreHooks;
}
export class CredentialStoreCommitUncertainError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`credential-commit-uncertain: ${message}`, options);
    this.name = "CredentialStoreCommitUncertainError";
  }
}

function frozenRefusal(
  code: SettingsApplyRejectionCode,
  message: string,
): CredentialStoreApplyOutcome {
  return deepFreeze(SettingsApplyRefusalSchema.parse({ state: "rejected", code, message }));
}

function conflict(currentRevision: number, expectedRevision: number): CredentialStoreApplyOutcome {
  return deepFreeze(SettingsApplyRefusalSchema.parse({
    state: "conflict",
    currentRevision,
    message: `credential revision ${String(expectedRevision)} is stale; current revision is ${String(currentRevision)}`,
  }));
}

function admit(input: unknown): ProtectedSettingsApplyInput | CredentialStoreApplyOutcome {
  const preflight = ProtectedSettingsApplyPreflightSchema.safeParse(input);
  if (!preflight.success) {
    return frozenRefusal("invalid-value", "credential request is invalid");
  }
  if (preflight.data.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
    return frozenRefusal("schema-mismatch", "credential schema does not match the current catalog");
  }
  const parsed = ProtectedSettingsApplyInputSchema.safeParse(input);
  if (!parsed.success) {
    const isUnknownKey = parsed.error.issues.some((issue) => issue.code === "unrecognized_keys");
    return frozenRefusal(
      isUnknownKey ? "not-editable" : "invalid-value",
      isUnknownKey ? "credential request contains a non-editable key" : "credential request is invalid",
    );
  }
  return parsed.data;
}

function privateEqual(left: unknown, right: unknown): boolean {
  try {
    return privateEqualBounded(left, right, MAX_PRIVATE_REQUEST_BYTES);
  } catch {
    throw new Error("credential private comparison exceeds its fixed bound");
  }
}

function lastApplied(request: {
  readonly commandId: string;
  readonly commandFingerprint: string;
  readonly expectedRevision: number;
  readonly protectedSchemaHash: string;
  readonly writeId: string;
}) {
  return ProtectedSettingsLastAppliedSchema.parse({
    commandId: request.commandId,
    commandFingerprint: request.commandFingerprint,
    expectedRevision: request.expectedRevision,
    protectedSchemaHash: request.protectedSchemaHash,
    writeId: request.writeId,
  });
}

function replayValueIds(history: readonly CredentialHistoryEntry[], baseRevision: number): Map<string, string> {
  let revision = baseRevision;
  const commandIds = new Set<string>();
  const writeIds = new Set<string>();
  const valueIds = new Set<string>();
  const entries = new Map<string, string>();
  for (const entry of history) {
    const { receipt, marked, setValueIds } = entry;
    if (receipt.expectedRevision !== revision || commandIds.has(receipt.commandId) || writeIds.has(receipt.writeId)) {
      throw new Error("credential history has a divergent command identity");
    }
    commandIds.add(receipt.commandId);
    writeIds.add(receipt.writeId);
    for (const name of ProtectedSettingsNameSchema.options) {
      const operation = marked[name];
      const valueId = setValueIds[name];
      if (operation === undefined || "clear" in operation || "erase" in operation) {
        if (valueId !== undefined) throw new Error("credential history has an unexpected value identity");
        if (operation !== undefined) entries.delete(name);
        continue;
      }
      if (valueId === undefined || valueIds.has(valueId)) throw new Error("credential history has an invalid value identity");
      valueIds.add(valueId);
      entries.set(name, valueId);
    }
    revision += 1;
  }
  return entries;
}

function recordValueIds(record: ProtectedStoreRecord): Map<string, string> {
  return new Map(ProtectedSettingsNameSchema.options.flatMap((name) => {
    const entry = record.entries[name];
    return entry === undefined ? [] : [[name, entry.valueId] as const];
  }));
}

function sameValueIds(left: Map<string, string>, right: Map<string, string>): boolean {
  return left.size === right.size && [...left].every(([name, valueId]) => right.get(name) === valueId);
}

export function authenticateDocument(input: unknown): CredentialDocument {
  const parsed = CredentialDocumentSchema.safeParse(input);
  if (!parsed.success) throw new Error("credential store protected.json is malformed");
  const erased = new Set(parsed.data.retiredLegacy.valueIds);
  let replayed: Map<string, string>;
  try {
    replayed = new Map([...replayValueIds(parsed.data.history, parsed.data.historyBaseRevision)].filter(([, valueId]) => !erased.has(valueId)));
  } catch {
    throw new Error("credential store protected.json has malformed identity history");
  }
  const actual = recordValueIds(parsed.data.record);
  if ([...actual.values()].some((valueId) => erased.has(valueId))
    || !sameValueIds(replayed, actual)
    || parsed.data.record.revision !== parsed.data.historyBaseRevision + parsed.data.history.length
    || !Number.isSafeInteger(parsed.data.record.revision)) {
    throw new Error("credential store protected.json disagrees with its identity history");
  }
  const latest = parsed.data.history.at(-1);
  if (latest === undefined ? parsed.data.record.lastApplied !== undefined
    : !privateEqual(parsed.data.record.lastApplied, lastApplied(latest.receipt))) {
    throw new Error("credential store protected.json disagrees with its identity history");
  }
  const request = parsed.data.latestRequest;
  if ((latest === undefined) !== (request === undefined)
    || latest !== undefined && request !== undefined && (latest.receipt.commandId !== request.request.commandId
      || latest.receipt.writeId !== request.request.writeId || latest.receipt.updatedAt !== request.request.updatedAt
      || latest.receipt.commandFingerprint !== request.request.commandFingerprint
      || latest.receipt.expectedRevision !== (request.kind === "erase" ? request.repairedExpectedRevision ?? request.request.expectedRevision : request.request.expectedRevision)
      || latest.receipt.protectedSchemaHash !== request.request.protectedSchemaHash)
    || parsed.data.history.some(entry => parsed.data.retiredLegacy.writeIds.includes(entry.receipt.writeId))) throw new Error("credential-document-history-invalid");
  if (request?.kind === "apply") {
    if (!privateEqual(markProtectedSettingsPatch(request.request.entries), latest?.marked)) throw new Error("credential-latest-request-invalid");
    for (const name of ProtectedSettingsNameSchema.options) {
      const choice = request.request.entries[name], entry = parsed.data.record.entries[name];
      if (choice === undefined) continue;
      if ("clear" in choice ? entry !== undefined : entry === undefined || !privateEqual(entry.value, choice.set)
        || entry.updatedAt !== request.request.updatedAt || entry.valueId !== latest?.setValueIds[name]) throw new Error("credential-latest-request-invalid");
    }
  }
  if (encodePrivate(parsed.data).byteLength > MAX_CREDENTIAL_DOCUMENT_BYTES) throw new Error("document-too-large: credential store protected.json exceeds its private bound");
  return deepFreeze(parsed.data);
}

export function initialDocument(): CredentialDocument {
  return deepFreeze(CredentialDocumentSchema.parse({
    schemaVersion: 4,
    record: initialProtectedStoreRecord(),
    historyBaseRevision: 1, history: [],
    retiredLegacy: { commandIds: [], writeIds: [], valueIds: [] },
  }));
}

const storeOwners = new WeakMap<CredentialStore, RuntimeAdmission>();
export function assertCredentialStoreOwner(store: CredentialStore, admissionInput: RuntimeAdmission): void {
  const admission = requireRuntimeAdmission(admissionInput);
  if (storeOwners.get(store) !== admission) throw new Error("credential-store-owner-mismatch");
}

export function observeCredentialPresence(store: CredentialStore, admission: RuntimeAdmission): readonly { readonly name: z.infer<typeof ProtectedSettingsNameSchema>; readonly present: boolean }[] {
  assertCredentialStoreOwner(store, admission);
  const record = store.read();
  return Object.freeze(ProtectedSettingsNameSchema.options.map(name => Object.freeze({ name, present: record.entries[name] !== undefined })));
}

export function createCredentialStore(options: CredentialStoreOptions): CredentialStore {
  const admission = requireRuntimeAdmission(options.admission);
  if (options.stateRoot.split(/[/\\]+/u).includes("..")) throw new Error("directory-integrity: raw credential path contains a '..' component");
  if (!isAbsolute(options.stateRoot) || resolve(options.stateRoot) !== options.stateRoot) throw new Error("directory-integrity: raw credential path must be canonical and absolute");
  admission.assertStateRoot(options.stateRoot);
  const ids = options.ids ?? { randomUUID }, hooks = options.hooks ?? {};
  const owner = createCanonicalCredentials(admission, { afterReplace(kind) { if (kind === "protected") hooks.afterRename?.(); } });
  function translate(error: unknown): never {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    if (error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_UNCERTAIN") throw new CredentialStoreCommitUncertainError(
      "credential commit reached protected.json but completion is uncertain", { cause: error });
    throw error;
  }
  function parseCurrent(frame: CanonicalCredentialRecord | undefined): CredentialDocument {
    if (frame === undefined) throw new CanonicalCredentialError("CREDENTIAL_UNAVAILABLE");
    const document = authenticateDocument(frame.value);
    if (frame.revision !== document.record.revision) throw new Error("credential store protected.json disagrees with its authenticated revision");
    return document;
  }
  function readCurrent(): CredentialDocument {
    try { return parseCurrent(owner.readRecord("protected")); }
    catch (error) { translate(error); }
  }
  function divergent(): CredentialStoreApplyOutcome {
    return frozenRefusal(
      "command-divergent",
      "credential command or write identity differs from its persisted request",
    );
  }

  function exactLastReplay(
    document: CredentialDocument,
    request: ProtectedSettingsApplyInput,
  ): "exact" | "divergent" | "none" {
    const latest = document.history.at(-1);
    if (latest === undefined) return "none";
    if (latest.receipt.commandId !== request.commandId) return "none";
    return document.latestRequest?.kind === "apply" && privateEqual(document.latestRequest.request, request) ? "exact" : "divergent";
  }

  function historyReusesIdentity(
    document: CredentialDocument,
    request: ProtectedSettingsApplyInput,
  ): boolean {
    return document.retiredLegacy.commandIds.includes(request.commandId) || document.retiredLegacy.writeIds.includes(request.writeId) || document.history.some(({ receipt }) => (
      receipt.commandId === request.commandId || receipt.writeId === request.writeId
    ));
  }

  function buildNext(
    document: CredentialDocument,
    request: ProtectedSettingsApplyInput,
  ): CredentialDocument {
    if (!Number.isSafeInteger(document.record.revision + 1)) throw new Error("credential-revision-overflow");
    const entries = new Map<string, unknown>(Object.entries(document.record.entries));
    const setValueIds: Record<string, string> = {};
    const allocated = new Set([
      ...Object.values(document.record.entries).map(({ valueId }) => valueId),
      ...document.history.flatMap(({ setValueIds: ids }) => Object.values(ids)),
      ...document.retiredLegacy.valueIds,
    ]);
    for (const name of ProtectedSettingsNameSchema.options) {
      const operation = request.entries[name];
      if (operation === undefined) continue;
      if ("clear" in operation) {
        entries.delete(name);
        continue;
      }
      const valueId = z.uuid().parse(ids.randomUUID());
      if (allocated.has(valueId)) throw new Error("credential value identity generation collided");
      allocated.add(valueId);
      setValueIds[name] = valueId;
      entries.set(name, { valueId, value: operation.set, updatedAt: request.updatedAt });
    }
    return authenticateDocument({
      schemaVersion: 4,
      historyBaseRevision: document.historyBaseRevision, retiredLegacy: document.retiredLegacy,
      latestRequest: { kind: "apply", request },
      record: {
        schemaVersion: 1,
        revision: document.record.revision + 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        entries: Object.fromEntries(entries),
        lastApplied: lastApplied(request),
      },
      history: [...document.history, {
        receipt: {
          commandId: request.commandId,
          commandFingerprint: request.commandFingerprint,
          expectedRevision: request.expectedRevision,
          protectedSchemaHash: request.protectedSchemaHash,
          writeId: request.writeId,
          updatedAt: request.updatedAt,
        },
        marked: markProtectedSettingsPatch(request.entries),
        setValueIds,
      }],
    });
  }

  function evaluateReplay(
    current: CredentialDocument,
    request: ProtectedSettingsApplyInput,
  ): CredentialStoreApplyOutcome | undefined {
    if (current.retiredLegacy.commandIds.includes(request.commandId)) return divergent();
    const directReplay = exactLastReplay(current, request);
    if (directReplay === "exact") {
      return deepFreeze({ state: "applied" as const, record: current.record });
    }
    if (directReplay === "divergent") return divergent();
    if (request.expectedRevision !== current.record.revision) {
      return conflict(current.record.revision, request.expectedRevision);
    }
    if (historyReusesIdentity(current, request)) return divergent();
    return undefined;
  }

  const store: CredentialStore = Object.freeze({
    read(): ProtectedStoreRecord { return readCurrent().record; },
    ownsCommandId(commandId: string): boolean {
      admission.assertCredentialRead();
      const id = z.uuid().parse(commandId);
      return readCurrent().history.some(({ receipt }) => receipt.commandId === id);
    },
    acceptedAt(commandId: string): string | undefined {
      admission.assertCredentialRead();
      const id = z.uuid().parse(commandId), latest = readCurrent().history.at(-1)?.receipt;
      return latest?.commandId === id ? latest.updatedAt : undefined;
    },
    apply(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome {
      admission.assertWritable();
      const request = admit(input);
      if (!("commandId" in request)) return request;
      const current = readCurrent(), replay = evaluateReplay(current, request);
      if (replay !== undefined) return replay;
      const next = buildNext(current, request);
      try {
        hooks.beforeRename?.();
        const saved = owner.replaceRecord("protected", current.record.revision, next);
        try { return deepFreeze({ state: "applied" as const, record: parseCurrent(saved).record }); }
        catch (error) { throw new CredentialStoreCommitUncertainError("credential commit readback differs after replacement", { cause: error }); }
      } catch (error) {
        if (hasUnprovedSourceClosure(error)) translate(error);
        if (error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_BUSY") return frozenRefusal("lock-unavailable", "credential store lock is unavailable");
        if (error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_CONFLICT") {
          const changed = readCurrent();
          return evaluateReplay(changed, request) ?? conflict(changed.record.revision, request.expectedRevision);
        }
        translate(error);
      }
    },
    verifyReplay(input: ProtectedSettingsApplyInput): CredentialStoreApplyOutcome {
      admission.assertCredentialRead();
      const request = admit(input);
      if (!("commandId" in request)) return request;
      return evaluateReplay(readCurrent(), request) ?? divergent();
    },
  });
  storeOwners.set(store, admission);
  return store;
}
