import assert from "node:assert/strict";
import { win32 } from "node:path";
import { it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { defaultRuntimePaths } from "../../../src/backend/app/config/runtime-paths.js";
import { AbsolutePathSchema, ConfigPathsSchema } from "../../../src/models/config/schema.js";

const CHECKOUT = "D:\\a\\hr-relay\\hr-relay";

it("accepts the Windows paths default runtime resolution produces and rejects relative and drive-relative paths", () => {
  const stateRoot = win32.resolve(CHECKOUT, rebuildRuntimeIsolation.stateRoot);
  const parsed = ConfigPathsSchema.parse({
    reportsDir: win32.resolve(CHECKOUT, "data/reports"),
    downloadsDir: win32.resolve(CHECKOUT, "data/downloads"),
    onboardingDocsDir: win32.resolve(CHECKOUT, "data/onboarding"),
    i9CheckTrackerPath: win32.resolve(CHECKOUT, "data/reports/i9-check-tracker.xlsx"),
    stateRoot,
    artifactRoot: win32.resolve(CHECKOUT, rebuildRuntimeIsolation.artifactRoot),
    browserProfileRoot: win32.resolve(CHECKOUT, rebuildRuntimeIsolation.browserProfileRoot),
    duoCredential: win32.join(stateRoot, "credentials", "duo-webauthn.json"),
    duoExtensionDir: win32.resolve(CHECKOUT, "duo-autopilot"),
  });
  assert.equal(parsed.reportsDir, "D:\\a\\hr-relay\\hr-relay\\data\\reports");
  assert.equal(parsed.duoCredential, "D:\\a\\hr-relay\\hr-relay\\.tracker\\data\\credentials\\duo-webauthn.json");
  assert.equal(AbsolutePathSchema.parse("/tmp/hrt"), "/tmp/hrt");
  assert.equal(AbsolutePathSchema.parse("\\\\server\\share\\data"), "\\\\server\\share\\data");
  const current = defaultRuntimePaths();
  assert.deepEqual(ConfigPathsSchema.parse(current), current);
  for (const path of ["data/reports", "D:foo", "D:", "\\a\\hr-relay", "\\\\"]) {
    assert.throws(() => AbsolutePathSchema.parse(path), /path must be absolute/);
  }
});
