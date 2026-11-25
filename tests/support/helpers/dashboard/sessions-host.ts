import { createElement, Fragment, type ComponentProps } from "react";
import { SessionPanel as Console, SessionsProvider } from "../../../../src/dashboard/surfaces/sessions/session-panel.js";
import { SessionRailControls } from "../../../../src/dashboard/surfaces/sessions/session-rail-controls.js";

type HostProps = Omit<ComponentProps<typeof SessionsProvider>, "children"> & ComponentProps<typeof Console>;

/** The sidebar controls and the console inside the provider that reads the workers, as the dashboard composes them. */
export function SessionPanel({ open, onOpenChange, ...provider }: HostProps) {
  return createElement(SessionsProvider, { ...provider, children: createElement(Fragment, null, createElement(SessionRailControls, { open, onOpenChange }), createElement(Console, { open, onOpenChange })) });
}
