import { lstatSync,mkdirSync,readdirSync } from "node:fs";
import { dirname,isAbsolute,join,relative,resolve,sep } from "node:path";
import { z } from "zod";
import { ActiveRuntimeConfigRecordSchema } from "../../../models/config/runtime-generation.js";
import { SettingsCurrentRecordSchema } from "../../../models/config/settings-current.js";
import { SETTINGS_SCHEMA_HASH,derivePersistedSettingsFingerprint,deriveRawSettingsPatchFingerprint,type SettingsFileRecord } from "../../../models/config/settings.js";
import { ConfigSnapshotRecordSchema,type ConfigSnapshotRecord } from "../../../models/config/snapshot.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { CommandAuditRecordSchema,SettingsCommandRequestSchema,deriveSettingsCommandFingerprint } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { offlineMaintenanceWorkspace,type OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { noSymlinkAncestry,readPrivateFile,unpublishedDraftAbortMembership,type DirectoryIdentity } from "../configuration/credential-safe-file.js";
import { fsyncPath,privatePathRejects,replacePrivateFile,writePrivateStage } from "../private-path.js";
import { hasUnprovedSourceClosure,retainAuthoritySourceClosure } from "../source-closure.js";
import { verifyBackupManifestAtPath } from "../sqlite/backup-service.js";
import { assertCanonicalProfileBinding } from "../sqlite/profile-local-databases.js";
import { file,hash,profileAuthorityFileWitnesses } from "./existing-data-backup-files.js";
import { proveProfileRootsUnused } from "./process-closure.js";

export class FixedLayoutRefusedError extends Error {
  readonly code = "STORAGE_FIXED_LAYOUT_REFUSED";
  constructor(cause: unknown) { super(ERROR_CATALOG.STORAGE_FIXED_LAYOUT_REFUSED.text, { cause }); this.name = "FixedLayoutRefusedError"; }
}

const RelativePathSchema = z.string().refine(value => value === "" || !value.includes("\\")
  && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const FIXED_LAYOUT_OUTPUT_PATHS = ["reportsDir", "downloadsDir", "onboardingDocsDir", "i9CheckTrackerPath"] as const;
const OutputPathUpdatesSchema = z.strictObject({ reportsDir: z.string().min(1).optional(), downloadsDir: z.string().min(1).optional(),
  onboardingDocsDir: z.string().min(1).optional(), i9CheckTrackerPath: z.string().min(1).optional() });

function movedOutputPath(path: string, sourceRoot: string, targetRoot: string): string {
  const suffix = relative(sourceRoot, path);
  return suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix) ? join(targetRoot, suffix) : path;
}

export function fixedLayoutOutputPaths(settings: SettingsFileRecord["settings"], paths: ConfigSnapshotRecord["config"]["paths"],
  sourceRoot: string, targetRoot: string): z.infer<typeof OutputPathUpdatesSchema> {
  return OutputPathUpdatesSchema.parse(Object.fromEntries(FIXED_LAYOUT_OUTPUT_PATHS.flatMap(key => {
    const saved = settings.paths?.[key], previous = saved ?? paths[key], next = movedOutputPath(previous, sourceRoot, targetRoot);
    return saved === next ? [] : [[key, next]];
  })));
}
export const FixedLayoutEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("directory"), path: RelativePathSchema, device: z.number().int().nonnegative(),
    inode: z.number().int().nonnegative(), mode: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("file"), path: RelativePathSchema, device: z.number().int().nonnegative(),
    inode: z.number().int().nonnegative(), mode: z.number().int().nonnegative(), size: z.number().int().nonnegative(), digest: DigestSchema }),
]);
export type FixedLayoutEntry = z.infer<typeof FixedLayoutEntrySchema>;
export const FixedLayoutRewriteSchema = z.strictObject({ path: RelativePathSchema, before: DigestSchema, after: DigestSchema });
export type FixedLayoutRewrite = z.infer<typeof FixedLayoutRewriteSchema>;

