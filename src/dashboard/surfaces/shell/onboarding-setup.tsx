import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { useEffect, useState } from "react";
import { Check, Fingerprint, KeyRound } from "lucide-react";
import { Badge, Button, Dialog, DialogContent, DialogFooter } from "../../ds/ui.js";
import { duoMethodLabels, duoMethodPresentation, duoSummary, useMockDuoSetup, useServedDuoSetup, type DuoConfirmationScope, type ServedOnboardingPort } from "./onboarding-model.js";
import { DuoMethodPill } from "./onboarding.js";
import "./onboarding-setup.css";

export function OnboardingSetup({ page, port }: { page: "fast" | "duo"; port?: ServedOnboardingPort }) {
  const mock = useMockDuoSetup(port === undefined);
  const served = useServedDuoSetup(port);
  const setup = port === undefined ? mock : served;
  const draft = port?.onboarding;
  const methodState = draft?.methods[setup.method].state;
  const failedMethod = methodState === "unknown" || methodState === "unavailable";
  const summary = duoSummary(setup.methods, draft);
  const readiness = setup.unavailable && !failedMethod ? operatorFailureSentence("PROFILE_AUTHORITY_UNAVAILABLE") : summary;
  const [confirmation, setConfirmation] = useState<DuoConfirmationScope | "mock">();
  const confirming = confirmation === "mock" ? port === undefined : confirmation !== undefined && served.matchesConfirmation(confirmation);
  useEffect(() => { if (confirmation !== undefined && !confirming) setConfirmation(undefined); }, [confirmation, confirming]);
  const dismissConfirmation = () => {
    if (typeof confirmation === "object") served.dismissConfirmation(confirmation);
    setConfirmation(undefined);
  };
  const duo = page === "duo";
  const both = setup.methods.key && setup.methods.touch;
  const methods = [["key", "Security key"], ["touch", "Touch ID"]] as const;
  const selectionDisabled = setup.listening || draft !== undefined && Object.values(draft.methods).some(method => method.state === "pending");
  const selectMethod = (method: "key" | "touch") => { setup.cancel(); setup.setMethod(method); };
  const icon = (method: "key" | "touch") => setup.methods[method] ? <Check className="icon" /> : method === "key" ? <KeyRound className="icon" /> : <Fingerprint className="icon" />;
  return <div className={`hub-duo-setup ${duo ? "duo-page" : "fast-page"}`} data-source={port?.source ?? "mock"}>
    <a tabIndex={0} href="#setup-main" className="skip-link">Skip to setup</a>
    <header className="setup-brand">{!duo && <svg aria-hidden width="32" height="32" viewBox="0 0 128 128"><rect width="128" height="128" rx="34" fill="var(--hub-fast-duo-brand)" /><path fill="var(--hub-fast-duo-ink)" fillRule="evenodd" d="M53 47a25 25 0 1 0 0 50 25 25 0 0 0 0-50Zm0 14a11 11 0 1 1 0 22 11 11 0 0 1 0-22Z" /><rect x="67" y="28" width="14" height="69" rx="7" fill="var(--hub-fast-duo-ink)" /><circle cx="96" cy="90" r="7" fill="var(--hub-fast-duo-ink)" /></svg>}<strong>{duo ? "UC San Diego" : "Fast Duo"}<small>{duo ? "Duo device management" : "Relay setup"}</small></strong><span>{duo ? "duo.ucpath.edu" : "Onboarding 1"} · {port ? "Relay setup" : "UI mock"}</span></header>
    <main id="setup-main"><header className="page-heading"><h1>{duo ? "Manage your devices" : "Set up Duo for Relay"}</h1><p>{draft ? "Review your sign-in methods in your Duo device-management tab." : duo ? "Add your security key and Touch ID for Relay." : "Confirm a security key and Touch ID in your Duo device-management tab."}</p></header>
      {duo ? <><div className="device-list">{methods.map(([method, label]) => <section className="device-row" key={method}><div><strong>{icon(method)}{label}</strong><p>{draft ? duoMethodLabels[draft.methods[method].state] : setup.methods[method] ? "Ready for Relay" : "Not added"}</p></div><button tabIndex={0} className={`btn ${setup.methods[method] ? "" : "primary"}`} disabled={!setup.connected || setup.methods[method] || port !== undefined && (port.onboarding?.methods[method].state === "unknown" || port.onboarding?.methods[method].state === "unavailable")} onClick={async () => {
        setup.setMethod(method);
        if (!port) { setConfirmation("mock"); return; }
        const scope = await served.start(method);
        if (scope) setConfirmation(scope);
      }}>{draft && draft.methods[method].state !== "idle" ? duoMethodLabels[draft.methods[method].state] : setup.methods[method] ? "Added" : method === "key" ? "Add security key" : "Add Touch ID"}</button></section>)}</div><p className="readiness">{readiness}</p><footer className="setup-footer"><p>{both ? "Both devices are added. Continue in Relay." : "Fast Duo stays open in its own tab."}</p><button tabIndex={0} className="btn" onClick={() => setup.returnToParent()}>Show Fast Duo</button></footer></> : <><div className="setup-grid"><section aria-label="Your sign-in methods"><div className="method-heading"><h2>Relay sign-in methods</h2><span>{Number(setup.methods.key) + Number(setup.methods.touch)} of 2 completed</span></div><div className="method-progress" aria-hidden>{methods.map(([method]) => <span key={method} data-state={draft?.methods[method].state ?? (setup.methods[method] ? "complete" : setup.listening && setup.method === method ? "pending" : "idle")} />)}</div><ul className="method-list">{methods.map(([method]) => {
        const state = draft?.methods[method].state ?? (setup.methods[method] ? "complete" : setup.listening && setup.method === method ? "pending" : "idle");
        const presentation = duoMethodPresentation(method, state);
        const label = method === "key" ? "Security key" : "Touch ID";
        return <li key={method}><button type="button" className="method-card" data-state={state} aria-pressed={setup.method === method} disabled={selectionDisabled || setup.methods[method]} onClick={() => selectMethod(method)}><span className="method-head"><span className="method-icon">{method === "key" ? <KeyRound className="icon" aria-hidden /> : <Fingerprint className="icon" aria-hidden />}</span><span className="method-identity"><strong>{label}</strong><span>{method === "key" ? "Software key in this browser" : "Platform authenticator · hardware or Chromium virtual authenticator"}</span></span><DuoMethodPill state={state} /></span><ol className="method-track" aria-label={`${label} progress`}>{presentation.track.map(step => <li key={step.label} data-state={step.tone}>{step.label}</li>)}</ol><span className="method-note">{presentation.note}</span></button></li>;
      })}</ul><p className="method-sync">Same status as the Relay sign-up step. Updated every second.</p><p className="readiness">{readiness}</p></section><section className="setup-task"><h2>{methodState ? duoMethodLabels[methodState] : both ? "Both methods are ready" : setup.unavailable ? "Reconnect your Duo tab" : setup.listening ? "Waiting for Duo…" : `Add ${setup.method === "key" ? "a security key" : "Touch ID"}`}</h2><p>{failedMethod ? "Relay could not confirm completion. Review your Duo devices without repeating this attempt." : both ? "Return to Relay to finish your profile." : setup.listening ? "In Duo, select the matching device and confirm that it was added." : "Open Duo, approve with an existing method, then choose Other options → Manage devices."}</p>{!both && <><div className="field"><label htmlFor="device-type">Device type</label><select disabled={selectionDisabled} id="device-type" value={setup.method} onChange={event => selectMethod(event.target.value as "key" | "touch")}>{methods.map(([method, label]) => <option key={method} value={method} disabled={setup.methods[method]}>{label}</option>)}</select></div><div className="action-row"><button tabIndex={0} className="btn" disabled={!setup.connected} onClick={() => setup.open(false)}>Open duo.ucpath.edu</button><button tabIndex={0} className="btn primary" disabled={!setup.connected || draft !== undefined && !setup.listening && methodState !== "idle"} onClick={() => setup.listening ? setup.cancel() : setup.open(true)}>{setup.listening ? "Cancel capture" : "Start capture"}</button></div></>}<p className="status-line" role="status">{failedMethod ? "Enrollment is unverified. Review your Duo devices before continuing." : !setup.connected ? "Setup is unavailable. Open this tab from Relay." : setup.unavailable ? "The Duo tab is unavailable. Reopen it to continue." : setup.listening ? "Listening for the selected device." : both ? "Security key and Touch ID ready" : "Capture alone does not mean the device is added."}</p></section></div><footer className="setup-footer"><p>{port ? "Enrollment is verified by Relay. Capture alone does not complete setup." : "UI mock. No credentials are created or sent."}</p><div className="action-row"><button tabIndex={0} className="btn" onClick={() => window.close()}>Close setup tab</button><button tabIndex={0} className="btn primary" onClick={() => setup.returnToParent()}>Return to Relay</button></div></footer></>}
    </main><span className="sr-only" role="status">{summary}</span>
    <Dialog open={confirming} onOpenChange={open => { if (!open) dismissConfirmation(); }}><DialogContent hideClose className="hub-duo-dialog" title={(typeof confirmation === "object" ? confirmation.method : setup.method) === "key" ? "Add security key?" : "Add Touch ID?"} description={port ? "Confirm only after Duo reports the device was added. Relay still requires the observed enrollment proof." : "Simulate the device capture, then confirm Duo’s successful addition."}><DialogFooter><button tabIndex={0} className="btn" onClick={dismissConfirmation}>Cancel</button><button tabIndex={0} className="btn primary" onClick={() => {
        if (confirmation === "mock" && !port) mock.confirm();
        else if (typeof confirmation === "object") served.confirm(confirmation);
        dismissConfirmation();
      }}>Confirm device added</button></DialogFooter></DialogContent></Dialog>
  </div>;
}

