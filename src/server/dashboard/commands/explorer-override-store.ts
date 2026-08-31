/** Durable presentation-only Explorer overrides (D186 §5.4). */
import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { deepFreeze } from "../../../domain/immutability.js";
import {
  CommandAuditRecordSchema,
  type CommandAuditRecord,
  type CommandRequest,
} from "../../../domain/commands.js";
import {
  ExplorerEditApplyRequestSchema,
  ExplorerOverrideDocumentSchema,
  ExplorerWorkflowOverrideSchema,
  type ExplorerEditApplyRequest,
  type ExplorerOverrideDocument,
  type ExplorerWorkflowOverride,
} from "../../../domain/dashboard/explorer.js";

export interface ExplorerOverrideCommit {
  readonly override: ExplorerWorkflowOverride;
  /** Release only after the authority transaction returned as committed. */
  readonly finalizeAfterCommit: () => void;
}

export interface ExplorerOverrideRepository {
  read(workflowId: string): ExplorerWorkflowOverride | undefined;
  /** Capture one immutable document; the caller owns recovery admission. */
  readAll(): readonly ExplorerWorkflowOverride[];
  reconcilePending(
    /** Absent at startup/read admission: no command is eligible to replay. */
    command: ExplorerEditApplyRequest | undefined,
    findOutcome: (commandId: string) => Readonly<{
      request: CommandRequest | undefined;
      audit: CommandAuditRecord | undefined;
    }>,
  ): void;
  replace(command: ExplorerEditApplyRequest, override: ExplorerWorkflowOverride): ExplorerOverrideCommit;
}

export class ExplorerOverrideConflictError extends Error {
  readonly currentRevision: number;

  constructor(workflowId: string, expectedRevision: number, currentRevision: number) {
    super(
      `Explorer override ${workflowId} is revision ${String(currentRevision)}, `
      + `not expected revision ${String(expectedRevision)}`,
    );
    this.name = "ExplorerOverrideConflictError";
    this.currentRevision = currentRevision;
  }
}

export class ExplorerOverrideBusyError extends Error {
  constructor(workflowId: string, ownerPid: number) {
    super(`Explorer override ${workflowId} is held by live writer process ${String(ownerPid)}`);
    this.name = "ExplorerOverrideBusyError";
  }
}

export class ExplorerOverridePendingError extends Error {
  constructor(workflowId: string, commandId: string) {
    super(
      `Explorer override ${workflowId} has uncommitted command ${commandId}; `
      + "only that byte-exact command may reconcile it",
    );
    this.name = "ExplorerOverridePendingError";
  }
}

export class ExplorerOverrideDivergentCommandError extends Error {
  constructor(commandId: string) {
    super(`Explorer command ${commandId} was reused with a different complete command envelope`);
    this.name = "ExplorerOverrideDivergentCommandError";
  }
}

/** The live/staged bytes no longer prove whether the requested replacement committed. */
export class ExplorerOverrideStateUncertainError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ExplorerOverrideStateUncertainError";
  }
}

export interface ExplorerOverrideFileOperations {
  readonly writeExclusive: (path: string, text: string) => void;
  readonly syncPath: (path: string) => void;
  readonly atomicReplace: (from: string, to: string) => void;
  readonly remove: (path: string) => void;
}

function syncPath(path: string): void {
  const descriptor = openSync(path, "r");
  let syncFailure: Readonly<{ error: unknown }> | undefined;
  try {
    fsyncSync(descriptor);
  } catch (error) {
    syncFailure = { error };
  }
  let closeFailure: Readonly<{ error: unknown }> | undefined;
  try {
    closeSync(descriptor);
  } catch (error) {
    closeFailure = { error };
  }
  const closeError = closeFailure === undefined ? undefined
    : new Error(`Explorer override close failed for ${path}`, { cause: closeFailure.error });
  if (syncFailure !== undefined) {
    if (closeError !== undefined) {
      throw new AggregateError(
        [syncFailure.error, closeError],
        `Explorer override fsync and close failed for ${path}`,
        { cause: syncFailure.error },
      );
    }
    throw new Error(`Explorer override fsync failed for ${path}`, { cause: syncFailure.error });
  }
  if (closeError !== undefined) throw closeError;
}

