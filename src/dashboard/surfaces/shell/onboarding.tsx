import { PROFILE_ONBOARDING_STATE } from "../../../models/profiles/public-profile.js";
import type { PublicProfileState } from "../../../models/profiles/public-profile.js";
import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, CircleDashed, Fingerprint, KeyRound, LoaderCircle, X } from "lucide-react";
import { duoMethodLabels, duoSummary, useDuoBrowser, mockOnboardingPort, type DuoMethods, type OnboardingDetails, type OnboardingErrors, type OnboardingPort, type OnboardingStep } from "./onboarding-model.js";
import "./onboarding.css";
import { Button, Dialog, DialogContent, DialogFooter } from "../../ds/ui.js";

export function Onboarding({ step, onStep, onDashboard, port = mockOnboardingPort, authenticated = false, problem, resumable = false }: {
  step: OnboardingStep; onStep: (step: OnboardingStep) => void; onDashboard: () => void; port?: OnboardingPort; authenticated?: boolean; problem?: string;
  resumable?: boolean;
}) {
  const [forms, setForms] = useState<Record<"login" | "signup", OnboardingDetails>>({ login: { firstName: "", lastName: "", email: "", password: "" }, signup: { firstName: "", lastName: "", email: "", password: "" } });
  const formStep = step === "login" ? "login" : "signup";
  const details = forms[formStep];
  const previousStep = useRef(step);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [mockMethods, setMethods] = useState<DuoMethods>({ key: false, touch: false });
  const draft = port.source === "served" ? port.onboarding : undefined;
  const uncertainMethod = draft?.methods.key.state === "unknown" ? "Security key" : draft?.methods.touch.state === "unknown" ? "Touch ID" : undefined;
  const waitingMethod = draft?.methods.key.state === "pending" ? "Security key" : draft?.methods.touch.state === "pending" ? "Touch ID" : undefined;
  const unavailableMethod = draft?.methods.key.state === "unavailable" ? "Security key" : draft?.methods.touch.state === "unavailable" ? "Touch ID" : undefined;
  const currentDraft = useRef(draft?.operationId); currentDraft.current = draft?.operationId;
  const methods = port.source === "served" ? { key: draft?.methods.key.state === "complete", touch: draft?.methods.touch.state === "complete" } : mockMethods;
  const [detailsAccepted, setDetailsDone] = useState(false);
  const detailsDone = port.source === "served" ? draft !== undefined || authenticated : detailsAccepted;
  const [submitting, setSubmitting] = useState(false);
  const [completionUnknown, setCompletionUnknown] = useState(false);
  const submitted = useRef(0);
  const cancelInFlight = useRef(false);
  const cancelTrigger = useRef<HTMLElement | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ next: "login" | "signup"; operationId?: string; authority: object }>();
  const cancelAuthority = port.source === "served" ? port.authorityScope ?? port : port;
  const currentCancelAuthority = useRef(cancelAuthority); currentCancelAuthority.current = cancelAuthority;
  const cancelCurrent = cancelTarget !== undefined && cancelTarget.operationId === draft?.operationId && cancelTarget.authority === cancelAuthority;
  useEffect(() => { if (!cancelCurrent) setCancelTarget(undefined); }, [cancelCurrent]);
  useEffect(() => { const lifetime = submitted; submitted.current++; setSubmitting(false); setCompletionUnknown(false); return () => { lifetime.current++; }; }, [draft?.operationId]);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [resuming, setResuming] = useState(resumable && port.source === "served");
  const resumeStarted = useRef(false);
  useEffect(() => {
    if (!resumable || port.source !== "served" || resumeStarted.current) return;
    resumeStarted.current = true;
    void port.resume().then(result => { if (result.state !== "active") onStep("login"); },
      () => { setLoginError(operatorFailureSentence("PROFILE_AUTHORITY_UNAVAILABLE")); onStep("login"); }).finally(() => setResuming(false));
  }, [resumable, port, onStep]);
  const [attempts, setAttempts] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const browser = useDuoBrowser(methods, setMethods, port.source, draft?.operationId, port.source === "served" ? port : undefined);
  const launching = browser.status === "launching", closed = browser.status === "browser-closed", failed = browser.status === "error";
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const signup = step === "signup";
  const both = methods.key && methods.touch;
  const inaccessible = step === "duo" && !detailsDone || step === "ready" && (!detailsDone || !both);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    if (seconds === 0) return;
    const timer = window.setTimeout(() => setSeconds(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  useLayoutEffect(() => {
    const previous = previousStep.current;
    if (previous === step) return;
    previousStep.current = step;
    submitted.current++; setSubmitting(false);
    if (previous === "login" || previous === "signup") setForms(current => ({ ...current, [previous]: { ...current[previous], password: "" } }));
    if (step === "login" || step === "signup") setSeconds(0);
    setErrors({}); setLoginError(""); setShowPassword(false);
  }, [step]);
  const requestCancellation = (next: "login" | "signup", trigger: Element | null = document.activeElement) => {
    cancelTrigger.current = trigger instanceof HTMLElement ? trigger : null;
    setCancelTarget({ next, ...(draft === undefined ? {} : { operationId: draft.operationId }), authority: cancelAuthority });
  };
  const navigate = async (next: OnboardingStep, confirmed = false) => {
    if (submitting || completionUnknown || cancelInFlight.current) return;
    if (port.source === "served" && draft && (next === "signup" || next === "login")) {
      if (!confirmed) { requestCancellation(next); return; }
      cancelInFlight.current = true;
      const request = ++submitted.current; setSubmitting(true); setLoginError("");
      try {
        const result = await port.cancel();
        if (currentCancelAuthority.current !== cancelAuthority) return;
        if (request !== submitted.current && currentDraft.current !== undefined) return;
        if (result.state === "signed-out") onStep(next);
        else setLoginError(operatorFailureSentence(result.state === "refused" || result.state === "error" ? result.code : "PROFILE_TRANSITION_BLOCKED"));
      } catch { if (request === submitted.current) { setCompletionUnknown(true); setLoginError(operatorFailureSentence("COMMAND_OUTCOME_UNCERTAIN")); } }
      finally { cancelInFlight.current = false; if (request === submitted.current) setSubmitting(false); }
      return;
    }
    if (next === "duo" && !detailsDone || next === "ready" && !both) return;
    onStep(next);
  };
  const field = (name: keyof OnboardingDetails, label: string, type: string, autoComplete: string) => {
    const input = <input id={`auth-${name}`} name={name} type={name === "password" && showPassword ? "text" : type} autoComplete={autoComplete}
      maxLength={160} required value={details[name]} aria-invalid={Boolean(errors[name])} aria-describedby={`auth-${name}-error${signup && name === "password" ? " password-help" : ""}`}
      spellCheck={type === "email" ? false : undefined} inputMode={type === "email" ? "email" : undefined}
      onChange={event => {
        const next = { ...details, [name]: event.target.value }; setForms(current => ({ ...current, [formStep]: next })); setLoginError("");
        if (errors[name]) setErrors(current => ({ ...current, [name]: port.validate(signup ? "signup" : "login", next)[name] }));
      }}
      onBlur={() => { if (details[name]) setErrors(current => ({ ...current, [name]: port.validate(signup ? "signup" : "login", details)[name] })); }} />;
    return <div className="field"><label htmlFor={`auth-${name}`}>{label}<span className="required" aria-hidden="true">*</span><span className="sr-only"> (required)</span></label>
      {name === "password" ? <div className="secret">{input}<button tabIndex={0} className="show-password" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</button></div> : input}
      {signup && name === "password" && <p className="field-help" id="password-help">Use at least 8 characters.</p>}
      <p className="hub-auth-error" id={`auth-${name}-error`} aria-live="polite">{errors[name]}</p></div>;
  };
  const title = step === "login" ? "Log in to Relay" : signup ? "Create your profile" : step === "ready" ? "You’re all set" : both ? "Duo setup is complete" : port.source === "served" ? "Set up Duo" : launching ? "Opening your setup browser…" : closed ? "Pick up where you left off" : failed ? "Reconnect to finish setup" : "Set up your sign-in methods";
  const opening = port.source === "served" && launching && !both;
  const description = step === "login" ? resuming ? "Opening your workspace…" : "Open your workspace." : signup ? "Add your details, then set up Duo." : step === "ready" ? "Your profile and sign-in methods are ready." : both ? "Security key and Touch ID are confirmed. Finish to open Relay."
    : uncertainMethod ? `Relay could not confirm ${uncertainMethod}. In Duo, open Manage devices and remove any device you do not recognize, then start it over in the setup browser.`
    : waitingMethod ? `Finish adding ${waitingMethod} in the setup browser. Relay moves on when Duo shows it was added.`
    : unavailableMethod ? `Relay cannot verify ${unavailableMethod}. Open the setup browser to check it.`
    : launching && port.source !== "served" ? "Relay is opening a browser with Fast Duo installed." : closed ? "The setup browser closed. Reopen it to continue; confirmed methods stay confirmed."
    : failed ? "Relay could not show the setup browser. Reopen it to try again." : "Add your security key and Touch ID in the setup browser, in either order.";
  if (inaccessible) return <div className="hub-onboarding"><div className="brand">Relay</div><main><div className="stack"><h1>Start with your details</h1><p>Complete the previous setup steps to continue.</p><button tabIndex={0} className="btn primary" onClick={() => onStep("login")}>Log in</button></div></main></div>;
  return <div className="hub-onboarding" data-source={port.source}>
    <a tabIndex={0} href="#onboarding-main" className="skip">Skip to content</a><div className="brand">Relay</div>
    <main id="onboarding-main" tabIndex={-1}><div className={`auth-layout${step === "login" ? " login" : ""}`}>
      {step !== "login" && <ol className="progress" aria-label="Profile setup progress">{(["signup", "duo", "ready"] as const).map((item, index) => {
        const current = step === "signup" ? 0 : step === "duo" ? 1 : 2;
        return <li key={item} aria-current={item === step ? "step" : undefined} data-complete={index < current}><button tabIndex={0} className="step-link" type="button" disabled={item === "duo" && !detailsDone || item === "ready" && !both} onClick={() => navigate(item)}><span className="progress-marker" aria-hidden="true">{index < current ? <Check className="icon" /> : index + 1}</span>{["Your details", "Duo setup", "Ready"][index]}</button></li>;
      })}</ol>}
      <div className="stack"><header className="heading"><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{description}</p></header>
        {(step === "login" || signup) ? <><form ref={form} noValidate onSubmit={async event => {
          event.preventDefault();
          if (submitting) return; const nextErrors = port.validate(signup ? "signup" : "login", details); setErrors(nextErrors);
          if (Object.values(nextErrors).some(Boolean)) { form.current?.querySelector<HTMLInputElement>(`[name="${Object.keys(nextErrors)[0]}"]`)?.focus(); return; }
          if (port.source === "served") {
            const request = ++submitted.current;
            setSubmitting(true); setLoginError("");
            try {
              const result: PublicProfileState = await port.submit(signup ? "signup" : "login", details);
              if (request !== submitted.current) return;
              if (result.state === PROFILE_ONBOARDING_STATE) {
                setForms(current => ({ ...current, [formStep]: { ...current[formStep], password: "" } }));
                onStep(result.step); return;
              }
              if (result.state === "signed-out") {
                setForms(current => current[formStep] === details ? { ...current, [formStep]: { ...current[formStep], password: "" } } : current);
                onStep("login"); return;
              }
              if (result.state === "cancelling" || result.state === "refused" && result.code === "PROFILE_LOGOUT_BLOCKED") return;
              if (signup || result.state !== "active") {
                setLoginError(operatorFailureSentence(result.state === "refused" || result.state === "error" ? result.code : "PROFILE_LOGOUT_BLOCKED"));
                return;
              }
              setForms(current => current[formStep] === details ? { ...current, [formStep]: { ...current[formStep], password: "" } } : current);
              setDetailsDone(true);
              if (result.duoState === "ready") onDashboard(); else onStep("duo");
            } catch {
              if (request === submitted.current) setLoginError(operatorFailureSentence("PROFILE_AUTHORITY_UNAVAILABLE"));
            } finally { if (request === submitted.current) setSubmitting(false); }
            return;
          }
          const result = signup ? "accepted" : port.login(details);
          if (result !== "accepted") {
            const count = attempts + 1; setAttempts(count);
            if (count >= 3) { setSeconds(30); setAttempts(0); setLoginError("Too many attempts. Wait 30 seconds, then try again."); }
            else setLoginError(result === "unknown-email" ? "No profile uses this email. Check it or sign up." : "Check your UCSD email and password, then try again.");
            return;
          }
          setDetailsDone(true); setAttempts(0); onStep("duo");
        }}>
          {signup && <div className="name-row">{field("firstName", "First name", "text", "given-name")}{field("lastName", "Last name", "text", "family-name")}</div>}
          {field("email", "Work email", "email", "username")}{field("password", "Password", "password", signup ? "new-password" : "current-password")}
          <div className="login-actions"><p className="form-error" role="alert">{loginError || problem}</p><button tabIndex={0} className="btn primary full" type="submit" disabled={seconds > 0 || submitting}>{signup ? "Create profile" : seconds > 0 ? `Log in in 0:${String(seconds).padStart(2, "0")}` : "Log in"}</button></div>
        </form><div className="switch-row"><span>{signup ? "Already have a profile?" : "New to Relay?"}</span><a tabIndex={0} className="text-link" href={`?onboarding=${signup ? "login" : "signup"}`} onClick={async event => { event.preventDefault(); await navigate(signup ? "login" : "signup"); }}>{signup ? "Log in" : "Sign up"}</a></div>
          {!signup && port.source === "mock" && <p className="field-help">Demo: alex.rivera@ucsd.edu / Relay-demo-42</p>}</> : step === "duo" ? <>
          <ul className="method-list" aria-label="Duo methods">{(["key", "touch"] as const).map(method => <li key={method}><span className="method-name">{method === "key" ? <KeyRound className="icon" aria-hidden /> : <Fingerprint className="icon" aria-hidden />}{method === "key" ? "Security key" : "Touch ID"}</span><DuoMethodPill state={draft?.methods[method].state ?? (methods[method] ? "complete" : "idle")} /></li>)}</ul>
          <p className="sr-only" role="status">{duoSummary(methods, draft)}</p>{port.source === "served" && (loginError || problem) && <p className="form-error" role="alert">{loginError || problem}</p>}<footer className="actions"><div className="buttons"><Button variant="ghost" size="sm" disabled={submitting || completionUnknown || port.source === "served" && (draft === undefined || port.unavailable)} onClick={event => requestCancellation("login", event.currentTarget)}>{submitting ? "Cancelling…" : "Cancel sign-up"}</Button><button tabIndex={0} className="btn primary" type="button" aria-busy={opening || undefined} disabled={submitting || completionUnknown || opening} onClick={() => both ? navigate("ready") : browser.open()}>{opening && <LoaderCircle aria-hidden className="icon animate-spin motion-reduce:animate-none" />}{both ? "Finish setup" : closed || failed ? "Reopen browser" : "Show setup browser"}</button></div></footer>
        </> : <>{port.source === "served" && (loginError || problem) && <p className="form-error" role="alert">{loginError || problem}</p>}<ul className="ready-list">{["Your details saved", "Security key confirmed", "Touch ID confirmed"].map(text => <li key={text}><Check className="icon" />{text}</li>)}</ul><button tabIndex={0} className="btn primary" type="button" disabled={!detailsDone || !both || submitting || completionUnknown || port.source === "served" && port.unavailable} onClick={async () => {
          if (port.source === "mock") { onDashboard(); return; }
          if (submitting || completionUnknown || draft?.step !== "ready") return;
          const request = ++submitted.current; setSubmitting(true); setLoginError("");
          try {
            const result = await port.complete();
            if (request !== submitted.current) return;
            if (result.state === "active" && result.duoState === "ready") onDashboard();
            else setLoginError(operatorFailureSentence(result.state === "refused" || result.state === "error" ? result.code : "PROFILE_LOGOUT_BLOCKED"));
          } catch { if (request === submitted.current) { setCompletionUnknown(true); setLoginError(operatorFailureSentence("COMMAND_OUTCOME_UNCERTAIN")); } }
          finally { if (request === submitted.current) setSubmitting(false); }
        }}>Go to dashboard</button></>}
      </div></div></main>
    <Dialog open={cancelCurrent} onOpenChange={open => { if (!open) setCancelTarget(undefined); }}><DialogContent size="sm" title="Cancel sign-up?" description="Your unfinished profile and the credentials you entered are removed from this computer. Devices you added stay in Duo device management." onCloseAutoFocus={event => {
      event.preventDefault();
      (cancelTrigger.current?.isConnected && !cancelTrigger.current.hasAttribute("disabled") ? cancelTrigger.current : heading.current)?.focus();
    }}><DialogFooter><Button variant="secondary" autoFocus onClick={() => setCancelTarget(undefined)}>Keep setting up</Button><Button variant="danger" onClick={() => {
      if (!cancelCurrent || cancelTarget === undefined) return;
      const next = cancelTarget.next; setCancelTarget(undefined); void navigate(next, true);
    }}>Cancel sign-up</Button></DialogFooter></DialogContent></Dialog>
    {port.source === "mock" && <p className="sr-only">UI mock. Browser handoff and Duo results are simulated. No details are sent or saved.</p>}
  </div>;
}

export function DuoMethodPill({ state }: { state: keyof typeof duoMethodLabels }) {
  const Icon = state === "idle" ? CircleDashed : state === "pending" ? LoaderCircle : state === "complete" ? Check : X;
  return <span className="duo-method-pill" data-state={state}><Icon aria-hidden />{duoMethodLabels[state]}</span>;
}
