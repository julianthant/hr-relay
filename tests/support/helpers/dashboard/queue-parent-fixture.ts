import type { z } from "zod";
import { QueueParentWireSchema } from "../../../../src/models/dashboard/projection.js";

export function queueParentFixture(runId: string, overrides: Partial<Omit<z.input<typeof QueueParentWireSchema>, "runId">> = {}) {
  return QueueParentWireSchema.parse({ runId, visibility: "inline", workflowId: "person-lookup", label: "Person lookup",
    title: "Parent run", partitionDay: "2026-07-31", panelKind: "group", status: "running", ...overrides });
}
