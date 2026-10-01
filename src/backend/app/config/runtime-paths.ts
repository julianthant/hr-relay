/**
 * The filesystem defaults behind `ConfigSchema.paths` — SERVER ONLY (ref clock-config-secrets §4,
 * D115/D116).
 *
 * This module exists because the config CONTRACT is browser-reachable and its
 * path DEFAULTS cannot be. `src/domain/commands.ts` imports
 * `SettingsOverrideSchema` from `./schema.ts`, and the dashboard bundle imports
 * commands, so `./schema.ts` is evaluated in the browser. A static
 * `import … from "node:path"` there is fatal on its own: Vite's dev server
 * replaces the module with a proxy that THROWS on the very first property read,
 * so the named-import binding kills the bundle at module-evaluation time —
 * before any default could even be materialized. Making the defaults lazy is
 * therefore not enough; the import itself has to be gone.
 *
 * Splitting it here is also the honest layering. A path default is a RUNTIME
 * concern by definition: it only exists by resolving a repo-relative literal
 * against a process working directory. A browser has neither, and must never
 * invent one — a fabricated `browserProfileRoot` would point Duo credential
 * reads and artifact writes at a plausible-but-wrong location, which is exactly
 * the silent-wrong-value failure this program forbids. The only caller is
 * `./resolve.ts`, the one `env > settings.json > default` resolver.
 *
 * The values are byte-identical to what the runtime resolved before the split.
 */
import { join, resolve } from "node:path";
import { rebuildRuntimeIsolation } from "../../../config/runtime-isolation.js";
import { ConfigPathsSchema, type ConfigPaths } from "../../../domain/config/schema.js";

/**
 * The rebuild's own Chromium profile root, absolute.
 *
 * The runtime-isolation contract states the root as a repo-relative literal
 * (`.auth`, since D216) because that is what the operational-isolation audit reads
 * as text on both sides. A RUNTIME path may never be that literal: a worker or
 * daemon started from any other working directory would otherwise resolve a
 * different, empty profile root and silently re-authenticate — or, worse, write
 * a second credential home. It is resolved exactly once per process, on first
 * use, so every consumer receives an absolute path and `paths.browserProfileRoot`
 * can be redirected (settings override) without any consumer re-deriving it.
 */
let browserProfileRootMemo: string | undefined;

export function defaultBrowserProfileRoot(): string {
  browserProfileRootMemo ??= resolve(rebuildRuntimeIsolation.browserProfileRoot);
  return browserProfileRootMemo;
}

/** Parsed, not asserted: a default that failed to resolve absolute fails loud here. */
export function defaultRuntimePaths(): ConfigPaths {
  const profileRoot = defaultBrowserProfileRoot();
  return ConfigPathsSchema.parse({
    reportsDir: resolve("data/reports"),
    downloadsDir: resolve("data/downloads"),
    onboardingDocsDir: resolve("data/onboarding"),
    i9CheckTrackerPath: resolve("data/reports/i9-check-tracker.xlsx"),
    stateRoot: resolve(".tracker"),
    artifactRoot: resolve(".tracker/artifacts"),
    browserProfileRoot: profileRoot,
    duoCredential: join(profileRoot, "duo-webauthn.json"),
    duoExtensionDir: resolve("duo-autopilot"),
  });
}
