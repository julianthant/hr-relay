import assert from "node:assert/strict";
import fs,{ chmodSync,mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it,vi } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { OrdinaryPathValidationError,validateOrdinaryPathChanges } from "../../../../src/backend/runs/commands/ordinary-path-validator.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import type { Config } from "../../../../src/models/config/schema.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "ordinary-paths-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const current = resolveConfigWithProvenance({}, hostConfigFacts({}),
    manualClock(new Date("2026-09-26T12:00:00.000Z"))).config;
  const previous: Config = { ...current, paths: {
    ...current.paths, stateRoot: join(root, "state"), artifactRoot: join(root, "state", "artifacts"),
    browserProfileRoot: join(root, "old-profile"), duoCredential: join(root, "old-duo.json"),
    duoExtensionDir: join(root, "old-extension"),
  } };
  return { root, previous, candidate: (paths: Partial<Config["paths"]>): Config => ({
    ...previous, paths: { ...previous.paths, ...paths },
  }) };
}

function refusal(work: () => void, key: string, reason: string) {
  assert.throws(work, (error: unknown) => error instanceof OrdinaryPathValidationError
    && error.key === key && error.reason === reason);
}

describe("ordinary browser paths", () => {
  it("requires fresh arbitrary profiles, permits a populated canonical reset, and exempts unchanged values", () => {
    const f = fixture();
    const fresh = join(f.root, "fresh");
    validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: fresh }), () => join(f.root, "default"));
    mkdirSync(fresh);
    chmodSync(fresh, 0o755);
    validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: fresh }), () => join(f.root, "default"));
    writeFileSync(join(fresh, "existing"), "synthetic");
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: fresh }),
      () => join(f.root, "default")), "paths.browserProfileRoot", "fresh-empty-profile-required");
    validateOrdinaryPathChanges(f.previous, f.previous, () => { throw new Error("default must stay unread"); });

    const defaultRoot = join(f.root, "default");
    mkdirSync(defaultRoot); writeFileSync(join(defaultRoot, "existing"), "synthetic");
    const reset = f.candidate({ browserProfileRoot: defaultRoot, duoCredential: join(defaultRoot, "duo-webauthn.json") });
    // Profile-only reset may keep the default Duo credential below the known installation profile.
    validateOrdinaryPathChanges({ ...f.previous, paths: { ...f.previous.paths, duoCredential: reset.paths.duoCredential } },
      reset, () => defaultRoot);
  });

  it("rejects writable, symlinked, overlapping, and nonempty arbitrary profile roots", () => {
    const f = fixture();
    const writable = join(f.root, "writable"); mkdirSync(writable, { mode: 0o777 }); chmodSync(writable, 0o777);
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: writable }),
      () => join(f.root, "default")), "paths.browserProfileRoot", "owned-nonwritable-directory-required");
    const link = join(f.root, "linked"); symlinkSync(f.root, link);
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: link }),
      () => join(f.root, "default")), "paths.browserProfileRoot", "regular-directory-required");
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: join(link, "child") }),
      () => join(f.root, "default")), "paths.browserProfileRoot", "symlink-ancestor");
    const unsafeParent = join(f.root, "unsafe-parent"); mkdirSync(unsafeParent); chmodSync(unsafeParent, 0o777);
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: join(unsafeParent, "child") }),
      () => join(f.root, "default")), "paths.browserProfileRoot", "unsafe-profile-parent");
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: f.previous.paths.stateRoot }),
      () => join(f.root, "default")), "paths.browserProfileRoot", "overlaps-runtime-location");
  });

  it("requires a private regular Duo file and a valid unpacked extension only when each effective path changes", () => {
    const f = fixture();
    const credential = join(f.root, "duo.json");
    writeFileSync(credential, '{"rpId":"synthetic.example","credentialId":"synthetic-id","privateKey":"synthetic-key","signCount":0,"transport":"internal"}', { mode: 0o600 });
    validateOrdinaryPathChanges(f.previous, f.candidate({ duoCredential: credential }));
    chmodSync(credential, 0o644);
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ duoCredential: credential })),
      "paths.duoCredential", "private-file-required");
    chmodSync(credential, 0o600);
    writeFileSync(credential, "invalid-json");
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ duoCredential: credential })),
      "paths.duoCredential", "credential-identity-unavailable");
    writeFileSync(credential, '{"rpId":"synthetic.example","credentialId":"synthetic-id","privateKey":"synthetic-key","signCount":0,"transport":"internal"}');
    const symlink = join(f.root, "duo-link.json"); symlinkSync(credential, symlink);
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ duoCredential: symlink })),
      "paths.duoCredential", "private-file-unavailable");
    const extension = join(f.root, "extension"); mkdirSync(extension);
    writeFileSync(join(extension, "workflow-manifest.json"), "{}");
    refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ duoExtensionDir: extension })),
      "paths.duoExtensionDir", "unpacked-manifest-required");
    writeFileSync(join(extension, "workflow-manifest.json"), '{"manifest_version":3,"name":"Synthetic Duo"}');
    validateOrdinaryPathChanges(f.previous, f.candidate({ duoExtensionDir: extension }));
  });
});

it("refuses a missing-profile probe with non-ENOENT failure", () => {
  const f = fixture(); const profile = join(f.root, "new-profile");
  validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: profile }), () => join(f.root, "default"));
  const original = fs.lstatSync;
  vi.spyOn(fs, "lstatSync").mockImplementation(((path: unknown, options: unknown) => {
    if (String(path) === profile) throw Object.assign(new Error("denied"), { code: "EACCES" });
    return original(path as string, options as never);
  })); syncBuiltinESMExports();
  refusal(() => validateOrdinaryPathChanges(f.previous, f.candidate({ browserProfileRoot: profile })), "paths.browserProfileRoot", "directory-unavailable");
});
