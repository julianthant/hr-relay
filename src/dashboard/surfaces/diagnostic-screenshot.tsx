import { Download, Expand } from "lucide-react";
import { useMemo } from "react";
import type { DiagnosticBundleWire } from "../../domain/dashboard/diagnostic-bundle.js";
import {
  BareButton,
  Banner, Button, ButtonLink, Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger,
  SectionLabel, dsFocus, dsIcon, dsRadius, dsText,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import {
  diagnosticScreenshots, screenshotDownloadAllowed, screenshotFilename, screenshotResourceKey, useDiagnosticScreenshot,
  type DiagnosticScreenshot, type ScreenshotState,
} from "./diagnostic-screenshot-model.js";
import { diagnosticScreenshotLabel } from "./trust-model.js";

export function DiagnosticScreenshotGallery({ bundle, attachmentUrl, readBundle }: {
  bundle: DiagnosticBundleWire;
  attachmentUrl: (artifactId: string) => string;
  readBundle: (bundleId: string, signal?: AbortSignal) => Promise<DiagnosticBundleWire>;
}) {
  const screenshots = useMemo(() => diagnosticScreenshots(bundle), [bundle]);
  if (screenshots.length === 0) return null;
  return (
    <section aria-label="Diagnostic screenshots" className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>Screenshots</SectionLabel>
      <div className="grid grid-cols-2 gap-[var(--ds-space-base)]">
        {screenshots.map((screenshot, index) => (
          <ScreenshotResource
            key={screenshotResourceKey(bundle, screenshot)}
            bundle={bundle}
            screenshot={screenshot}
            index={index}
            total={screenshots.length}
            url={attachmentUrl(screenshot.artifactId)}
            readBundle={readBundle}
          />
        ))}
      </div>
    </section>
  );
}

function ScreenshotResource({ bundle, screenshot, index, total, url, readBundle }: {
  bundle: DiagnosticBundleWire;
  screenshot: DiagnosticScreenshot;
  index: number;
  total: number;
  url: string;
  readBundle: (bundleId: string, signal?: AbortSignal) => Promise<DiagnosticBundleWire>;
}) {
  const { state, dispatch, triggerRef } = useDiagnosticScreenshot(bundle, screenshot, readBundle);
  const label = diagnosticScreenshotLabel(index, total);
  return (
    <Dialog open={state.lightbox !== "closed"} onOpenChange={(open) => dispatch({ type: open ? "open" : "close" })}>
      <DialogTrigger asChild>
        <BareButton
          ref={triggerRef}
          type="button"
          aria-label={`Open ${label}`}
          aria-busy={state.authority.state === "rechecking" || (state.authority.state === "verified" && state.thumbnail === "loading") || undefined}
          className={cn(
            "group relative min-h-11 min-w-0 overflow-hidden border bg-[var(--ds-surface-1)] text-left",
            "cursor-pointer hover:border-[color:var(--ds-border-strong)] hover:bg-[var(--ds-surface-2)]",
            "border-[color:var(--ds-border)]", dsRadius.md, dsFocus,
          )}
        >
          <span className="relative flex max-h-[62vh] w-full items-center justify-center" style={{ aspectRatio: `${String(screenshot.width)} / ${String(screenshot.height)}` }}>
            {state.authority.state === "verified" && state.thumbnail !== "deferred" && (
              <img
                alt={label}
                width={screenshot.width}
                height={screenshot.height}
                loading="lazy"
                decoding="async"
                className={cn("absolute inset-0 h-full w-full object-contain", state.thumbnail === "loading" && "invisible")}
                src={url}
                onLoad={() => dispatch({ type: "loaded", view: "thumbnail" })}
                onError={() => dispatch({ type: "failed" })}
              />
            )}
            <ScreenshotStatus state={state} view="thumbnail" />
          </span>
          <span className={cn(
            "flex min-h-11 items-center justify-between gap-[var(--ds-space-snug)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
            dsText.meta, "text-[color:var(--ds-fg)]",
          )}>
            <span>{label}</span>
            <Expand aria-hidden className={cn(dsIcon.sm, "shrink-0")} />
          </span>
        </BareButton>
      </DialogTrigger>
      {state.lightbox !== "closed" && (
        <DialogContent size="lg" hideClose title={label} description={`${String(screenshot.width)} × ${String(screenshot.height)} px · ${screenshot.sensitivity} at capture`}>
          <DialogBody className="flex min-w-0 flex-col gap-[var(--ds-space-base)] bg-[var(--ds-surface-1)]">
            {screenshot.sensitivity === "restricted" && <RestrictedScreenshotWarning />}
            <div className="relative flex max-h-[62vh] w-full shrink-0 items-center justify-center" style={{ aspectRatio: `${String(screenshot.width)} / ${String(screenshot.height)}` }}>
            {state.authority.state === "verified" && (
              <img
                alt={label}
                width={screenshot.width}
                height={screenshot.height}
                loading="eager"
                decoding="async"
                className={cn("absolute inset-0 h-full w-full object-contain", state.lightbox === "loading" && "invisible")}
                src={url}
                onLoad={() => dispatch({ type: "loaded", view: "lightbox" })}
                onError={() => dispatch({ type: "failed" })}
              />
            )}
            <ScreenshotStatus state={state} view="lightbox" />
            </div>
          </DialogBody>
          <DialogFooter className="[&>span]:min-w-0 [&>span]:shrink [&>span]:flex-wrap [&>span]:justify-end">
            <Button variant="secondary" className="min-h-11 min-w-11" onClick={() => dispatch({ type: "close" })}>Back to screenshots</Button>
            {screenshotDownloadAllowed(state) && (
              <ButtonLink variant="primary" className="min-h-11 min-w-11" icon={<Download aria-hidden className={dsIcon.md} />} href={url} download={screenshotFilename(screenshot.mediaType, index)}>
                Download screenshot
              </ButtonLink>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

function ScreenshotStatus({ state, view }: { state: ScreenshotState; view: "thumbnail" | "lightbox" }) {
  if (state.authority.state === "unavailable") {
    const failure = state.authority.failure;
    return view === "thumbnail" ? (
      <span className={cn(dsText.meta, "break-words px-[var(--ds-space-base)] text-center text-[color:var(--ds-fg-secondary)]")}>
        {failure.title}: {failure.message}
      </span>
    ) : (
      <Banner tone={failure.kind === "authority" || failure.kind === "identity-mismatch" ? "danger" : "warning"} title={failure.title}>
        {failure.message}
      </Banner>
    );
  }
  if (state.authority.state === "verified" && state[view] === "ready") return null;
  return (
    <span role="status" className={cn(dsText.meta, "px-[var(--ds-space-base)] text-center text-[color:var(--ds-fg-secondary)]")}>
      {state.authority.state === "rechecking" ? "Verifying the stored screenshot attachment…"
        : state[view] === "deferred" ? "Preview loads when visible" : "Loading screenshot…"}
    </span>
  );
}

export function RestrictedScreenshotWarning() {
  return (
    <Banner tone="warning" title="Restricted screenshots may contain sensitive visible information">
      This screenshot was permitted as restricted diagnostic evidence. Review it before sharing; the dashboard does not redact image pixels.
    </Banner>
  );
}
