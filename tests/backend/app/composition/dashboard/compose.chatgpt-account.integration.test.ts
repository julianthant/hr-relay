import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import * as accounts from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { ChatGptSignInStartSchema } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { installationAdmission, releaseAdmissionFixture } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";

for (const startupFailure of [false, true]) it(`closes pending account completion before HTTP drain during ${startupFailure ? "startup unwind" : "shutdown"}`, async () => {
  const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "wb08-compose-")));
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(join(process.cwd(), file), join(repoRoot, file));
  const f = chatGptFixture();
  let accountClosed = false, httpClosed = false;
  const factory = vi.spyOn(accounts, "createChatGptAccountService").mockReturnValue({ ...f.service, close: async () => { await f.service.close(); accountClosed = true; } });
  const primary = new Error("synthetic post-listen failure");
  try {
    const composed = composeDashboardRuntime({ admission: installationAdmission(repoRoot), repoRoot, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {},
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      httpServerStarter: async ({ app }) => {
        const started = ChatGptSignInStartSchema.parse(await (await app.request("http://127.0.0.1/api/v1/settings/chatgpt-account/sign-in", {
          method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ usePlan: true }),
        })).json());
        const completion = app.request(`/api/v1/settings/chatgpt-account/sign-in/${started.attemptId}`);
        return { get port() { if (startupFailure) throw primary; return 12345; }, close: async () => {
          assert.equal(accountClosed, true);
          const response = await completion;
          assert.equal((await response.json() as { code: string }).code, "CHATGPT_AUTH_CANCELLED");
          httpClosed = true;
        } };
      } });
    if (startupFailure) await assert.rejects(composed, error => error === primary);
    else await (await composed).stop();
    assert.equal(httpClosed, true);
    assert.equal(factory.mock.calls[0]?.[0].stateRoot, join(repoRoot, rebuildRuntimeIsolation.stateRoot));
  } finally { factory.mockRestore(); await f.cleanup(); releaseAdmissionFixture(repoRoot); rmSync(repoRoot, { recursive: true, force: true }); }
});
