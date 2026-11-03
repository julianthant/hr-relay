import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { ReadWorkbookReference, WorkbookReferenceFactsSchema } from "../../processing/workbooks/read-reference.js";
import { I9CheckCanonicalInput } from "../i9-check/input.js";
import { I9CheckStartCanonicalInput, I9_CHECK_START_EXAMPLE } from "../i9-check/start.js";
import { I9_CHECK_BATCH_TASK_POLICY, I9_CHECK_PERSON_EXAMPLE, I9_CHECK_REFERENCE_EXAMPLE, I9CheckPeopleSchema } from "../i9-check/batch.js";

export const ReadI9CheckRequests = defineTaskContract({
  ...I9_CHECK_BATCH_TASK_POLICY, id: taskId("workflow:i9-check-start/read-requests"), title: "Bind the selected roster rows",
  input: z.strictObject({ request: I9CheckStartCanonicalInput, people: I9CheckPeopleSchema, reference: ReadWorkbookReference.output }),
  output: z.strictObject({ people: I9CheckPeopleSchema.shape.people, children: z.array(I9CheckCanonicalInput).min(1), reference: WorkbookReferenceFactsSchema }),
  example: { people: [I9_CHECK_PERSON_EXAMPLE], reference: I9_CHECK_REFERENCE_EXAMPLE, children: [{
    asOf: I9_CHECK_START_EXAMPLE.asOf, reviewerName: I9_CHECK_START_EXAMPLE.reviewerName,
    ocrRunId: I9_CHECK_PERSON_EXAMPLE.ocrRunId, recordId: I9_CHECK_PERSON_EXAMPLE.recordId, person: I9_CHECK_PERSON_EXAMPLE.person, roster: { rows: [] },
  }] },
});
