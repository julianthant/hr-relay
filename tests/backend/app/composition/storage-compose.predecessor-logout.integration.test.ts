import { it } from "vitest";
import { runLogoutSettlementCase } from "../../../support/helpers/credential-source-retention.js";

for (const boundary of ["collision", "prepared", "after-commit", "ready", "unlink", "third-image", "key-replacement", "unknown"] as const)
  it(`retains predecessor logout identity and claimed-run custody at ${boundary} through real startup and authorized settlement`, async () => {
    await runLogoutSettlementCase(boundary, true);
  });
