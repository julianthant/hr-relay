import { createRoot } from "react-dom/client";
import { useState } from "react";
import { BodySection, Button, DsBodyScope, FormGroup, PageHeading, ResultRow, Switch, TooltipProvider } from "../../../src/dashboard/ds/ui.js";
import { ChatGptAccountSettings } from "../../../src/dashboard/surfaces/settings/general/chatgpt-account.js";
import type { ChatGptAccountPort, ChatGptAccountResource, ChatGptAccountSnapshot } from "../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { AssistantPermissionsSettings } from "../../../src/dashboard/surfaces/settings/general/hub-preferences.js";
import "../../../src/dashboard/surfaces/settings/hub-settings.css";

/** Top of Settings > General (`built` is the shipped composition; the others are the phase-1 candidates): the ChatGPT card first, the Assistant's Permissions group second, in three structures. */
export const GENERAL_VARIANTS = ["stacked", "one-panel", "status-line", "built"] as const;
export const GENERAL_STATES = ["connected", "not-connected", "signing-in", "limit-reached", "check-failed"] as const;
export type GeneralVariant = typeof GENERAL_VARIANTS[number];
export type GeneralState = typeof GENERAL_STATES[number];

const SNAPSHOTS: Record<GeneralState, ChatGptAccountSnapshot> = {
  connected: { state: "connected", name: "Jordan Lee", email: "jordan.lee@ucsd.example", planUsage: "enabled" },
  "not-connected": { state: "signed-out" },
  "signing-in": { state: "signing-in", attemptId: "attempt-1", expiresAt: "2026-11-17T18:30:00Z", authorizationUrl: "https://auth.example/authorize" },
  "limit-reached": { state: "connected", name: "Jordan Lee", email: "jordan.lee@ucsd.example", planUsage: "limit-reached" },
  "check-failed": { state: "unavailable", message: "Relay couldn't check ChatGPT." },
};

function fixturePort(state: GeneralState): ChatGptAccountPort {
  const snapshot = SNAPSHOTS[state];
  const resource: ChatGptAccountResource = state === "check-failed" ? { state: "failed", code: "CHATGPT_AUTH_UNAVAILABLE" } : { state: "loading" };
  const noop = () => Promise.resolve();
  return { mode: "preview", getSnapshot: () => snapshot, subscribe: () => () => undefined, getResource: () => resource, refresh: noop, signIn: noop, cancelSignIn: noop, signOut: () => Promise.resolve(undefined) };
}

const SUMMARY: Record<GeneralState, { label: string; detail: string; action?: string }> = {
  connected: { label: "Connected", detail: "Jordan Lee · jordan.lee@ucsd.example", action: "Disconnect" },
  "not-connected": { label: "Not connected", detail: "The assistant and OCR need a ChatGPT account.", action: "Connect" },
  "signing-in": { label: "Signing in", detail: "Finish signing in to ChatGPT in your browser.", action: "Cancel" },
  "limit-reached": { label: "Usage limit reached", detail: "Jordan Lee · jordan.lee@ucsd.example", action: "Manage usage" },
  "check-failed": { label: "Could not check", detail: "Relay couldn't check ChatGPT. Nothing was changed.", action: "Retry" },
};

function PermissionsRows() {
  const [fullAccess, setFullAccess] = useState(false);
  return <FormGroup label="Permissions"><div data-settings-path="assistant.fullAccess" className="settings-compact-row">
    <Switch name="assistant.fullAccess" label="Full access" description="Let the assistant choose Full access in its approval menu. Off, every action waits for your confirmation." checked={fullAccess} onCheckedChange={setFullAccess} />
  </div></FormGroup>;
}

function StatusLine({ state }: { state: GeneralState }) {
  const summary = SUMMARY[state];
  return <FormGroup label="ChatGPT"><div data-settings-path="chatgpt.account"><ResultRow controlWidth="wide" label={<span>ChatGPT · <strong>{summary.label}</strong></span>} description={summary.detail}
    value={summary.action === undefined ? null : <Button variant={state === "limit-reached" ? "primary" : "secondary"} onClick={() => undefined}>{summary.action}</Button>} /></div></FormGroup>;
}

function Top({ variant, state }: { variant: GeneralVariant; state: GeneralState }) {
  const port = fixturePort(state);
  return <section className="settings-compact-page"><PageHeading title="General" />
    {variant === "stacked" && <>
      <ChatGptAccountSettings port={port} />
      <BodySection title="Permissions"><PermissionsRows /></BodySection>
    </>}
    {variant === "one-panel" && <BodySection title="Assistant" description="Your ChatGPT connection and what the assistant may do with it.">
      <ChatGptAccountSettings port={port} />
      <BodySection as="h3" title="Permissions"><PermissionsRows /></BodySection>
    </BodySection>}
    {variant === "built" && <><ChatGptAccountSettings port={port} /><AssistantPermissionsSettings /></>}
    {variant === "status-line" && <>
      <BodySection title="ChatGPT"><StatusLine state={state} /></BodySection>
      <BodySection title="Permissions"><PermissionsRows /></BodySection>
    </>}
    <BodySection title="Runs"><FormGroup label="Runs"><div className="settings-compact-row"><Switch label="Prevent sleep while a run is active" checked onCheckedChange={() => undefined} /></div></FormGroup></BodySection>
  </section>;
}

const SCENE_CSS = `.gc-root.ds-body-scope{max-width:none;margin:0}.gc-root{box-sizing:border-box;width:100vw;min-height:100vh;padding:24px 32px;background:var(--ds-surface-0, var(--background));color:var(--ds-fg)}`;

export function GeneralScenePage({ variant, state }: { variant: GeneralVariant; state: GeneralState }) {
  return <TooltipProvider><style>{SCENE_CSS}</style><DsBodyScope className="gc-root"><Top variant={variant} state={state} /></DsBodyScope></TooltipProvider>;
}

function parseOption<T extends string>(value: string | null, options: readonly T[], name: string): T {
  const match = options.find(option => option === value);
  if (match === undefined) throw new Error(`settings-general-chatgpt-${name}-invalid:${String(value)}`);
  return match;
}

/** Browser entry: variant, state and theme come from the URL. */
export function mountGeneralScene(): void {
  const query = new URLSearchParams(location.search);
  const theme = query.get("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-demo-theme", theme);
  document.body.setAttribute("data-demo-theme", theme);
  const root = document.getElementById("root");
  if (root === null) throw new Error("settings-general-chatgpt-root-missing");
  createRoot(root).render(<GeneralScenePage variant={parseOption(query.get("variant"), GENERAL_VARIANTS, "variant")} state={parseOption(query.get("state"), GENERAL_STATES, "state")} />);
}
