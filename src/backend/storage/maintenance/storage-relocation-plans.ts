import { isAbsolute, relative, resolve, join } from "node:path";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import {
  StorageRelocationPlanViewSchema, storageRelocationDesiredDigest, storageRelocationRequestFingerprint,
  type StorageRelocationCommandRequest, type StorageRelocationPlanView,
} from "../../../rules/commands/commands.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import type { AuthorityRepositories } from "../sqlite/authority-database.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RelocationCompletionReceipt, RuntimeLocator } from "../admission/installation.js";

type Pair = Readonly<{ stateRoot: string; artifactRoot: string }>;
export type StorageRelocationEpoch = Pick<RuntimeLocator, "installationId" | "generation" | "stateRoot" | "artifactRoot">;
export type StorageRelocationHistoryRepositories = Readonly<{
  commands: Pick<AuthorityRepositories["commands"], "listStorageRelocationCommands">;
  commandAudits: Pick<AuthorityRepositories["commandAudits"], "findByCommand">;
}>;
type Epoch = StorageRelocationEpoch;
type Authority = Readonly<{ withAuthorityTransaction<T>(work: (repositories: AuthorityRepositories) => T): T }>;
export type StorageRelocationPlanReader = Readonly<{
  read(): StorageRelocationPlanView;
  project(repositories: AuthorityRepositories): StorageRelocationPlanView;
  validate(request: StorageRelocationCommandRequest): void;
}>;

function refuse(reason: string): never { throw new Error(`storage-relocation-plan: ${reason}`); }
function inside(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === "" || (part !== ".." && !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(part));
}
function requirePair(pair: Pair, workspace: string): void {
  for (const path of [pair.stateRoot, pair.artifactRoot]) {
    if (!isAbsolute(path) || resolve(path) !== path) refuse("roots must be canonical absolute paths");
    if (inside(path, workspace) || inside(path, join(workspace, ".tracker/control"))
      || inside(join(workspace, ".tracker/control"), path)) refuse("control overlaps a movable root");
  }
  if (inside(pair.artifactRoot, pair.stateRoot)) refuse("state root overlaps artifact root");
}
function requireDesired(source: Pair, desired: Pair, workspace: string): void {
  requirePair(source, workspace);
  requirePair(desired, workspace);
  if ((desired.stateRoot !== source.stateRoot && inside(workspace, desired.stateRoot))
    || (desired.artifactRoot !== source.artifactRoot && inside(workspace, desired.artifactRoot))) refuse("destination is inside workspace");
  if (source.stateRoot === desired.stateRoot && source.artifactRoot === desired.artifactRoot) refuse("desired pair is unchanged");
  if (source.stateRoot !== desired.stateRoot && source.artifactRoot === desired.artifactRoot
    && inside(source.stateRoot, source.artifactRoot)) refuse("state-only move would strand nested artifacts");
  for (const moved of [
    ...(source.stateRoot === desired.stateRoot ? [] : [desired.stateRoot]),
    ...(source.artifactRoot === desired.artifactRoot ? [] : [desired.artifactRoot]),
  ]) {
    if (inside(moved, source.stateRoot) || inside(source.stateRoot, moved)
      || inside(moved, source.artifactRoot) || inside(source.artifactRoot, moved)) {
      refuse("moved root overlaps a source root");
    }
  }
}
function locatorTarget(locator: Epoch) {
  return { installationId: locator.installationId, sourceGeneration: locator.generation,
    sourcePair: { stateRoot: locator.stateRoot, artifactRoot: locator.artifactRoot } };
}
function requireSource(request: StorageRelocationCommandRequest, locator: Epoch): void {
  if (canonicalJsonStringify({ installationId: request.target.installationId,
    sourceGeneration: request.target.sourceGeneration, sourcePair: request.target.sourcePair })
    !== canonicalJsonStringify(locatorTarget(locator))) refuse("installation or source pair drift");
}
function requireRequest(request: StorageRelocationCommandRequest, locator: Epoch, workspace: string): void {
  requireSource(request, locator);
  if (request.payload.requestFingerprint !== storageRelocationRequestFingerprint(request)) refuse("request fingerprint mismatch");
  if (request.type === "plan-storage-relocation") {
    requireDesired(request.target.sourcePair, request.payload.desiredPair, workspace);
    if (request.payload.desiredDigest !== storageRelocationDesiredDigest(request.target, request.payload.desiredPair)) refuse("desired digest mismatch");
  }
}

