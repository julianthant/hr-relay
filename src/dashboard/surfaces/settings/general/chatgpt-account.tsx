import { useDelayedLoading } from "../../shared/loading/loading-model.js";
import { useContext, useEffect, useRef, useState } from "react";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { ExternalLink } from "lucide-react";
import { Banner, BodySection, Button, ButtonLink, FormGroup, ResultRow, Skeleton, dsIcon } from "../../../ds/ui.js";
import { LoadingRegion, SkeletonText } from "../../shared/loading/loading.js";
import { CHATGPT_USAGE_URL, ChatGptAccountContext, useChatGptAccount, type ChatGptAccountPort, type ChatGptOcrTestSnapshot } from "./chatgpt-account-model.js";

export function ChatGptAccountSettings({ port: override }: { port?: ChatGptAccountPort }) {
  const contextPort = useContext(ChatGptAccountContext);
  const port = override ?? contextPort;
  const account = useChatGptAccount(port);
  const [pending, setPending] = useState<"sign-in" | "sign-out" | "cancel" | "test-ocr">();
  const [ocrFailed, setOcrFailed] = useState(false);
  const [error, setError] = useState<string>();
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
      region.current?.querySelector<HTMLElement>("a,button")?.focus();
    }
    actionFocus.current = null;
  }, [account.state, pending]);
  useEffect(() => {
    if (account.state === "signing-in" || account.state === "sign-in-expired") {
      locked.current = false;
      setPending(undefined);
    }
  }, [account.state]);
  const perform = async (action: "sign-in" | "sign-out" | "cancel" | "test-ocr") => {
    if (locked.current) return;
    locked.current = true;
    const request = ++actionEpoch.current;
    actionFocus.current = document.activeElement instanceof HTMLElement && region.current?.contains(document.activeElement)
      ? document.activeElement : null;
    setPending(action);
    setError(undefined);
    setOcrFailed(false);
    try {
      if (action === "sign-in") await port.signIn({ usePlan: true });
      else if (action === "cancel") await port.cancelSignIn();
      else if (action === "test-ocr") await port.testOcr();
      else await port.signOut();
    } catch {
      if (mounted.current && request === actionEpoch.current && action === "test-ocr") setOcrFailed(true);
      else if (mounted.current && request === actionEpoch.current) setError(action === "cancel"
        ? "Sign-in cancellation could not be confirmed. Try again."
        : action === "sign-in"
        ? "ChatGPT sign-in could not be completed. Try again."
        : "Sign-out could not be confirmed. Try again.");
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
  const ocr: ChatGptOcrTestSnapshot | undefined = ocrFailed ? { state: "failed", code: "CHATGPT_OCR_FAILED" } : account.ocrTest;
  const canTest = account.state === "connected" && plan === "enabled" && ocr?.state !== "uncertain";
  const label = connected ? displayed.name : displayed.state === "expired" ? "Sign in again" : "Use your ChatGPT plan";
  const description = connected ? <><span className="block break-all">{displayed.email}</span>{plan !== "enabled" && <span className="block">{plan === "limit-reached" ? "Usage limit reached" : "ChatGPT plan access not enabled"}</span>}</>
    : signingIn ? "Waiting for you to finish signing in in your browser"
      : signInExpired ? "Your sign-in attempt expired. Sign in to try again."
        : displayed.state === "expired" ? "Your ChatGPT session expired. Reconnect to continue." : "Not connected. Connect your ChatGPT account to Relay.";
  return <BodySection title="ChatGPT account">
      {account.state === "unavailable" && <Banner className="mb-[var(--ds-space-heading-content)]" tone="warning" title="ChatGPT account unavailable">{account.message}</Banner>}
      {error !== undefined && <Banner className="mb-[var(--ds-space-heading-content)]" tone="danger" title="ChatGPT connection failed">{error}</Banner>}
    {ocr !== undefined && <div className="mb-[var(--ds-space-heading-content)]" aria-live="polite">
      <Banner tone={ocr.state === "completed" ? "success" : ocr.state === "loading" ? "info" : ocr.state === "failed" ? "danger" : "warning"}
        title={ocr.state === "completed" ? "OCR test completed" : ocr.state === "loading" ? "Testing OCR" : ocr.state === "uncertain" ? "OCR test outcome uncertain" : ocr.state === "refused" ? "OCR test refused" : "OCR test failed"}>
        {ocr.state === "completed" ? `Model: ${ocr.model}` : ocr.state === "loading" ? "Reading the fixed synthetic test page." : ERROR_CATALOG[ocr.code].text}
      </Banner>
    </div>}
    <FormGroup label="ChatGPT account"><div ref={region} data-settings-path="chatgpt.account" onFocusCapture={event => { if (event.target instanceof HTMLElement) actionFocus.current = event.target; }}>
      {account.state === "loading" ? show && <LoadingRegion label="Loading ChatGPT account"><ResultRow controlWidth="wide" label={<SkeletonText className="w-40" />} description={<SkeletonText className="w-60" />} value={<Skeleton className="h-[var(--ds-h-body-control)] w-48 rounded-[var(--ds-radius-body-control)]" />} /></LoadingRegion>
        : <ResultRow controlWidth="wide" label={label} description={description}
          value={<div className="flex flex-wrap items-center justify-end gap-2">
            {connected && plan !== "disabled" && <ButtonLink variant={plan === "limit-reached" ? "primary" : "secondary"} href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" iconAfter={<ExternalLink aria-hidden className={dsIcon.sm} />}>Manage usage</ButtonLink>}
            {signingIn && <>
              {"authorizationUrl" in displayed && displayed.authorizationUrl !== undefined && <ButtonLink variant="secondary" href={displayed.authorizationUrl} target="_blank" rel="noopener noreferrer">Reopen sign-in page</ButtonLink>}
              <Button variant="ghost" disabled={pending !== undefined} loading={pending === "cancel"} onClick={() => { void perform("cancel"); }}>Cancel</Button>
            </>}
            {!signingIn && (!connected || plan === "disabled") && <Button variant="secondary" disabled={pending !== undefined} loading={pending === "sign-in"} onClick={() => { void perform("sign-in"); }}>{signInExpired ? "Sign in" : displayed.state === "expired" ? "Reconnect" : "Connect ChatGPT"}</Button>}
            {connected && <Button variant="secondary" disabled={!canTest || pending !== undefined || ocr?.state === "loading"} loading={pending === "test-ocr" || ocr?.state === "loading"} onClick={() => { void perform("test-ocr"); }}>Test OCR</Button>}
            {(connected || displayed.state === "expired") && <Button variant="ghost" disabled={pending !== undefined} loading={pending === "sign-out"} onClick={() => { void perform("sign-out"); }}>Disconnect</Button>}
          </div>} />}
    </div></FormGroup>
  </BodySection>;
}
