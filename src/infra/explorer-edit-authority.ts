/** Atomic file authority for the Explorer's versioned presentation overrides. */
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { canonicalJsonStringify } from "../domain/canonical-json.js";
import {
  ExplorerAppliedOverrideSchema,
  ExplorerEditAuthorityFileSchema,
  deriveExplorerAppliedRecordFingerprint,
  deriveExplorerEditFingerprint,
  type ExplorerAppliedOverride,
  type ExplorerEditAuthorityFile,
} from "../domain/dashboard/explorer-edit.js";

const EMPTY_AUTHORITY: ExplorerEditAuthorityFile = Object.freeze({ schemaVersion: 1, overrides: [] });

function syncPath(path: string): void {
  const handle = openSync(path, "r");
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

function canonicalBytes(file: ExplorerEditAuthorityFile): string {
  return `${canonicalJsonStringify(ExplorerEditAuthorityFileSchema.parse(file))}\n`;
}

export type ExplorerAuthorityCommit =
  | Readonly<{ state: "applied"; override: ExplorerAppliedOverride }>
  | Readonly<{ state: "conflict"; currentRevision: number }>;

export interface ExplorerEditAuthorityDurability {
  syncDirectory(path: string): void;
}

const FILESYSTEM_DURABILITY: ExplorerEditAuthorityDurability = Object.freeze({
  syncDirectory: syncPath,
});

export class ExplorerEditAuthority {
  readonly #path: string;
  readonly #durability: ExplorerEditAuthorityDurability;

  constructor(path: string, durability: ExplorerEditAuthorityDurability = FILESYSTEM_DURABILITY) {
    this.#path = path;
    this.#durability = durability;
  }

  readFile(): ExplorerEditAuthorityFile {
    if (!existsSync(this.#path)) return EMPTY_AUTHORITY;
    const bytes = readFileSync(this.#path, "utf8");
    let decoded: unknown;
    try {
      decoded = JSON.parse(bytes);
    } catch (error) {
      throw new Error(`Explorer edit authority ${this.#path} is not valid JSON`, { cause: error });
    }
    const parsed = ExplorerEditAuthorityFileSchema.parse(decoded);
    if (bytes !== canonicalBytes(parsed)) {
      throw new Error(`Explorer edit authority ${this.#path} is not canonical JSON`);
    }
    for (const override of parsed.overrides) {
      const { recordFingerprint, ...recordContent } = override;
      if (recordFingerprint !== deriveExplorerAppliedRecordFingerprint(recordContent)) {
        throw new Error(
          `Explorer edit authority ${this.#path} has an applied record fingerprint mismatch for ${String(override.workflowId)}`,
        );
      }
      const expected = deriveExplorerEditFingerprint({
        draftVersion: 1,
        workflowId: override.workflowId,
        baseDescriptorVersion: override.baseDescriptorVersion,
        baseContractFingerprint: override.baseContractFingerprint,
        baseOverrideRevision: override.revision - 1,
        changes: override.changes,
      });
      if (override.compiledFingerprint !== expected) {
        throw new Error(
          `Explorer edit authority ${this.#path} has a fingerprint mismatch for ${String(override.workflowId)}`,
        );
      }
    }
    return parsed;
  }

  read(workflowId: string): ExplorerAppliedOverride | undefined {
    return this.readFile().overrides.find((override) => String(override.workflowId) === workflowId);
  }

  /** Project one already-journaled override into the atomic file authority. */
  project(override: ExplorerAppliedOverride): ExplorerAuthorityCommit {
    ExplorerAppliedOverrideSchema.parse(override);
    const file = this.readFile();
    const index = file.overrides.findIndex(
      (candidate) => String(candidate.workflowId) === String(override.workflowId),
    );
    const current = index < 0 ? undefined : file.overrides[index];
    const currentRevision = current?.revision ?? 0;
    if (currentRevision === override.revision) {
      if (current === undefined || canonicalJsonStringify(current) !== canonicalJsonStringify(override)) {
        throw new Error(
          `Explorer projection revision ${String(override.revision)} for ${String(override.workflowId)} has divergent bytes`,
        );
      }
      this.#durability.syncDirectory(dirname(this.#path));
      return { state: "applied", override: current };
    }
    if (current !== undefined && currentRevision !== override.revision - 1) {
      return { state: "conflict", currentRevision };
    }
    const overrides = [...file.overrides];
    if (index < 0) overrides.push(override);
    else overrides[index] = override;
    overrides.sort((left, right) => String(left.workflowId).localeCompare(String(right.workflowId)));
    const next = ExplorerEditAuthorityFileSchema.parse({ schemaVersion: 1, overrides });
    this.#atomicReplace(next, String(override.commandId));
    return { state: "applied", override };
  }

  #atomicReplace(file: ExplorerEditAuthorityFile, commandId: string): void {
    const temporary = `${this.#path}.${commandId}.tmp`;
    let handle: number | undefined;
    let replaced = false;
    try {
      handle = openSync(temporary, "wx", 0o600);
      writeFileSync(handle, canonicalBytes(file), "utf8");
      fsyncSync(handle);
      closeSync(handle);
      handle = undefined;
      renameSync(temporary, this.#path);
      replaced = true;
      this.#durability.syncDirectory(dirname(this.#path));
    } catch (error) {
      if (handle !== undefined) closeSync(handle);
      if (!replaced && existsSync(temporary)) {
        try {
          unlinkSync(temporary);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `Explorer edit apply failed and could not clean ${temporary}`,
            { cause: cleanupError },
          );
        }
      }
      throw error;
    }
  }
}
