import { useToasts } from "../../ds/ui.js";
import { useCallback, type ComponentProps } from "react";
import { RunStartSurfaces } from "./run-start.js";
import type { useRunLaunch } from "./run-launch-model.js";

/** Only this host couples launch dismissal to Intake takeover focus. */
export function RunLaunchHost({ controller, onPreviewClose, ...props }: Omit<ComponentProps<typeof RunStartSurfaces>, "open" | "onOpenChange" | "onCloseAutoFocus"> & {
  readonly controller: ReturnType<typeof useRunLaunch>;
  readonly onPreviewClose?: () => void;
}) {
  const { toast } = useToasts();
  const setOpen = controller.setOpen;
  const changeOpen = useCallback((open: boolean) => { setOpen(open); if (!open) onPreviewClose?.(); }, [setOpen, onPreviewClose]);
  return <RunStartSurfaces {...props} rerunSource={props.previewLaunch ? undefined : controller.rerunSource} rerunInputText={props.previewLaunch ? undefined : controller.rerunInputText} open={controller.open || props.previewLaunch !== undefined} onOpenChange={changeOpen} onCloseAutoFocus={controller.closeFocus}
    onApplied={(workflowId, count) => {
      toast({ tone: "success", title: count === undefined ? "Run submission confirmed" : !props.previewLaunch && controller.rerunSource ? "Rerun started" : count === 1 ? "Run started" : `${count} runs started`, description: props.catalog.find(workflow => workflow.id === workflowId)?.label ?? workflowId });
      props.onApplied?.(workflowId, count);
    }}
    onOpenIntake={(workflowId, sessionId) => { controller.handOffToIntake(); props.onOpenIntake?.(workflowId, sessionId); }} />;
}
