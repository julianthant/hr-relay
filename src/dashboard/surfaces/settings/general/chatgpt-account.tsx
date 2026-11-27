import { useContext, useEffect, useRef, useState } from "react";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { cn } from "../../../lib/utils.js";
import { BodySection, Button, ButtonLink, ConfirmDialog, FormGroup, ResultRow, Skeleton, dsIcon } from "../../../ds/ui.js";
import { LoadingRegion, SkeletonText } from "../../shared/loading/loading.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { CHATGPT_USAGE_URL, ChatGptAccountContext, useChatGptAccount, type ChatGptAccountPort } from "./chatgpt-account-model.js";

const FIT = "[&_.ds-result-row-value]:max-w-full [&_.ds-result-row-value]:min-w-0 [&_.ds-result-row-side]:max-w-full";

/** `grouped` renders the status row and its dialog bare, for a caller that owns the surrounding group. */
export function ChatGptAccountSettings({ port: override, grouped = false }: { port?: ChatGptAccountPort; grouped?: boolean }) {
  const contextPort = useContext(ChatGptAccountContext);
  const port = override ?? contextPort;
  const account = useChatGptAccount(port);
  const [pending, setPending] = useState<"sign-in" | "cancel" | "sign-out">();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string>();
  const mounted = useRef(false);
  const locked = useRef(false);
  const actionEpoch = useRef(0);
  const actionFocus = useRef<HTMLElement | null>(null);
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (pending !== undefined) return;
    const previous = actionFocus.current;
    if (previous && !previous.isConnected && document.activeElement === document.body) {
      region.current?.querySelector<HTMLElement>("a,button:not([data-destructive])")?.focus();
    }
    actionFocus.current = null;
  }, [account.state, pending]);
  useEffect(() => {
    if (account.state === "signing-in" || account.state === "sign-in-expired") {
      locked.current = false;
      setPending(undefined);
    }
  }, [account.state]);
  const perform = async (action: "sign-in" | "cancel") => {
    if (locked.current) return;
    locked.current = true;
    const request = ++actionEpoch.current;
    actionFocus.current = document.activeElement instanceof HTMLElement && region.current?.contains(document.activeElement)
      ? document.activeElement : null;
    setPending(action);
    setError(undefined);
    try {
      if (action === "sign-in") await port.signIn({ usePlan: true });
      else await port.cancelSignIn();
    } catch {
      if (mounted.current && request === actionEpoch.current) setError(action === "cancel"
        ? "Sign-in cancellation could not be confirmed. Try again."
        : ERROR_CATALOG.CHATGPT_CONNECT_FAILED.text);
    } finally {
      if (request === actionEpoch.current) {
        locked.current = false;
        if (mounted.current) setPending(undefined);
      }
    }
  };
  const disconnect = async () => {
    setConfirming(false);
    if (locked.current) return;
    locked.current = true;
    const request = ++actionEpoch.current;
    setPending("sign-out");
    setError(undefined);
    setDisconnectError(undefined);
    try {
      const code = await port.signOut();
      if (code !== undefined && mounted.current) setDisconnectError(ERROR_CATALOG[code === "CHATGPT_AUTH_UNAVAILABLE" ? "CHATGPT_DISCONNECT_FAILED" : code].text);
    } catch {
      if (mounted.current) setDisconnectError(ERROR_CATALOG.CHATGPT_DISCONNECT_FAILED.text);
    } finally {
      if (request === actionEpoch.current) {
        locked.current = false;
        if (mounted.current) setPending(undefined);
      }
    }
  };
  const displayed = account.state === "unavailable" ? account.account ?? account : account;
  const signingIn = displayed.state === "signing-in";
  const signInExpired = displayed.state === "sign-in-expired";
  const connected = displayed.state === "connected";
  const plan = connected ? displayed.planUsage : undefined;
  const label = "ChatGPT";
  const checkFailed = account.state === "unavailable" && account.account === undefined && port.getResource?.().state !== "refused";
  const held = account.state === "unavailable" && account.account !== undefined && account.account.state !== "signed-out";
  const failure: { sentence: string; label: string; onClick: () => void } | undefined = disconnectError !== undefined ? { sentence: disconnectError, label: "Try again", onClick: () => { void disconnect(); } }
    : error !== undefined ? { sentence: error, label: "Try again", onClick: () => { void perform("sign-in"); } }
    : account.state !== "unavailable" ? undefined
    : checkFailed ? { sentence: "Couldn't check ChatGPT.", label: "Retry", onClick: () => { void port.refresh?.(); } }
    : held ? { sentence: account.message, label: "Retry", onClick: () => { void port.refresh?.(); } }
    : { sentence: account.message, label: "Try again", onClick: () => { void perform("sign-in"); } };
  const status = failure === undefined ? undefined : <span role="alert" className="flex min-w-0 items-center gap-2"><TriangleAlert aria-hidden className={cn(dsIcon.sm, "shrink-0")} /><span className="truncate" title={failure.sentence}>{failure.sentence}</span></span>;
  const description = connected ? <><span className="flex min-w-0 items-baseline gap-2"><span className="truncate" title={displayed.name}>{displayed.name}</span>{displayed.email !== "" && <span className="min-w-0 truncate text-[color:var(--ds-fg-muted)]" title={displayed.email}>{displayed.email}</span>}</span>{plan !== "enabled" && <span className="block">{plan === "limit-reached" ? "Usage limit reached" : "ChatGPT plan access not enabled"}</span>}</>
    : signingIn ? "Finish signing in to ChatGPT in your browser."
      : signInExpired ? "Your sign-in attempt expired. Sign in to try again."
        : "Not connected";
  const row = checkFailed && failure !== undefined ? <ResultRow className={FIT} controlWidth="wide" label={label}
          description={status}
          value={<Button variant="secondary" disabled={pending !== undefined} onClick={failure.onClick}>{failure.label}</Button>} />
        : account.state === "loading" ? <LoadingRegion label="Loading ChatGPT account"><ResultRow className={FIT} controlWidth="wide" label={<SkeletonText className="w-40" />} description={<SkeletonText className="w-60" />} value={<Skeleton className="h-[var(--ds-h-body-control)] w-48 rounded-[var(--ds-radius-body-control)]" />} /></LoadingRegion>
        : <ResultRow className={FIT} controlWidth="wide" label={label} description={status === undefined ? description : <span className="flex min-w-0 flex-col gap-1">{description}{status}</span>}
          value={<div className="flex min-w-0 max-w-full items-center justify-end gap-3">
            {held && failure !== undefined && <Button variant="secondary" onClick={failure.onClick}>{failure.label}</Button>}
            {signingIn && <>
              {"authorizationUrl" in displayed && displayed.authorizationUrl !== undefined && <ButtonLink variant="secondary" href={displayed.authorizationUrl} target="_blank" rel="noopener noreferrer">Reopen sign-in page</ButtonLink>}
              <Button variant="secondary" disabled={pending !== undefined} loading={pending === "cancel"} onClick={() => { void perform("cancel"); }}>Cancel</Button>
            </>}
            {connected && plan !== "disabled" && <ButtonLink variant="secondary" href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" iconAfter={<ExternalLink aria-hidden className={dsIcon.sm} />}>Manage usage</ButtonLink>}
            {connected && account.state === "connected" && <Button variant="secondary" data-destructive disabled={pending !== undefined} loading={pending === "sign-out"} onClick={() => setConfirming(true)}>Disconnect</Button>}
            {!signingIn && (!connected || plan === "disabled") && <Button variant="secondary" disabled={pending !== undefined} loading={pending === "sign-in"} onClick={() => { void perform("sign-in"); }}>{signInExpired ? "Sign in" : "Connect"}</Button>}
          </div>} />;
  const dialog = <ConfirmDialog open={confirming} onOpenChange={setConfirming} title="Disconnect ChatGPT?" description="Assistant and OCR stop until you sign in." confirmLabel="Disconnect" destructive onConfirm={() => { void disconnect(); }} />;
  const content = <>
    <div ref={region} data-settings-path="chatgpt.account" onFocusCapture={event => { if (event.target instanceof HTMLElement) actionFocus.current = event.target; }}>
      {grouped ? row : <FormGroup label="ChatGPT">{row}</FormGroup>}
    </div>
    {dialog}
  </>;
  return grouped ? content : <BodySection title="ChatGPT" description="Account the assistant signs in with.">{content}</BodySection>;
}