const REAL_FILE_OPERATIONS: ExplorerOverrideFileOperations = Object.freeze({
  writeExclusive: (path: string, text: string) =>
    writeFileSync(path, text, { encoding: "utf8", mode: 0o600, flag: "wx" }),
  syncPath,
  atomicReplace: renameSync,
  remove: unlinkSync,
});

const PreviousDocumentSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("present"), document: ExplorerOverrideDocumentSchema }),
]);

const ClaimFields = {
  claimVersion: z.literal(2),
  pid: z.number().int().positive(),
  command: ExplorerEditApplyRequestSchema,
  commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
} as const;

const ExplorerOverrideClaimSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...ClaimFields, state: z.literal("acquiring") }),
  z.strictObject({
    ...ClaimFields,
    state: z.literal("prepared"),
    previous: PreviousDocumentSchema,
    next: ExplorerOverrideDocumentSchema,
  }),
]);
type ExplorerOverrideClaim = z.infer<typeof ExplorerOverrideClaimSchema>;
type PreparedClaim = Extract<ExplorerOverrideClaim, { state: "prepared" }>;

function emptyDocument(): ExplorerOverrideDocument {
  return ExplorerOverrideDocumentSchema.parse({ documentVersion: 1, workflows: [] });
}

function processIsAlive(pid: number): boolean {
  let signalError: unknown;
  try {
    process.kill(pid, 0);
  } catch (error) {
    signalError = error;
  }
  if (signalError === undefined) return true;
  const code = typeof signalError === "object" && signalError !== null && "code" in signalError
    ? signalError.code
    : undefined;
  if (code === "ESRCH") return false;
  throw new Error(`cannot determine whether Explorer claim process ${String(pid)} is alive`, {
    cause: signalError,
  });
}

function errnoOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return false;
    throw new ExplorerOverrideStateUncertainError(
      `Explorer override path ${path} presence could not be determined`,
      error,
    );
  }
}

function textAt(path: string): string | undefined {
  return pathExists(path) ? readFileSync(path, "utf8") : undefined;
}

function documentText(document: ExplorerOverrideDocument): string {
  return `${canonicalJsonStringify(document)}\n`;
}

export function explorerEditCommandFingerprint(command: ExplorerEditApplyRequest): string {
  return createHash("sha256")
    .update("hrauto:explorer-edit-command:v2\0")
    .update(canonicalJsonStringify(ExplorerEditApplyRequestSchema.parse(command)))
    .digest("hex");
}

function sameCommand(left: ExplorerEditApplyRequest, right: ExplorerEditApplyRequest): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function cleanupFailures(primary: unknown, cleanup: unknown, path: string): AggregateError {
  return new AggregateError(
    [primary, new Error(`Explorer override cleanup failed for ${path}`, { cause: cleanup })],
    `Explorer override operation and cleanup failed for ${path}`,
    { cause: primary },
  );
}

