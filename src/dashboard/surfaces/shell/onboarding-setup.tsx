import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { useEffect, useRef, useState } from "react";
import { Check, Fingerprint, KeyRound, LoaderCircle } from "lucide-react";
import { Button, Card, Dialog, DialogContent, DialogFooter } from "../../ds/ui.js";
import { duoSummary, useServedDuoSetup, useWaitStage, type DuoConfirmationScope, type ServedOnboardingPort } from "./onboarding-model.js";
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
  const [closing, setClosing] = useState<"complete" | "cancel">();
  /** Shared by both close actions and set at dispatch, so a second press before React re-renders sends nothing. */
  const closeLatch = useRef(false);
  const [closeFailure, setCloseFailure] = useState<string>();
  const closeReenrol = async (action: "complete" | "cancel") => {
    if (closeLatch.current) return;
    closeLatch.current = true; setClosing(action); setCloseFailure(undefined);
    try { await port[action](); }
    catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "PROFILE_DUO_REENROL_UNCERTAIN";
      setCloseFailure(`${action === "complete" ? "Duo setup not switched" : "Duo setup not cancelled"}. ${operatorFailureSentence(code)}`);
    } finally { closeLatch.current = false; setClosing(undefined); }
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
  const preparing = browser?.state === "opening" || browser?.state === "reopening" || browser?.state === "checking";
  const preparingStage = useWaitStage(preparing && browser !== undefined ? `${draft?.operationId}:${browser.state}:${browser.generation}` : undefined);
  const browserNotice = browser?.state === "failed" ? operatorFailureSentence(browser.code)
    : browser?.state === "closed" ? "The setup browser was closed. Select Reopen to continue."
    : preparing ? preparingStage === "still" ? "Still preparing the setup browser…" : "Relay is preparing the setup browser." : undefined;
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
  const waitingAttempt = methodState === "pending" ? draft?.methods[setup.method].attemptId ?? setup.method : setup.listening ? setup.method : undefined;
  const waitStage = useWaitStage(waitingAttempt === undefined ? undefined : `${draft?.operationId}:${waitingAttempt}`);
  const status = statusReadFailed ? "Relay could not read the setup status. It keeps trying."
    : !setup.connected ? "Open this window from Relay to continue."
    : setup.unavailable && !failedMethod ? "The Duo tab is closed. Reopen it to continue."
    : waitStage === "still" ? "Still waiting for Duo." : undefined;
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
      {reenrol ? <div className="action-row"><Button variant="secondary" size="lg" disabled={closing !== undefined} aria-busy={closing === "cancel" || undefined} onClick={() => void closeReenrol("cancel")}>{closing === "cancel" && <LoaderCircle aria-hidden className="icon animate-spin motion-reduce:animate-none" />}{closing === "cancel" ? "Cancelling…" : "Cancel setup"}</Button><Button variant={both ? "primary" : "secondary"} size="lg" disabled={!both || closing !== undefined} aria-busy={closing === "complete" || undefined} onClick={() => void closeReenrol("complete")}>{closing === "complete" && <LoaderCircle aria-hidden className="icon animate-spin motion-reduce:animate-none" />}{closing === "complete" ? "Switching…" : "Use new devices"}</Button></div>
        : <div className="action-row"><Button variant="secondary" size="lg" onClick={() => window.close()}>Close</Button><Button variant={both ? "primary" : "secondary"} size="lg" onClick={() => setup.returnToParent()}>Back to Relay</Button></div>}
    </footer>
    <span className="sr-only" role="status">{summary}</span>
    <Dialog open={confirming} onOpenChange={open => { if (!open) dismissConfirmation(); }}><DialogContent size="sm" title={(confirmation?.method ?? setup.method) === "key" ? "Add security key?" : "Add Touch ID?"} description="Confirm once Duo shows the device as added."><DialogFooter><Button variant="secondary" onClick={dismissConfirmation}>Cancel</Button><Button variant="primary" onClick={() => {
        if (confirmation !== undefined) setup.confirm(confirmation);
        dismissConfirmation();
      }}>Device added</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
