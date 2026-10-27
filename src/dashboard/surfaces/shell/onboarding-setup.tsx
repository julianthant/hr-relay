import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { useEffect, useState } from "react";
import { Check, Fingerprint, KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "../../ds/ui.js";
import { duoSummary, useMockDuoSetup, useServedDuoSetup, type DuoConfirmationScope, type ServedOnboardingPort } from "./onboarding-model.js";
import "./onboarding-setup.css";

export function OnboardingSetup({ page, port }: { page: "fast" | "duo"; port?: ServedOnboardingPort }) {
  const mock = useMockDuoSetup(port === undefined);
  const served = useServedDuoSetup(port);
  const setup = port === undefined ? mock : served;
  const [confirmation, setConfirmation] = useState<DuoConfirmationScope | "mock">();
  const confirming = confirmation === "mock" ? port === undefined : confirmation !== undefined && served.matchesConfirmation(confirmation);
  useEffect(() => { if (confirmation !== undefined && !confirming) setConfirmation(undefined); }, [confirmation, confirming]);
  const dismissConfirmation = () => {
    if (typeof confirmation === "object") served.dismissConfirmation(confirmation);
    setConfirmation(undefined);
  };
  const duo = page === "duo";
  const both = setup.methods.key && setup.methods.touch;
  const methods = [["key", "Security key"], ["touch", "Touch ID on this Mac"]] as const;
  const icon = (method: "key" | "touch") => setup.methods[method] ? <Check className="icon" /> : method === "key" ? <KeyRound className="icon" /> : <Fingerprint className="icon" />;
  return <div className={`hub-duo-setup ${duo ? "duo-page" : "fast-page"}`} data-source={port?.source ?? "mock"}>
    <a tabIndex={0} href="#setup-main" className="skip-link">Skip to setup</a>
    <header className="setup-brand">{!duo && <svg aria-hidden width="32" height="32" viewBox="0 0 128 128"><rect width="128" height="128" rx="34" fill="var(--hub-fast-duo-brand)" /><path fill="var(--hub-fast-duo-ink)" fillRule="evenodd" d="M53 47a25 25 0 1 0 0 50 25 25 0 0 0 0-50Zm0 14a11 11 0 1 1 0 22 11 11 0 0 1 0-22Z" /><rect x="67" y="28" width="14" height="69" rx="7" fill="var(--hub-fast-duo-ink)" /><circle cx="96" cy="90" r="7" fill="var(--hub-fast-duo-ink)" /></svg>}<strong>{duo ? "UC San Diego" : "Fast Duo"}<small>{duo ? "Duo device management" : "Relay setup"}</small></strong><span>{duo ? "duo.ucsd.edu" : "Onboarding 1"} · UI mock</span></header>
    <main id="setup-main"><header className="page-heading"><h1>{duo ? "Manage your devices" : "Set up Duo for Relay"}</h1><p>{duo ? "Add your security key and Touch ID for Relay." : "Confirm a security key and Touch ID in your Duo device-management tab."}</p></header>
      {duo ? <><div className="device-list">{methods.map(([method, label]) => <section className="device-row" key={method}><div><strong>{icon(method)}{label}</strong><p>{setup.methods[method] ? "Ready for Relay" : "Not added"}</p></div><button tabIndex={0} className={`btn ${setup.methods[method] ? "" : "primary"}`} disabled={!setup.connected || setup.methods[method] || port !== undefined && (port.onboarding?.methods[method].state === "unknown" || port.onboarding?.methods[method].state === "unavailable")} onClick={async () => {
        setup.setMethod(method);
        if (!port) { setConfirmation("mock"); return; }
        const scope = await served.start(method);
        if (scope) setConfirmation(scope);
      }}>{setup.methods[method] ? "Added" : method === "key" ? "Add security key" : "Add Touch ID"}</button></section>)}</div><p className="readiness">{setup.unavailable ? operatorFailureSentence("PROFILE_AUTHORITY_UNAVAILABLE") : duoSummary(setup.methods)}</p><footer className="setup-footer"><p>{both ? "Both devices are added. Continue in Relay." : "Fast Duo stays open in its own tab."}</p><button tabIndex={0} className="btn" onClick={setup.returnToParent}>Show Fast Duo</button></footer></> : <><div className="setup-grid"><section aria-label="Your sign-in methods"><ul className="method-list">{methods.map(([method, label]) => <li key={method}>{icon(method)}<div><strong>{label}</strong><small>{setup.methods[method] ? "Ready for Relay" : "Not added"}</small></div></li>)}</ul><p className="readiness">{setup.unavailable ? operatorFailureSentence("PROFILE_AUTHORITY_UNAVAILABLE") : duoSummary(setup.methods)}</p></section><section className="setup-task"><h2>{both ? "Both methods are ready" : setup.unavailable ? "Reconnect your Duo tab" : setup.listening ? "Waiting for Duo…" : `Add ${setup.method === "key" ? "a security key" : "Touch ID"}`}</h2><p>{both ? "Return to Relay to finish your profile." : setup.listening ? "In Duo, select the matching device and confirm that it was added." : "Open Duo, approve with an existing method, then choose Other options → Manage devices."}</p>{!both && <><div className="field"><label htmlFor="device-type">Device type</label><select disabled={port !== undefined && setup.listening} id="device-type" value={setup.method} onChange={event => { setup.cancel(); setup.setMethod(event.target.value as "key" | "touch"); }}>{methods.map(([method, label]) => <option key={method} value={method} disabled={setup.methods[method]}>{label}</option>)}</select></div><div className="action-row"><button tabIndex={0} className="btn" disabled={!setup.connected} onClick={() => setup.open(false)}>Open duo.ucsd.edu</button><button tabIndex={0} className="btn primary" disabled={!setup.connected} onClick={() => setup.listening ? setup.cancel() : setup.open(true)}>{setup.listening ? "Cancel capture" : "Start capture"}</button></div></>}<p className="status-line" role="status">{!setup.connected ? "Setup is unavailable. Open this tab from Relay." : setup.unavailable ? "The Duo tab is unavailable. Reopen it to continue." : setup.listening ? "Listening for the selected device." : both ? "Security key and Touch ID ready" : "Capture alone does not mean the device is added."}</p></section></div><footer className="setup-footer"><p>UI mock. No credentials are created or sent.</p><div className="action-row"><button tabIndex={0} className="btn" onClick={() => window.close()}>Close setup tab</button><button tabIndex={0} className="btn primary" onClick={setup.returnToParent}>Return to Relay</button></div></footer></>}
    </main><span className="sr-only" role="status">{duoSummary(setup.methods)}</span>
    <Dialog open={confirming} onOpenChange={open => { if (!open) dismissConfirmation(); }}><DialogContent hideClose className="hub-duo-dialog" title={(typeof confirmation === "object" ? confirmation.method : setup.method) === "key" ? "Add security key?" : "Add Touch ID?"} description="Simulate the device capture, then confirm Duo’s successful addition."><DialogFooter><button tabIndex={0} className="btn" onClick={dismissConfirmation}>Cancel</button><button tabIndex={0} className="btn primary" onClick={() => {
        if (confirmation === "mock" && !port) mock.confirm();
        else if (typeof confirmation === "object") served.confirm(confirmation);
        dismissConfirmation();
      }}>Confirm device added</button></DialogFooter></DialogContent></Dialog>
  </div>;
}
