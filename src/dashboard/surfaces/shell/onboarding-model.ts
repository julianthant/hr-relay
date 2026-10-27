import type { DashboardClient } from "../../client/index.js";
import type { ConfirmProfileOnboardingDuoRequest, ProfileOnboardingState, ProfileOnboardingMethod, PublicProfileState } from "../../../models/profiles/public-profile.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type OnboardingStep = "login" | "signup" | "duo" | "ready";
export type OnboardingDetails = { firstName: string; lastName: string; email: string; password: string };
export type OnboardingErrors = Partial<Record<keyof OnboardingDetails, string>>;
export type DuoMethods = { key: boolean; touch: boolean };
export interface MockOnboardingPort {
  readonly source: "mock";
  validate(this: void, step: "login" | "signup", details: OnboardingDetails): OnboardingErrors;
  login(details: OnboardingDetails): "accepted" | "unknown-email" | "incorrect-password";
  confirm(method: keyof DuoMethods, current: DuoMethods): DuoMethods;
}

export type DuoConfirmationScope = Readonly<Pick<ConfirmProfileOnboardingDuoRequest, "operationId" | "method" | "attemptId"> & {
  profileId: ProfileOnboardingState["profileId"]; generation: number; authorityScope: object | undefined;
}>;

export interface ServedOnboardingPort {
  readonly source: "served";
  readonly onboarding?: ProfileOnboardingState;
  readonly unavailable?: boolean;
  readonly authorityScope?: object;
  complete(): Promise<PublicProfileState>;
  cancel(): Promise<PublicProfileState>;
  cancelDuo(method: ProfileOnboardingMethod, attemptId: string): Promise<PublicProfileState>;
  showBrowser(): Promise<PublicProfileState>;
  openPortal(): Promise<PublicProfileState>;
  start(method: ProfileOnboardingMethod): Promise<PublicProfileState>;
  confirmDuo(scope: DuoConfirmationScope): Promise<PublicProfileState>;
  validate(this: void, step: "login" | "signup", details: OnboardingDetails): OnboardingErrors;
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

export function createServedOnboardingPort(client: DashboardClient, settled: (state: PublicProfileState) => void, onboarding?: ProfileOnboardingState): ServedOnboardingPort {
  const accept = (result: PublicProfileState, allowActive = false) => {
    if (result.state === "active" && !allowActive) throw new Error("ONBOARDING_DRAFT_REQUIRED");
    if (onboarding && (result.state === "onboarding" && (result.operationId !== onboarding.operationId || result.profileId !== onboarding.profileId)
      || result.state === "active" && (result.profileId !== onboarding.profileId || result.duoState !== "ready"))) throw new Error("ONBOARDING_SCOPE_REPLACED");
    settled(result); return result;
  };
  return Object.freeze<ServedOnboardingPort>({ source: "served", validate: validateOnboarding, onboarding,
    async complete() { if (!onboarding) throw new Error("ONBOARDING_DRAFT_REQUIRED"); const result = await client.completeProfileOnboarding({ operationId: onboarding.operationId }); return accept(result, true); },
    async cancel() { if (!onboarding) throw new Error("ONBOARDING_DRAFT_REQUIRED"); const result = await client.cancelProfileOnboarding({ operationId: onboarding.operationId }); return accept(result); },
    async cancelDuo(method, attemptId) { if (!onboarding) throw new Error("ONBOARDING_DRAFT_REQUIRED"); return accept(await client.cancelProfileOnboardingDuo({ operationId: onboarding.operationId, method, attemptId })); },
    async showBrowser() { if (!onboarding) throw new Error("ONBOARDING_DRAFT_REQUIRED"); return accept(await client.showProfileOnboardingBrowser({ operationId: onboarding.operationId })); },
    async openPortal() { if (!onboarding) throw new Error("ONBOARDING_DRAFT_REQUIRED"); return accept(await client.openProfileOnboardingPortal({ operationId: onboarding.operationId })); },
    async start(method) { if (!onboarding) throw new Error("ONBOARDING_DRAFT_REQUIRED"); const result = await client.startProfileOnboardingDuo({ operationId: onboarding.operationId, method }); return accept(result); },
    async confirmDuo(scope) {
      if (!onboarding || scope.operationId !== onboarding.operationId || scope.profileId !== onboarding.profileId) throw new Error("ONBOARDING_SCOPE_REPLACED");
      const result = await client.confirmProfileOnboardingDuo({ operationId: scope.operationId, method: scope.method, attemptId: scope.attemptId, operatorConfirmed: true });
      return accept(result);
    },
    async submit(step, details) {
      const result = step === "signup" ? await client.signUpProfile(details) : await client.signInProfile({ email: details.email, password: details.password });
      if (step === "signup" && result.state !== "onboarding" && result.state !== "refused" && result.state !== "error") throw new Error("ONBOARDING_DRAFT_REQUIRED");
      return accept(result, step === "login");
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
export function useDuoBrowser(methods: DuoMethods, onMethods: (methods: DuoMethods) => void, source: "mock" | "served" = "mock", operationId?: string, served?: ServedOnboardingPort) {
  const child = useRef<Window | null>(null);
  const latest = useRef(methods);
  latest.current = methods;
  const receive = useRef(onMethods);
  receive.current = onMethods;
  const [status, setStatus] = useState<DuoBrowserStatus>("launching");
  useEffect(() => {
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
    if (source === "mock") window.addEventListener("message", message);
    return () => { window.clearInterval(timer); window.removeEventListener("message", message); window.removeEventListener("pagehide", close); close(); };
  }, [source, operationId]);
  return { status: source === "served" && operationId === undefined ? "error" as const : status, async open() {
    if (source === "served") {
      if (!served || !operationId || served.unavailable) { setStatus("error"); return; }
      setStatus("launching");
      try { const result = await served.showBrowser(); setStatus(result.state === "onboarding" ? "waiting" : "error"); }
      catch { setStatus("error"); }
      return;
    }
    if (child.current && !child.current.closed) { child.current.focus(); return; }
    child.current = window.open(`${location.pathname}?onboardingSetup=fast`, "hub-duo-setup", "popup,width=1200,height=900");
    setStatus(child.current ? "launching" : "error");
  } };
}

export function useMockDuoSetup(enabled = true) {
  const parent = enabled ? window.opener as Window | null : null;
  const [methods, setMethods] = useState<DuoMethods>({ key: false, touch: false });
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [method, setMethod] = useState<keyof DuoMethods>("key");
  const child = useRef<Window | null>(null);
  const latest = useRef(methods);
  latest.current = methods;
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, parent]);
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
  const busy = useRef(false);
  const settle = useCallback((value: PublicProfileState) => {
    setSettlement(current => ({ client, state: value.state === "refused" || value.state === "error"
      ? current?.client === client && current.state?.state === "onboarding" ? current.state : value : value, failure: current?.client === client && current.state?.state === "onboarding" && (value.state === "refused" || value.state === "error") }));
  }, [client]);
  useEffect(() => {
    live.current = enabled; busy.current = false;
    if (!enabled) return;
    const lifetime = generation;
    const request = ++generation.current;
    void client.readProfileSession().then(value => {
      if (live.current && generation.current === request) settle(value);
    }, () => { if (live.current && generation.current === request) setSettlement({ client, failure: true }); });
    return () => { live.current = false; lifetime.current++; };
  }, [client, enabled, settle]);
  const onboarding = state?.state === "onboarding" ? state : undefined;
  useEffect(() => {
    if (!enabled || !onboarding) return;
    let reading = false;
    const timer = window.setInterval(() => {
      if (busy.current || reading) return;
      reading = true;
      const request = ++generation.current;
      void client.readProfileSession().then(value => {
        if (live.current && generation.current === request) {
          if (value.state === "onboarding" && (value.operationId !== onboarding.operationId || value.profileId !== onboarding.profileId)
            || value.state === "active" && value.profileId !== onboarding.profileId) {
            setSettlement(current => current?.client === client ? { ...current, failure: true } : current); return;
          }
          settle(value);
        }
      }, () => { if (live.current && generation.current === request) setSettlement(current => current?.client === client ? { ...current, failure: true } : current); }).finally(() => { reading = false; });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [client, enabled, onboarding, settle]);
  const scope = useMemo(() => ({ client, operationId: onboarding?.operationId, failure }), [client, onboarding?.operationId, failure]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const port = useMemo<ServedOnboardingPort>(() => {
    const run = async (action: (port: ServedOnboardingPort) => Promise<PublicProfileState>) => {
      if (!live.current || currentScope.current !== scope || failure && onboarding !== undefined) throw new Error("ONBOARDING_SCOPE_REPLACED");
      const request = ++generation.current;
      busy.current = true;
      try {
        const result = await action(createServedOnboardingPort(client, value => {
          if (live.current && generation.current === request && currentScope.current === scope) settle(value);
        }, onboarding));
        if (!live.current || generation.current !== request) throw new Error("ONBOARDING_SCOPE_REPLACED");
        return result;
      } finally { if (generation.current === request) busy.current = false; }
    };
    return { source: "served", validate: validateOnboarding, onboarding, unavailable: Boolean(failure), authorityScope: scope,
      submit: (step, details) => run(port => port.submit(step, details)),
      complete: () => run(port => port.complete()), cancel: () => run(port => port.cancel()),
      cancelDuo: (method, attemptId) => run(port => port.cancelDuo(method, attemptId)),
      showBrowser: () => run(port => port.showBrowser()), openPortal: () => run(port => port.openPortal()),
      start: method => run(port => port.start(method)), confirmDuo: scope => run(port => port.confirmDuo(scope)),
    };
  }, [client, onboarding, scope, settle, failure]);
  return { state, failure, port,
    logout: async (): Promise<void> => {
      const request = ++generation.current; busy.current = true;
      try { const value = await client.logOutProfile(); if (live.current && generation.current === request) settle(value); }
      catch { if (live.current && generation.current === request) setSettlement({ client, failure: true }); }
      finally { if (generation.current === request) busy.current = false; }
    },
  };
}

export function useServedDuoSetup(port?: ServedOnboardingPort) {
  const [method, setMethod] = useState<ProfileOnboardingMethod>("key");
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const generation = useRef(0);
  const child = useRef<Window | null>(null);
  const draft = port?.onboarding;
  const current = useRef({ port, method }); current.current = { port, method };
  const matchesConfirmation = (scope: DuoConfirmationScope): boolean => {
    const latest = current.current, active = latest.port?.onboarding;
    return !latest.port?.unavailable && latest.port?.authorityScope === scope.authorityScope && generation.current === scope.generation && latest.method === scope.method
      && active?.operationId === scope.operationId && active.profileId === scope.profileId
      && active.methods[scope.method].state === "pending" && active.methods[scope.method].attemptId === scope.attemptId;
  };
  useEffect(() => { const lifetime = generation; generation.current++; setPending(false); setUnavailable(false); return () => { lifetime.current++; child.current?.close(); child.current = null; }; }, [draft?.operationId, port?.authorityScope]);
  const run = async (action: () => Promise<PublicProfileState>) => {
    if (pending || !port) return;
    const request = ++generation.current; setPending(true); setUnavailable(false);
    try {
      const result = await action();
      if (request === generation.current) { setUnavailable(result.state !== "onboarding"); return result; }
    }
    catch { if (request === generation.current) setUnavailable(true); }
    finally { if (request === generation.current) setPending(false); }
  };
  return { methods: { key: draft?.methods.key.state === "complete", touch: draft?.methods.touch.state === "complete" },
    connected: draft !== undefined && !port?.unavailable, unavailable: unavailable || port?.unavailable || draft?.methods[method].state === "unknown" || draft?.methods[method].state === "unavailable", listening: pending || draft?.methods[method].state === "pending", method, setMethod(next: ProfileOnboardingMethod) { if (next !== current.current.method) generation.current++; setMethod(next); }, matchesConfirmation,
    dismissConfirmation(scope: DuoConfirmationScope) { if (scope.generation === generation.current) generation.current++; },
    returnToParent() { const opener = window.opener as WindowProxy | null; opener?.focus(); },
    cancel() { const attemptId = draft?.methods[method].attemptId; if (port && attemptId) void run(() => port.cancelDuo(method, attemptId)); },
    open(capture: boolean) {
      if (!port || !draft || port.unavailable) return;
      if (!capture) { void run(() => port.openPortal()); return; }
      if (draft.methods[method].state === "idle") void run(() => port.start(method));
    },
    async start(selected: ProfileOnboardingMethod): Promise<DuoConfirmationScope | undefined> {
      const latest = current.current.port, active = latest?.onboarding;
      if (!latest || !active || latest.unavailable) return;
      const result = active.methods[selected].state === "idle" ? await run(() => latest.start(selected)) : active;
      if (result?.state !== "onboarding" || result.operationId !== active.operationId || result.profileId !== active.profileId) return;
      const attempt = result.methods[selected];
      if (attempt.state !== "pending" || !attempt.attemptId) return;
      return { operationId: result.operationId, profileId: result.profileId, method: selected, attemptId: attempt.attemptId, generation: ++generation.current, authorityScope: latest.authorityScope };
    },
    confirm(scope: DuoConfirmationScope) {
      if (!matchesConfirmation(scope)) { setUnavailable(true); return; }
      const latest = current.current.port;
      if (latest) void run(() => latest.confirmDuo(scope));
    },
  };
}
