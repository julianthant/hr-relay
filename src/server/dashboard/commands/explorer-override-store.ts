/** Durable presentation-only Explorer overrides (D186 §5.4). */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
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
  reconcilePending(
    command: ExplorerEditApplyRequest,
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
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
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

function textAt(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
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
        || next.revision !== claim.command.target.expectedOverrideRevision + 1) {
        throw new ExplorerOverrideStateUncertainError(
          `Explorer override claim ${source} does not bind its next document to the complete command envelope`,
        );
      }
    }
    return claim;
  };

  const readClaim = (): ExplorerOverrideClaim | undefined => {
    const text = textAt(claimPath);
    return text === undefined ? undefined : parseClaimText(text, claimPath);
  };

  const releaseClaim = (): void => {
    if (!existsSync(claimPath)) return;
    try {
      removeAndSyncDirectory(claimPath);
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} could not be released durably`,
        error,
      );
    }
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
            new AggregateError([error, cleanupError]),
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
              "Explorer prepared claim landed but duplicate stage could not be removed",
              new AggregateError([error, cleanupError]),
            );
          }
        }
      } else if (liveText === beforeText && stagedText === preparedText) {
        try {
          removeAndSyncDirectory(claimTemporaryPath);
        } catch (cleanupError) {
          throw new ExplorerOverrideStateUncertainError(
            "Explorer prepared claim did not land and its stage could not be removed",
            new AggregateError([error, cleanupError]),
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
            new AggregateError([error, cleanupError]),
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
                new AggregateError([error, cleanupError]),
              );
            }
          }
        } else if (liveText === priorText(claim.previous) && stagedText === expectedText) {
          try {
            removeAndSyncDirectory(temporaryPath);
          } catch (cleanupError) {
            throw new ExplorerOverrideStateUncertainError(
              `Explorer override rename did not land and stage ${temporaryPath} could not be removed`,
              new AggregateError([error, cleanupError]),
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

      try {
        fileOperations.syncPath(directory);
      } catch (error) {
        throw new ExplorerOverrideStateUncertainError(
          `Explorer override replacement for ${path} landed but its directory sync failed`,
          error,
        );
      }
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
    const fileExisted = existsSync(path);
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
    if (current === undefined) return;
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
    reconcilePending(
      input: ExplorerEditApplyRequest,
      findOutcome: (commandId: string) => Readonly<{
        request: CommandRequest | undefined;
        audit: CommandAuditRecord | undefined;
      }>,
    ): void {
      const command = ExplorerEditApplyRequestSchema.parse(input);
      recoverClaimStage();
      const claim = readClaim();
      if (claim === undefined) return;
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
        releaseClaim();
        return;
      }
      if (sameCommand(claim.command, command)) return;
      if (claim.command.commandId === command.commandId) {
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
              "Explorer override preparation failed and its acquiring claim could not be released",
              new AggregateError([error, releaseError]),
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
