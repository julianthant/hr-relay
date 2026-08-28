import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { deepFreeze } from "../../domain/immutability.js";
import {
  SettingsRuntimeIdentitySchema,
  SettingsRuntimeStatusSchema,
  type SettingsRuntimeIdentity,
  type SettingsRuntimeStatus,
} from "../../domain/config/settings.js";

const SettingsRuntimeGenerationRecordSchema = z.strictObject({
  protocolVersion: z.literal(1),
  identity: SettingsRuntimeIdentitySchema,
});

export interface SettingsRuntimeGeneration {
  /** Dashboard boot is the one activation edge for a newly resolved generation. */
  activate(identity: unknown): SettingsRuntimeIdentity;
  /** A worker may establish the never-run baseline, but may never replace it. */
  assertCurrentOrInitialize(identity: unknown, operation: string): SettingsRuntimeIdentity;
  assertCurrent(identity: unknown, operation: string): SettingsRuntimeIdentity;
  status(identity: unknown): SettingsRuntimeStatus;
}

export type { SettingsRuntimeIdentity, SettingsRuntimeStatus };

export interface SettingsRuntimeGenerationOptions {
  readonly path: string;
}

let temporarySequence = 0;

function isMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

function isExists(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST";
}

function syncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function sameIdentity(left: SettingsRuntimeIdentity, right: SettingsRuntimeIdentity): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function createSettingsRuntimeGeneration(
  options: SettingsRuntimeGenerationOptions,
): SettingsRuntimeGeneration {
  const path = options.path;

  function read(): SettingsRuntimeIdentity | undefined {
    let bytes: string;
    try {
      bytes = readFileSync(path, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(bytes);
    } catch (error) {
      throw new Error(`settings runtime generation ${path} is not valid JSON`, { cause: error });
    }
    try {
      return deepFreeze(SettingsRuntimeGenerationRecordSchema.parse(decoded).identity);
    } catch (error) {
      throw new Error(`settings runtime generation ${path} violates its strict identity contract`, {
        cause: error,
      });
    }
  }

  function stagedBytes(identity: SettingsRuntimeIdentity): Readonly<{ path: string; bytes: string }> {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true });
    temporarySequence += 1;
    const temporaryPath = join(
      directory,
      `.${basename(path)}.${String(process.pid)}.${String(temporarySequence)}.tmp`,
    );
    const bytes = `${canonicalJsonStringify({ protocolVersion: 1, identity })}\n`;
    try {
      writeFileSync(temporaryPath, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
      syncPath(temporaryPath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch (cleanupError) {
        if (!isMissing(cleanupError)) {
          throw new AggregateError(
            [error, cleanupError],
            `settings runtime generation staging and cleanup both failed for ${temporaryPath}`,
            { cause: cleanupError },
          );
        }
      }
      throw error;
    }
    return { path: temporaryPath, bytes };
  }

  function verify(identity: SettingsRuntimeIdentity): SettingsRuntimeIdentity {
    const observed = read();
    if (observed === undefined || !sameIdentity(observed, identity)) {
      throw new Error(`settings runtime generation ${path} readback differs from the exact activated identity`);
    }
    return observed;
  }

  function replace(identity: SettingsRuntimeIdentity): SettingsRuntimeIdentity {
    const staged = stagedBytes(identity);
    try {
      renameSync(staged.path, path);
      syncPath(dirname(path));
    } catch (error) {
      try {
        unlinkSync(staged.path);
      } catch (cleanupError) {
        if (!isMissing(cleanupError)) {
          throw new AggregateError(
            [error, cleanupError],
            `settings runtime generation replacement and cleanup both failed for ${path}`,
            { cause: cleanupError },
          );
        }
      }
      throw error;
    }
    return verify(identity);
  }

  function initialize(identity: SettingsRuntimeIdentity): SettingsRuntimeIdentity {
    const staged = stagedBytes(identity);
    try {
      linkSync(staged.path, path);
      syncPath(dirname(path));
    } catch (error) {
      if (!isExists(error)) {
        try {
          unlinkSync(staged.path);
        } catch (cleanupError) {
          if (!isMissing(cleanupError)) {
            throw new AggregateError(
              [error, cleanupError],
              `settings runtime generation initialization and cleanup both failed for ${path}`,
              { cause: cleanupError },
            );
          }
        }
        throw error;
      }
    }
    try {
      unlinkSync(staged.path);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return verify(identity);
  }

  function status(identityInput: unknown): SettingsRuntimeStatus {
    const persisted = SettingsRuntimeIdentitySchema.parse(identityInput);
    const active = read();
    if (active === undefined) {
      throw new Error(
        `settings runtime generation ${path} is absent; a runtime boot must activate or initialize it before work starts`,
      );
    }
    return sameIdentity(active, persisted)
      ? deepFreeze({ state: "current" as const, identity: persisted })
      : deepFreeze({ state: "restart-required" as const, active, persisted });
  }

  function assertCurrent(identityInput: unknown, operation: string): SettingsRuntimeIdentity {
    const observed = status(identityInput);
    if (observed.state === "current") return observed.identity;
    throw new Error(
      `${operation} refused because a full runtime restart is required: active settings revision `
      + `${String(observed.active.settingsRevision)} (${observed.active.configFingerprint}) differs from persisted `
      + `revision ${String(observed.persisted.settingsRevision)} (${observed.persisted.configFingerprint})`,
    );
  }

  return Object.freeze({
    activate(identityInput: unknown): SettingsRuntimeIdentity {
      const identity = SettingsRuntimeIdentitySchema.parse(identityInput);
      const active = read();
      if (active !== undefined && sameIdentity(active, identity)) return active;
      return replace(identity);
    },
    assertCurrentOrInitialize(identityInput: unknown, operation: string): SettingsRuntimeIdentity {
      const identity = SettingsRuntimeIdentitySchema.parse(identityInput);
      if (read() === undefined) initialize(identity);
      return assertCurrent(identity, operation);
    },
    assertCurrent,
    status,
  });
}
