import type { DashboardClient } from "../../client/index.js";
import type { PublicProfileState } from "../../../models/profiles/public-profile.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type OnboardingStep = "login" | "signup" | "duo" | "ready";
export type OnboardingDetails = { firstName: string; lastName: string; email: string; password: string };
export type OnboardingErrors = Partial<Record<keyof OnboardingDetails, string>>;
export type DuoMethods = { key: boolean; touch: boolean };
export interface MockOnboardingPort {
  readonly source: "mock";
  validate(step: "login" | "signup", details: OnboardingDetails): OnboardingErrors;
  login(details: OnboardingDetails): "accepted" | "unknown-email" | "incorrect-password";
  confirm(method: keyof DuoMethods, current: DuoMethods): DuoMethods;
}

export interface ServedOnboardingPort {
  readonly source: "served";
  validate(step: "login" | "signup", details: OnboardingDetails): OnboardingErrors;
  submit(step: "login" | "signup", details: OnboardingDetails): Promise<PublicProfileState>;
}
export type OnboardingPort = MockOnboardingPort | ServedOnboardingPort;

export function validateOnboarding(step: "login" | "signup", details: OnboardingDetails): OnboardingErrors {
    const errors: OnboardingErrors = {};
    if (step === "signup") {
      if (!details.firstName.trim()) errors.firstName = "Enter your first name.";
      if (!details.lastName.trim()) errors.lastName = "Enter your last name.";
    }
    if (!details.email.trim()) errors.email = "Enter your work email.";
    else if (!/^[^\s@]+@ucsd\.edu$/iu.test(details.email.trim())) errors.email = "Use your @ucsd.edu email.";
    if (!details.password) errors.password = "Enter a password.";
    else if (step === "signup" && details.password.length < 8) errors.password = "Use at least 8 characters.";
    return errors;
}

export const mockOnboardingPort: MockOnboardingPort = Object.freeze<MockOnboardingPort>({
  source: "mock",
  validate: validateOnboarding,
  login(details) {
    if (details.email.trim().toLowerCase() !== "alex.rivera@ucsd.edu") return "unknown-email";
    return details.password === "Relay-demo-42" ? "accepted" : "incorrect-password";
  },
  confirm(method, current) { return { ...current, [method]: true }; },
});

export function createServedOnboardingPort(client: DashboardClient, settled: (state: PublicProfileState) => void): ServedOnboardingPort {
  return Object.freeze<ServedOnboardingPort>({ source: "served", validate: validateOnboarding,
    async submit(step, details) {
      const result = step === "signup" ? await client.signUpProfile(details) : await client.signInProfile({ email: details.email, password: details.password });
      settled(result); return result;
    },
  });
}

export function duoSummary(methods: DuoMethods): string {
  if (methods.key && methods.touch) return "Security key and Touch ID ready";
  if (methods.key) return "Security key ready · Touch ID not added";
  if (methods.touch) return "Touch ID ready · Security key not added";
  return "Security key and Touch ID not added";
}

export type DuoBrowserStatus = "launching" | "waiting" | "browser-closed" | "error";
export function parseDuoMessage(value: unknown): DuoMethods | undefined {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "hub-duo-mock" || !("key" in value) || !("touch" in value)) return;
  if (typeof value.key === "boolean" && typeof value.touch === "boolean") return { key: value.key, touch: value.touch };
}
export function useDuoBrowser(methods: DuoMethods, onMethods: (methods: DuoMethods) => void, source: "mock" | "served" = "mock") {
  const child = useRef<Window | null>(null);
  const latest = useRef(methods);
  latest.current = methods;
  const receive = useRef(onMethods);
  receive.current = onMethods;
  const [status, setStatus] = useState<DuoBrowserStatus>(source === "served" ? "error" : "launching");
  useEffect(() => {
    if (source === "served") return;
    const message = (event: MessageEvent<unknown>) => {
      if (!child.current || event.origin !== location.origin || event.source !== child.current) return;
      if (typeof event.data === "object" && event.data !== null && "type" in event.data && event.data.type === "hub-duo-ready") {
        child.current?.postMessage({ type: "hub-duo-mock", ...latest.current }, location.origin);
        setStatus("waiting");
      }
      const next = parseDuoMessage(event.data);
      if (next) { latest.current = { key: latest.current.key || next.key, touch: latest.current.touch || next.touch }; receive.current(latest.current); setStatus("waiting"); }
    };
    const timer = window.setInterval(() => {
      if (child.current?.closed) { child.current = null; setStatus("browser-closed"); }
    }, 500);
    const close = () => child.current?.close();
    window.addEventListener("pagehide", close);
    window.addEventListener("message", message);
    return () => { window.clearInterval(timer); window.removeEventListener("message", message); window.removeEventListener("pagehide", close); close(); };
  }, [source]);
  return { status, open() {
    if (source === "served") { setStatus("error"); return; }
    if (child.current && !child.current.closed) { child.current.focus(); return; }
    child.current = window.open(`${location.pathname}?onboardingSetup=fast`, "hub-duo-setup", "popup,width=1200,height=900");
    setStatus(child.current ? "launching" : "error");
  } };
}

