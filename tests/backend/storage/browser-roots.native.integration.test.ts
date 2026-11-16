import { it } from "vitest";
import { runBrowserRootUnknownHandoffCase, runCredentialSourceRetentionCase } from "../../support/helpers/credential-source-retention.js";

it("reacquires and releases full Chromium twice under genuine held registry authority in an owned child", async () => {
  await runCredentialSourceRetentionCase("browser-root-native-success");
});

for (const scenario of ["browser-root-busy", "browser-root-close-unproved", "browser-root-stage-close",
  "browser-root-observed-publication", "browser-root-rm-refusal"] as const)
  it(`retains exact browser custody at the reached ${scenario} boundary until actual owned child close`, async () => {
    await runCredentialSourceRetentionCase(scenario);
  });


it("refuses an unknown predecessor under a genuinely new lease after actual owned source child close", async () => {
  await runBrowserRootUnknownHandoffCase();
});