export function fixedLayoutEntries(root: string): readonly FixedLayoutEntry[] {
  const ancestry = new Map<string, DirectoryIdentity>();
  if (!noSymlinkAncestry(root, ancestry)) throw new Error("fixed-layout-source-changed");
  const entries = unpublishedDraftAbortMembership(root).map(entry => {
    const identity = { path: entry.path.split("\\").join("/"), device: entry.device, inode: entry.inode, mode: entry.mode };
    if (entry.directory) return FixedLayoutEntrySchema.parse({ ...identity, kind: "directory" });
    const observed = file(join(root, entry.path), "managed data");
    if (observed.identity.device !== entry.device || observed.identity.inode !== entry.inode
      || observed.stat.mode !== entry.mode || observed.bytes.length !== entry.size) throw new Error("fixed-layout-source-changed");
    return FixedLayoutEntrySchema.parse({ ...identity, kind: "file", size: observed.bytes.length, digest: hash(observed.bytes) });
  }).sort((left, right) => left.path < right.path ? -1 : left.path === right.path ? 0 : 1);
  if (!noSymlinkAncestry(root, ancestry)) throw new Error("fixed-layout-source-changed");
  return entries;
}

export function assertFixedLayoutEntries(before: readonly FixedLayoutEntry[], after: readonly FixedLayoutEntry[],
  rewrites: readonly FixedLayoutRewrite[] = [], completed = false): void {
  const names = new Set(before.map(row => row.path));
  if (names.size !== before.length || new Set(after.map(row => row.path)).size !== after.length
    || new Set(rewrites.map(row => row.path)).size !== rewrites.length || before.length !== after.length) throw new Error("fixed-layout-membership-changed");
  for (const rewrite of rewrites) {
    const previous = before.find(row => row.path === rewrite.path);
    if (previous?.kind !== "file" || previous.digest !== rewrite.before) throw new Error("fixed-layout-rewrite-unbound");
  }
  for (const previous of before) {
    const current = after.find(row => row.path === previous.path);
    if (current === undefined || current.kind !== previous.kind) throw new Error("fixed-layout-membership-changed");
    const rewrite = rewrites.find(row => row.path === previous.path);
    if (rewrite !== undefined && previous.kind === "file" && current.kind === "file"
      && current.digest === rewrite.after && (current.mode & 0o7777) === 0o600) continue;
    if ((completed && rewrite !== undefined) || canonicalJsonStringify(previous) !== canonicalJsonStringify(current)) throw new Error("fixed-layout-entry-changed");
  }
}


export const FixedLayoutActivationSchema = z.strictObject({
  profileId: z.uuid(), sourceRoot: z.string().min(1), authorityPath: z.string().min(1),
  backupFileName: z.string().regex(/^authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite$/u),
  backupSha256: DigestSchema, backupManifestSha256: DigestSchema,
  preAuthorityGeneration: z.number().int().nonnegative(), preAuthorityContentFingerprint: DigestSchema,
  settingsRevision: z.number().int().positive(), settingsFingerprint: DigestSchema,
  priorActive: ActiveRuntimeConfigRecordSchema, snapshot: ConfigSnapshotRecordSchema,
  settingsUpdate: z.strictObject({ commandId: z.uuid(), auditId: z.uuid(), previousBrowserRoot: z.string().min(1).optional(), outputPaths: OutputPathUpdatesSchema }).optional(),
}).superRefine((intent, context) => {
  if (intent.snapshot.revision !== intent.settingsRevision + (intent.settingsUpdate === undefined ? 0 : 1)) context.addIssue({ code: "custom", message: "fixed-layout-settings-revision-mismatch" });
});
export type FixedLayoutActivation = z.infer<typeof FixedLayoutActivationSchema>;

