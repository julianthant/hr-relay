import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { ReadApprovedOcrRecords } from "../../processing/ocr/read-approved-records.js";
import { I9CheckStartCanonicalInput } from "../i9-check/start.js";
import { I9_CHECK_BATCH_TASK_POLICY, I9_CHECK_PERSON_EXAMPLE, I9CheckPeopleSchema } from "../i9-check/batch.js";

export const ReadI9CheckPeople = defineTaskContract({
  ...I9_CHECK_BATCH_TASK_POLICY, id: taskId("workflow:i9-check-start/read-people"), title: "Group approved I-9 sections by person",
  input: z.strictObject({ request: I9CheckStartCanonicalInput, selection: ReadApprovedOcrRecords.output }),
  output: I9CheckPeopleSchema, example: { people: [I9_CHECK_PERSON_EXAMPLE] },
});