export function useMockDuoSetup() {
  const parent = window.opener as Window | null;
  const [methods, setMethods] = useState<DuoMethods>({ key: false, touch: false });
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [method, setMethod] = useState<keyof DuoMethods>("key");
  const child = useRef<Window | null>(null);
  const latest = useRef(methods);
  latest.current = methods;
  useEffect(() => {
    const message = (event: MessageEvent<unknown>) => {
      if (event.origin !== location.origin) return;
      if (parent && event.source === parent) {
        const next = parseDuoMessage(event.data);
        if (next) { latest.current = next; setMethods(next); setConnected(true); if (next.key) setMethod("touch"); }
      } else if (child.current && event.source === child.current) {
        if (typeof event.data === "object" && event.data !== null && "type" in event.data && event.data.type === "hub-duo-ready") child.current?.postMessage({ type: "hub-duo-mock", ...latest.current }, location.origin);
        const next = parseDuoMessage(event.data);
        if (next) {
          const confirmed = { key: latest.current.key || next.key, touch: latest.current.touch || next.touch };
          latest.current = confirmed;
          setMethods(confirmed); setListening(false); setMethod(confirmed.key ? "touch" : "key");
          parent?.postMessage({ type: "hub-duo-mock", ...confirmed }, location.origin);
        }
      }
    };
    const close = () => child.current?.close();
    window.addEventListener("pagehide", close);
    window.addEventListener("message", message);
    parent?.postMessage({ type: "hub-duo-ready" }, location.origin);
    const timer = window.setInterval(() => { if (child.current?.closed) { child.current = null; setUnavailable(true); setListening(false); } }, 500);
    return () => { window.removeEventListener("message", message); window.removeEventListener("pagehide", close); window.clearInterval(timer); close(); };
  }, [parent]);
  return { methods, connected, unavailable, listening, method, setMethod,
    returnToParent(this: void) { parent?.focus(); },
    cancel() { setListening(false); },
    open(capture: boolean) {
      setListening(capture); setUnavailable(false);
      if (child.current && !child.current.closed) child.current.focus();
      else child.current = window.open(`${location.pathname}?onboardingSetup=duo`, "hub-duo-devices", "popup,width=900,height=800");
      if (!child.current) setUnavailable(true);
    },
    confirm() {
      if (!connected) return;
      const next = mockOnboardingPort.confirm(method, latest.current);
      latest.current = next;
      setMethods(next); parent?.postMessage({ type: "hub-duo-mock", ...next }, location.origin);
    },
  };
}

export function usePublicProfileSession(client: DashboardClient, enabled: boolean) {
  const [settlement, setSettlement] = useState<{ client: DashboardClient; state?: PublicProfileState; failure: boolean }>();
  const state = enabled && settlement?.client === client ? settlement.state : undefined;
  const failure = enabled && settlement?.client === client && settlement.failure;
  const generation = useRef(0);
  const live = useRef(false);
  const invalidate = useCallback(() => { live.current = false; generation.current++; }, []);
  useEffect(() => {
    live.current = enabled;
    if (!enabled) return;
    const request = ++generation.current;
    void client.readProfileSession().then(value => {
      if (live.current && generation.current === request) { setSettlement({ client, state: value, failure: false }); }
    }, () => { if (live.current && generation.current === request) setSettlement({ client, failure: true }); });
    return invalidate;
  }, [client, enabled, invalidate]);
  const port = useMemo<ServedOnboardingPort>(() => ({
    source: "served", validate: validateOnboarding,
    async submit(step, details) {
      const request = ++generation.current;
      return createServedOnboardingPort(client, value => {
        if (live.current && generation.current === request) { setSettlement({ client, state: value, failure: false }); }
      }).submit(step, details);
    },
  }), [client]);
  return { state, failure, port,
    logout: async (): Promise<void> => {
      const request = ++generation.current;
      try {
        const value = await client.logOutProfile();
        if (live.current && generation.current === request) { setSettlement({ client, state: value, failure: false }); }
      } catch { if (live.current && generation.current === request) setSettlement({ client, failure: true }); }
    },
  };
}
