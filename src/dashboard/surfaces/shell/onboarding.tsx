import { DashboardClientError } from "../../client/errors.js";
import { PROFILE_ONBOARDING_STATE } from "../../../models/profiles/public-profile.js";
import type { PublicProfileState } from "../../../models/profiles/public-profile.js";
import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, CircleDashed, CircleHelp, PanelTop, PanelTopClose, TriangleAlert, KeyRound, LoaderCircle, X } from "lucide-react";
import { duoMethodLabels, duoSummary, signInSentence, useDuoBrowser, useWaitStage, type OnboardingDetails, type OnboardingErrors, type OnboardingStep, type ServedOnboardingPort } from "./onboarding-model.js";
import "./onboarding.css";
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, SecretField } from "../../ds/ui.js";
import { AppLockup } from "./app-lockup.js";

/**
 * `problem` is a failure that still applies (profile authority, a blocked or unfinished log out) and stays until the session changes;
 * `signInProblem` is the session's answer to the last sign-in and clears on typing, on resubmit and on switching between Log in and Sign up.
 */
export function Onboarding({ step, onStep, onDashboard, port, authenticated = false, problem, signInProblem, resumable = false }: {
  step: OnboardingStep; onStep: (step: OnboardingStep) => void; onDashboard: () => void; port: ServedOnboardingPort; authenticated?: boolean; problem?: string; signInProblem?: string;
  resumable?: boolean;
}) {
  const [forms, setForms] = useState<Record<"login" | "signup", OnboardingDetails>>({ login: { firstName: "", lastName: "", email: "", password: "" }, signup: { firstName: "", lastName: "", email: "", password: "", ucpathUsername: "", ucpathPassword: "" } });
  const formStep = step === "login" ? "login" : "signup";
  const details = forms[formStep];
  const previousStep = useRef(step);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const draft = port.onboarding;
  const keyState = draft?.methods.key.state;
  const currentDraft = useRef(draft?.operationId); currentDraft.current = draft?.operationId;
  const methods = { key: keyState === "complete" };
  const detailsDone = draft !== undefined || authenticated;
  const [submitting, setSubmitting] = useState(false);
  /** Set at dispatch, so a second press before React re-renders is ignored too. */
  const busy = useRef(false);
  const setBusy = (value: boolean) => { busy.current = value; setSubmitting(value); };
  const [completionUnknown, setCompletionUnknown] = useState(false);
  const unknownCancellation = useRef<{ operationId: string; profileId: string; readRevision: number } | undefined>(undefined);
  const submitted = useRef(0);
  const cancelInFlight = useRef(false);
  const cancelTrigger = useRef<HTMLElement | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ next: "login" | "signup"; operationId?: string; authority: object }>();
  const cancelAuthority = port.authorityScope ?? port;
  const currentCancelAuthority = useRef(cancelAuthority); currentCancelAuthority.current = cancelAuthority;
  const cancelCurrent = cancelTarget !== undefined && cancelTarget.operationId === draft?.operationId && cancelTarget.authority === cancelAuthority;
  useEffect(() => { if (!cancelCurrent) setCancelTarget(undefined); }, [cancelCurrent]);
  useEffect(() => { const lifetime = submitted; submitted.current++; setBusy(false); setCompletionUnknown(false); return () => { lifetime.current++; }; }, [draft?.operationId]);
  const [loginError, setLoginError] = useState("");
  const [dismissed, setDismissed] = useState<string>();
  const error = loginError || problem || (signInProblem !== dismissed ? signInProblem : undefined);
  const clearError = () => { setLoginError(""); setDismissed(signInProblem); };
  const focusPassword = useRef(false);
  const [resuming, setResuming] = useState(resumable);
  const resumeStarted = useRef(false);
  useEffect(() => {
    if (!resumable || resumeStarted.current) return;
    resumeStarted.current = true;
    void port.resume().then(result => { if (result.state !== "active") onStep("login"); },
      () => { setLoginError(operatorFailureSentence("PROFILE_AUTHORITY_UNAVAILABLE")); onStep("login"); }).finally(() => setResuming(false));
  }, [resumable, port, onStep]);
  const browser = useDuoBrowser(draft?.operationId, port);
  const launching = browser.status === "launching", failed = browser.status === "error";
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const signup = step === "signup";
  const keyAdded = methods.key;
  const inaccessible = step === "duo" && !detailsDone || step === "ready" && (!detailsDone || !keyAdded);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    if (submitting || !focusPassword.current) return;
    focusPassword.current = false; form.current?.querySelector<HTMLInputElement>('[name="password"]')?.focus();
  }, [submitting]);
  useLayoutEffect(() => {
    const previous = previousStep.current;
    if (previous === step) return;
    previousStep.current = step;
    submitted.current++; setBusy(false);
    if (previous === "login" || previous === "signup") setForms(current => ({ ...current, [previous]: { ...current[previous], password: "", ...(previous === "signup" && { ucpathPassword: "" }) } }));
    setErrors({}); setLoginError(""); setDismissed(signInProblem);
  }, [step, signInProblem]);
  const requestCancellation = (next: "login" | "signup", trigger: Element | null = document.activeElement) => {
    cancelTrigger.current = trigger instanceof HTMLElement ? trigger : null;
    setCancelTarget({ next, ...(draft === undefined ? {} : { operationId: draft.operationId }), authority: cancelAuthority });
  };
  const navigate = async (next: OnboardingStep, confirmed = false) => {
    if (busy.current || completionUnknown || cancelInFlight.current) return;
    if (draft && (next === "signup" || next === "login")) {
      if (!confirmed) { requestCancellation(next); return; }
      cancelInFlight.current = true;
      const request = ++submitted.current; setBusy(true); clearError();
      try {
        const result = await port.cancel();
        if (currentCancelAuthority.current !== cancelAuthority) return;
        if (request !== submitted.current && currentDraft.current !== undefined) return;
        if (result.state === "signed-out") onStep(next);
        else setLoginError(operatorFailureSentence(result.state === "refused" || result.state === "error" ? result.code : "PROFILE_TRANSITION_BLOCKED"));
      } catch { if (request === submitted.current) { unknownCancellation.current = { operationId: draft.operationId, profileId: draft.profileId, readRevision: port.readRevision ?? 0 }; setCompletionUnknown(true); setLoginError(signInSentence("COMMAND_OUTCOME_UNCERTAIN")); } }
      finally { cancelInFlight.current = false; if (request === submitted.current) setBusy(false); }
      return;
    }
    if (next === "duo" && !detailsDone || next === "ready" && !keyAdded) return;
    onStep(next);
  };
  const finish = async () => {
    if (busy.current || completionUnknown || draft?.step !== "ready") return;
    const request = ++submitted.current; setBusy(true); clearError();
    try {
      const result = await port.complete();
      if (request !== submitted.current) return;
      if (result.state === "active" && result.duoState === "ready") onDashboard();
      else setLoginError(operatorFailureSentence(result.state === "refused" || result.state === "error" ? result.code : "PROFILE_LOGOUT_BLOCKED"));
    } catch { if (request === submitted.current) { setCompletionUnknown(true); setLoginError(signInSentence("COMMAND_OUTCOME_UNCERTAIN")); } }
    finally { if (request === submitted.current) setBusy(false); }
  };
  const field = (name: keyof OnboardingDetails, label: string, type: string, autoComplete: string) => {
    const shared = {
      name, autoComplete, maxLength: 160, required: true, disabled: submitting, value: details[name] ?? "", size: "lg" as const,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const next = { ...details, [name]: event.target.value }; setForms(current => ({ ...current, [formStep]: next })); clearError();
        if (errors[name]) setErrors(current => ({ ...current, [name]: port.validate(signup ? "signup" : "login", next)[name] }));
      },
      onBlur: () => { if (details[name]) setErrors(current => ({ ...current, [name]: port.validate(signup ? "signup" : "login", details)[name] })); },
    };
    return <Field label={label} error={errors[name]} description={signup && name === "password" ? "Use at least 8 characters" : undefined}>
      {name === "password" || name === "ucpathPassword" ? <SecretField {...shared} label={label} />
        : <Input {...shared} type={type} spellCheck={type === "email" ? false : undefined} inputMode={type === "email" ? "email" : undefined} />}
    </Field>;
  };
  const title = step === "login" ? "Log in to Relay" : signup ? "Create your profile" : step === "ready" ? "You’re all set" : keyAdded ? "Duo setup is complete" : "Set up Duo";
  const setupWindow = port.unavailable && draft?.browser.state !== "failed" ? { state: "checking" as const, generation: draft?.browser.generation ?? 0 } : draft?.browser;
  const opening = (launching || setupWindow?.state === "opening" || setupWindow?.state === "reopening");
  const waitingAttempt = keyState === "pending" ? draft?.methods.key.attemptId : undefined;
  const openingStage = useWaitStage(step === "duo" && opening ? `${draft?.operationId}:${setupWindow?.state}:${setupWindow?.generation}` : undefined);
  const stage = useWaitStage(step === "duo" && !opening && waitingAttempt !== undefined ? `${draft?.operationId}:${waitingAttempt}` : undefined);
  const reopen = setupWindow !== undefined && setupWindow.state !== "open";
  /** The pending press is Finish setup / Go to dashboard, not a cancellation. */
  const finishing = submitting && !cancelInFlight.current;
  const recoveryProvedCurrent = !port.unavailable && draft !== undefined && unknownCancellation.current?.operationId === draft.operationId
    && unknownCancellation.current.profileId === draft.profileId && (port.readRevision ?? 0) > unknownCancellation.current.readRevision;
  const recoveryBlocked = completionUnknown && !recoveryProvedCurrent;
  const waitTitle = waitingAttempt === undefined ? undefined : stage === "still" ? "Still waiting for Duo to add Security key" : "Waiting for Duo to add Security key";
  const windowTitle = setupWindow?.state === "failed" ? setupWindow.code === "DUO_SETUP_OPEN_FAILED" ? "Could not open setup window" : "Could not reopen setup window"
    : opening ? openingStage === "still" ? "Still opening setup window…" : setupWindow?.state === "reopening" ? "Reopening setup window…" : "Opening setup window…"
      : setupWindow?.state === "open" ? waitTitle ?? "Setup window is open" : setupWindow?.state === "closed" ? "Setup window closed" : "Checking setup window…";
  const WindowIcon = opening ? LoaderCircle : setupWindow?.state === "failed" ? TriangleAlert : setupWindow?.state === "closed" ? PanelTopClose : setupWindow?.state === "open" ? PanelTop : CircleHelp;
  const windowDescription = setupWindow?.state === "failed" ? operatorFailureSentence(setupWindow.code)
    : opening ? setupWindow?.state === "reopening" ? "Closing the previous window first." : undefined
      : setupWindow?.state === "open" ? undefined
        : setupWindow?.state === "closed" ? keyAdded ? "Your security key is confirmed. Reopen or finish." : "Reopen to continue."
          : "Relay cannot read the window. Reopen to check.";
  const description = step === "login" ? resuming ? "Opening your workspace…" : "Open your workspace" : signup ? "Add your details, then set up Duo" : step === "ready" ? "Your profile is ready" : keyAdded ? "Your security key is confirmed"
    : keyState === "unknown" ? "Relay could not confirm your security key. In Duo, remove any device you do not recognize, then start over."
    : keyState === "pending" ? "Finish adding your security key in the setup browser."
    : keyState === "unavailable" ? "Relay cannot verify your security key. Open the setup browser."
    : failed ? "Could not show the setup browser. Reopen it." : "Add your security key";
  if (inaccessible) return <div className="hub-onboarding"><div className="brand"><AppLockup /></div><main><div className="stack"><h1>Start with your details</h1><p>Complete the previous setup steps to continue.</p><Button variant="primary" size="lg" className="self-start" onClick={() => onStep("signup")}>Start with your details</Button></div></main></div>;
  const refusal = port.refusal;
  if (refusal !== undefined) return <div className="hub-onboarding"><a tabIndex={0} href="#onboarding-main" className="skip">Skip to content</a><div className="brand"><AppLockup /></div><main id="onboarding-main" tabIndex={-1}><div className="stack"><p className="form-error" role="alert">{operatorFailureSentence(refusal)}</p></div></main></div>;
  return <div className="hub-onboarding">
    <a tabIndex={0} href="#onboarding-main" className="skip">Skip to content</a><div className="brand"><AppLockup /></div>
    <main id="onboarding-main" tabIndex={-1}><div className="auth-layout">
      {step !== "login" && <ol className="progress" aria-label="Profile setup progress">{(["signup", "duo", "ready"] as const).map((item, index) => {
        const current = step === "signup" ? 0 : step === "duo" ? 1 : 2;
        return <li key={item} aria-current={item === step ? "step" : undefined} data-complete={index < current}><button tabIndex={0} className="step-link" type="button" disabled={item === "duo" && !detailsDone || item === "ready" && !keyAdded} onClick={() => navigate(item)}><span className="progress-marker" aria-hidden="true">{index < current ? <Check className="icon" /> : index + 1}</span>{["Your details", "Duo setup", "Ready"][index]}</button></li>;
      })}</ol>}
      <div className="stack"><header className="heading"><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{description}</p></header>
        {(step === "login" || signup) ? <><form ref={form} className="auth-form" noValidate onSubmit={async event => {
          event.preventDefault();
          if (busy.current || port.unavailable) return; clearError(); const nextErrors = port.validate(signup ? "signup" : "login", details); setErrors(nextErrors);
          if (Object.values(nextErrors).some(Boolean)) { form.current?.querySelector<HTMLInputElement>(`[name="${Object.keys(nextErrors)[0]}"]`)?.focus(); return; }
          const request = ++submitted.current;
          setBusy(true);
          try {
            const result: PublicProfileState = await port.submit(signup ? "signup" : "login", details);
            if (request !== submitted.current) return;
            if (result.state === PROFILE_ONBOARDING_STATE) {
              setForms(current => ({ ...current, [formStep]: { ...current[formStep], password: "", ...(signup && { ucpathPassword: "" }) } }));
              onStep(result.step); return;
            }
            if (result.state === "signed-out") {
              setForms(current => current[formStep] === details ? { ...current, [formStep]: { ...current[formStep], password: "", ...(signup && { ucpathPassword: "" }) } } : current);
              onStep("login"); return;
            }
            if (result.state === "cancelling" || result.state === "refused" && result.code === "PROFILE_LOGOUT_BLOCKED") return;
            if (signup || result.state !== "active") {
              setLoginError(signInSentence(result.state === "refused" || result.state === "error" ? result.code : "PROFILE_LOGOUT_BLOCKED"));
              if (!signup) { setForms(current => ({ ...current, login: { ...current.login, password: "" } })); focusPassword.current = true; }
              return;
            }
            setForms(current => current[formStep] === details ? { ...current, [formStep]: { ...current[formStep], password: "", ...(signup && { ucpathPassword: "" }) } } : current);
            if (result.duoState === "ready") onDashboard(); else onStep("duo");
          } catch (error) {
            if (request === submitted.current) setLoginError(operatorFailureSentence(error instanceof DashboardClientError && error.kind === "network" ? "PROFILE_CONNECTION_FAILED" : "PROFILE_AUTHORITY_UNAVAILABLE"));
          } finally { if (request === submitted.current) { setBusy(false); setDismissed(undefined); } }
        }}>
          {signup && <div className="name-row">{field("firstName", "First name", "text", "given-name")}{field("lastName", "Last name", "text", "family-name")}</div>}
          {field("email", "Work email", "email", "username")}{field("password", "Password", "password", signup ? "new-password" : "current-password")}
          {signup && <fieldset className="ucpath-fields"><legend>UCPath login</legend>{field("ucpathUsername", "UCPath username", "text", "off")}{field("ucpathPassword", "UCPath password", "password", "off")}</fieldset>}
          <p className="form-error" role="alert">{error}</p><Button variant="primary" size="lg" className="self-start" type="submit" aria-busy={submitting || undefined} disabled={submitting || port.unavailable}>{submitting && <LoaderCircle aria-hidden className="icon animate-spin motion-reduce:animate-none" />}{submitting ? signup ? "Creating profile…" : "Logging in…" : signup ? "Create profile" : "Log in"}</Button>
        </form><div className="switch-row"><span>{signup ? "Already have a profile?" : "New to Relay?"}</span><a tabIndex={0} className="text-link" aria-disabled={submitting || undefined} href={`?onboarding=${signup ? "login" : "signup"}`} onClick={async event => { event.preventDefault(); await navigate(signup ? "login" : "signup"); }}>{signup ? "Log in" : "Sign up"}</a></div></> : step === "duo" ? <>
          <ul className="method-list" aria-label="Duo methods"><li><span className="method-name"><KeyRound className="icon" aria-hidden />Security key</span><DuoMethodPill state={keyState ?? (methods.key ? "complete" : "idle")} /></li></ul>
          <p className="sr-only" role="status">{duoSummary(methods, draft)}</p>{error && setupWindow?.state !== "failed" && !port.unavailable && <p className="form-error" role="alert">{error}</p>}{setupWindow && <div className="window-state" role={setupWindow.state === "failed" ? "alert" : "status"}><WindowIcon className="icon" aria-hidden /><div><strong>{windowTitle}</strong>{windowDescription && <p>{windowDescription}</p>}</div></div>}<footer className="actions"><Button variant="ghost" size="lg" disabled={submitting || completionUnknown || (draft === undefined || port.unavailable)} aria-busy={cancelInFlight.current || undefined} onClick={event => requestCancellation("login", event.currentTarget)}>{cancelInFlight.current && <LoaderCircle aria-hidden className="icon animate-spin motion-reduce:animate-none" />}{cancelInFlight.current ? "Cancelling…" : "Cancel sign-up"}</Button>{keyAdded && reopen && <Button variant="secondary" size="lg" disabled={opening || submitting || recoveryBlocked} onClick={() => browser.open(true)}>Reopen</Button>}<Button variant="primary" size="lg" type="button" aria-busy={opening || keyAdded && finishing || undefined} disabled={submitting || (keyAdded ? completionUnknown : recoveryBlocked) || opening || keyAdded && port.unavailable} onClick={() => keyAdded ? finish() : browser.open(reopen)}>{(opening || keyAdded && finishing) && <LoaderCircle aria-hidden className="icon animate-spin motion-reduce:animate-none" />}{keyAdded ? finishing ? "Finishing…" : "Finish setup" : opening ? setupWindow?.state === "reopening" ? "Reopening…" : "Opening…" : reopen ? "Reopen" : "Show window"}</Button></footer>
        </> : <>{error && <p className="form-error" role="alert">{error}</p>}<ul className="ready-list">{["Your details saved", "Security key confirmed"].map(text => <li key={text}><Check className="icon" />{text}</li>)}</ul><Button variant="primary" size="lg" className="self-start" type="button" aria-busy={finishing || undefined} disabled={!detailsDone || !keyAdded || submitting || completionUnknown || port.unavailable} onClick={() => void finish()}>{finishing && <LoaderCircle aria-hidden className="icon animate-spin motion-reduce:animate-none" />}{finishing ? "Opening dashboard…" : "Go to dashboard"}</Button></>}
      </div></div></main>
    <Dialog open={cancelCurrent} onOpenChange={open => { if (!open) setCancelTarget(undefined); }}><DialogContent size="sm" title="Cancel sign-up?" description="Your unfinished profile and entered credentials are removed from this computer. Devices already added stay in Duo." onCloseAutoFocus={event => {
      event.preventDefault();
      (cancelTrigger.current?.isConnected && !cancelTrigger.current.hasAttribute("disabled") ? cancelTrigger.current : heading.current)?.focus();
    }}><DialogFooter><Button variant="secondary" autoFocus onClick={() => setCancelTarget(undefined)}>Keep setting up</Button><Button variant="danger" onClick={() => {
      if (!cancelCurrent || cancelTarget === undefined) return;
      const next = cancelTarget.next; setCancelTarget(undefined); void navigate(next, true);
    }}>Cancel sign-up</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

export function DuoMethodPill({ state }: { state: keyof typeof duoMethodLabels }) {
  const Icon = state === "idle" ? CircleDashed : state === "pending" ? LoaderCircle : state === "complete" ? Check : X;
  return <span className="duo-method-pill" data-state={state}><Icon aria-hidden />{duoMethodLabels[state]}</span>;
}
