import { useDelayedLoading } from "../../shared/loading/loading-model.js";
import { useContext, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { BodySection, Button, ButtonLink, Dialog, DialogContent, DialogFooter, FormGroup, ResultRow, Skeleton, dsIcon, FailureNotice } from "../../../ds/ui.js";
import { LoadingRegion, SkeletonText } from "../../shared/loading/loading.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { CHATGPT_USAGE_URL, ChatGptAccountContext, useChatGptAccount, type ChatGptAccountPort } from "./chatgpt-account-model.js";

const FIT = "[&_.ds-result-row-value]:max-w-full [&_.ds-result-row-value]:min-w-0 [&_.ds-result-row-side]:max-w-full";

export function ChatGptAccountSettings({ port: override }: { port?: ChatGptAccountPort }) {
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
  const show = useDelayedLoading(account.state === "loading");
  const displayed = account.state === "unavailable" ? account.account ?? account : account;
  const signingIn = displayed.state === "signing-in";
  const signInExpired = displayed.state === "sign-in-expired";
  const connected = displayed.state === "connected";
  const plan = connected ? displayed.planUsage : undefined;
  const label = "ChatGPT";
  const checkFailed = account.state === "unavailable" && account.account === undefined && port.getResource?.().state !== "refused";
  const held = account.state === "unavailable" && account.account !== undefined && account.account.state !== "signed-out";
  const description = connected ? <><span className="block truncate" title={displayed.name}>{displayed.name}</span>{plan !== "enabled" && <span className="block">{plan === "limit-reached" ? "Usage limit reached" : "ChatGPT plan access not enabled"}</span>}</>
    : signingIn ? "Finish signing in to ChatGPT in your browser."
      : signInExpired ? "Your sign-in attempt expired. Sign in to try again."
        : "Not connected";
  return <BodySection title="Connected account">
      {disconnectError !== undefined && <FailureNotice sentence={disconnectError} stillWorks="ChatGPT is still connected." action={{ label: "Try again", onClick: () => { void disconnect(); } }} />}
      {error !== undefined && <FailureNotice sentence={error} stillWorks="ChatGPT is still not connected." action={{ label: "Try again", onClick: () => { void perform("sign-in"); } }} />}
      {account.state === "unavailable" && !checkFailed && <FailureNotice sentence={account.message}
        stillWorks={held ? "This is the last account Relay confirmed." : "ChatGPT is still not connected."}
        action={!held ? { label: "Try again", onClick: () => { void perform("sign-in"); } } : { label: "Retry", onClick: () => { void port.refresh?.(); } }} />}
    <FormGroup label="Connected account"><div ref={region} data-settings-path="chatgpt.account" onFocusCapture={event => { if (event.target instanceof HTMLElement) actionFocus.current = event.target; }}>
      {checkFailed ? <FailureNotice sentence="Relay couldn't check ChatGPT." stillWorks="Nothing was changed." action={{ label: "Retry", onClick: () => { void port.refresh?.(); } }} />
        : account.state === "loading" ? show && <LoadingRegion label="Loading ChatGPT account"><ResultRow className={FIT} controlWidth="wide" label={<SkeletonText className="w-40" />} description={<SkeletonText className="w-60" />} value={<Skeleton className="h-[var(--ds-h-body-control)] w-48 rounded-[var(--ds-radius-body-control)]" />} /><ResultRow className={FIT} controlWidth="wide" label={<SkeletonText className="w-20" />} value={<Skeleton className="h-[var(--ds-h-body-control)] w-32 rounded-[var(--ds-radius-body-control)]" />} /></LoadingRegion>
        : <ResultRow className={FIT} controlWidth="wide" label={label} description={description}
          value={<div className="flex min-w-0 max-w-full items-center justify-end gap-3">
            {connected && <span className="min-w-0 truncate text-[color:var(--ds-fg-muted)]" title={displayed.email}>{displayed.email}</span>}
            {signingIn && <>
              {"authorizationUrl" in displayed && displayed.authorizationUrl !== undefined && <ButtonLink variant="secondary" href={displayed.authorizationUrl} target="_blank" rel="noopener noreferrer">Reopen sign-in page</ButtonLink>}
              <Button variant="ghost" disabled={pending !== undefined} loading={pending === "cancel"} onClick={() => { void perform("cancel"); }}>Cancel</Button>
            </>}
            {connected && account.state === "connected" && <Button variant="secondary" data-destructive disabled={pending !== undefined} loading={pending === "sign-out"} onClick={() => setConfirming(true)}>Disconnect</Button>}
                        {!signingIn && (!connected || plan === "disabled") && <Button variant="secondary" disabled={pending !== undefined} loading={pending === "sign-in"} onClick={() => { void perform("sign-in"); }}>{signInExpired ? "Sign in" : "Connect"}</Button>}
          </div>} />}
      {!checkFailed && account.state !== "loading" && connected && plan !== "disabled" && <ResultRow className={FIT} controlWidth="wide" label="Manage" value={<div className="flex items-center justify-end gap-2">
        <ButtonLink variant={plan === "limit-reached" ? "primary" : "secondary"} href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" iconAfter={<ExternalLink aria-hidden className={dsIcon.sm} />}>Manage usage</ButtonLink>
      </div>} />}
    </div></FormGroup>
    {confirming && <Dialog open onOpenChange={next => { if (!next) setConfirming(false); }}>
      <DialogContent size="sm" title="Disconnect ChatGPT?" description="Relay forgets this account; the assistant and OCR stop until you connect again.">
        <DialogFooter>
          <Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { void disconnect(); }}>Disconnect</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
  </BodySection>;
}
