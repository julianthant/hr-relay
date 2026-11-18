import type { QueueSurfaceWire } from "../../queue/queue-model.js";

export type LogSelection = Readonly<{ row: QueueSurfaceWire; workflowLabel: string }>;
