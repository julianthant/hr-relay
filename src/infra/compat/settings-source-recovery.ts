/** A1 read-only recovery of the released file protocols; Phase 2.6 owns deletion. */
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { FingerprintSchema, PositiveIntSchema } from "../../domain/ids.js";
import { ProcessStartIdentitySchema, observeProcessIdentity } from "../sqlite/runtime-process-locks.js";

const Base64Schema = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const OrdinaryIdentitySchema = z.strictObject({ commandId: z.uuid(), commandFingerprint: FingerprintSchema,
  expectedRevision: PositiveIntSchema, settingsSchemaHash: FingerprintSchema, patchFingerprint: FingerprintSchema });
const ProtectedIdentitySchema = z.strictObject({ commandId: z.uuid(), commandFingerprint: FingerprintSchema,
  expectedRevision: PositiveIntSchema, protectedSchemaHash: FingerprintSchema, writeId: z.uuid() });
const RecoveryFields = {
  schemaVersion: z.literal(1), settingsPathFingerprint: FingerprintSchema,
  command: z.union([OrdinaryIdentitySchema, ProtectedIdentitySchema]),
  priorSettingsBytesBase64: Base64Schema.nullable(), nextSettingsBytesBase64: Base64Schema,
  priorInitializationBytesBase64: Base64Schema, nextInitializationBytesBase64: Base64Schema,
};
const OldPrepareSchema = z.strictObject({ ...RecoveryFields, command: OrdinaryIdentitySchema, prepareId: z.uuid() });
const PrepareSchema = z.strictObject({ ...RecoveryFields, target: z.enum(["ordinary", "protected"]), prepareId: z.uuid() });
const RollbackSchema = z.strictObject({ ...RecoveryFields, target: z.enum(["ordinary", "protected"]), rollbackId: z.uuid() });
const OldRollbackSchema = z.strictObject({ schemaVersion: z.literal(1), rollbackId: z.uuid(),
  settingsPathFingerprint: FingerprintSchema, commandId: z.uuid(), appliedRevision: PositiveIntSchema,
  priorRevision: PositiveIntSchema, appliedSettingsBytesFingerprint: FingerprintSchema,
  priorSettingsBytesFingerprint: FingerprintSchema.nullable(), priorInitializationBytesFingerprint: FingerprintSchema });
const LockSchema = z.strictObject({ schemaVersion: z.literal(1), acquisitionId: z.uuid(), pid: PositiveIntSchema,
  processIdentity: ProcessStartIdentitySchema, settingsPathFingerprint: FingerprintSchema });
