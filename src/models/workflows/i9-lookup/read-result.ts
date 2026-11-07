import { z } from "zod";
import { I9ReadSection2Signer, I9SignerOutputSchema } from "../../systems/i9/read-section2-signer.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";

export const ReadI9LookupResult = defineTaskContract({
  id: taskId("workflow:i9-lookup/read-result"), title: "Retain I-9 signer result", effect: "read",
  input: z.strictObject({ signer: I9SignerOutputSchema }), output: I9SignerOutputSchema,
  errorCodes: ["INCONSISTENT_INPUTS"],
  subject: { kind: "none", reason: "retains the declared I-9 signer task observation without another browser read" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" },
  provenance: { default: "derived" }, scenarios: [], example: I9ReadSection2Signer.example,
});