function samePair(left: Pair, right: Pair): boolean {
  return left.stateRoot === right.stateRoot && left.artifactRoot === right.artifactRoot;
}
function consumeReceipt(receipt: RelocationCompletionReceipt, pending: NonNullable<StorageRelocationPlanView["pending"]>,
  epoch: Epoch, revision: number): Epoch {
  if (receipt.installationId !== epoch.installationId || receipt.fromGeneration !== epoch.generation
    || receipt.toGeneration !== epoch.generation + 1
    || !samePair(receipt.source, epoch) || receipt.plan.revision !== revision
    || receipt.plan.expectedRevision !== revision - 1 || receipt.plan.commandId !== pending.commandId
    || receipt.plan.requestFingerprint !== pending.requestFingerprint
    || receipt.plan.desiredDigest !== pending.desiredDigest
    || !samePair(receipt.destination, pending.desiredPair)) refuse("activation receipt does not match pending plan");
  return { installationId: epoch.installationId, generation: receipt.toGeneration,
    stateRoot: receipt.destination.stateRoot, artifactRoot: receipt.destination.artifactRoot };
}
function project(repositories: StorageRelocationHistoryRepositories, locator: Epoch,
  receipts: readonly RelocationCompletionReceipt[], workspace: string): StorageRelocationPlanView {
  const commands = repositories.commands.listStorageRelocationCommands();
  const seenWriteIds = new Set<string>();
  let pending: StorageRelocationPlanView["pending"] = null;
  let revision = 0;
  let epoch: Epoch = receipts.length > 0
    ? { installationId: locator.installationId, generation: 0,
      stateRoot: receipts[0].source.stateRoot, artifactRoot: receipts[0].source.artifactRoot }
    : { installationId: locator.installationId, generation: 0, stateRoot: locator.stateRoot, artifactRoot: locator.artifactRoot };
  let receiptIndex = 0;
  for (const request of commands) {
    requireRequest(request, epoch, workspace);
    if (request.target.expectedRevision !== revision) refuse("duplicate or gap plan revision");
    if (seenWriteIds.has(request.payload.writeId)) refuse("write id reused");
    seenWriteIds.add(request.payload.writeId);
    const nextRevision = revision + 1;
    const target = { family: "storage-relocation", revision: nextRevision };
    const audit = repositories.commandAudits.findByCommand(request.commandId);
    if (audit === undefined) refuse("missing command audit");
    if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(request)
      || audit.result.state !== "applied" || audit.result.commandId !== request.commandId
      || canonicalJsonStringify(audit.result.affectedTargets) !== canonicalJsonStringify([target])
      || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{ target, before: revision, after: nextRevision }])
      || audit.affectedDependencyIds.length !== 0) refuse("command audit mismatch");
    if (request.type === "plan-storage-relocation") {
      pending = { commandId: request.commandId, writeId: request.payload.writeId,
        desiredPair: request.payload.desiredPair, desiredDigest: request.payload.desiredDigest,
        requestFingerprint: request.payload.requestFingerprint };
    } else {
      if (pending === null || pending.commandId !== request.payload.cancelledPlanCommandId
        || pending.desiredDigest !== request.payload.cancelledPlanDigest) refuse("cancel does not match current plan");
      pending = null;
    }
    revision = nextRevision;
    const receipt = receipts[receiptIndex];
    if (receipt !== undefined && receipt.plan.revision <= revision) {
      if (pending === null) refuse("activation receipt has no pending plan");
      epoch = consumeReceipt(receipt, pending, epoch, revision);
      pending = null;
      receiptIndex += 1;
    }
  }
  if (receiptIndex !== receipts.length) refuse("activation receipt has no matching plan command");
  if (epoch.generation !== locator.generation || !samePair(epoch, locator)) refuse("projected plan epoch differs from active locator");
  return deepFreeze(StorageRelocationPlanViewSchema.parse({ revision, installationId: locator.installationId,
    sourceGeneration: locator.generation,
    sourcePair: { stateRoot: locator.stateRoot, artifactRoot: locator.artifactRoot }, pending }));
}

export function projectStorageRelocationPlanHistory(repositories: StorageRelocationHistoryRepositories,
  epoch: StorageRelocationEpoch, receipts: readonly RelocationCompletionReceipt[], workspaceInput: string): StorageRelocationPlanView {
  const workspace = resolve(workspaceInput);
  requirePair(epoch, workspace);
  return project(repositories, epoch, receipts, workspace);
}

export function createStorageRelocationPlanReader(input: Readonly<{
  authority: Authority;
  admission: RuntimeAdmission;
  workspace: string;
}>): StorageRelocationPlanReader {
  const workspace = resolve(input.workspace);
  const context = () => {
    const admission = requireRuntimeAdmission(input.admission);
    admission.assertStorageRelocationSupported();
    const locator = admission.locator;
    requirePair(locator, workspace);
    const receipts = admission.readRelocationReceipts();
    if (receipts.length !== locator.generation
      || (receipts.length > 0 && !samePair(receipts[receipts.length - 1].destination, locator))) {
      refuse("active locator receipt chain mismatch");
    }
    return { locator, receipts };
  };
  context();
  return Object.freeze({
    read: () => input.authority.withAuthorityTransaction((repositories) => {
      const current = context();
      return project(repositories, current.locator, current.receipts, workspace);
    }),
    project: (repositories: AuthorityRepositories) => {
      const current = context();
      return project(repositories, current.locator, current.receipts, workspace);
    },
    validate: (request: StorageRelocationCommandRequest) => requireRequest(request, context().locator, workspace),
  });
}
