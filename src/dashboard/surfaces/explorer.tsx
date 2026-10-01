import { useMemo, useState } from "react";
import { ExplorerTimeline } from "./explorer/explorer-flow.js";
import { buildExplorerPreview, EXPLORER_PREVIEW_TITLE, previewFieldSource } from "./explorer/explorer-fixture.js";
import { DEFAULT_SCENARIO, type PreviewScenario } from "./explorer/explorer-flow-model.js";

/** Local presentation producer; the registered-definition UI has been retired. */
export function WorkflowExplorer({ onVersionRegistry }: { onVersionRegistry: () => void }) {
  const [scenario, setScenario] = useState<PreviewScenario>(DEFAULT_SCENARIO);
  const steps = useMemo(() => buildExplorerPreview(scenario), [scenario]);
  return <ExplorerTimeline title={EXPLORER_PREVIEW_TITLE} steps={steps} scenario={scenario} onScenario={setScenario}
    sourceFor={(field, step) => previewFieldSource(field.source ?? "", step, scenario)}
    onVersionRegistry={onVersionRegistry} />;
}