export function createExplorerOverrideStore(
  path: string,
  fileOperations: ExplorerOverrideFileOperations = REAL_FILE_OPERATIONS,
): ExplorerOverrideRepository {
  const directory = dirname(path);
  const temporaryPath = `${path}.pending`;
  const claimPath = `${path}.claim`;
  const claimTemporaryPath = `${claimPath}.pending`;
  mkdirSync(directory, { recursive: true });

  const readDocument = (): ExplorerOverrideDocument => {
    const text = textAt(path);
    if (text === undefined) return emptyDocument();
    const raw: unknown = JSON.parse(text);
    return ExplorerOverrideDocumentSchema.parse(raw);
  };

  const read = (workflowId: string): ExplorerWorkflowOverride | undefined =>
    readDocument().workflows.find((entry) => String(entry.workflowId) === workflowId);

  const removeAndSyncDirectory = (target: string): void => {
    fileOperations.remove(target);
    fileOperations.syncPath(directory);
  };

  const parseClaimText = (text: string, source: string): ExplorerOverrideClaim => {
    let claim: ExplorerOverrideClaim;
    try {
      claim = ExplorerOverrideClaimSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${source} is malformed; refusing to replace authority`,
        error,
      );
    }
    const fingerprint = explorerEditCommandFingerprint(claim.command);
    if (claim.commandFingerprint !== fingerprint) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${source} does not fingerprint its complete command envelope`,
      );
    }
    if (claim.state === "prepared") {
      const next = claim.next.workflows.find(
        (entry) => String(entry.workflowId) === String(claim.command.target.workflowId),
      );
      if (next === undefined
        || next.appliedCommandId !== claim.command.commandId
        || next.commandFingerprint !== fingerprint
        || next.descriptorVersion !== claim.command.target.expectedVersion
        || next.contractFingerprint !== claim.command.target.contractFingerprint
        || next.revision !== claim.command.target.expectedOverrideRevision + 1) {
        throw new ExplorerOverrideStateUncertainError(
          `Explorer override claim ${source} does not bind its next document to the complete command envelope`,
        );
      }
      const previous = claim.previous.state === "present" ? claim.previous.document : emptyDocument();
      const priorOverride = previous.workflows.find((entry) => entry.workflowId === claim.command.target.workflowId);
      if ((priorOverride?.revision ?? 0) !== claim.command.target.expectedOverrideRevision) {
        throw new ExplorerOverrideStateUncertainError(
          `Explorer override claim ${source} prior revision does not match its command basis`,
        );
      }
      const presentation = { ...priorOverride?.presentation };
      const changedKinds = new Set<string>();
      for (const change of claim.command.payload.changes) {
        if (changedKinds.has(change.kind)) {
          throw new ExplorerOverrideStateUncertainError(`Explorer override claim ${source} repeats ${change.kind}`);
        }
        changedKinds.add(change.kind);
        switch (change.kind) {
          case "workflow-label": presentation.label = change.value; break;
          case "workflow-icon": presentation.icon = change.value; break;
          case "workflow-category": presentation.category = change.value; break;
          default:
            throw new ExplorerOverrideStateUncertainError(
              `Explorer override claim ${source} cannot hot-apply ${change.kind}`,
            );
        }
      }
      const expectedOverride = ExplorerWorkflowOverrideSchema.parse({
        overrideVersion: 1,
        workflowId: claim.command.target.workflowId,
        descriptorVersion: claim.command.target.expectedVersion,
        contractFingerprint: claim.command.target.contractFingerprint,
        revision: claim.command.target.expectedOverrideRevision + 1,
        appliedCommandId: claim.command.commandId,
        commandFingerprint: fingerprint,
        presentation,
      });
      const expectedNext = ExplorerOverrideDocumentSchema.parse({
        documentVersion: 1,
        workflows: [
          ...previous.workflows.filter((entry) => entry.workflowId !== claim.command.target.workflowId),
          expectedOverride,
        ].sort((left, right) => left.workflowId.localeCompare(right.workflowId)),
      });
      if (documentText(claim.next) !== documentText(expectedNext)) {
        throw new ExplorerOverrideStateUncertainError(
          `Explorer override claim ${source} next bytes differ from its prior document plus command changes`,
        );
      }
    }
    return claim;
  };

  const readClaim = (): ExplorerOverrideClaim | undefined => {
    const text = textAt(claimPath);
    return text === undefined ? undefined : parseClaimText(text, claimPath);
  };

  const proveClaimAbsence = (): void => {
    // A cold reopen cannot distinguish clean absence from unlink followed by
    // failed directory fsync. Repeat the barrier and check absence afterward;
    // never recreate or remove a claim that appeared during this observation.
    try {
      fileOperations.syncPath(directory);
      if (pathExists(claimPath)) {
        throw new Error(`Explorer override claim ${claimPath} is present after absence sync`);
      }
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} absence could not be proven durably`,
        error,
      );
    }
  };

  const releaseClaim = (): void => {
    try {
      if (pathExists(claimPath)) fileOperations.remove(claimPath);
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} could not be released durably`,
        error,
      );
    }
    proveClaimAbsence();
  };

  const recoverClaimStage = (): void => {
    const stagedText = textAt(claimTemporaryPath);
    if (stagedText === undefined) return;
    const liveText = textAt(claimPath);
    const staged = parseClaimText(stagedText, claimTemporaryPath);
    if (staged.state !== "prepared") {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim stage ${claimTemporaryPath} is not a prepared transition`,
      );
    }
    if (liveText === undefined) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim stage ${claimTemporaryPath} exists without its exclusive claim`,
      );
    }
    const live = parseClaimText(liveText, claimPath);
    const sameEnvelope = live.commandFingerprint === staged.commandFingerprint
      && sameCommand(live.command, staged.command);
    if (!sameEnvelope || (live.state === "prepared" && liveText !== stagedText)) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim stage ${claimTemporaryPath} diverges from live claim bytes`,
      );
    }
    try {
      removeAndSyncDirectory(claimTemporaryPath);
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim stage ${claimTemporaryPath} could not be reconciled durably`,
        error,
      );
    }
  };

  const writeExclusiveClaim = (claim: ExplorerOverrideClaim): void => {
    const claimText = `${canonicalJsonStringify(claim)}\n`;
    fileOperations.writeExclusive(claimPath, claimText);
    try {
      fileOperations.syncPath(claimPath);
      fileOperations.syncPath(directory);
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} could not be made durable`,
        error,
      );
    }
    if (textAt(claimPath) !== claimText) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} was not read back byte-exactly`,
      );
    }
  };

  const persistPreparedClaim = (acquiring: ExplorerOverrideClaim, prepared: PreparedClaim): void => {
    if (acquiring.state !== "acquiring") {
      throw new Error("only an acquiring Explorer claim can become prepared");
    }
    const beforeText = `${canonicalJsonStringify(acquiring)}\n`;
    const preparedText = `${canonicalJsonStringify(prepared)}\n`;
    try {
      fileOperations.writeExclusive(claimTemporaryPath, preparedText);
      fileOperations.syncPath(claimTemporaryPath);
    } catch (error) {
      const stagedText = textAt(claimTemporaryPath);
      if (stagedText !== undefined) {
        try {
          removeAndSyncDirectory(claimTemporaryPath);
        } catch (cleanupError) {
          throw new ExplorerOverrideStateUncertainError(
            `Explorer override claim stage ${claimTemporaryPath} could not be cleaned after prepare failure`,
            cleanupFailures(error, cleanupError, claimTemporaryPath),
          );
        }
      }
      throw error;
    }
    try {
      fileOperations.atomicReplace(claimTemporaryPath, claimPath);
    } catch (error) {
      const liveText = textAt(claimPath);
      const stagedText = textAt(claimTemporaryPath);
      if (liveText === preparedText) {
        if (stagedText !== undefined) {
          try {
            removeAndSyncDirectory(claimTemporaryPath);
          } catch (cleanupError) {
            throw new ExplorerOverrideStateUncertainError(
              `Explorer prepared claim landed but duplicate stage ${claimTemporaryPath} could not be removed`,
              cleanupFailures(error, cleanupError, claimTemporaryPath),
            );
          }
        }
      } else if (liveText === beforeText && stagedText === preparedText) {
        try {
          removeAndSyncDirectory(claimTemporaryPath);
        } catch (cleanupError) {
          throw new ExplorerOverrideStateUncertainError(
            `Explorer prepared claim did not land and its stage ${claimTemporaryPath} could not be removed`,
            cleanupFailures(error, cleanupError, claimTemporaryPath),
          );
        }
        throw error;
      } else {
        throw new ExplorerOverrideStateUncertainError(
          `Explorer prepared claim rename outcome is uncertain for ${claimPath}`,
          error,
        );
      }
    }
    try {
      fileOperations.syncPath(directory);
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer prepared claim ${claimPath} landed but its directory sync failed`,
        error,
      );
    }
    if (textAt(claimPath) !== preparedText) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer prepared claim ${claimPath} readback differs from the replacement bytes`,
      );
    }
  };

  const priorText = (previous: PreparedClaim["previous"]): string | undefined =>
    previous.state === "absent" ? undefined : documentText(previous.document);

  const transitionState = (claim: PreparedClaim): "previous" | "next" => {
    const liveText = textAt(path);
    if (liveText === documentText(claim.next)) return "next";
    if (liveText === priorText(claim.previous)) return "previous";
    throw new ExplorerOverrideStateUncertainError(
      `Explorer override ${path} matches neither the pending command's prior nor next bytes`,
    );
  };

  const recoverStalePending = (expectedText: string): void => {
    const stagedText = textAt(temporaryPath);
    if (stagedText === undefined) return;
    if (stagedText !== expectedText) {
      throw new ExplorerOverrideStateUncertainError(
        `stale Explorer override stage ${temporaryPath} differs from the pending command bytes`,
      );
    }
  };

  const applyPrepared = (claim: PreparedClaim): ExplorerWorkflowOverride => {
    const expectedText = documentText(claim.next);
    if (transitionState(claim) === "previous") {
      recoverStalePending(expectedText);
      try {
        fileOperations.writeExclusive(temporaryPath, expectedText);
      } catch (error) {
        if (textAt(temporaryPath) !== expectedText) {
          throw new ExplorerOverrideStateUncertainError(
            `Explorer override stage ${temporaryPath} was not created byte-exactly`,
            error,
          );
        }
      }
      try {
        fileOperations.syncPath(temporaryPath);
      } catch (error) {
        try {
          removeAndSyncDirectory(temporaryPath);
        } catch (cleanupError) {
          throw new ExplorerOverrideStateUncertainError(
            `Explorer override stage ${temporaryPath} failed to sync and could not be removed`,
            cleanupFailures(error, cleanupError, temporaryPath),
          );
        }
        throw error;
      }

      try {
        fileOperations.atomicReplace(temporaryPath, path);
      } catch (error) {
        const liveText = textAt(path);
        const stagedText = textAt(temporaryPath);
        if (liveText === expectedText) {
          if (stagedText !== undefined) {
            if (stagedText !== expectedText) {
              throw new ExplorerOverrideStateUncertainError(
                `Explorer override rename threw and left divergent live/staged bytes for ${path}`,
                error,
              );
            }
            try {
              removeAndSyncDirectory(temporaryPath);
            } catch (cleanupError) {
              throw new ExplorerOverrideStateUncertainError(
                `Explorer override rename landed but duplicate stage ${temporaryPath} could not be removed`,
                cleanupFailures(error, cleanupError, temporaryPath),
              );
            }
          }
        } else if (liveText === priorText(claim.previous) && stagedText === expectedText) {
          try {
            removeAndSyncDirectory(temporaryPath);
          } catch (cleanupError) {
            throw new ExplorerOverrideStateUncertainError(
              `Explorer override rename did not land and stage ${temporaryPath} could not be removed`,
              cleanupFailures(error, cleanupError, temporaryPath),
            );
          }
          throw error;
        } else {
          throw new ExplorerOverrideStateUncertainError(
            `Explorer override rename outcome is uncertain for ${path}; live/staged bytes prove neither prior nor next state`,
            error,
          );
        }
      }
    }

    // Exact next bytes can be the result of a rename whose directory fsync failed.
    // Replay repeats that durability barrier before either audit or finalization.
    try {
      fileOperations.syncPath(directory);
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override replacement for ${path} landed but its directory sync failed`,
        error,
      );
    }

    let readback: ExplorerOverrideDocument;
    try {
      readback = readDocument();
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override ${path} cannot be parsed after atomic replacement`,
        error,
      );
    }
    if (documentText(readback) !== expectedText) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override ${path} readback differs from the pending command's exact next document`,
      );
    }
    const persisted = readback.workflows.find(
      (entry) => String(entry.workflowId) === String(claim.command.target.workflowId),
    );
    if (persisted === undefined) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override ${String(claim.command.target.workflowId)} is absent from exact readback`,
      );
    }
    return persisted;
  };

  const acquire = (command: ExplorerEditApplyRequest): ExplorerOverrideClaim => {
    recoverClaimStage();
    const fingerprint = explorerEditCommandFingerprint(command);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = readClaim();
      if (existing === undefined) {
        const claim = ExplorerOverrideClaimSchema.parse({
          claimVersion: 2,
          pid: process.pid,
          state: "acquiring",
          command,
          commandFingerprint: fingerprint,
        });
        const claimText = `${canonicalJsonStringify(claim)}\n`;
        try {
          writeExclusiveClaim(claim);
          return claim;
        } catch (error) {
          const liveText = textAt(claimPath);
          if (liveText === undefined || liveText === claimText) throw error;
          continue;
        }
      }
      if (existing.state === "prepared") {
        transitionState(existing);
        if (sameCommand(existing.command, command)) return existing;
        if (existing.command.commandId === command.commandId) {
          throw new ExplorerOverrideDivergentCommandError(command.commandId);
        }
        throw new ExplorerOverridePendingError(
          String(existing.command.target.workflowId),
          existing.command.commandId,
        );
      }
      if (processIsAlive(existing.pid)) {
        throw new ExplorerOverrideBusyError(String(command.target.workflowId), existing.pid);
      }
      releaseClaim();
    }
    throw new ExplorerOverrideStateUncertainError(
      `Explorer override claim ${claimPath} could not be acquired after stale-claim recovery`,
    );
  };

  const prepare = (
    acquiring: Extract<ExplorerOverrideClaim, { state: "acquiring" }>,
    override: ExplorerWorkflowOverride,
  ): PreparedClaim => {
    const fileExisted = pathExists(path);
    const document = readDocument();
    const current = document.workflows.find(
      (entry) => String(entry.workflowId) === String(override.workflowId),
    );
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== acquiring.command.target.expectedOverrideRevision) {
      throw new ExplorerOverrideConflictError(
        String(override.workflowId),
        acquiring.command.target.expectedOverrideRevision,
        currentRevision,
      );
    }
    if (override.revision !== currentRevision + 1) {
      throw new Error(
        `Explorer override ${String(override.workflowId)} replacement revision must be `
        + `${String(currentRevision + 1)}, received ${String(override.revision)}`,
      );
    }
    const next = ExplorerOverrideDocumentSchema.parse({
      documentVersion: 1,
      workflows: [
        ...document.workflows.filter((entry) => String(entry.workflowId) !== String(override.workflowId)),
        override,
      ].sort((left, right) => String(left.workflowId).localeCompare(String(right.workflowId))),
    });
    const prepared = ExplorerOverrideClaimSchema.parse({
      ...acquiring,
      state: "prepared",
      previous: fileExisted ? { state: "present", document } : { state: "absent" },
      next,
    });
    if (prepared.state !== "prepared") throw new Error("Explorer prepared claim parsed as acquiring");
    persistPreparedClaim(acquiring, prepared);
    return prepared;
  };

  const finalize = (expected: PreparedClaim): void => {
    recoverClaimStage();
    const current = readClaim();
    if (current === undefined) {
      proveClaimAbsence();
      return;
    }
    if (current.state !== "prepared"
      || !sameCommand(current.command, expected.command)
      || canonicalJsonStringify(current) !== canonicalJsonStringify(expected)) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} changed before authority commit finalization`,
      );
    }
    if (transitionState(current) !== "next") {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} cannot finalize before its next bytes are live`,
      );
    }
    releaseClaim();
  };

  const reconcileAudit = (claim: PreparedClaim, requestInput: unknown, auditInput: unknown): void => {
    const request = ExplorerEditApplyRequestSchema.parse(requestInput);
    const audit = CommandAuditRecordSchema.parse(auditInput);
    if (!sameCommand(claim.command, request)) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer journal ${claim.command.commandId} does not preserve the pending complete command envelope`,
      );
    }
    if (audit.request.family !== "explorer" || !sameCommand(claim.command, audit.request)) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer audit ${audit.auditId} does not preserve the pending complete command envelope`,
      );
    }
    if (audit.affectedDependencyIds.length !== 0) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer audit ${audit.auditId} has nonempty affectedDependencyIds; Explorer edits must have no dependency effects`,
      );
    }
    const target = {
      family: "explorer" as const,
      workflowId: claim.command.target.workflowId,
      revision: claim.command.target.expectedOverrideRevision + 1,
    };
    const exactResult = audit.result.state === "applied"
      && audit.result.commandId === claim.command.commandId
      && audit.result.affectedTargets.length === 1
      && canonicalJsonStringify(audit.result.affectedTargets[0]) === canonicalJsonStringify(target);
    const exactVersions = audit.versionChanges.length === 1
      && canonicalJsonStringify(audit.versionChanges[0]) === canonicalJsonStringify({
        target,
        before: claim.command.target.expectedOverrideRevision,
        after: claim.command.target.expectedOverrideRevision + 1,
      });
    if (!exactResult || !exactVersions) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer audit ${audit.auditId} does not prove the pending override transition`,
      );
    }
  };

  return Object.freeze({
    read,
    readAll: () => deepFreeze(readDocument()).workflows,
    reconcilePending(
      input: ExplorerEditApplyRequest | undefined,
      findOutcome: (commandId: string) => Readonly<{
        request: CommandRequest | undefined;
        audit: CommandAuditRecord | undefined;
      }>,
    ): void {
      const command = input === undefined ? undefined : ExplorerEditApplyRequestSchema.parse(input);
      recoverClaimStage();
      const claim = readClaim();
      if (claim === undefined) {
        proveClaimAbsence();
        return;
      }
      if (claim.state === "acquiring") {
        if (processIsAlive(claim.pid)) {
          throw new ExplorerOverrideBusyError(String(claim.command.target.workflowId), claim.pid);
        }
        releaseClaim();
        return;
      }
      const state = transitionState(claim);
      const outcome = findOutcome(claim.command.commandId);
      if (outcome.request !== undefined || outcome.audit !== undefined) {
        if (outcome.request === undefined || outcome.audit === undefined) {
          throw new ExplorerOverrideStateUncertainError(
            `Explorer command ${claim.command.commandId} has a partial journal outcome`,
          );
        }
        reconcileAudit(claim, outcome.request, outcome.audit);
        if (state !== "next") {
          throw new ExplorerOverrideStateUncertainError(
            `Explorer command ${claim.command.commandId} is audited applied but its exact next bytes are not live`,
          );
        }
        // Recovery/replay must prove durable next bytes before removing the
        // only retained claim, even when the journal already says applied.
        applyPrepared(claim);
        releaseClaim();
        return;
      }
      if (command !== undefined && sameCommand(claim.command, command)) return;
      if (command !== undefined && claim.command.commandId === command.commandId) {
        throw new ExplorerOverrideDivergentCommandError(command.commandId);
      }
      throw new ExplorerOverridePendingError(
        String(claim.command.target.workflowId),
        claim.command.commandId,
      );
    },
    replace(input: ExplorerEditApplyRequest, rawOverride: ExplorerWorkflowOverride): ExplorerOverrideCommit {
      const command = ExplorerEditApplyRequestSchema.parse(input);
      const override = ExplorerWorkflowOverrideSchema.parse(rawOverride);
      const fingerprint = explorerEditCommandFingerprint(command);
      if (String(override.workflowId) !== String(command.target.workflowId)
        || override.descriptorVersion !== command.target.expectedVersion
        || override.contractFingerprint !== command.target.contractFingerprint
        || override.appliedCommandId !== command.commandId
        || override.commandFingerprint !== fingerprint) {
        throw new Error(
          `Explorer override ${String(override.workflowId)} does not bind the complete command envelope`,
        );
      }
      const acquired = acquire(command);
      let prepared: PreparedClaim;
      if (acquired.state === "prepared") {
        prepared = acquired;
      } else {
        try {
          prepared = prepare(acquired, override);
        } catch (error) {
          if (error instanceof ExplorerOverrideStateUncertainError) throw error;
          try {
            releaseClaim();
          } catch (releaseError) {
            throw new ExplorerOverrideStateUncertainError(
              `Explorer override preparation failed and its acquiring claim ${claimPath} could not be released`,
              cleanupFailures(error, releaseError, claimPath),
            );
          }
          throw error;
        }
      }
      const persisted = applyPrepared(prepared);
      if (canonicalJsonStringify(persisted) !== canonicalJsonStringify(override)) {
        throw new ExplorerOverrideStateUncertainError(
          `Explorer command ${command.commandId} read back different override bytes`,
        );
      }
      return Object.freeze({
        override: persisted,
        finalizeAfterCommit: () => finalize(prepared),
      });
    },
  });
}
