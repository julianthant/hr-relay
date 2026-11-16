import { declareDriverFor } from "../../../workflow-kit/task-registry.js";
import type { OnbaseDriver } from "../../../models/ui/onbase.js";

export const onbaseDriver = declareDriverFor<OnbaseDriver>()("onbase", "semantic-ready");
