import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { initialProtectedStoreRecord } from "../../../src/domain/config/protected-settings.js";
import { initialSettingsFileRecord } from "../../../src/domain/config/settings.js";
import {
  settingsRootAuthority,
  settingsRootPaths,
  type SettingsRootPaths,
} from "../../../src/infra/compat/d331-settings-root.js";

/** Synthetic-only baseline for tests whose subject is backup/recovery rather than settings writes. */
export function initializeSyntheticSettingsBackupRoot(stateRoot: string): SettingsRootPaths {
  const paths = settingsRootPaths(stateRoot);
  const existing = [paths.ordinary, paths.protected, paths.authority].map(existsSync);
  if (existing.every(Boolean)) return paths;
  if (existing.some(Boolean)) throw new Error("synthetic settings backup root is partially initialized");
  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  writeFileSync(paths.ordinary, `${canonicalJsonStringify(initialSettingsFileRecord())}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(paths.protected, `${canonicalJsonStringify(initialProtectedStoreRecord())}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(paths.authority, `${canonicalJsonStringify(settingsRootAuthority("initialized", "initialized"))}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return paths;
}
