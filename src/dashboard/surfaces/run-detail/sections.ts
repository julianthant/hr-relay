import type { z } from "zod";
import type { RunDetailSectionResponseSchema } from "../../../domain/dashboard/run-detail.js";
import type { ContextSections } from "./context-rail-model.js";
import type { IdentityGatePayload } from "./identity/identity-ceremony.js";
import type { ParkedWritePayload } from "./resolution/park-resolve.js";
import type { ReceiptSectionPayload } from "./failure/receipt.js";
import type { NotePage } from "./logs-model.js";

export type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
export type RunDetailSectionName = RunDetailSectionResponse["section"];

export interface PanelSections extends ContextSections {
  logs?: NotePage;
  receipt?: ReceiptSectionPayload;
  failure?: Extract<RunDetailSectionResponse, { section: "failure" }>['payload'];
  "parked-write"?: ParkedWritePayload;
  "identity-gate"?: IdentityGatePayload;
}