export function DuoSignupSteps({ methods, platformAuthenticator, state, onEnroll, onFinish, onCancel, onShowSetup }: {
  methods: Readonly<Record<"key" | "touch", "idle" | "pending" | "complete" | "unknown" | "unavailable">>;
  platformAuthenticator: "hardware" | "virtual";
  state: "enrolling" | "finishing" | "cancelling";
  onEnroll?: (method: "key" | "touch") => void;
  onFinish?: () => void;
  onCancel?: () => void;
  onShowSetup?: () => void;
}) {
  const busy = state !== "enrolling" || methods.key === "pending" || methods.touch === "pending";
  const ready = methods.key === "complete" && methods.touch === "complete";
  return <section aria-label="Required Duo methods" className="duo-signup-methods">
    <div className="duo-signup-cards">{(["touch", "key"] as const).map(method => <section key={method} className="duo-signup-card"><div className="flex items-center justify-between gap-3"><span className="duo-signup-icon">{methods[method] === "complete" ? <Check aria-hidden /> : method === "touch" ? <Fingerprint aria-hidden /> : <KeyRound aria-hidden />}</span><Badge tone={methods[method] === "complete" ? "success" : "neutral"}>{methods[method] === "complete" ? "Added" : methods[method] === "pending" ? "Waiting for Duo" : methods[method] === "unknown" ? "Unknown" : methods[method] === "unavailable" ? "Unavailable" : "Not added"}</Badge></div><h2>{method === "touch" ? "Touch ID" : "Security key"}</h2><p>{methods[method] === "complete" ? method === "touch" && platformAuthenticator === "virtual" ? "Verified · Chromium virtual authenticator." : "Verified in Duo." : methods[method] === "pending" ? "Finish adding it in the setup browser." : methods[method] === "unknown" ? "Enrollment is unverified. Review your Duo devices." : methods[method] === "unavailable" ? "Enrollment is unavailable. Reopen the setup browser." : method === "touch" ? platformAuthenticator === "virtual" ? "Chromium supplies a virtual platform authenticator." : "Use Touch ID on this Mac." : "Use FastDuo in Relay’s setup browser."}</p>{methods[method] === "idle" && <Button variant="secondary" disabled={busy || !onEnroll} onClick={() => onEnroll?.(method)}>Add {method === "touch" ? "Touch ID" : "Security key"}</Button>}{(methods[method] === "pending" || methods[method] === "unknown" || methods[method] === "unavailable") && <Button variant="secondary" disabled={state !== "enrolling" || !onShowSetup} onClick={onShowSetup}>Show setup browser</Button>}</section>)}</div>
    {state !== "enrolling" && <p role="status">{state === "finishing" ? "Finishing sign-up; your account is not published yet." : "Cancelling sign-up; resource closure is not complete."}</p>}
    <footer className="flex items-center justify-between border-t border-ui-stroke pt-[var(--ds-space-loose)]"><Button variant="ghost" disabled={state !== "enrolling" || !onCancel} onClick={onCancel}>Back to login</Button><Button disabled={!ready || busy || !onFinish} onClick={onFinish}>Finish</Button></footer>
  </section>;
}
