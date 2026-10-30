import { useState } from "react";
import { Banner, Button, DsBodyScope, PageHeading, TooltipProvider, dsText, useDemoTheme } from "../../../../../src/dashboard/ds/ui.js";
import { DuoSignupSteps } from "../../../../../src/dashboard/surfaces/shell/onboarding-setup.js";
export function ControlPreview() {
  const { theme } = useDemoTheme();
  const [methods, setMethods] = useState<Record<"key" | "touch", "idle" | "pending" | "complete" | "unknown" | "unavailable">>({ key: "idle", touch: "idle" });
  const [state, setState] = useState<"enrolling" | "finishing" | "cancelling">("enrolling");
  const [platform, setPlatform] = useState<"hardware" | "virtual">("hardware");
  return <div data-app-root data-demo-theme={theme}><TooltipProvider><DsBodyScope><main className={`ds-body-stack ${dsText.body}`} style={{ margin: "0 auto", maxWidth: 900, padding: "var(--ds-space-section)" }}>
    <Banner tone="info" title="UI mock">No Duo enrollment, credential creation, or account publication occurs.</Banner><PageHeading title="Set up Duo" description="Sign-up · Two required methods" />
    <DuoSignupSteps methods={methods} platformAuthenticator={platform} state={state} onEnroll={method => setMethods({ ...methods, [method]: "pending" })} onFinish={() => setState("finishing")} onCancel={() => setState("cancelling")} />
    <div className="flex flex-wrap gap-2"><Button variant="muted" onClick={() => setMethods({ key: "idle", touch: "complete" })}>Verify mock Touch ID</Button><Button variant="muted" onClick={() => setMethods({ key: "complete", touch: "complete" })}>Verify mock both</Button><Button variant="muted" onClick={() => setMethods({ key: "unknown", touch: "complete" })}>Show unknown</Button><Button variant="muted" onClick={() => setMethods({ key: "unavailable", touch: "idle" })}>Show unavailable</Button><Button variant="muted" onClick={() => setPlatform("virtual")}>Show virtual platform</Button><Button variant="muted" onClick={() => { setState("enrolling"); setMethods({ key: "idle", touch: "idle" }); }}>Reset mock</Button></div>
  </main></DsBodyScope></TooltipProvider></div>;
}