export function fixedLayoutSettingsUpdate(intent: FixedLayoutActivation, previous: SettingsFileRecord["settings"]) {
  const update = intent.settingsUpdate;
  if (update === undefined || previous.paths?.browserProfileRoot !== update.previousBrowserRoot) throw new Error("fixed-layout-browser-setting-changed");
  const browserProfileRoot = update.previousBrowserRoot === undefined ? undefined : intent.snapshot.config.paths.browserProfileRoot;
  if (FIXED_LAYOUT_OUTPUT_PATHS.some(key => update.outputPaths[key] !== undefined && previous.paths?.[key] !== undefined
    && update.outputPaths[key] !== movedOutputPath(previous.paths[key], intent.sourceRoot, dirname(intent.authorityPath)))) throw new Error("fixed-layout-output-override-changed");
  const settings = { ...previous, paths: { ...previous.paths, ...update.outputPaths, ...(browserProfileRoot === undefined ? {} : { browserProfileRoot }) } };
  const patch = { ...Object.fromEntries(FIXED_LAYOUT_OUTPUT_PATHS.flatMap(key => update.outputPaths[key] === undefined ? [] : [[`paths.${key}`, { set: update.outputPaths[key] }]])),
    ...(browserProfileRoot === undefined ? {} : { "paths.browserProfileRoot": { set: browserProfileRoot } }) };
  if (Object.keys(patch).length === 0) throw new Error("fixed-layout-settings-update-empty");
  const request = SettingsCommandRequestSchema.parse({ commandId: update.commandId, family: "settings", type: "apply-settings",
    source: "automatic-layout", requestedBy: intent.snapshot.capturedBy, requestedAt: intent.snapshot.capturedAt,
    target: { expectedRevision: intent.settingsRevision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint(patch), patch } });
  const target = { family: "settings", revision: intent.snapshot.revision };
  const current = SettingsCurrentRecordSchema.parse({ revision: intent.snapshot.revision, settings,
    settingsFingerprint: derivePersistedSettingsFingerprint(settings), commandId: update.commandId,
    commandFingerprint: deriveSettingsCommandFingerprint(request), auditId: update.auditId, committedAt: intent.snapshot.capturedAt });
  const audit = CommandAuditRecordSchema.parse({ auditId: update.auditId, request, completedAt: intent.snapshot.capturedAt,
    result: { state: "applied", commandId: update.commandId, affectedTargets: [target], settingsRevision: current.revision,
      settingsFingerprint: current.settingsFingerprint, restartRequired: false },
    versionChanges: [{ target, before: intent.settingsRevision, after: current.revision }], affectedDependencyIds: [] });
  return { request, current, audit };
}

export const FixedLayoutIntentSchema = z.strictObject({
  schemaVersion: z.literal(1), operationId: z.uuid(), installationId: z.uuid(),
  sourceWorkspace: z.string().refine(value => isAbsolute(value) && resolve(value) === value),
  targetWorkspace: z.string().refine(value => isAbsolute(value) && resolve(value) === value),
  phase: z.enum(["moving", "configuring", "complete"]),
  data: z.array(FixedLayoutEntrySchema), control: z.array(FixedLayoutEntrySchema),
  bindings: z.array(z.strictObject({ role: z.enum(["state", "artifact", "installation", "locator"]), content: z.string().max(1_048_576) })).length(4),
  profiles: z.array(FixedLayoutActivationSchema),
}).superRefine((intent, context) => {
  if (new Set(intent.profiles.map(row => row.profileId)).size !== intent.profiles.length
    || new Set(intent.bindings.map(row => row.role)).size !== 4) context.addIssue({ code: "custom", message: "fixed-layout-membership-invalid" });
  for (const profile of intent.profiles) {
    const sourceRoot = join(intent.sourceWorkspace, rebuildRuntimeIsolation.stateRoot, "profiles", profile.profileId);
    const targetRoot = join(intent.targetWorkspace, rebuildRuntimeIsolation.stateRoot, "profiles", profile.profileId);
    if (profile.sourceRoot !== sourceRoot || profile.authorityPath !== join(targetRoot, "state.db")
      || profile.settingsUpdate?.previousBrowserRoot !== undefined && profile.settingsUpdate.previousBrowserRoot !== join(sourceRoot, "browsers")) context.addIssue({ code: "custom", message: "fixed-layout-person-path-mismatch" });
  }
});
export type FixedLayoutIntent = z.infer<typeof FixedLayoutIntentSchema>;


