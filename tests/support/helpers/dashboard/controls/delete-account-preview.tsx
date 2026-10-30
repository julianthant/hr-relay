import { useState } from "react";
import { Banner, Button, DsBodyScope, PageHeading, TooltipProvider, dsText, useDemoTheme } from "../../../../../src/dashboard/ds/ui.js";
import { DeleteAccountControl } from "../../../../../src/dashboard/surfaces/settings/general/ui-settings-records-general-paths.js";
import type { DeleteAccountPresentation } from "../../../../../src/dashboard/surfaces/settings/general/delete-account-model.js";

export function ControlPreview() {
  const { theme } = useDemoTheme();
  const [state, setState] = useState<DeleteAccountPresentation["state"] | "closure-blocked">("ready");
  const presentation: DeleteAccountPresentation = state === "ready"
    ? { state, personName: "Example Operator", onConfirm: () => setState("deleting") }
    : state === "closure-blocked" ? { state: "blocked", personName: "Example Operator", reason: "closure-unproved" }
    : state === "blocked" ? { state, personName: "Example Operator", reason: "unresolved-write" }
    : state === "deleting" ? { state, personName: "Example Operator" } : { state };
  return <div data-app-root data-demo-theme={theme}><TooltipProvider><DsBodyScope><main className={`ds-body-stack ${dsText.body}`} style={{ margin: "0 auto", maxWidth: 800, padding: "var(--ds-space-section)" }}>
    <Banner tone="info" title="UI mock">No account data is read or erased.</Banner>
    <PageHeading title="General" description="Settings · Personal" />
    <DeleteAccountControl presentation={presentation} />
    <div className="flex gap-2" aria-label="Mock state">{(["ready", "blocked", "closure-blocked", "deleting", "unavailable"] as const).map(value => <Button key={value} variant="muted" onClick={() => setState(value)}>Show {value}</Button>)}</div>
  </main></DsBodyScope></TooltipProvider></div>;
}
