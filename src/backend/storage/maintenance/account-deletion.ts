import { readRestoreWriteFences } from "../sqlite/restore-write-fences.js";
import { withReadonlyAuthoritySnapshot } from "../sqlite/readonly-authority-snapshot.js";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { lstatSync, rmdirSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { advanceProfileRegistryDocument, ProfileRegistryDocumentSchema, ProfileVerifierDocumentSchema } from "../../../models/profiles/profile.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { BrowserRootsSchema } from "../browser-root-contract.js";
import { CanonicalCredentialHeadSchema } from "../configuration/canonical-credential-store.js";
import { credentialKeyCustody } from "../configuration/credential-key-custody.js";
import { readPrivateFile, removeExactPath } from "../configuration/credential-safe-file.js";
import { fsyncPath, replacePrivateFile, writePrivateStage } from "../private-path.js";
import { FixedLayoutEntrySchema, fixedLayoutEntries } from "./fixed-layout.js";
import { proveProfileRootsUnused } from "./process-closure.js";

const FileSchema = z.strictObject({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(), digest: z.string().regex(/^[a-f0-9]{64}$/u) });
const RelativePath = z.string().min(1).refine(path => !path.includes("\\") && path.split("/").every(part => part !== "" && part !== "." && part !== ".."));
export const AccountDeletionSchema = z.strictObject({
  schemaVersion: z.literal(1), installationId: z.uuid(), operationId: z.uuid(), profileId: z.uuid(),
  priorDocument: ProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema,
  priorVerifiers: ProfileVerifierDocumentSchema, verifiers: ProfileVerifierDocumentSchema,
  priorBrowsers: BrowserRootsSchema, browsers: BrowserRootsSchema,
  head: CanonicalCredentialHeadSchema, headFile: FileSchema, duoFile: FileSchema,
  roots: z.array(z.strictObject({ path: RelativePath, entries: z.array(FixedLayoutEntrySchema) })),
  cursor: z.number().int().nonnegative(), credentialCursor: z.number().int().min(0).max(2), pending: z.boolean(),
});
type AccountDeletion = z.infer<typeof AccountDeletionSchema>;
type Location = Readonly<{ stateRoot: string; installationId: string }>;
const same = (left: unknown, right: unknown) => canonicalJsonStringify(left) === canonicalJsonStringify(right);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function read(path: string) {
  const file = readPrivateFile(path, { label: "managed data", maxBytes: 100 * 1024 * 1024 });
  if (file === undefined) throw new Error("account-deletion-source-missing");
  return file;
}
function json(path: string): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read(path).bytes)); }
function witness(path: string) { const file = read(path); return { ...file.identity, digest: digest(file.bytes) }; }
function write(path: string, value: unknown): void {
  const stage = `${path}.account-deletion.tmp`, bytes = Buffer.from(canonicalJsonStringify(value));
  if (lstatSync(stage, { throwIfNoEntry: false }) === undefined) writePrivateStage(stage, bytes);
  else if (!read(stage).bytes.equals(bytes)) throw new Error("account-deletion-stage-changed");
  replacePrivateFile(stage, path); fsyncPath(dirname(path));
}
function paths(location: Location, profileId: string) {
  const machine = join(location.stateRoot, "machine");
  return { registry: join(machine, "profiles.json"), verifiers: join(machine, "profile-verifiers.json"),
    browsers: join(machine, "browser-roots.json"), head: join(machine, "credential-keys", `${profileId}.json`),
    duo: join(machine, "duo-credentials", `${profileId}.json`) };
}

