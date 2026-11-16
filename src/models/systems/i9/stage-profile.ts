import { defineTaskContract, ContractFieldPathSchema } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { I9ProfileTargetSchema, I9CreationStagingSchema, I9_PROFILE_SUBJECT, I9_PROFILE_STAGED } from "../../ui/i9-creation.js";

export const I9StageProfile = defineTaskContract({
  id: taskId("i9/stage-profile"), title: "Fill I-9 profile", effect: "prepare",
  input: I9ProfileTargetSchema, output: I9CreationStagingSchema.refine(value => value.stagedPageState === I9_PROFILE_STAGED), errorCodes: ["I9_WRITE_REFUSED"],
  subject: { kind: "person", expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: I9_PROFILE_SUBJECT, match: "normalized-exact-name", requiredAt: "after-prepare-before-fence" },
  checkpoint: "in-memory-only", scenarios: ["onboarding/write-transactions"],
  example: { stagedPageState: I9_PROFILE_STAGED, observedName: "Fixture Hire" },
});
