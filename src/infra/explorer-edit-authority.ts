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
  type ExplorerAppliedOverride,
  type ExplorerCompiledEdit,
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

export class ExplorerEditAuthority {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
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
    return parsed;
  }

  read(workflowId: string): ExplorerAppliedOverride | undefined {
    return this.readFile().overrides.find((override) => String(override.workflowId) === workflowId);
  }

  /**
   * The callback is intentionally inside the CAS window: the service validates
   * descriptor ownership once at ingress and again here, immediately before
   * bytes replace authority.
   */
  commit(
    compiled: ExplorerCompiledEdit,
    appliedAt: string,
    revalidate: () => void,
  ): ExplorerAuthorityCommit {
    const file = this.readFile();
    const index = file.overrides.findIndex(
      (override) => String(override.workflowId) === String(compiled.draft.workflowId),
    );
    const current = index < 0 ? undefined : file.overrides[index];
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== compiled.draft.baseOverrideRevision) {
      return { state: "conflict", currentRevision };
    }
    revalidate();
    const override = ExplorerAppliedOverrideSchema.parse({
      recordVersion: 1,
      workflowId: compiled.draft.workflowId,
      revision: currentRevision + 1,
      baseDescriptorVersion: compiled.draft.baseDescriptorVersion,
      baseContractFingerprint: compiled.draft.baseContractFingerprint,
      compiledFingerprint: compiled.compiledFingerprint,
      changes: compiled.draft.changes,
      commandId: compiled.commandId,
      appliedAt,
    });
    const overrides = [...file.overrides];
    if (index < 0) overrides.push(override);
    else overrides[index] = override;
    overrides.sort((left, right) => String(left.workflowId).localeCompare(String(right.workflowId)));
    const next = ExplorerEditAuthorityFileSchema.parse({ schemaVersion: 1, overrides });
    this.#atomicReplace(next, String(compiled.commandId));
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
      syncPath(dirname(this.#path));
    } catch (error) {
      if (handle !== undefined) closeSync(handle);
      if (!replaced && existsSync(temporary)) {
        try {
          unlinkSync(temporary);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Explorer edit apply failed and could not clean ${temporary}`);
        }
      }
      throw error;
    }
  }
}