export function readFixedLayoutIntent(workspace: string): FixedLayoutIntent | undefined {
  const path = join(workspace, ".tracker", "fixed-layout.json"), ancestry = new Map<string, DirectoryIdentity>();
  if (!noSymlinkAncestry(dirname(path), ancestry)) return undefined;
  const document = readPrivateFile(path, { label: "lock", maxBytes: 16 * 1024 * 1024 });
  if (!noSymlinkAncestry(dirname(path), ancestry)) throw new Error("fixed-layout-journal-ancestry-changed");
  const parse = (bytes: Uint8Array) => FixedLayoutIntentSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const stages = readdirSync(dirname(path)).filter(name => name.startsWith(".fixed-layout-"));
  if (stages.length > 1) throw new Error("fixed-layout-journal-stages-unknown");
  const stageName = stages[0], stage = stageName === undefined ? undefined : readPrivateFile(join(dirname(path), stageName), { label: "lock", maxBytes: 16 * 1024 * 1024 });
  if (document === undefined && stage === undefined) return undefined;
  const staged = stage === undefined ? undefined : parse(stage.bytes);
  const intent = document === undefined ? staged : parse(document.bytes);
  if (intent === undefined || staged !== undefined && (stageName !== `.fixed-layout-${staged.operationId}-${staged.phase}.stage`
    || canonicalJsonStringify({ ...staged, phase: intent.phase }) !== canonicalJsonStringify(intent)
    || document === undefined && staged.phase !== "moving"
    || document !== undefined && ["moving", "configuring", "complete"].indexOf(staged.phase) !== ["moving", "configuring", "complete"].indexOf(intent.phase) + 1)) throw new Error("fixed-layout-journal-stage-changed");
  if (intent.targetWorkspace !== workspace || intent.targetWorkspace === intent.sourceWorkspace) throw new Error("fixed-layout-workspace-mismatch");
  if (!noSymlinkAncestry(dirname(path), ancestry)) throw new Error("fixed-layout-journal-ancestry-changed");
  return deepFreeze(intent);
}

export function createFixedLayoutDirectory(workspace: string): void {
  if (!isAbsolute(workspace) || resolve(workspace) !== workspace || dirname(workspace) === workspace) throw new Error("fixed-layout-directory-invalid");
  if (lstatSync(dirname(workspace), { throwIfNoEntry: false }) === undefined) createFixedLayoutDirectory(dirname(workspace));
  const ancestry = new Map<string, DirectoryIdentity>();
  if (!noSymlinkAncestry(dirname(workspace), ancestry)) throw new Error("fixed-layout-parent-missing");
  if (lstatSync(workspace, { throwIfNoEntry: false }) === undefined) {
    mkdirSync(workspace, { mode: 0o700 }); fsyncPath(dirname(workspace));
  }
  const directory = lstatSync(workspace);
  if (!directory.isDirectory() || privatePathRejects(workspace, directory, "directory-0700")
    || !noSymlinkAncestry(workspace, ancestry)) throw new Error("fixed-layout-directory-unsafe");
}

export function publishFixedLayoutIntent(operation: OfflineMaintenanceOperation, input: FixedLayoutIntent): FixedLayoutIntent {
  const intent = FixedLayoutIntentSchema.parse(input), workspace = offlineMaintenanceWorkspace(operation);
  if (workspace !== intent.sourceWorkspace && workspace !== intent.targetWorkspace) throw new Error("fixed-layout-operation-foreign");
  operation.assertHeld();
  createFixedLayoutDirectory(intent.targetWorkspace);
  const directory = join(intent.targetWorkspace, ".tracker"); createFixedLayoutDirectory(directory);
  const path = join(directory, "fixed-layout.json"), stage = join(directory, `.fixed-layout-${intent.operationId}-${intent.phase}.stage`);
  const previous = readFixedLayoutIntent(intent.targetWorkspace);
  if (previous === undefined && readdirSync(directory).length !== 0) throw new Error("fixed-layout-target-not-empty");
  if (previous !== undefined && (canonicalJsonStringify({ ...previous, phase: intent.phase }) !== canonicalJsonStringify(intent)
    || ["moving", "configuring", "complete"].indexOf(intent.phase) < ["moving", "configuring", "complete"].indexOf(previous.phase)
    || ["moving", "configuring", "complete"].indexOf(intent.phase) > ["moving", "configuring", "complete"].indexOf(previous.phase) + 1)) throw new Error("fixed-layout-journal-changed");
  const content = Buffer.from(`${JSON.stringify(intent)}\n`);
  if (lstatSync(path, { throwIfNoEntry: false }) !== undefined && previous?.phase === intent.phase) return previous;
  operation.assertHeld();
  if (lstatSync(stage, { throwIfNoEntry: false }) === undefined) writePrivateStage(stage, content);
  else if (hash(file(stage, "managed data").bytes) !== hash(content)) throw new Error("fixed-layout-journal-stage-changed");
  operation.assertHeld(); replacePrivateFile(stage, path); fsyncPath(directory);
  return readFixedLayoutIntent(intent.targetWorkspace) ?? (() => { throw new Error("fixed-layout-journal-missing"); })();
}

