import { RunDetailSectionResponseSchema } from "../../../../src/domain/dashboard/run-detail.js";
import type { RunDetailSectionResponse } from "../../../../src/domain/dashboard/run-detail.js";

export function sectionResponse(value: unknown): RunDetailSectionResponse {
  return RunDetailSectionResponseSchema.parse(value);
}
