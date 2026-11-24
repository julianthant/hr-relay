import { expect, it, vi } from "vitest";
import { withHeadlessCopySignin } from "../../../scripts/profiles/headless-copy-signin.js";

const seams = vi.hoisted(() => ({
  release: vi.fn(), close: vi.fn(async () => undefined),
  readRegistry: vi.fn(), launchDashboard: vi.fn(), launchBrowser: vi.fn(),
}));

vi.mock(import("../../../scripts/profiles/copy-signin.js"), async importOriginal => ({
  ...await importOriginal(), assertCopySigninTarget: vi.fn(),
}));
vi.mock("../../../src/backend/storage/admission/lifetime-lock.js", () => ({
  acquireRuntimeLifetimeLock: async () => ({ close: seams.close }),
}));
vi.mock("../../../src/backend/storage/admission/bootstrap-admission.js", () => ({
  acquireEntrypointAdmission: () => ({ readProfileRegistry: seams.readRegistry, release: seams.release }),
}));
vi.mock(import("node:child_process"), async importOriginal => ({ ...await importOriginal(), spawn: seams.launchDashboard }));
vi.mock("../../../src/backend/runtime/browser/native-browser.js", () => ({ DEFAULT_BROWSER_LAUNCHER: { launch: seams.launchBrowser } }));

it.each([
  { profiles: [], activeProfileId: null },
  { profiles: [{ profileId: "synthetic", lifecycle: "ready", credentialState: "saved", duoState: "pending" }], activeProfileId: "synthetic" },
])("refuses enrollment before starting the dashboard or opening a browser", async registry => {
  seams.readRegistry.mockReturnValue(registry);
  const useSession = vi.fn(async () => undefined);
  await expect(withHeadlessCopySignin(useSession)).rejects.toThrow("copy-signin-headless-enrollment-required");
  expect(seams.launchDashboard).not.toHaveBeenCalled();
  expect(seams.launchBrowser).not.toHaveBeenCalled();
  expect(useSession).not.toHaveBeenCalled();
  expect(seams.release).toHaveBeenCalled();
  expect(seams.close).toHaveBeenCalled();
});
