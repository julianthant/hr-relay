/**
 * Start a phone capture — the operator's half of doc 06 §5.1 (2i-F, D175).
 *
 * It sits beside the spreadsheet dropzone because it answers the same question
 * from the other side: the operator is holding either a file or a stack of
 * paper, and this is the paper answer. Everything about it is deliberately
 * small — one button, and what that button returns.
 *
 * ## The token exists for one render and is never stored
 *
 * `POST /api/v1/capture/sessions` is the single moment the raw token exists
 * outside the phone. It is drawn straight into a QR and held in component
 * state; it is never written to the URL, to storage, to a query, or to a log,
 * and the surface offers no way to copy it as text. Closing the panel drops it,
 * which is the correct behaviour — the phone already has it, and a session the
 * operator has lost the link to should be restarted rather than recovered.
 *
 * ## A refused ingress is a CONFIGURATION answer, not a failure
 *
 * `409` means the dashboard cannot produce an origin a phone could reach. That
 * is a named result with a remediation the server wrote, so it renders as the
 * server's own two sentences beside the control that asked — never as a QR
 * pointing at loopback, which scans perfectly and then fails on the phone with
 * a network error that explains nothing.
 */
import { useCallback, useState } from "react";
import { QrCode, Smartphone } from "lucide-react";
import {
  encodeQrCode,
  qrCodeSvgPath,
  qrCodeSvgViewBox,
  type QrCodeMatrix,
} from "../../domain/qr-code.js";
import type { CaptureStartResult } from "../../domain/capture-surface.js";
import { Button, Refusal, SectionLabel, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useDashboardClient } from "../state/client-context.js";

type StartState =
  | { readonly state: "idle" }
  | { readonly state: "starting" }
  | { readonly state: "started"; readonly result: Extract<CaptureStartResult, { state: "started" }> }
  | { readonly state: "refused"; readonly message: string; readonly remediation: string }
  /** A transport or server fault — distinct from a refusal, and said so. */
  | { readonly state: "failed"; readonly message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The symbol, as one `<path>` of 1×1 module rectangles inside the quiet zone's
 * own viewBox. `shape-rendering: crispEdges` matters: the default antialiasing
 * blurs a module boundary at small sizes, and a decoder locks onto edges.
 *
 * The colours are the two that MUST be a genuine light/dark pair for a camera
 * to read the symbol at all — so they are the page's own foreground and card,
 * which are near-black on white in Paper Ink and near-white on graphite in
 * Graphite Warm. A QR is one of the few things in this product where contrast
 * is a functional requirement rather than a legibility one.
 */
function QrSymbol({ matrix, label }: { matrix: QrCodeMatrix; label: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={qrCodeSvgViewBox(matrix)}
      shapeRendering="crispEdges"
      // The light half is the element's own background, so the quiet zone the
      // viewBox reserves is painted by construction rather than by a rect whose
      // origin would have to be kept in step with the margin.
      className="size-[200px] shrink-0 bg-[var(--ds-surface-1)]"
    >
      <path d={qrCodeSvgPath(matrix)} fill="var(--ds-fg)" />
    </svg>
  );
}

export function CaptureStart({
  workflowId,
  workflowLabel,
}: {
  workflowId: string;
  workflowLabel: string;
}) {
  const client = useDashboardClient();
  const [start, setStart] = useState<StartState>({ state: "idle" });

  const begin = useCallback((): void => {
    setStart({ state: "starting" });
    client.startCaptureSession({ workflowId }).then(
      (result) => {
        setStart(result.state === "started"
          ? { state: "started", result }
          : { state: "refused", message: result.message, remediation: result.remediation });
      },
      // Not folded into `refused`: a refusal names a setting to change, and a
      // fault names a system that is down. Telling the operator to edit config
      // because the BFF fell over would send them to the wrong place.
      (caught: unknown) => setStart({ state: "failed", message: messageOf(caught) }),
    );
  }, [client, workflowId]);

  return (
    <section className="flex flex-col gap-[var(--ds-space-base)]">
      <SectionLabel>Or photograph it</SectionLabel>

      {start.state === "started"
        ? (
          <div className="flex items-start gap-[var(--ds-space-loose)]">
            <QrSymbol
              matrix={encodeQrCode(start.result.phoneUrl)}
              label={`QR code opening this capture on a phone, for ${workflowLabel}`}
            />
            <div className="flex flex-col gap-[var(--ds-space-tight)]">
              <p className={cn(dsText.ui, "font-medium text-[color:var(--ds-fg)]")}>
                Scan this with the phone&apos;s camera
              </p>
              <p className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                The link opens a page that photographs pages and sends them here. It is good for one
                capture and expires on its own — this code is the only copy, so leave it on screen
                until the phone has opened it.
              </p>
            </div>
          </div>
        )
        : (
          <div className="flex flex-col items-start gap-[var(--ds-space-base)]">
            {/* `items-start` so the button keeps its own width. A flex column
                stretches its children by default, and a full-bleed 1300px
                control is not this dashboard's idiom — its buttons are
                compact and sit at the left edge of their section. */}
            <Button
              icon={<Smartphone aria-hidden className={dsIcon.md} />}
              loading={start.state === "starting"}
              onClick={begin}
            >
              Start a phone capture
            </Button>
            {start.state === "refused" && (
              <Refusal
                title="No phone can reach this dashboard"
                code="capture ingress"
                outcome={start.remediation}
              >
                {start.message}
              </Refusal>
            )}
            {start.state === "failed" && (
              <Refusal title="The capture could not be started" code="request failed" outcome="no session was opened">
                {start.message}
              </Refusal>
            )}
            {start.state === "idle" && (
              <p className={cn(dsText.body, "flex items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
                <QrCode aria-hidden className={cn(dsIcon.md, "shrink-0")} />
                Photograph a paper form with a phone instead of uploading a file.
              </p>
            )}
          </div>
        )}
    </section>
  );
}
