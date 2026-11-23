/** The dashboard's theme root and providers around one story, as `DashboardApp` nests them. */
import type { ReactNode } from "react";
import { useHubMotion } from "../../../../../../src/dashboard/ds/theme/motion.js";
import { ToastProvider, TooltipProvider } from "../../../../../../src/dashboard/ds/ui.js";
import { PersonPreferencesContext } from "../../../../../../src/dashboard/lib/person-preferences.js";
import { createPersonPreferences } from "../../../../../../src/dashboard/state/person-preferences-model.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../../../../src/models/config/person-preferences.js";

const PREFERENCES = createPersonPreferences("preview", { ...NEUTRAL_PERSON_PREFERENCES, theme: "dark", animations: false });

function ThemeRoot({ children }: { children: ReactNode }) {
  useHubMotion();
  return <div data-app-root="" data-demo-theme="dark"
    className="flex h-screen min-h-[var(--ds-h-desktop-min)] min-w-[var(--ds-w-desktop-min)] flex-col overflow-hidden bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]">
    <TooltipProvider delayDuration={200}><ToastProvider>
      <div className="dashboard-shell relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="dashboard-workspace relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </ToastProvider></TooltipProvider>
  </div>;
}

export function StoryFrame({ children }: { children: ReactNode }) {
  return <PersonPreferencesContext.Provider value={PREFERENCES}><ThemeRoot>{children}</ThemeRoot></PersonPreferencesContext.Provider>;
}
