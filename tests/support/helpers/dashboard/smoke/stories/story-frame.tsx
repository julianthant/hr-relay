/** The dashboard's theme root and providers around one story, as `DashboardApp` nests them. */
import { useLayoutEffect, type ReactNode } from "react";
import { useHubMotion } from "../../../../../../src/dashboard/ds/theme/motion.js";
import { DEMO_THEME_ATTR, ToastProvider, TooltipProvider } from "../../../../../../src/dashboard/ds/ui.js";
import { OperatorLabelContext } from "../../../../../../src/dashboard/state/operator-label.js";
import { PersonPreferencesContext } from "../../../../../../src/dashboard/lib/person-preferences.js";
import { createPersonPreferences } from "../../../../../../src/dashboard/state/person-preferences-model.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../../../../src/models/config/person-preferences.js";

const STILL = createPersonPreferences("preview", { ...NEUTRAL_PERSON_PREFERENCES, theme: "dark", animations: false });
const ANIMATED = createPersonPreferences("preview", { ...NEUTRAL_PERSON_PREFERENCES, theme: "dark", animations: true });

function ThemeRoot({ children, theme }: { children: ReactNode; theme: "dark" | "light" }) {
  useHubMotion();
  // Page-level tokens resolve on html and body, which the app themes too.
  useLayoutEffect(() => { for (const node of [document.documentElement, document.body]) node.setAttribute(DEMO_THEME_ATTR, theme); }, [theme]);
  return <div data-app-root="" data-demo-theme={theme}
    className="flex h-screen min-h-[var(--ds-h-desktop-min)] min-w-[var(--ds-w-desktop-min)] flex-col overflow-hidden bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]">
    <TooltipProvider delayDuration={200}><ToastProvider hold>
      <div className="dashboard-shell relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="dashboard-workspace relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </ToastProvider></TooltipProvider>
  </div>;
}

/** `animated` is for a check of motion itself; every other story holds still. */
export function StoryFrame({ children, animated = false, theme = "dark" }: { children: ReactNode; animated?: boolean; theme?: "dark" | "light" }) {
  return <PersonPreferencesContext.Provider value={animated ? ANIMATED : STILL}><OperatorLabelContext.Provider value="Sam Rivera"><ThemeRoot theme={theme}>{children}</ThemeRoot></OperatorLabelContext.Provider></PersonPreferencesContext.Provider>;
}
