import { useToasts } from "../ds/ui.js";
import type { ComponentProps } from "react";
import { RunStartSurfaces } from "../surfaces/run-start.js";
import type { useRunLaunch } from "./run-launch-model.js";

/** Only this host couples launch dismissal to Intake takeover focus. */
export function RunLaunchHost({ controller, ...props }: Omit<ComponentProps<typeof RunStartSurfaces>, "open" | "onOpenChange" | "onCloseAutoFocus"> & {
  readonly controller: ReturnType<typeof useRunLaunch>;
}) {
  const { toast } = useToasts();
  return <RunStartSurfaces {...props} rerunSource={controller.rerunSource} open={controller.open} onOpenChange={controller.setOpen} onCloseAutoFocus={controller.closeFocus}
    onApplied={(workflowId, count) => {
      toast({ tone: "success", title: count === undefined ? "Run submission confirmed" : controller.rerunSource ? "Rerun started" : count === 1 ? "Run started" : `${count} runs started`, description: props.workflows.find(workflow => workflow.workflowId === workflowId)?.label ?? workflowId });
      props.onApplied?.(workflowId, count);
    }}
    onOpenIntake={(workflowId, sessionId) => { controller.handOffToIntake(); props.onOpenIntake?.(workflowId, sessionId); }} />;
}