export function fixedLayoutBindingEntries(intent: FixedLayoutIntent) {
  return intent.bindings.map(binding => {
    const tree = binding.role === "state" || binding.role === "artifact" ? "data" : "control";
    const path = binding.role === "state" ? ".runtime-owner.json" : binding.role === "artifact" ? "artifacts/.runtime-owner.json"
      : binding.role === "installation" ? "installation.json" : "locator.json";
    const entry = intent[tree].find(entry => entry.path === path);
    if (entry?.kind !== "file") throw new Error("fixed-layout-binding-unbound");
    return { ...binding, tree, path, before: entry.digest, after: hash(Buffer.from(binding.content)) };
  });
}

export function fixedLayoutSourceFence(intent: FixedLayoutIntent): string {
  return `${JSON.stringify({ schemaVersion: 1, operationId: intent.operationId, installationId: intent.installationId, targetWorkspace: intent.targetWorkspace })}\n`;
}

export function assertFixedLayoutSourceFence(intent: FixedLayoutIntent): void {
  const root = join(intent.sourceWorkspace, rebuildRuntimeIsolation.stateRoot), entries = fixedLayoutEntries(root);
  const fence = entries.find(row => row.path === ".runtime-source-fence.json");
  if (entries.length !== 2 || entries[0]?.kind !== "directory" || entries[0].path !== ""
    || fence?.kind !== "file" || fence.digest !== hash(Buffer.from(fixedLayoutSourceFence(intent)))
    || (fence.mode & 0o7777) !== 0o600) throw new Error("fixed-layout-source-fence-changed");
}

export function assertFixedLayoutMove(intent: FixedLayoutIntent, completed = false): void {
  const sourceData = join(intent.sourceWorkspace, rebuildRuntimeIsolation.stateRoot), targetData = join(intent.targetWorkspace, rebuildRuntimeIsolation.stateRoot);
  const sourceControl = join(intent.sourceWorkspace, ".tracker", "control"), targetControl = join(intent.targetWorkspace, ".tracker", "control");
  const movedData = lstatSync(targetData, { throwIfNoEntry: false }) !== undefined;
  const movedControl = lstatSync(targetControl, { throwIfNoEntry: false }) !== undefined;
  if (movedControl && !movedData || completed && (!movedData || !movedControl)) throw new Error("fixed-layout-move-prefix-invalid");
  if (movedData) {
    if (lstatSync(sourceData, { throwIfNoEntry: false }) !== undefined) {
      if (movedControl || completed || fixedLayoutEntries(sourceData).length !== 1) assertFixedLayoutSourceFence(intent);
    }
    else if (movedControl || completed) throw new Error("fixed-layout-source-fence-missing");
  }
  if (movedControl && lstatSync(sourceControl, { throwIfNoEntry: false }) !== undefined) throw new Error("fixed-layout-control-duplicated");
  const bindings = fixedLayoutBindingEntries(intent);
  for (const [tree, root, moved] of [["data", movedData ? targetData : sourceData, movedData], ["control", movedControl ? targetControl : sourceControl, movedControl]] as const) {
    const entries = fixedLayoutEntries(root).filter(entry => {
      const binding = moved ? bindings.find(binding => binding.tree === tree && entry.path === join(dirname(binding.path), `.fixed-layout-${intent.operationId}.stage`)) : undefined;
      if (binding === undefined) return true;
      if (entry.kind !== "file" || entry.digest !== binding.after || (entry.mode & 0o7777) !== 0o600) throw new Error("fixed-layout-binding-stage-changed");
      return false;
    });
    assertFixedLayoutEntries(intent[tree], entries, moved ? bindings.filter(row => row.tree === tree) : [], completed);
  }
  readFixedLayoutIntent(intent.targetWorkspace);
  const allowed = new Set(["fixed-layout.json", `.fixed-layout-${intent.operationId}-moving.stage`, `.fixed-layout-${intent.operationId}-configuring.stage`, ...(movedData ? ["data"] : []), ...(movedControl ? ["control"] : [])]);
  if (readdirSync(join(intent.targetWorkspace, ".tracker")).some(name => !allowed.has(name))) throw new Error("fixed-layout-target-membership-unknown");
}


