import { z } from "zod";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJsonStringify } from "../canonical-json.js";
import { FingerprintSchema } from "../ids.js";
import { deepFreeze } from "../immutability.js";
import { sha256Hex } from "../sha256.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "./protected-settings.js";
import { SETTINGS_SCHEMA_HASH } from "./settings.js";

export const SettingsDocumentTargetSchema = z.enum(["ordinary", "protected"]);
export type SettingsDocumentTarget = z.infer<typeof SettingsDocumentTargetSchema>;

export const SettingsRootPathsSchema = z.strictObject({
  root: z.string().min(1),
  ordinary: z.string().min(1),
  protected: z.string().min(1),
  authority: z.string().min(1),
  prepare: z.string().min(1),
  rollback: z.string().min(1),
  lock: z.string().min(1),
  reaper: z.string().min(1),
});
export type SettingsRootPaths = z.infer<typeof SettingsRootPathsSchema>;

function pathsAt(root: string): SettingsRootPaths {
  const lock = join(root, "settings.lock");
  return Object.freeze(SettingsRootPathsSchema.parse({
    root,
    ordinary: join(root, "settings.json"),
    protected: join(root, "protected.json"),
    authority: join(root, "authority.json"),
    prepare: join(root, "prepare.json"),
    rollback: join(root, "rollback.json"),
    lock,
    reaper: `${lock}.reaper`,
  }));
}

/** The only settings authority pathname: `<stateRoot>/settings/`. */
export function settingsRootPaths(stateRoot: string): SettingsRootPaths {
  return pathsAt(join(resolve(stateRoot), "settings"));
}

/** Compatibility adapter for callers that still pass the ordinary pathname. */
export function settingsRootPathsFromOrdinaryPath(path: string): SettingsRootPaths {
  const ordinary = resolve(path);
  if (basename(ordinary) !== "settings.json" || basename(dirname(ordinary)) !== "settings") {
    throw new Error("settings authority pathname must be <stateRoot>/settings/settings.json");
  }
  return pathsAt(dirname(ordinary));
}
const SettingsRootTupleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  settingsSchemaHash: FingerprintSchema,
  protectedSchemaHash: FingerprintSchema,
  ordinary: z.enum(["virgin", "initialized"]),
  protected: z.enum(["virgin", "initialized"]),
});
export const SettingsRootAuthoritySchema = SettingsRootTupleSchema.extend({
  rootFingerprint: FingerprintSchema,
}).superRefine((record, context) => {
  const tuple = SettingsRootTupleSchema.parse({
    schemaVersion: record.schemaVersion,
    settingsSchemaHash: record.settingsSchemaHash,
    protectedSchemaHash: record.protectedSchemaHash,
    ordinary: record.ordinary,
    protected: record.protected,
  });
  if (record.rootFingerprint !== sha256Hex(canonicalJsonStringify(tuple))) {
    context.addIssue({ code: "custom", path: ["rootFingerprint"], message: "authority.json tuple fingerprint mismatch" });
  }
  if (record.settingsSchemaHash !== SETTINGS_SCHEMA_HASH || record.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
    context.addIssue({ code: "custom", message: "authority.json schema-mismatch" });
  }
});
export type SettingsRootAuthority = z.infer<typeof SettingsRootAuthoritySchema>;

/** This identity binds only schema and initialization states, never either document's values. */
export function settingsRootAuthority(
  ordinary: SettingsRootAuthority["ordinary"],
  protectedState: SettingsRootAuthority["protected"],
): SettingsRootAuthority {
  const tuple = SettingsRootTupleSchema.parse({
    schemaVersion: 1,
    settingsSchemaHash: SETTINGS_SCHEMA_HASH,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    ordinary,
    protected: protectedState,
  });
  return deepFreeze(SettingsRootAuthoritySchema.parse({ ...tuple, rootFingerprint: sha256Hex(canonicalJsonStringify(tuple)) }));
}