type Target = "ordinary" | "protected";
interface RecordIdentity { readonly revision: number; readonly lastApplied?: unknown }
interface RecoveryInput {
  readonly d331: boolean;
  readonly ordinaryPath: string;
  readonly protectedPath: string;
  readonly authorityPath: string;
  readonly preparePath: string;
  readonly rollbackPath: string;
  readonly lockPath: string;
  readonly pathFingerprint: string;
  read(path: string): string;
  parse(target: Target, bytes: string | null): RecordIdentity;
  parseAuthority(bytes: string): Readonly<{ ordinary: "virgin" | "initialized"; protected: "virgin" | "initialized" }>;
  authenticate(target: Target, bytes: string | null): void;
  absentFor(target: Target, commandId: string): boolean;
}
function decode(input: string): string {
  const bytes = Buffer.from(input, "base64");
  if (bytes.toString("base64") !== input) throw new Error("source-invalid-base64");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function fingerprint(bytes: string | null): string | null { return bytes === null ? null : sha256Hex(bytes); }

/** Selects an authenticated prior/next snapshot without touching any source byte. */
export function recoverSettingsSources(input: RecoveryInput): Readonly<{
  ordinary: string | null; protected: string | null; authority: string; files: string[];
}> {
  const files: string[] = [];
  const read = (path: string) => { files.push(basename(path)); return input.read(path); };
  const optional = (path: string) => existsSync(path) ? read(path) : null;
  const ordinary = optional(input.ordinaryPath);
  const protectedBytes = input.d331 ? optional(input.protectedPath) : null;
  const authority = read(input.authorityPath);
  if (existsSync(`${input.lockPath}.reaper`)) throw new Error("settings-authority-reaper-unsettled");
  if (existsSync(input.lockPath)) {
    const lock = LockSchema.parse(JSON.parse(read(input.lockPath)));
    if (lock.settingsPathFingerprint !== input.pathFingerprint) throw new Error("settings-lock-path-mismatch");
    const process = observeProcessIdentity(lock.pid);
    if (process.state !== "gone" && canonicalJsonStringify(process.identity) === canonicalJsonStringify(lock.processIdentity)) {
      throw new Error("settings-authority-active");
    }
  }
  const prepareBytes = optional(input.preparePath);
  const rollbackBytes = optional(input.rollbackPath);
  if (prepareBytes === null && rollbackBytes === null) return { ordinary, protected: protectedBytes, authority, files };
  if (!input.d331 && prepareBytes === null) {
    const rollback = OldRollbackSchema.parse(JSON.parse(rollbackBytes ?? "null"));
    const prior = input.parse("ordinary", ordinary);
    if (rollback.settingsPathFingerprint !== input.pathFingerprint || rollback.appliedRevision !== rollback.priorRevision + 1
      || prior.revision !== rollback.priorRevision || fingerprint(ordinary) !== rollback.priorSettingsBytesFingerprint
      || fingerprint(authority) !== rollback.priorInitializationBytesFingerprint
      || !input.absentFor("ordinary", rollback.commandId)) throw new Error("settings-rollback-uncertain");
    input.authenticate("ordinary", ordinary);
    return { ordinary, protected: protectedBytes, authority, files };
  }
  const recovery = input.d331
    ? prepareBytes === null ? RollbackSchema.parse(JSON.parse(rollbackBytes ?? "null")) : PrepareSchema.parse(JSON.parse(prepareBytes))
    : OldPrepareSchema.parse(JSON.parse(prepareBytes ?? "null"));
  const target = "target" in recovery ? recovery.target : "ordinary";
  if ((target === "ordinary") !== ("settingsSchemaHash" in recovery.command)
    || recovery.settingsPathFingerprint !== input.pathFingerprint) throw new Error("settings-recovery-path-or-target-mismatch");
  const priorBytes = recovery.priorSettingsBytesBase64 === null ? null : decode(recovery.priorSettingsBytesBase64);
  const nextBytes = decode(recovery.nextSettingsBytesBase64);
  const priorAuthority = decode(recovery.priorInitializationBytesBase64);
  const nextAuthority = decode(recovery.nextInitializationBytesBase64);
  const prior = input.parse(target, priorBytes);
  const next = input.parse(target, nextBytes);
  const priorStates = input.parseAuthority(priorAuthority);
  const nextStates = input.parseAuthority(nextAuthority);
  const other = target === "ordinary" ? "protected" : "ordinary";
  if (priorStates[target] !== (priorBytes === null ? "virgin" : "initialized")
    || nextStates[target] !== "initialized" || priorStates[other] !== nextStates[other]
    || next.revision !== prior.revision + 1 || recovery.command.expectedRevision !== prior.revision
    || canonicalJsonStringify(next.lastApplied) !== canonicalJsonStringify(recovery.command)) throw new Error("settings-recovery-envelope-mismatch");
  const live = target === "ordinary" ? ordinary : protectedBytes;
  if ((live !== priorBytes && live !== nextBytes) || (authority !== priorAuthority && authority !== nextAuthority)) throw new Error("settings-recovery-bytes-divergent");
  const committed = !input.absentFor(target, recovery.command.commandId);
  if (committed) {
    input.authenticate(target, nextBytes);
    if (live !== nextBytes || rollbackBytes !== null) throw new Error("settings-recovery-committed-bytes-missing");
  } else {
    input.authenticate(target, priorBytes);
    if (rollbackBytes !== null) {
      if (input.d331) {
        const rollback = RollbackSchema.parse(JSON.parse(rollbackBytes));
        const body = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "prepareId" && key !== "rollbackId"));
        if (canonicalJsonStringify(body(rollback)) !== canonicalJsonStringify(body(recovery))) throw new Error("settings-rollback-divergent");
      } else {
        const rollback = OldRollbackSchema.parse(JSON.parse(rollbackBytes));
        if (rollback.settingsPathFingerprint !== input.pathFingerprint || rollback.commandId !== recovery.command.commandId
          || rollback.appliedRevision !== next.revision || rollback.priorRevision !== prior.revision
          || rollback.appliedSettingsBytesFingerprint !== fingerprint(nextBytes)
          || rollback.priorSettingsBytesFingerprint !== fingerprint(priorBytes)
          || rollback.priorInitializationBytesFingerprint !== fingerprint(priorAuthority)) throw new Error("settings-rollback-divergent");
      }
    }
  }
  const selected = committed ? nextBytes : priorBytes;
  return { ordinary: target === "ordinary" ? selected : ordinary, protected: target === "protected" ? selected : protectedBytes,
    authority: committed ? nextAuthority : priorAuthority, files };
}