export function assertFixedLayoutConfiguring(intent: FixedLayoutIntent): void {
  assertFixedLayoutSourceFence(intent);
  if (lstatSync(join(intent.sourceWorkspace, ".tracker", "control"), { throwIfNoEntry: false }) !== undefined) throw new Error("fixed-layout-control-duplicated");
  const mutable = new Set(intent.profiles.flatMap(profile => {
    const path = `profiles/${profile.profileId}/state.db`; return [path, `${path}-wal`, `${path}-shm`];
  }));
  const target = join(intent.targetWorkspace, ".tracker"), data = fixedLayoutEntries(join(target, "data"));
  for (const profile of intent.profiles) {
    const path = `profiles/${profile.profileId}/state.db`, before = intent.data.find(row => row.path === path), after = data.find(row => row.path === path);
    if (before?.kind !== "file" || after?.kind !== "file" || after.device !== before.device || after.inode !== before.inode || after.mode !== before.mode) throw new Error("fixed-layout-person-file-changed");
  }
  const bindings = fixedLayoutBindingEntries(intent);
  assertFixedLayoutEntries(intent.data.filter(row => !mutable.has(row.path)), data.filter(row => !mutable.has(row.path)), bindings.filter(row => row.tree === "data"), true);
  assertFixedLayoutEntries(intent.control, fixedLayoutEntries(join(target, "control")), bindings.filter(row => row.tree === "control"), true);
  readFixedLayoutIntent(intent.targetWorkspace);
  if (readdirSync(target).some(name => !["data", "control", "fixed-layout.json", `.fixed-layout-${intent.operationId}-configuring.stage`, `.fixed-layout-${intent.operationId}-complete.stage`].includes(name))) throw new Error("fixed-layout-target-membership-unknown");
}

const FixedLayoutProfileClaimSchema = z.strictObject({ operationId: z.uuid(), profileId: z.uuid() });
export type FixedLayoutProfileClaim = z.infer<typeof FixedLayoutProfileClaimSchema>;
type FixedLayoutProfileSource = Readonly<{ machine: RuntimeAdmission; operation: OfflineMaintenanceOperation;
  stateRoot: string; artifactRoot: string; binding: Readonly<{ installationId: string; profileId: string }>;
  activation: FixedLayoutActivation; assertHeld(): void }>;
const layoutProfiles = new WeakMap<FixedLayoutProfileClaim, FixedLayoutProfileSource>();

export function requireFixedLayoutProfileClaim(claim: FixedLayoutProfileClaim, machine?: RuntimeAdmission): FixedLayoutProfileSource {
  const source = layoutProfiles.get(claim);
  if (source === undefined || machine !== undefined && source.machine !== machine) throw new Error("fixed-layout-claim-unissued");
  source.assertHeld(); return source;
}

function issueFixedLayoutProfile(machine: RuntimeAdmission, operation: OfflineMaintenanceOperation,
  activation: FixedLayoutActivation): FixedLayoutProfileClaim {
  machine.assertExclusive(); machine.assertOfflineMaintenance(operation);
  const context = machine.readInstallationContext();
  if (context === undefined) throw new Error("fixed-layout-installation-required");
  const registry = machine.readProfileRegistry(), row = registry.profiles.find(profile => profile.profileId === activation.profileId);
  if (row?.lifecycle !== "ready" || row.credentialState !== "saved") throw new Error("fixed-layout-ready-person-required");
  const stateRoot = join(machine.stateRoot, "profiles", activation.profileId), artifactRoot = join(stateRoot, "artifacts");
  const binding = { installationId: machine.locator.installationId, profileId: activation.profileId };
  const plan = deepFreeze(FixedLayoutActivationSchema.parse(activation));
  if (plan.authorityPath !== join(stateRoot, "state.db") || plan.snapshot.config.paths.stateRoot !== stateRoot
      || plan.snapshot.config.paths.artifactRoot !== artifactRoot || plan.snapshot.config.paths.browserProfileRoot !== join(stateRoot, "browsers")) throw new Error("fixed-layout-config-path-mismatch");
  const journal = readFixedLayoutIntent(context.workspace);
  if (journal?.phase !== "configuring") throw new Error("fixed-layout-publication-required");
  const journalIdentity = canonicalJsonStringify(journal);
  assertCanonicalProfileBinding(plan.authorityPath, binding);
  const physical = lstatSync(plan.authorityPath);
  const ancestry = new Map<string, DirectoryIdentity>();
  const assertHeld = () => {
    machine.assertExclusive(); machine.assertOfflineMaintenance(operation);
    const current = readFixedLayoutIntent(context.workspace);
    if (current?.phase !== "configuring" || canonicalJsonStringify(current) !== journalIdentity || current.installationId !== binding.installationId
      || canonicalJsonStringify(current.profiles.find(profile => profile.profileId === binding.profileId)) !== canonicalJsonStringify(plan)
      || canonicalJsonStringify(machine.readProfileRegistry()) !== canonicalJsonStringify(registry)
      || !noSymlinkAncestry(stateRoot, ancestry) || !noSymlinkAncestry(artifactRoot, ancestry)) throw new Error("fixed-layout-claim-changed");
    const observed = lstatSync(plan.authorityPath, { throwIfNoEntry: false });
    if (observed === undefined || !observed.isFile() || observed.isSymbolicLink() || observed.nlink !== 1
      || observed.dev !== physical.dev || observed.ino !== physical.ino || observed.mode !== physical.mode || observed.uid !== physical.uid) throw new Error("fixed-layout-database-changed");
  };
  assertHeld(); proveProfileRootsUnused([stateRoot]); assertHeld();
  const claim = Object.freeze(FixedLayoutProfileClaimSchema.parse({ operationId: operation.operationId, profileId: binding.profileId }));
  layoutProfiles.set(claim, Object.freeze({ machine, operation, stateRoot, artifactRoot, binding: Object.freeze(binding), activation: plan, assertHeld }));
  return claim;
}

