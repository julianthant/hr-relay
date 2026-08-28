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
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import {
  ExplorerOverrideDocumentSchema,
  ExplorerWorkflowOverrideSchema,
  type ExplorerOverrideDocument,
  type ExplorerWorkflowOverride,
} from "../../../domain/dashboard/explorer.js";

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
  writeExclusive: (path, text) => writeFileSync(path, text, { encoding: "utf8", mode: 0o600, flag: "wx" }),
  syncPath,
  atomicReplace: renameSync,
  remove: unlinkSync,
});

function emptyDocument(): ExplorerOverrideDocument {
  return ExplorerOverrideDocumentSchema.parse({ documentVersion: 1, workflows: [] });
}

export function createExplorerOverrideStore(
  path: string,
  fileOperations: ExplorerOverrideFileOperations = REAL_FILE_OPERATIONS,
): ExplorerOverrideRepository {
  const directory = dirname(path);
  const temporaryPath = `${path}.pending`;
  mkdirSync(directory, { recursive: true });

  const readDocument = (): ExplorerOverrideDocument => {
    if (!existsSync(path)) return emptyDocument();
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    return ExplorerOverrideDocumentSchema.parse(raw);
  };

  const read = (workflowId: string): ExplorerWorkflowOverride | undefined =>
    readDocument().workflows.find((entry) => String(entry.workflowId) === workflowId);

  return Object.freeze({
    read,
    replace(expectedRevision: number, input: ExplorerWorkflowOverride): ExplorerWorkflowOverride {
      const override = ExplorerWorkflowOverrideSchema.parse(input);
      const document = readDocument();
      const current = document.workflows.find(
        (entry) => String(entry.workflowId) === String(override.workflowId),
      );
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
      let temporaryCreated = false;
      try {
        fileOperations.writeExclusive(temporaryPath, expectedText);
        temporaryCreated = true;
        fileOperations.syncPath(temporaryPath);
        fileOperations.atomicReplace(temporaryPath, path);
        temporaryCreated = false;
        fileOperations.syncPath(directory);
      } catch (primary) {
        if (!temporaryCreated) throw primary;
        try {
          fileOperations.remove(temporaryPath);
        } catch (cleanup) {
          throw new AggregateError([primary, cleanup], `Explorer override write and staged cleanup both failed for ${path}`);
        }
        throw primary;
      }
      const readback = readDocument();
      if (canonicalJsonStringify(readback) !== canonicalJsonStringify(next)) {
        throw new Error(`Explorer override ${path} readback differs from the atomically replaced document`);
      }
      const persisted = readback.workflows.find(
        (entry) => String(entry.workflowId) === String(override.workflowId),
      );
      if (persisted === undefined) {
        throw new Error(`Explorer override ${String(override.workflowId)} is absent from exact readback`);
      }
      return persisted;
    },
  });
}
