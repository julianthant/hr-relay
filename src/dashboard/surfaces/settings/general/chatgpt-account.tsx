import { useContext, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge, Banner, BodySection, Button, ButtonLink, Checkbox, Dialog, DialogContent, DialogFooter, FormGroup, ResultRow, Skeleton, dsIcon } from "../../../ds/ui.js";
import { LoadingRegion, SkeletonText } from "../../shared/loading/loading.js";
import { CHATGPT_USAGE_URL, ChatGptAccountContext, useChatGptAccount, type ChatGptAccountPort } from "./chatgpt-account-model.js";

export function ChatGptAccountSettings({ port: override }: { port?: ChatGptAccountPort }) {
  const contextPort = useContext(ChatGptAccountContext);
  const port = override ?? contextPort;
  const account = useChatGptAccount(port);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [usePlan, setUsePlan] = useState(true);
  const [pending, setPending] = useState<"sign-in" | "sign-out">();
  const [error, setError] = useState<string>();
  const mounted = useRef(false);
  const locked = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const perform = async (action: "sign-in" | "sign-out") => {
    if (locked.current) return;
    locked.current = true;
    setPending(action);
    setError(undefined);
    try {
      if (action === "sign-in") await port.signIn({ usePlan });
      else await port.signOut();
      if (mounted.current) setPreviewOpen(false);
    } catch {
      if (mounted.current) setError(action === "sign-in"
        ? "ChatGPT sign-in could not be completed. Try again."
        : "Sign-out could not be confirmed. Try again.");
    } finally {
      locked.current = false;
      if (mounted.current) setPending(undefined);
    }
  };
  const beginSignIn = () => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(undefined);
    setUsePlan(true);
    if (port.mode === "preview") setPreviewOpen(true);
    else void perform("sign-in");
  };
  const connected = account.state === "connected";
  const plan = connected ? account.planUsage : undefined;
  const label = connected ? account.name : account.state === "expired" ? "Sign in again" : "Use your ChatGPT plan";
  const description = connected ? <><span className="block break-all">{account.email}</span><span className="block">{plan === "enabled" ? "Using ChatGPT plan" : plan === "limit-reached" ? "Usage limit reached" : "ChatGPT plan access not enabled"}</span></>
    : account.state === "expired" ? "Your ChatGPT session expired." : "Sign in to use your plan for OCR.";
  return <BodySection title="ChatGPT account">
    <FormGroup label="ChatGPT account"><div ref={region} data-settings-path="chatgpt.account">
      {account.state === "loading" ? <LoadingRegion label="Loading ChatGPT account"><ResultRow controlWidth="wide" label={<SkeletonText className="w-40" />} description={<SkeletonText className="w-60" />} value={<Skeleton className="h-[var(--ds-h-body-control)] w-48 rounded-[var(--ds-radius-body-control)]" />} /></LoadingRegion>
        : <ResultRow controlWidth="wide" label={<span className="inline-flex flex-wrap items-center gap-2">{label}{port.mode === "preview" && <Badge tone="neutral">Preview</Badge>}</span>} description={description}
          value={<div className="flex flex-wrap items-center justify-end gap-2">
            {connected && plan !== "disabled" && <ButtonLink variant={plan === "limit-reached" ? "primary" : "secondary"} href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" iconAfter={<ExternalLink aria-hidden className={dsIcon.sm} />}>Manage usage</ButtonLink>}
            {(!connected || plan === "disabled") && <Button variant="secondary" disabled={pending !== undefined} loading={pending === "sign-in"} onClick={beginSignIn}>Continue with ChatGPT</Button>}
            {connected && <Button variant="ghost" disabled={pending !== undefined} loading={pending === "sign-out"} onClick={() => { void perform("sign-out"); }}>Sign out</Button>}
          </div>} />}
      {account.state === "unavailable" && <Banner tone="warning" title="ChatGPT account unavailable">{account.message}</Banner>}
      {error !== undefined && !previewOpen && <Banner tone="danger" title="ChatGPT connection failed">{error}</Banner>}
    </div></FormGroup>
    <Dialog open={previewOpen} onOpenChange={open => { if (!locked.current) setPreviewOpen(open); }}>
      <DialogContent size="sm" className="ds-body-overlay" title="Preview ChatGPT sign-in" description="Use a sample account to test this connection. No OpenAI sign-in occurs." onEscapeKeyDown={event => { if (locked.current) event.preventDefault(); }} onCloseAutoFocus={event => {
        const target = trigger.current?.isConnected ? trigger.current : region.current?.querySelector<HTMLElement>("button");
        if (target) { event.preventDefault(); target.focus(); }
        trigger.current = null;
      }}>
        <Checkbox label="Use ChatGPT plan for OCR" checked={usePlan} disabled={pending !== undefined} onCheckedChange={checked => setUsePlan(checked === true)} />
        {error !== undefined && <Banner tone="danger" title="ChatGPT connection failed">{error}</Banner>}
        <DialogFooter><Button variant="secondary" disabled={pending !== undefined} onClick={() => setPreviewOpen(false)}>Cancel</Button><Button loading={pending === "sign-in"} disabled={pending !== undefined} onClick={() => { void perform("sign-in"); }}>Connect preview account</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </BodySection>;
}
