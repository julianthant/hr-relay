import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { OcrApprovedSnapshotSchema } from "../../ocr/review.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { OcrApprovalReferenceSchema } from "../../workflows/ocr/result.js";
import { policy,snapshot } from "./approved-snapshot.js";
export const ReadApprovedOcrSnapshot = defineTaskContract({ ...policy, id: taskId("ocr/read-approved-snapshot"),
  title: "Read approved OCR snapshot", input: OcrApprovalReferenceSchema,
  output: z.strictObject({ snapshot: OcrApprovedSnapshotSchema }), example: { snapshot } });
