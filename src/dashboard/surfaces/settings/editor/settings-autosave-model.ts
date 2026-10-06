import type { FocusEvent } from "react";

export function blurredSettingsPath(event: FocusEvent<HTMLElement>): string | undefined {
  if (!(event.target instanceof HTMLElement) || !event.target.matches('input, textarea, [role="spinbutton"]')) return undefined;
  const field = event.target.closest<HTMLElement>("[data-settings-path]");
  if (field === null || (event.relatedTarget instanceof Node && field.contains(event.relatedTarget))) return undefined;
  return field.dataset.settingsPath;
}