export function captureAccountDeletion(location: Location, document: z.infer<typeof ProfileRegistryDocumentSchema>, profileId: string, epoch: number): AccountDeletion {
  const row = document.profiles.find(row => row.profileId === profileId), files = paths(location, profileId);
  if (document.activeProfileId !== null || document.sessionGeneration !== epoch || row?.lifecycle !== "ready") throw new Error("account-deletion-session-changed");
  const priorVerifiers = ProfileVerifierDocumentSchema.parse(json(files.verifiers));
  const priorBrowsers = BrowserRootsSchema.parse(json(files.browsers));
  if (priorBrowsers.installationId !== location.installationId || priorBrowsers.roots.some(root => root.profileId === profileId && (root.launch.state !== "closed" || root.native !== undefined))) throw new Error("account-deletion-browser-closure-unproved");
  if (priorVerifiers.profiles.filter(row => row.profileId === profileId).length !== 1) throw new Error("account-deletion-verifier-missing");
  const head = CanonicalCredentialHeadSchema.parse(json(files.head));
  if (head.state !== "active" || head.installationId !== location.installationId || head.profileId !== profileId || head.key.installationId !== location.installationId || head.key.profileId !== profileId) throw new Error("account-deletion-credentials-changed");
  credentialKeyCustody.read(head.key);
  const roots = [`profiles/${profileId}`, ...priorBrowsers.roots.filter(root => root.profileId === profileId && root.owner.kind === "signup")
    .map(root => root.directory).filter(path => lstatSync(join(location.stateRoot, path), { throwIfNoEntry: false }) !== undefined)];
  proveProfileRootsUnused(roots.map(path => join(location.stateRoot, path)));
  if (withReadonlyAuthoritySnapshot(join(location.stateRoot, "profiles", profileId, "state.db"), database => readRestoreWriteFences(database).unresolved.length) !== 0) throw new Error("account-deletion-unresolved-write");
  return AccountDeletionSchema.parse({ schemaVersion: 1, installationId: location.installationId, operationId: randomUUID(), profileId,
    priorDocument: document, document: advanceProfileRegistryDocument(document, { profiles: document.profiles.filter(row => row.profileId !== profileId), sessionGeneration: epoch + 1 }),
    priorVerifiers, verifiers: { ...priorVerifiers, profiles: priorVerifiers.profiles.filter(row => row.profileId !== profileId) },
    priorBrowsers, browsers: { ...priorBrowsers, revision: priorBrowsers.revision + 1, roots: priorBrowsers.roots.filter(root => root.profileId !== profileId) },
    head, headFile: witness(files.head), duoFile: witness(files.duo), roots: roots.map(path => ({ path, entries: fixedLayoutEntries(join(location.stateRoot, path)) })), cursor: 0, credentialCursor: 0, pending: false });
}

export function publishAccountDeletion(path: string, plan: AccountDeletion): void {
  writePrivateStage(path, Buffer.from(canonicalJsonStringify(AccountDeletionSchema.parse(plan)))); fsyncPath(dirname(path));
}

