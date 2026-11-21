import { useToasts } from "../../ds/ui.js";
import type { ComponentProps } from "react";
import { RunStartSurfaces } from "./run-start.js";
import { runLaunchAppliedToast, type useRunLaunch } from "./run-launch-model.js";

/** Only this host couples launch dismissal to Intake takeover focus. */
export function RunLaunchHost({ controller, onOpenRun, ...props }: Omit<ComponentProps<typeof RunStartSurfaces>, "open" | "onOpenChange" | "onCloseAutoFocus"> & {
  readonly controller: ReturnType<typeof useRunLaunch>;
  /** Opens a started run's Logs. */
  readonly onOpenRun?: (runId: string) => void;
}) {
  const { toast } = useToasts();
  const setOpen = controller.setOpen;
    return <RunStartSurfaces {...props} rerunSource={controller.rerunSource} rerunInputText={controller.rerunInputText} open={controller.open} onOpenChange={setOpen} onCloseAutoFocus={controller.closeFocus}
    onApplied={(workflowId, count, runId) => {
      toast({ ...runLaunchAppliedToast({ label: props.catalog.find(workflow => workflow.id === workflowId)?.label ?? workflowId,
        count, rerun: controller.rerunSource !== undefined }),
        ...(runId === undefined || onOpenRun === undefined ? {} : { action: { label: "Open run", onClick: () => onOpenRun(runId) } }) });
      props.onApplied?.(workflowId, count, runId);
    }}
    onOpenIntake={(workflowId, sessionId) => { controller.handOffToIntake(); props.onOpenIntake?.(workflowId, sessionId); }} />;
}
