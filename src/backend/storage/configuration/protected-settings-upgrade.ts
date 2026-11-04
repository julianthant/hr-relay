import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CredentialEraseInputSchema } from "../../../models/config/credential-store.js";
import { ProtectedSettingsApplyInputSchema, ProtectedSettingsLastAppliedSchema, ProtectedSettingsPatchSchema, ProtectedStoreEntriesSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../models/config/protected-settings.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { privateEqual as comparePrivate } from "../../../rules/validation/private-equal.js";
import { authenticateDocument, credentialHistoryValueIds, CredentialDocumentSchema, type CredentialDocument } from "./credential-store.js";

const priorValues = {
  timekeeperName: z.string().min(1).max(256),
  activityPersonPseudonym: z.strictObject({ keyHex: z.string().regex(/^[0-9a-f]{64}$/u), keyGeneration: z.string().regex(/^activity-person-[a-z0-9]+(?:-[a-z0-9]+)*$/u) }),
};
const priorOperation = <Value extends z.ZodType>(value: Value) => z.union([z.strictObject({ set: value }), z.strictObject({ clear: z.literal(true) })]).optional();
const PriorPatchSchema = ProtectedSettingsPatchSchema.extend({ timekeeperName: priorOperation(priorValues.timekeeperName), activityPersonPseudonym: priorOperation(priorValues.activityPersonPseudonym) });
const priorHash = deriveSchemaHash(PriorPatchSchema, "input");
const priorEntry = <Value extends z.ZodType>(value: Value) => z.strictObject({ valueId: z.uuid(), value, updatedAt: IsoInstantSchema }).optional();
const PriorEntriesSchema = ProtectedStoreEntriesSchema.extend({ timekeeperName: priorEntry(priorValues.timekeeperName), activityPersonPseudonym: priorEntry(priorValues.activityPersonPseudonym) });
export const StoppedProtectedSettingsNameSchema = PriorPatchSchema.keyof();
export const STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH = priorHash;
export const StoppedProtectedSettingsApplyInputSchema = ProtectedSettingsApplyInputSchema.extend({ entries: PriorPatchSchema });
export const StoppedProtectedStoreRecordSchema = z.strictObject({ schemaVersion: z.literal(1), revision: z.number().int().safe().positive(),
  protectedSchemaHash: z.literal(priorHash), entries: PriorEntriesSchema, lastApplied: ProtectedSettingsLastAppliedSchema.optional() }).superRefine((record, context) => {
  const identities = Object.values(record.entries).map(entry => entry.valueId);
  if (new Set(identities).size !== identities.length || (record.revision === 1
    ? identities.length !== 0 || record.lastApplied !== undefined
    : record.lastApplied === undefined || record.lastApplied.expectedRevision + 1 !== record.revision || record.lastApplied.protectedSchemaHash !== priorHash))
    context.addIssue({ code: "custom", message: "protected-settings-upgrade-source-invalid" });
});
const PriorDocumentSchema = CredentialDocumentSchema.extend({ schemaVersion: z.literal(4), record: StoppedProtectedStoreRecordSchema,
  latestRequest: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("apply"), request: StoppedProtectedSettingsApplyInputSchema }),
    z.strictObject({ kind: z.literal("erase"), request: CredentialEraseInputSchema, repairedExpectedRevision: z.number().int().safe().positive().optional() }),
  ]).optional() });

function privateEqual(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return comparePrivate(left, right);
}

