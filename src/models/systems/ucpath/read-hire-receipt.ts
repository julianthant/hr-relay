import { z } from "zod";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { UcpathHireQuerySchema, UcpathHireProofSchema, UCPATH_HIRE_PROOF_EXAMPLE } from "../../ui/ucpath-hire.js";
import { UCPATH_HIRE_READ_CONTRACT } from "./hire-contract.js";
import { UcpathTransactionReceiptSchema } from "../../ui/ucpath-ss-smart-hr.js";

export const UcpathReadHireReceipt = defineTaskContract({ ...UCPATH_HIRE_READ_CONTRACT, id: taskId("ucpath/read-hire-receipt"), title: "Read the current hire receipt",
  input: z.strictObject({ query: UcpathHireQuerySchema, transactionId: UcpathTransactionReceiptSchema }), output: UcpathHireProofSchema,
  errorCodes: ["UCPATH_HIRE_REFUSED", "BROWSER_SCREENSHOT_CAPTURE_FAILED"], example: UCPATH_HIRE_PROOF_EXAMPLE });