export async function activateFixedLayoutProfiles(machine: RuntimeAdmission): Promise<void> {
  machine.assertExclusive();
  const context = machine.readInstallationContext(), operation = machine.maintenanceOperation();
  if (context === undefined) throw new Error("fixed-layout-installation-required");
  const intent = readFixedLayoutIntent(context.workspace), registry = machine.readProfileRegistry();
  if (intent?.phase !== "configuring" || intent.installationId !== machine.locator.installationId
    || intent.profiles.length !== registry.profiles.length || registry.profiles.some(row => !intent.profiles.some(plan => plan.profileId === row.profileId))) throw new Error("fixed-layout-profile-membership-mismatch");
  const { RuntimeAdmission } = await import("../admission/admission.js");
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  const completed = new Map<string, ReturnType<typeof profileAuthorityFileWitnesses>>();
  for (const plan of intent.profiles) {
    machine.assertOfflineMaintenance(operation); assertFixedLayoutConfiguring(intent);
    const admission = RuntimeAdmission.forFixedLayoutProfile(machine, issueFixedLayoutProfile(machine, operation, plan));
    let retain = false;
    try {
      const manifestPath = join(admission.stateRoot, "backups", "authority", `${plan.backupFileName}.manifest.json`);
      if (hash(file(manifestPath, "managed data").bytes) !== plan.backupManifestSha256) throw new Error("fixed-layout-backup-manifest-changed");
      const backup = await verifyBackupManifestAtPath(admission, manifestPath);
      if (backup.manifest.sha256 !== plan.backupSha256 || backup.manifest.authorityGeneration !== plan.preAuthorityGeneration
        || backup.manifest.authorityContentFingerprint !== plan.preAuthorityContentFingerprint) throw new Error("fixed-layout-backup-changed");
      AuthorityDatabase.publishFixedLayoutActivation(admission);
      assertFixedLayoutConfiguring(intent); proveProfileRootsUnused([admission.stateRoot]);
      completed.set(admission.stateRoot, profileAuthorityFileWitnesses(admission.stateRoot));
    } catch (error) {
      retain = hasUnprovedSourceClosure(error);
      if (retain) { machine.retainSourceClosure(error); throw retainAuthoritySourceClosure([error], { admission, restore: operation }); }
      throw error;
    } finally { if (!retain) admission.release(); }
  }
  machine.assertOfflineMaintenance(operation); assertFixedLayoutConfiguring(intent);
  proveProfileRootsUnused([machine.stateRoot]);
  for (const [root, files] of completed) if (canonicalJsonStringify(profileAuthorityFileWitnesses(root)) !== canonicalJsonStringify(files)) throw new Error("fixed-layout-completed-person-changed");
  publishFixedLayoutIntent(operation, { ...intent, phase: "complete" });
}
