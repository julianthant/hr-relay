import { declareDriverFor } from "../../../workflow-kit/task-registry.js";
import type { I9Driver } from "../../../models/ui/i9.js";

export const i9Driver = declareDriverFor<I9Driver>()("i9", "semantic-ready");
