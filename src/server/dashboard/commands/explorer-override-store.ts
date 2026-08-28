/** Durable presentation-only Explorer overrides (D186 §5.4). */
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
  ExplorerOverrideDocumentSchema,
  ExplorerWorkflowOverrideSchema,
  type ExplorerOverrideDocument,
  type ExplorerWorkflowOverride,
} from "../../../domain/dashboard/explorer.js";
import { CommandIdSchema, WorkflowIdSchema } from "../../../domain/ids.js";

export interface ExplorerOverrideRepository {
  read(workflowId: string): ExplorerWorkflowOverride | undefined;
  replace(expectedRevision: number, override: ExplorerWorkflowOverride): ExplorerWorkflowOverride;
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

const ExplorerOverrideClaimSchema = z.strictObject({
  claimVersion: z.literal(1),
  pid: z.number().int().positive(),
  workflowId: WorkflowIdSchema,
  commandId: CommandIdSchema,
});

function emptyDocument(): ExplorerOverrideDocument {
  return ExplorerOverrideDocumentSchema.parse({ documentVersion: 1, workflows: [] });
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    if (code === "ESRCH") return false;
    throw error;
  }
}

function textAt(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function createExplorerOverrideStore(
  path: string,
  fileOperations: ExplorerOverrideFileOperations = REAL_FILE_OPERATIONS,
): ExplorerOverrideRepository {
  const directory = dirname(path);
  const temporaryPath = `${path}.pending`;
  const claimPath = `${path}.claim`;
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

  const acquireClaim = (override: ExplorerWorkflowOverride): void => {
    const claim = ExplorerOverrideClaimSchema.parse({
      claimVersion: 1,
      pid: process.pid,
      workflowId: override.workflowId,
      commandId: override.appliedCommandId,
    });
    const claimText = `${canonicalJsonStringify(claim)}\n`;
    let acquired = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fileOperations.writeExclusive(claimPath, claimText);
        acquired = true;
      } catch (error) {
        const existingText = textAt(claimPath);
        if (existingText === undefined) throw error;
        let existing: z.infer<typeof ExplorerOverrideClaimSchema>;
        try {
          existing = ExplorerOverrideClaimSchema.parse(JSON.parse(existingText));
        } catch (claimError) {
          throw new ExplorerOverrideStateUncertainError(
            `Explorer override claim ${claimPath} is malformed; refusing to replace authority`,
            claimError,
          );
        }
        if (processIsAlive(existing.pid)) {
          throw new ExplorerOverrideBusyError(String(override.workflowId), existing.pid);
        }
        try {
          removeAndSyncDirectory(claimPath);
        } catch (cleanupError) {
          throw new ExplorerOverrideStateUncertainError(
            `stale Explorer override claim ${claimPath} could not be removed durably`,
            cleanupError,
          );
        }
        continue;
      }
      break;
    }
    if (!acquired || textAt(claimPath) !== claimText) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} was not read back byte-exactly`,
      );
    }
    try {
      fileOperations.syncPath(claimPath);
      fileOperations.syncPath(directory);
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} could not be made durable`,
        error,
      );
    }
  };

  const recoverStalePending = (): void => {
    if (!existsSync(temporaryPath)) return;
    try {
      removeAndSyncDirectory(temporaryPath);
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `stale Explorer override stage ${temporaryPath} could not be removed durably`,
        error,
      );
    }
  };

  const releaseClaim = (): void => {
    try {
      removeAndSyncDirectory(claimPath);
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override claim ${claimPath} could not be released durably`,
        error,
      );
    }
  };

  const replaceUnderClaim = (
    expectedRevision: number,
    override: ExplorerWorkflowOverride,
  ): ExplorerWorkflowOverride => {
    recoverStalePending();
    const previousText = textAt(path);
    const document = readDocument();
    const current = document.workflows.find(
      (entry) => String(entry.workflowId) === String(override.workflowId),
    );
    if (current?.appliedCommandId === override.appliedCommandId) {
      if (canonicalJsonStringify(current) === canonicalJsonStringify(override)) return current;
      throw new ExplorerOverrideStateUncertainError(
        `Explorer command ${override.appliedCommandId} is already present with different override bytes`,
      );
    }
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expectedRevision) {
      throw new ExplorerOverrideConflictError(String(override.workflowId), expectedRevision, currentRevision);
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
    const expectedText = `${canonicalJsonStringify(next)}\n`;

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
      } else if (liveText === previousText && stagedText === expectedText) {
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
    let readback: ExplorerOverrideDocument;
    try {
      readback = readDocument();
    } catch (error) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override ${path} cannot be parsed after atomic replacement`,
        error,
      );
    }
    if (`${canonicalJsonStringify(readback)}\n` !== expectedText) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override ${path} readback differs from the atomically replaced document`,
      );
    }
    const persisted = readback.workflows.find(
      (entry) => String(entry.workflowId) === String(override.workflowId),
    );
    if (persisted === undefined) {
      throw new ExplorerOverrideStateUncertainError(
        `Explorer override ${String(override.workflowId)} is absent from exact readback`,
      );
    }
    return persisted;
  };

  return Object.freeze({
    read,
    replace(expectedRevision: number, input: ExplorerWorkflowOverride): ExplorerWorkflowOverride {
      const override = ExplorerWorkflowOverrideSchema.parse(input);
      acquireClaim(override);
      let result: ExplorerWorkflowOverride | undefined;
      let primary: unknown;
      try {
        result = replaceUnderClaim(expectedRevision, override);
      } catch (error) {
        primary = error;
      }
      if (primary instanceof ExplorerOverrideStateUncertainError) throw primary;
      try {
        releaseClaim();
      } catch (releaseError) {
        throw new ExplorerOverrideStateUncertainError(
          `Explorer override replacement for ${String(override.workflowId)} cannot prove claim release`,
          primary === undefined ? releaseError : new AggregateError([primary, releaseError]),
        );
      }
      if (primary !== undefined) throw primary;
      if (result === undefined) {
        throw new Error(`Explorer override ${String(override.workflowId)} replacement returned no readback`);
      }
      return result;
    },
  });
}
