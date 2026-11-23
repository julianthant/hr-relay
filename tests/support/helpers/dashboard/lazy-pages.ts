import { act } from "react";

/** Lets React finish rendering the dashboard pages loaded with `lazy()` before a test reads them. */
export async function loadLazyPages(): Promise<void> {
  await act(async () => {
    await Promise.all([
      import("../../../../src/dashboard/surfaces/settings/settings.js"),
      import("../../../../src/dashboard/surfaces/activity/activity.js"),
      import("../../../../src/dashboard/surfaces/explorer/explorer.js"),
      import("../../../../src/dashboard/surfaces/shell/assistant-panel.js"),
    ]);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
