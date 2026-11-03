import { defineTaskContract, ContractFieldPathSchema } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { I9RemoteTargetSchema, I9CreationStagingSchema, I9_PROFILE_SUBJECT, I9_REMOTE_STAGED } from "../../ui/i9-creation.js";

export const I9StageRemoteRecord = defineTaskContract({
  id: taskId("i9/stage-remote-record"), title: "Fill remote I-9 record", effect: "prepare",
  input: I9RemoteTargetSchema, output: I9CreationStagingSchema.refine(value => value.stagedPageState === I9_REMOTE_STAGED), errorCodes: ["I9_WRITE_REFUSED"],
  subject: { kind: "person", expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: I9_PROFILE_SUBJECT, match: "normalized-exact-name", requiredAt: "after-prepare-before-fence" },
  checkpoint: "in-memory-only", scenarios: ["onboarding/write-transactions"],
  example: { stagedPageState: I9_REMOTE_STAGED, observedName: "Fixture Hire" },
});
