import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { OcrApprovedSnapshotSchema } from "../../ocr/review.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { OcrApprovalReferenceSchema } from "../../workflows/ocr/result.js";
import { policy,snapshot } from "./approved-snapshot.js";
export const ReadApprovedOcrSnapshot = defineTaskContract({ ...policy,
  // Scopes the members delegate, whose admission ages it on the wall clock; each member re-authenticates its own record.
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, id: taskId("ocr/read-approved-snapshot"),
  title: "Read approved OCR snapshot", input: OcrApprovalReferenceSchema,
  output: z.strictObject({ snapshot: OcrApprovedSnapshotSchema }), example: { snapshot } });
