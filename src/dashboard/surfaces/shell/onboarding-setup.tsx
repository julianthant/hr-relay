import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { useEffect, useState } from "react";
import { Check, Fingerprint, KeyRound } from "lucide-react";
import { Badge, Button, Card, Dialog, DialogContent, DialogFooter } from "../../ds/ui.js";
import { duoSummary, useServedDuoSetup, type DuoConfirmationScope, type ServedOnboardingPort } from "./onboarding-model.js";
import { AppLockup } from "./app-lockup.js";
import "./onboarding-setup.css";

const methods = [["key", "Security key", "Use a security key or passkey with Duo."], ["touch", "Touch ID", "Use Touch ID on this computer."]] as const;
const statusLabels = { idle: "Not started", pending: "Waiting for Duo", complete: "Added", unknown: "Not confirmed", unavailable: "Unavailable" } as const;

export function OnboardingSetup({ page, port }: { page: "fast" | "duo"; port: ServedOnboardingPort }) {
  const duo = page === "duo";
  const setup = useServedDuoSetup(port);
  const draft = port.onboarding;
  const methodState = draft?.methods[setup.method].state;
  const failedMethod = methodState === "unknown" || methodState === "unavailable";
  const summary = duoSummary(setup.methods, draft);
  const [confirmation, setConfirmation] = useState<DuoConfirmationScope>();
  const confirming = confirmation !== undefined && setup.matchesConfirmation(confirmation);
  useEffect(() => { if (confirmation !== undefined && !confirming) setConfirmation(undefined); }, [confirmation, confirming]);
  const dismissConfirmation = () => {
    if (confirmation !== undefined) setup.dismissConfirmation(confirmation);
    setConfirmation(undefined);
  };
  const [closing, setClosing] = useState(false);
  const [closeFailure, setCloseFailure] = useState<string>();
  const closeReenrol = async (action: "complete" | "cancel") => {
    if (closing) return;
    setClosing(true); setCloseFailure(undefined);
    try { await port[action](); }
    catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "PROFILE_DUO_REENROL_UNCERTAIN";
      setCloseFailure(`${action === "complete" ? "Duo setup not switched" : "Duo setup not cancelled"}. ${operatorFailureSentence(code)}`);
    } finally { setClosing(false); }
  };
  const browser = draft?.browser;
  const reenrol = port.reenrol === true;
  const [reopening, setReopening] = useState(false);
  const [reopenFailure, setReopenFailure] = useState<string>();
  const reopen = async () => {
    if (reopening) return;
    setReopening(true); setReopenFailure(undefined);
    try { await port.reopenBrowser(); }
    catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "PROFILE_DUO_REENROL_UNCERTAIN";
      setReopenFailure(operatorFailureSentence(code));
    } finally { setReopening(false); }
  };
  const browserNotice = browser?.state === "failed" ? operatorFailureSentence(browser.code)
    : browser?.state === "closed" ? "The setup browser was closed. Select Reopen to continue."
    : browser?.state === "opening" || browser?.state === "reopening" || browser?.state === "checking" ? "Relay is preparing the setup browser." : undefined;
  const canReopen = browser?.state === "failed" || browser?.state === "closed";
  const statusReadFailed = port.unavailable === true && !failedMethod;
  const both = setup.methods.key && setup.methods.touch;
  const selectionDisabled = setup.listening || draft !== undefined && Object.values(draft.methods).some(method => method.state === "pending");
  const selectMethod = (method: "key" | "touch") => { setup.cancel(); setup.setMethod(method); };
  useEffect(() => {
    if (setup.methods[setup.method] && !both) setup.setMethod(setup.method === "key" ? "touch" : "key");
  }, [both, setup]);
  const instruction = failedMethod ? "In Duo, open Manage devices and remove any device you do not recognize, then add this one again."
    : both ? "Both devices are added. Go back to Relay to finish."
    : setup.listening ? "In Duo, add the matching device. Relay moves on once it sees it."
    : "In Duo, approve with your current method, then choose Other options and Manage devices.";
  const status = statusReadFailed ? "Relay could not read the setup status. It keeps trying."
    : !setup.connected ? "Open this window from Relay to continue."
    : setup.unavailable && !failedMethod ? "The Duo tab is closed. Reopen it to continue." : undefined;
  return <div className="hub-duo-setup">
    <a tabIndex={0} href="#setup-main" className="skip-link">Skip to setup</a>
    <header className="setup-brand"><AppLockup /><span>Duo setup</span></header>
    <main id="setup-main"><header className="heading"><h1>{reenrol ? "Set up Duo again" : "Set up Duo"}</h1><p>{instruction}</p></header>
      <ul className="method-list">{methods.map(([method, label, help]) => {
        const state = draft?.methods[method].state ?? (setup.methods[method] ? "complete" : setup.listening && setup.method === method ? "pending" : "idle");
        const added = state === "complete";
        const selected = setup.method === method && !added;
        const Icon = method === "key" ? KeyRound : Fingerprint;
        return <li key={method}><Card selected={selected} tone={state === "unknown" || state === "unavailable" ? "danger" : "default"}>
          <button type="button" className="method-head" aria-pressed={selected} disabled={selectionDisabled || added} onClick={() => selectMethod(method)}>
            <Icon className="icon" aria-hidden /><span className="method-name"><strong>{label}</strong><span>{help}</span></span>
            <span className="method-status" data-state={state}>{added && <Check className="icon" aria-hidden />}{statusLabels[state]}</span>
          </button>
          {selected && <div className="method-actions">
            {canReopen && !statusReadFailed && <Button variant="secondary" size="lg" disabled={reopening} onClick={() => void reopen()}>{reopening ? "Reopening…" : "Reopen"}</Button>}
            <Button variant="secondary" size="lg" disabled={!setup.connected || canReopen} onClick={() => setup.open(false)}>Open Duo</Button>
            <Button variant="primary" size="lg" disabled={!setup.connected || statusReadFailed || failedMethod || canReopen || draft !== undefined && !setup.listening && methodState !== "idle"} onClick={async () => {
              if (duo) { const scope = await setup.start(method); if (scope) setConfirmation(scope); }
              else if (setup.listening) setup.cancel(); else setup.open(true);
            }}>{setup.listening && !duo ? "Stop" : "Add this device"}</Button>
          </div>}
        </Card></li>;
      })}</ul>
      {statusReadFailed && <p role="alert" className="setup-notice" data-tone="failure">{status}</p>}
      {!statusReadFailed && browserNotice !== undefined && <p role={canReopen ? "alert" : "status"} className="setup-notice" data-tone={canReopen ? "failure" : "info"}>{browserNotice}</p>}
      {reopenFailure !== undefined && <p role="alert" className="setup-notice" data-tone="failure">{reopenFailure}</p>}
      {!statusReadFailed && status !== undefined && browserNotice === undefined && <p role="status" className="setup-notice" data-tone="info">{status}</p>}
    </main>
    <footer className="setup-footer">{closeFailure !== undefined && <p role="alert" className="setup-notice" data-tone="failure">{closeFailure}</p>}
      {reenrol ? <div className="action-row"><Button variant="secondary" size="lg" disabled={closing} onClick={() => void closeReenrol("cancel")}>Cancel setup</Button><Button variant={both ? "primary" : "secondary"} size="lg" disabled={!both || closing} onClick={() => void closeReenrol("complete")}>Use new devices</Button></div>
        : <div className="action-row"><Button variant="secondary" size="lg" onClick={() => window.close()}>Close</Button><Button variant={both ? "primary" : "secondary"} size="lg" onClick={() => setup.returnToParent()}>Back to Relay</Button></div>}
    </footer>
    <span className="sr-only" role="status">{summary}</span>
    <Dialog open={confirming} onOpenChange={open => { if (!open) dismissConfirmation(); }}><DialogContent size="sm" title={(confirmation?.method ?? setup.method) === "key" ? "Add security key?" : "Add Touch ID?"} description="Confirm once Duo shows the device as added."><DialogFooter><Button variant="secondary" onClick={dismissConfirmation}>Cancel</Button><Button variant="primary" onClick={() => {
        if (confirmation !== undefined) setup.confirm(confirmation);
        dismissConfirmation();
      }}>Device added</Button></DialogFooter></DialogContent></Dialog>
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
    <div className="duo-signup-cards">{(["touch", "key"] as const).map(method => <section key={method} className="duo-signup-card"><div className="flex items-center justify-between gap-3"><span className="duo-signup-icon">{methods[method] === "complete" ? <Check aria-hidden /> : method === "touch" ? <Fingerprint aria-hidden /> : <KeyRound aria-hidden />}</span><Badge tone={methods[method] === "complete" ? "success" : "neutral"}>{methods[method] === "complete" ? "Added" : methods[method] === "pending" ? "Waiting for Duo" : methods[method] === "unknown" ? "Unknown" : methods[method] === "unavailable" ? "Unavailable" : "Not added"}</Badge></div><h2>{method === "touch" ? "Touch ID" : "Security key"}</h2><p>{methods[method] === "complete" ? method === "touch" && platformAuthenticator === "virtual" ? "Verified in Duo on this computer." : "Verified in Duo." : methods[method] === "pending" ? "Finish adding it in the setup browser." : methods[method] === "unknown" ? "Relay could not confirm it. Review your Duo devices." : methods[method] === "unavailable" ? "Relay cannot reach it. Reopen the setup browser." : method === "touch" ? platformAuthenticator === "virtual" ? "Touch ID on this computer, managed by Relay." : "Use Touch ID on this computer." : "Use a security key in Relay’s setup browser."}</p>{methods[method] === "idle" && <Button variant="secondary" disabled={busy || !onEnroll} onClick={() => onEnroll?.(method)}>Add {method === "touch" ? "Touch ID" : "Security key"}</Button>}{(methods[method] === "pending" || methods[method] === "unknown" || methods[method] === "unavailable") && <Button variant="secondary" disabled={state !== "enrolling" || !onShowSetup} onClick={onShowSetup}>Show setup browser</Button>}</section>)}</div>
    {state !== "enrolling" && <p role="status">{state === "finishing" ? "Finishing sign-up; your account is not published yet." : "Cancelling sign-up; resource closure is not complete."}</p>}
    <footer className="flex items-center justify-between border-t border-ui-stroke pt-[var(--ds-space-loose)]"><Button variant="ghost" disabled={state !== "enrolling" || !onCancel} onClick={onCancel}>Back to login</Button><Button disabled={!ready || busy || !onFinish} onClick={onFinish}>Finish</Button></footer>
  </section>;
}
