/** One exact capture list serves its canonical Receipt placement and compact Logs placement. */
import { Banner, Button, ButtonLink, Dialog, DialogBody, DialogClose, DialogContent, DialogFooter,
  DialogTrigger, EmptyState, SectionLabel, Skeleton, dsRadius, dsText } from "../ds/ui.js";
import type { RunCaptureArtifactWire } from "../../domain/dashboard/run-detail.js";
import { cn } from "../lib/utils.js";
import { runCaptureFrame, useRunCaptureImage, type RunCaptureItem, type RunCapturesState } from "./run-captures-model.js";

export function RunCaptures({ captures, compact = false }: { captures: RunCapturesState; compact?: boolean }) {
  if (captures.state === "inactive") return null;
  return (
    <section
      aria-label="Run captures"
      className={cn(
        "flex min-w-0 flex-col",
        compact
          ? "gap-[var(--ds-space-tight)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]"
          : "gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]",
      )}
    >
      <SectionLabel>Captures</SectionLabel>
      {captures.state === "absent" && <EmptyState title="No captures" description={captures.reason} />}
      {captures.state === "loading" && <Skeleton className="h-[var(--ds-h-row)] w-full" />}
      {captures.state === "error" && <Banner tone="danger" title="Captures could not be read">{captures.message}</Banner>}
      {captures.state === "available" && captures.items.map(item => (
        <article
          key={`${captures.runId}:${String(captures.generation)}:${item.capture.artifact.artifactId}`}
          className={cn(
            runCaptureFrame(item.capture),
            dsRadius.md,
            "min-w-0",
            compact ? "p-[var(--ds-space-snug)]" : "p-[var(--ds-space-base)]",
          )}
        >
          <RunCaptureFacts capture={item.capture} />
          {compact && item.capture.artifact.mediaKind === "image" && <RunCaptureImagePreview item={item} />}
          <div className={cn(
            "flex flex-wrap gap-[var(--ds-space-base)]",
            compact ? "pt-[var(--ds-space-snug)]" : "pt-[var(--ds-space-base)]",
          )}>
            {item.capture.artifact.mediaKind === "image" && (
              <Dialog open={captures.selectedId === item.capture.artifact.artifactId}
                onOpenChange={open => { captures.select(open ? item.capture.artifact.artifactId : undefined); }}>
                <DialogTrigger asChild>
                  <Button variant="secondary" aria-label={`Open capture ${item.capture.artifact.artifactId}`}>Preview</Button>
                </DialogTrigger>
                <DialogContent size="xl" hideClose title="Run capture" description={`Artifact ${item.capture.artifact.artifactId}`}>
                  <DialogBody className="flex flex-col gap-[var(--ds-space-loose)]">
                    <RunCaptureImagePreview item={item} />
                    <RunCaptureFacts capture={item.capture} />
                  </DialogBody>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="ghost">Close</Button></DialogClose>
                    <ButtonLink href={item.downloadUrl} download={`capture-${item.capture.artifact.artifactId}`}>Download</ButtonLink>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            <ButtonLink href={item.downloadUrl} download={`capture-${item.capture.artifact.artifactId}`} variant="secondary">Download</ButtonLink>
          </div>
        </article>
      ))}
    </section>
  );
}

function RunCaptureImagePreview({ item }: { item: RunCaptureItem }) {
  const image = useRunCaptureImage(item.capture.artifact);
  const { artifact } = item.capture;
  if (artifact.mediaKind !== "image") throw new Error("Only an image capture has an inline preview.");
  return (
    <figure aria-label="Run capture preview" aria-busy={image.state === "loading"}
      className={cn(dsRadius.md, runCaptureFrame(item.capture), "flex max-h-[56dvh] w-full shrink-0 flex-col overflow-hidden bg-[color:var(--ds-surface-2)]")}
      style={{ aspectRatio: `${String(artifact.width)} / ${String(artifact.height)}` }}>
      <div className="relative min-h-0 flex-1">
        {image.state === "loading" && <>
          <Skeleton className="absolute inset-0 h-full w-full" />
          <span role="status" className="sr-only">Loading capture image…</span>
        </>}
        <img ref={image.bind} src={item.downloadUrl} loading="eager" width={artifact.width} height={artifact.height}
          alt={image.state === "ready" ? `Capture ${artifact.artifactId}` : ""} aria-hidden={image.state === "ready" ? undefined : true}
          className={cn("absolute inset-0 h-full w-full object-contain", image.state !== "ready" && "opacity-0")}
          onLoad={event => { image.decode(event.currentTarget); }} onError={event => { image.fail(event.currentTarget); }} />
        {image.state === "failed" && <div className="absolute inset-0 overflow-auto"><Banner tone="danger" title="Capture image could not be displayed">The browser could not load or decode this capture with its recorded dimensions.</Banner></div>}
      </div>
      <figcaption className={cn(dsText.meta, "min-h-[calc(1lh+var(--ds-space-tight)*2)] shrink-0 break-words bg-[color:var(--ds-surface-2)] px-[var(--ds-space-snug)] py-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
        {image.state === "ready" && "Image decoded"}
      </figcaption>
    </figure>
  );
}

function RunCaptureFacts({ capture }: { capture: RunCaptureArtifactWire }) {
  const { artifact, origins } = capture;
  return (
    <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
      {artifact.sensitivity === "restricted" && <Banner tone="warning" title="Restricted capture">{artifact.redaction}</Banner>}
      <dl className={cn(dsText.body, "grid min-w-0 gap-[var(--ds-space-tight)] [overflow-wrap:anywhere]")}>
        <div><dt>Artifact</dt><dd className={dsText.nums}>{artifact.artifactId}</dd></div>
        <div><dt>Media</dt><dd>{artifact.mediaKind} · {artifact.mediaType}</dd></div>
        <div><dt>Size</dt><dd className={dsText.nums}>{artifact.byteLength} bytes</dd></div>
        <div><dt>SHA-256</dt><dd className={dsText.nums}>{artifact.sha256}</dd></div>
        <div><dt>Sensitivity</dt><dd>{artifact.sensitivity}</dd></div>
        <div><dt>Redaction</dt><dd>{artifact.redaction}</dd></div>
        {artifact.mediaKind === "image" && <div><dt>Dimensions</dt><dd>{artifact.width} × {artifact.height}</dd></div>}
        {artifact.mediaKind === "pdf" && <div><dt>Pages</dt><dd>{artifact.pageCount}</dd></div>}
      </dl>
      <ul aria-label="Capture origins" className={cn(dsText.body, "[overflow-wrap:anywhere]")}>
        {origins.map(origin => <li key={origin.bundleId}>{origin.originKind} · <span className={dsText.nums}>{origin.bundleId}</span></li>)}
      </ul>
    </div>
  );
}