function authenticatePrior(input: unknown) {
  const prior = PriorDocumentSchema.parse(input), { record, history, latestRequest: request } = prior;
  const actual = Object.entries(record.entries).map(([name, entry]) => [name, entry.valueId] as const);
  const retired = new Set(prior.retiredLegacy.valueIds);
  const replayed = new Map([...credentialHistoryValueIds(history, prior.historyBaseRevision)].filter(([, id]) => !retired.has(id)));
  if (record.revision !== prior.historyBaseRevision + history.length || actual.length !== replayed.size
    || new Set(actual.map(([, id]) => id)).size !== actual.length
    || actual.some(([name, id]) => retired.has(id) || replayed.get(name) !== id)) throw new Error("protected-settings-upgrade-history-invalid");
  const latest = history.at(-1);
  if (record.revision === 1 ? actual.length !== 0 || record.lastApplied !== undefined
    : record.lastApplied === undefined || record.lastApplied.expectedRevision + 1 !== record.revision
      || record.lastApplied.protectedSchemaHash !== priorHash) throw new Error("protected-settings-upgrade-record-invalid");
  const receipt = latest === undefined ? undefined : (({ updatedAt: _updatedAt, ...value }) => value)(latest.receipt);
  if (!privateEqual(record.lastApplied, receipt) || (latest === undefined) !== (request === undefined)
    || history.some(entry => prior.retiredLegacy.writeIds.includes(entry.receipt.writeId))) throw new Error("protected-settings-upgrade-receipt-invalid");
  if (request !== undefined && latest !== undefined) {
    const expectedRevision = request.kind === "erase" ? request.repairedExpectedRevision ?? request.request.expectedRevision : request.request.expectedRevision;
    if (request.request.commandId !== latest.receipt.commandId || request.request.writeId !== latest.receipt.writeId
      || request.request.commandFingerprint !== latest.receipt.commandFingerprint || request.request.updatedAt !== latest.receipt.updatedAt
      || expectedRevision !== latest.receipt.expectedRevision || request.request.protectedSchemaHash !== latest.receipt.protectedSchemaHash) throw new Error("protected-settings-upgrade-request-invalid");
    if (request.kind === "apply") {
      const marked = Object.fromEntries(Object.entries(request.request.entries).map(([name, operation]) => [name, "set" in operation ? { set: "<set>" } : { clear: true }]));
      if (!privateEqual(marked, latest.marked)) throw new Error("protected-settings-upgrade-request-invalid");
      for (const name of PriorEntriesSchema.keyof().options) {
        const choice = request.request.entries[name], entry = record.entries[name];
        if (choice === undefined) continue;
        if ("clear" in choice ? entry !== undefined : entry === undefined || !privateEqual(entry.value, choice.set)
          || entry.valueId !== latest.setValueIds[name] || entry.updatedAt !== request.request.updatedAt) throw new Error("protected-settings-upgrade-value-invalid");
      }
    }
  }
  return prior;
}

export function convertProtectedSettings(input: unknown, at: string): CredentialDocument {
  const prior = authenticatePrior(input), { timekeeperName: _name, activityPersonPseudonym: _pseudonym, ...entries } = prior.record.entries;
  const removed = prior.history.flatMap(entry => [entry.setValueIds.timekeeperName, entry.setValueIds.activityPersonPseudonym].filter((id): id is string => id !== undefined));
  const commandId = randomUUID(), writeId = randomUUID(), updatedAt = IsoInstantSchema.parse(at);
  const request = ProtectedSettingsApplyInputSchema.parse({ commandId, writeId, updatedAt,
    commandFingerprint: sha256Hex(canonicalJsonStringify({ purpose: "retire-timekeeper-settings", revision: prior.record.revision, schema: priorHash, commandId, writeId })),
    expectedRevision: prior.record.revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, entries: {} });
  const { entries: _entries, updatedAt: _updatedAt, ...lastApplied } = request;
  return authenticateDocument({ schemaVersion: 5, historyBaseRevision: prior.historyBaseRevision,
    record: { schemaVersion: 2, revision: prior.record.revision + 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, entries, lastApplied },
    history: [...prior.history, { receipt: { ...lastApplied, updatedAt }, marked: {}, setValueIds: {} }],
    retiredLegacy: { ...prior.retiredLegacy, valueIds: [...new Set([...prior.retiredLegacy.valueIds, ...removed])] },
    latestRequest: { kind: "apply", request } });
}

export function inspectProtectedSettingsSource(input: unknown) {
  if (typeof input === "object" && input !== null && Reflect.get(input, "schemaVersion") === 5) return authenticateDocument(input);
  return authenticatePrior(input);
}
