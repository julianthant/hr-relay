import { it } from "vitest";
import { verifyRetainedDelegatedPreviewEvidence } from "../../../support/helpers/backend/retained-delegated-preview-evidence.js";

it("serves persisted predecessor parent and child preview receipts and Logs after reopen without changing linked digests", () => verifyRetainedDelegatedPreviewEvidence());
