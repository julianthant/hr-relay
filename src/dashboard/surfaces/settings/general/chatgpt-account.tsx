import { useDelayedLoading } from "../../shared/loading/loading-model.js";
import { useContext, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Banner, BodySection, Button, ButtonLink, FormGroup, ResultRow, Skeleton, dsIcon } from "../../../ds/ui.js";
import { LoadingRegion, SkeletonText } from "../../shared/loading/loading.js";
import { CHATGPT_USAGE_URL, ChatGptAccountContext, useChatGptAccount, type ChatGptAccountPort } from "./chatgpt-account-model.js";

export function ChatGptAccountSettings({ port: override }: { port?: ChatGptAccountPort }) {
  const contextPort = useContext(ChatGptAccountContext);
  const port = override ?? contextPort;
  const account = useChatGptAccount(port);
  const [pending, setPending] = useState<"sign-in" | "sign-out">();
  const [error, setError] = useState<string>();
  const mounted = useRef(false);
  const locked = useRef(false);
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
  const perform = async (action: "sign-in" | "sign-out") => {
    if (locked.current) return;
    locked.current = true;
    actionFocus.current = document.activeElement instanceof HTMLElement && region.current?.contains(document.activeElement)
      ? document.activeElement : null;
    setPending(action);
    setError(undefined);
    try {
      if (action === "sign-in") await port.signIn({ usePlan: true });
      else await port.signOut();
    } catch {
      if (mounted.current) setError(action === "sign-in"
        ? "ChatGPT sign-in could not be completed. Try again."
        : "Sign-out could not be confirmed. Try again.");
    } finally {
      locked.current = false;
      if (mounted.current) setPending(undefined);
    }
  };
  const show = useDelayedLoading(account.state === "loading");
  const displayed = account.state === "unavailable" ? account.account ?? account : account;
  const connected = displayed.state === "connected";
  const plan = connected ? displayed.planUsage : undefined;
  const label = connected ? displayed.name : displayed.state === "expired" ? "Sign in again" : "Use your ChatGPT plan";
  const description = connected ? <><span className="block break-all">{displayed.email}</span>{plan !== "enabled" && <span className="block">{plan === "limit-reached" ? "Usage limit reached" : "ChatGPT plan access not enabled"}</span>}</>
    : displayed.state === "expired" ? "Your ChatGPT session expired." : "Sign in to use your plan for OCR.";
  return <BodySection title="ChatGPT account">
    <FormGroup label="ChatGPT account"><div ref={region} data-settings-path="chatgpt.account">
      {account.state === "loading" ? show && <LoadingRegion label="Loading ChatGPT account"><ResultRow controlWidth="wide" label={<SkeletonText className="w-40" />} description={<SkeletonText className="w-60" />} value={<Skeleton className="h-[var(--ds-h-body-control)] w-48 rounded-[var(--ds-radius-body-control)]" />} /></LoadingRegion>
        : <ResultRow controlWidth="wide" label={label} description={description}
          value={<div className="flex flex-wrap items-center justify-end gap-2">
            {connected && plan !== "disabled" && <ButtonLink variant={plan === "limit-reached" ? "primary" : "secondary"} href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" iconAfter={<ExternalLink aria-hidden className={dsIcon.sm} />}>Manage usage</ButtonLink>}
            {(!connected || plan === "disabled") && <Button variant="secondary" disabled={pending !== undefined || account.state === "unavailable"} loading={pending === "sign-in"} onClick={() => { void perform("sign-in"); }}>Continue with ChatGPT</Button>}
            {connected && <Button variant="ghost" disabled={pending !== undefined || account.state === "unavailable"} loading={pending === "sign-out"} onClick={() => { void perform("sign-out"); }}>Sign out</Button>}
          </div>} />}
      {account.state === "unavailable" && <Banner tone="warning" title="ChatGPT account unavailable">{account.message}</Banner>}
      {error !== undefined && <Banner tone="danger" title="ChatGPT connection failed">{error}</Banner>}
    </div></FormGroup>
  </BodySection>;
}
