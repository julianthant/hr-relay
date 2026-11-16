import { useState } from "react";
import { DsBodyScope, PageHeading, TooltipProvider, dsText, useDemoTheme } from "../../../../../src/dashboard/ds/ui.js";
import { DuoSignupSteps } from "../../../../../src/dashboard/surfaces/shell/onboarding-setup.js";

export function ControlPreview() {
  const { theme } = useDemoTheme();
  const params = new URLSearchParams(location.search);
  const scenario = params.get("state");
  const [enrolling, setEnrolling] = useState<"key" | "touch">();
  const [phase, setPhase] = useState<"finishing" | "cancelling">();
  const touch = scenario === "touch-complete" || scenario === "both-complete" || scenario === "finishing" || scenario === "unknown" || scenario === "pending" ? "complete" : enrolling === "touch" ? "pending" : "idle";
  const key = scenario === "both-complete" || scenario === "finishing" ? "complete" : scenario === "unknown" ? "unknown" : scenario === "unavailable" ? "unavailable" : scenario === "pending" || enrolling === "key" ? "pending" : "idle";
  return <div data-app-root data-demo-theme={theme} className="min-h-screen min-w-[1024px] bg-ui-canvas text-ui-primary"><TooltipProvider><DsBodyScope style={{ maxWidth: "none" }}><div className={`${dsText.display} font-semibold`} style={{ padding: "32px 40px 0" }}>Relay</div><main style={{ maxWidth: 760, margin: "72px auto 0", display: "grid", gridTemplateColumns: "150px minmax(0,1fr)", gap: 40 }}><nav aria-label="Sign-up steps" className="flex flex-col gap-[var(--ds-space-section)] border-r border-ui-stroke pr-4 text-ui-muted"><span>✓{"\u3000"}Your details</span><span className="font-semibold text-ui-primary">2{"\u3000"}Duo setup</span><span>3{"\u3000"}Ready</span></nav><div className="flex flex-col gap-[var(--ds-space-section)]"><PageHeading title="Add your sign-in methods" description="Add both in the setup browser, in either order." />
    <DuoSignupSteps methods={{ key, touch }} platformAuthenticator={scenario === "virtual" || params.get("platform") === "virtual" ? "virtual" : "hardware"} state={phase ?? (scenario === "finishing" || scenario === "cancelling" ? scenario : "enrolling")} onEnroll={setEnrolling} onFinish={() => setPhase("finishing")} onCancel={() => setPhase("cancelling")} onShowSetup={() => { document.documentElement.dataset.setupBrowserShown = "true"; }} />
  </div></main></DsBodyScope></TooltipProvider></div>;
}
