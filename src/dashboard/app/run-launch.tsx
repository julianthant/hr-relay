import type { ComponentProps } from "react";
import { RunStartSurfaces } from "../surfaces/run-start.js";
import type { useRunLaunch } from "./run-launch-model.js";

/** Only this host couples launch dismissal to Intake takeover focus. */
export function RunLaunchHost({ controller, ...props }: Omit<ComponentProps<typeof RunStartSurfaces>, "open" | "onOpenChange" | "onCloseAutoFocus"> & {
  readonly controller: ReturnType<typeof useRunLaunch>;
}) {
  return <RunStartSurfaces {...props} open={controller.open} onOpenChange={controller.setOpen} onCloseAutoFocus={controller.closeFocus}
    onOpenIntake={(workflowId, sessionId) => { controller.handOffToIntake(); props.onOpenIntake?.(workflowId, sessionId); }} />;
}
