import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, CircleCheck, Fingerprint, KeyRound, Monitor, PanelTopClose, RefreshCw } from "lucide-react";
import { duoSummary, useDuoBrowser, mockOnboardingPort, type DuoMethods, type OnboardingDetails, type OnboardingErrors, type OnboardingPort, type OnboardingStep } from "./onboarding-model.js";
import "./onboarding.css";

export function Onboarding({ step, onStep, onDashboard, port = mockOnboardingPort, authenticated = false, problem }: {
  step: OnboardingStep; onStep: (step: OnboardingStep) => void; onDashboard: () => void; port?: OnboardingPort; authenticated?: boolean; problem?: string;
}) {
  const [forms, setForms] = useState<Record<"login" | "signup", OnboardingDetails>>({ login: { firstName: "", lastName: "", email: "", password: "" }, signup: { firstName: "", lastName: "", email: "", password: "" } });
  const formStep = step === "login" ? "login" : "signup";
  const details = forms[formStep];
  const previousStep = useRef(step);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [methods, setMethods] = useState<DuoMethods>({ key: false, touch: false });
  const [detailsAccepted, setDetailsDone] = useState(false);
  const detailsDone = port.source === "served" ? authenticated : detailsAccepted;
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef(0);
  useEffect(() => () => { submitted.current++; }, []);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const browser = useDuoBrowser(methods, setMethods, port.source);
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
  const navigate = (next: OnboardingStep) => {
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
  const title = step === "login" ? "Log in to Relay" : signup ? "Create your profile" : step === "ready" ? "You’re all set" : both ? "Duo setup is complete" : launching ? "Opening your setup browser…" : closed ? "Pick up where you left off" : failed ? "Reconnect to finish setup" : "Set up your sign-in methods";
  const description = step === "login" ? "Open your workspace." : signup ? "Add your details, then set up Duo." : step === "ready" ? "Your profile and sign-in methods are ready." : both ? "Security key and Touch ID are confirmed. You can finish your profile." : launching ? "Relay is opening a browser with Fast Duo installed." : closed ? "The setup browser closed. Your confirmed methods are still ready." : failed ? "Fast Duo stopped responding. Reopen the setup browser to continue." : "Add your security key and Touch ID in the setup tabs.";
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
              const result = await port.submit(signup ? "signup" : "login", details);
              if (request !== submitted.current) return;
              if (result.state === "signed-out") {
                setForms(current => current[formStep] === details ? { ...current, [formStep]: { ...current[formStep], password: "" } } : current);
                onStep("login"); return;
              }
              if (result.state !== "active") {
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
        </form><div className="switch-row"><span>{signup ? "Already have a profile?" : "New to Relay?"}</span><a tabIndex={0} className="text-link" href={`?onboarding=${signup ? "login" : "signup"}`} onClick={event => { event.preventDefault(); navigate(signup ? "login" : "signup"); }}>{signup ? "Log in" : "Sign up"}</a></div>
          {!signup && port.source === "mock" && <p className="field-help">Demo: alex.rivera@ucsd.edu / Relay-demo-42</p>}</> : step === "duo" ? <>
          <div className="method-summary" aria-label="Duo method status"><span className={methods.key ? "confirmed" : undefined}>{methods.key ? <Check className="icon" /> : <KeyRound className="icon" />}Security key{methods.key && " confirmed"}</span><span className={methods.touch ? "confirmed" : undefined}>{methods.touch ? <Check className="icon" /> : <Fingerprint className="icon" />}Touch ID{methods.touch && " confirmed"}</span></div>
          <section className="focus-task" aria-label="Next action">{both ? <CircleCheck className="icon" /> : launching ? <Monitor className="icon" /> : closed ? <PanelTopClose className="icon" /> : failed ? <RefreshCw className="icon" /> : methods.key ? <Fingerprint className="icon" /> : <KeyRound className="icon" />}<h2>{both ? "Ready to finish" : launching ? "Preparing Fast Duo" : closed || failed ? `${methods.key ? "Touch ID" : "Security key"} is next` : methods.key ? "Next, add Touch ID" : methods.touch ? "Next, add a security key" : "Start with a security key"}</h2><p>{both ? "Both methods are registered in Duo." : launching ? "The setup page opens in a browser with the Fast Duo extension ready." : closed || failed ? `Reopen the browser, then add ${methods.key ? "Touch ID" : "a security key"}. Your completed methods stay confirmed.` : `In the setup browser, follow Fast Duo’s ${methods.key ? "Touch ID" : "security key"} instructions. You can add the methods in either order.`}</p></section>
          <p className="readiness" role="status">{duoSummary(methods)}</p><footer className="actions"><div className="buttons"><button tabIndex={0} className="btn primary" type="button" onClick={() => both ? navigate("ready") : browser.open()}>{both ? "Finish setup" : closed || failed ? "Reopen browser" : "Show setup browser"}</button></div></footer>
        </> : <><ul className="ready-list">{["Your details saved", "Security key confirmed", "Touch ID confirmed"].map(text => <li key={text}><Check className="icon" />{text}</li>)}</ul><button tabIndex={0} className="btn primary" type="button" disabled={!detailsDone || !both} onClick={onDashboard}>Go to dashboard</button></>}
      </div></div></main>
    {port.source === "mock" && <p className="sr-only">UI mock. Browser handoff and Duo results are simulated. No details are sent or saved.</p>}
  </div>;
}