export function resumeAccountDeletion(location: Location, journal: string, assertHeld: () => void,
  registry: Readonly<{ validate(prior: z.infer<typeof ProfileRegistryDocumentSchema>, next: z.infer<typeof ProfileRegistryDocumentSchema>): void; publish(): void }>): void {
  let plan = AccountDeletionSchema.parse(json(journal));
  const files = paths(location, plan.profileId), profileRoot = `profiles/${plan.profileId}`;
  const expectedRoots = [profileRoot, ...plan.priorBrowsers.roots.filter(root => root.profileId === plan.profileId && root.owner.kind === "signup").map(root => root.directory)];
  if (plan.installationId !== location.installationId || plan.priorDocument.installationId !== location.installationId || plan.priorDocument.activeProfileId !== null
    || plan.head.installationId !== location.installationId || plan.head.profileId !== plan.profileId || plan.head.key.installationId !== location.installationId || plan.head.key.profileId !== plan.profileId || plan.head.state !== "active"
    || !same(plan.document, advanceProfileRegistryDocument(plan.priorDocument, { profiles: plan.priorDocument.profiles.filter(row => row.profileId !== plan.profileId), sessionGeneration: plan.priorDocument.sessionGeneration + 1 }))
    || !same(plan.verifiers, { ...plan.priorVerifiers, profiles: plan.priorVerifiers.profiles.filter(row => row.profileId !== plan.profileId) })
    || !same(plan.browsers, { ...plan.priorBrowsers, revision: plan.priorBrowsers.revision + 1, roots: plan.priorBrowsers.roots.filter(row => row.profileId !== plan.profileId) })
    || plan.priorBrowsers.roots.some(root => root.profileId === plan.profileId && (root.launch.state !== "closed" || root.native !== undefined))
    || plan.roots[0]?.path !== profileRoot || new Set(plan.roots.map(root => root.path)).size !== plan.roots.length
    || plan.roots.some(root => !expectedRoots.includes(root.path) || root.entries.filter(entry => entry.path === "" && entry.kind === "directory").length !== 1
      || new Set(root.entries.map(entry => entry.path)).size !== root.entries.length)) throw new Error("account-deletion-plan-invalid");
  const entries = plan.roots.flatMap(root => root.entries.map(entry => ({ ...entry, path: entry.path === "" ? root.path : `${root.path}/${entry.path}` })))
    .sort((left, right) => right.path.split("/").length - left.path.split("/").length || left.path.localeCompare(right.path));
  if (plan.cursor > entries.length) throw new Error("account-deletion-cursor-invalid");
  const credentials = [[files.duo, plan.duoFile], [files.head, plan.headFile]] as const;
  const current = () => {
    assertHeld();
    if (!same(json(journal), plan)) throw new Error("account-deletion-journal-changed");
    registry.validate(plan.priorDocument, plan.document);
    for (const [path, prior, next] of [[files.registry, plan.priorDocument, plan.document], [files.verifiers, plan.priorVerifiers, plan.verifiers], [files.browsers, plan.priorBrowsers, plan.browsers]] as const) {
      const observed = json(path);
      if (!same(observed, prior) && !same(observed, next)) throw new Error("account-deletion-control-changed");
    }
    for (const [index, [path, expected]] of credentials.entries()) {
      const present = lstatSync(path, { throwIfNoEntry: false }) !== undefined;
      if (present ? index < plan.credentialCursor || !same(witness(path), expected)
        : index >= plan.credentialCursor + Number(plan.cursor === entries.length && plan.pending)) throw new Error("account-deletion-credential-changed");
    }
    for (const root of plan.roots) {
      if (lstatSync(join(location.stateRoot, root.path), { throwIfNoEntry: false }) === undefined) {
        if (entries.findIndex(entry => entry.path === root.path) >= plan.cursor + Number(plan.pending)) throw new Error("account-deletion-membership-changed");
        continue;
      }
      for (const entry of fixedLayoutEntries(join(location.stateRoot, root.path))) {
        const path = entry.path === "" ? root.path : `${root.path}/${entry.path}`, index = entries.findIndex(prior => prior.path === path), prior = entries[index];
        if (prior === undefined || index < plan.cursor || prior.kind !== entry.kind || prior.device !== entry.device || prior.inode !== entry.inode || prior.mode !== entry.mode
          || prior.kind === "file" && entry.kind === "file" && (prior.digest !== entry.digest || prior.size !== entry.size)) throw new Error("account-deletion-membership-changed");
      }
    }
    for (let index = plan.cursor + Number(plan.pending); index < entries.length; index++) {
      const entry = entries[index];
      if (entry === undefined || lstatSync(join(location.stateRoot, entry.path), { throwIfNoEntry: false }) === undefined) throw new Error("account-deletion-member-missing");
    }
  };
  current();
  proveProfileRootsUnused(plan.roots.map(root => join(location.stateRoot, root.path)));
  current(); credentialKeyCustody.delete(plan.head.key);
  while (plan.cursor < entries.length) {
    if (!plan.pending) { plan = { ...plan, pending: true }; write(journal, plan); }
    current();
    const entry = entries[plan.cursor]; if (entry === undefined) throw new Error("account-deletion-cursor-invalid");
    const path = join(location.stateRoot, entry.path);
    if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) {
      if (entry.kind === "directory") rmdirSync(path); else removeExactPath(path, entry, false, "account-deletion-member-changed");
      fsyncPath(dirname(path));
    }
    plan = { ...plan, cursor: plan.cursor + 1, pending: false }; write(journal, plan);
  }
  while (plan.credentialCursor < credentials.length) {
    if (!plan.pending) { plan = { ...plan, pending: true }; write(journal, plan); }
    current();
    const credential = credentials[plan.credentialCursor]; if (credential === undefined) throw new Error("account-deletion-cursor-invalid");
    const [path, expected] = credential;
    removeExactPath(path, expected, true, "account-deletion-credential-changed"); fsyncPath(dirname(path));
    plan = { ...plan, credentialCursor: plan.credentialCursor + 1, pending: false }; write(journal, plan);
  }
  current(); write(files.verifiers, plan.verifiers);
  current(); write(files.browsers, plan.browsers);
  current(); write(files.registry, plan.document);
  current(); registry.publish();
  current(); unlinkSync(journal); fsyncPath(dirname(journal));
}
