/**
 * The phone capture surface (2i-F, D175) — ref data-intake-and-edit-data §5.1's phone half.
 *
 * ## The scene decides the shape
 *
 * Someone from HR is standing at a filing cabinet. Phone in one hand, a paper
 * form in the other, one to six pages to photograph and send. That is the whole
 * brief, and everything below follows from it: ONE page, a persistent action
 * bar in the thumb zone whose VERB changes with the phase, and no navigation to
 * lose your place in. The session is durable, so a dropped connection or a
 * locked screen lands back on exactly this state — which is why nothing here is
 * held in memory that authority does not already hold.
 *
 * Light theme, deliberately. The operator's dashboard is dark because it lives
 * on a desk under office light; this is read at arm's length in daylight beside
 * a cabinet. `capture.html` stamps Paper Ink and carries no `dark` class.
 *
 * ## Three phases, one page
 *
 *   capture  — tiles at rest, camera is the primary verb
 *   review   — the same tiles grow explicit move + remove controls, Send is
 *              the primary verb
 *   settled  — one status region owns the outcome: Sent, naming the run and
 *              manifest the bundle became, or Failed in the server's own words
 *              with Retry and Discard beside it
 *
 * Review and Send are the same screen on purpose. Reordering is the only thing
 * that can still change what the document SAYS, so it belongs beside the button
 * that commits it rather than behind a step the operator would learn to skip.
 *
 * ## Nothing is re-worded, and nothing is substituted
 *
 * Every refusal renders the server's own sentence in a `role="alert"` region
 * that holds its height whether or not it is occupied — a failure that pushes
 * the action bar down under a thumb already travelling toward it is how the
 * wrong control gets pressed. A read that fails leaves the last session on
 * screen and says the read failed; it never falls back to an empty session,
 * because "no photographs yet" would invite six pages to be shot twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ListOrdered, RotateCcw, Send, Trash2 } from "lucide-react";
import type { CaptureSessionWire } from "../../domain/capture-surface.js";
import { cn } from "../lib/utils.js";
import { dsRadius } from "../ds/tokens.js";
import {
  CapturePhoneError,
  movedPhotoOrder,
  photoOrderOf,
  type CapturePhoneClient,
} from "./capture-client.js";
import { PhoneButton, CameraButton } from "./phone-controls.js";
import { PhotoTile, type PhotoPreview } from "./photo-tile.js";

type Resource =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly session: CaptureSessionWire }
  /** The one fail-closed sentence, in the server's words. There is no second. */
  | { readonly state: "refused"; readonly message: string };

function messageOf(error: unknown): string {
  if (error instanceof CapturePhoneError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function pageCount(count: number): string {
  return count === 1 ? "1 page" : `${String(count)} pages`;
}

export function CaptureApp({ client }: { client: CapturePhoneClient }) {
  const [resource, setResource] = useState<Resource>({ state: "loading" });
  /**
   * WHICH control is in flight, not merely THAT one is. Every verb here is a
   * round trip, and locking the page while showing no spinner anywhere means
   * the operator presses Send and the phone appears to do nothing.
   */
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [previews, setPreviews] = useState<Readonly<Record<string, PhotoPreview>>>({});
  /**
   * Which tiles have already taken their place. A photograph that ARRIVES
   * settles; a session re-read after a reload does not, because nothing
   * arrived — the pages were already there.
   */
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const seeded = useRef(false);
  /** Object URLs are a resource, not a value: every one is revoked exactly once. */
  const objectUrls = useRef(new Map<string, string>());

  const session = resource.state === "ready" ? resource.session : undefined;
  const order = useMemo(() => (session === undefined ? [] : photoOrderOf(session)), [session]);

  /* ── the first read ─────────────────────────────────────────────────────── */

  useEffect(() => {
    let live = true;
    client.readSession().then(
      (next) => {
        if (!live) return;
        setResource({ state: "ready", session: next });
      },
      (caught: unknown) => {
        if (!live) return;
        setResource({ state: "refused", message: messageOf(caught) });
      },
    );
    return () => {
      live = false;
    };
  }, [client]);

  /* ── the photographs' own bytes ─────────────────────────────────────────── */

  /**
   * Fetched rather than pointed at. An image element's source attribute cannot
   * carry a header, and the token may not ride a URL, so the bytes come back
   * through the client and become an object URL. The alternative — a
   * query-string token — would put the credential in every access log the
   * tunnel keeps.
   */
  useEffect(() => {
    if (session === undefined) return;
    const wanted = new Set(order);
    for (const [photoId, url] of objectUrls.current) {
      if (wanted.has(photoId)) continue;
      URL.revokeObjectURL(url);
      objectUrls.current.delete(photoId);
      setPreviews((current) => {
        const { [photoId]: _removed, ...rest } = current;
        return rest;
      });
    }
    for (const photoId of order) {
      if (objectUrls.current.has(photoId)) continue;
      // Claimed synchronously so React's double-invoked effects cannot start
      // two fetches for one page.
      objectUrls.current.set(photoId, "");
      setPreviews((current) => ({ ...current, [photoId]: { state: "loading" } }));
      client.photoBytes(photoId).then(
        (bytes) => {
          const url = URL.createObjectURL(bytes.blob);
          if (objectUrls.current.get(photoId) !== "") {
            // The page was removed while its bytes were in flight.
            URL.revokeObjectURL(url);
            return;
          }
          objectUrls.current.set(photoId, url);
          setPreviews((current) => ({ ...current, [photoId]: { state: "ready", url } }));
        },
        (caught: unknown) => {
          // Not swallowed into a blank frame: a blank frame and a blank page
          // look the same, and one of them means a form did not photograph.
          setPreviews((current) => ({
            ...current,
            [photoId]: { state: "failed", message: messageOf(caught) },
          }));
        },
      );
    }
  }, [client, order, session]);

  useEffect(() => () => {
    for (const url of objectUrls.current.values()) {
      if (url !== "") URL.revokeObjectURL(url);
    }
    objectUrls.current.clear();
  }, []);

  /* ── the settle ────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (session === undefined) return;
    if (!seeded.current) {
      // The pages already on the session when this page opened did not arrive.
      seeded.current = true;
      setSettled(new Set(order));
      return;
    }
    if (order.every((photoId) => settled.has(photoId))) return;
    // One frame later, so the transition runs from a painted value.
    const frame = requestAnimationFrame(() => setSettled(new Set(order)));
    return () => cancelAnimationFrame(frame);
  }, [order, session, settled]);

  /* ── the verbs ─────────────────────────────────────────────────────────── */

  /**
   * One shape for every command: name the control, clear the last problem, run
   * it, and replace the session with exactly what the server answered. A
   * failure puts the server's sentence on screen and changes nothing else —
   * the wire is the truth and the next read re-derives it.
   */
  const run = useCallback(
    (control: string, verb: (current: CaptureSessionWire) => Promise<CaptureSessionWire>): void => {
      if (session === undefined) return;
      setPending(control);
      setProblem(null);
      verb(session).then(
        (next) => {
          setPending(null);
          setResource({ state: "ready", session: next });
        },
        (caught: unknown) => {
          setPending(null);
          setProblem(messageOf(caught));
        },
      );
    },
    [session],
  );

  const photograph = useCallback(
    (file: File): void => {
      run("camera", async (current) => client.uploadPhoto({
        expectedVersion: current.version,
        // A browser that cannot name the type sends what it has; the server
        // refuses anything outside image/jpeg and image/png by name.
        mediaType: file.type.length > 0 ? file.type : "application/octet-stream",
        bytes: file,
      }));
    },
    [client, run],
  );

  const move = useCallback(
    (photoId: string, direction: "up" | "down"): void => {
      run(`move:${photoId}`, async (current) =>
        client.reorder(movedPhotoOrder(photoOrderOf(current), photoId, direction), current.version));
    },
    [client, run],
  );

  /* ── what the page is ──────────────────────────────────────────────────── */

  if (resource.state === "loading") {
    return (
      <PhoneFrame ready="loading">
        <p className="phone-text-lead text-[color:var(--ds-fg-muted)]">Opening this capture…</p>
      </PhoneFrame>
    );
  }

  if (resource.state === "refused") {
    return (
      <PhoneFrame ready="refused">
        <div
          role="alert"
          className={cn(
            "flex flex-col gap-[var(--ds-phone-gap)] border p-[var(--ds-phone-inset)]",
            "bg-[var(--ds-status-waiting-bg)] border-[color:var(--ds-status-waiting-border)]",
            dsRadius.lg,
          )}
        >
          <AlertTriangle aria-hidden className="size-6 text-[color:var(--ds-status-waiting-fg)]" />
          <p className="phone-text-lead font-semibold text-[color:var(--ds-fg)]">
            This capture is not open
          </p>
          {/* The server's one sentence for every unresolvable token. */}
          <p className="phone-text text-[color:var(--ds-fg-secondary)]">{resource.message}</p>
        </div>
      </PhoneFrame>
    );
  }

  const current = resource.session;
  const total = current.photos.length;
  const handoff = current.handoff;
  const sending = pending === "finalize" || pending === "retry" || current.state === "finalizing";
  /**
   * The page is ready when the session is read AND every page it holds has
   * resolved its bytes one way or the other. A tile grid half-way through
   * fetching is a half-painted page, so this is the app's own statement about
   * itself rather than a test hook — the parity lane happens to wait on it.
   */
  const ready: "loading" | "true" = order.every((photoId) => {
    const preview = previews[photoId];
    return preview !== undefined && preview.state !== "loading";
  })
    ? "true"
    : "loading";

  /* ── settled: the outcome owns the page ────────────────────────────────── */

  if (handoff.state === "enqueued") {
    return (
      <PhoneFrame ready={ready} session={current}>
        <Outcome
          tone="success"
          icon={<CheckCircle2 aria-hidden className="size-6 text-[color:var(--ds-success-fg)]" />}
          title={`${pageCount(total)} sent`}
        >
          <p className="phone-text text-[color:var(--ds-fg-secondary)]">
            The bundle is in the queue. You can put the phone down.
          </p>
          {/* The identities the handoff produced — the join between this
              bundle and the work it became, so a person can name it later. */}
          <dl className="flex flex-col gap-[var(--ds-space-tight)]">
            <Identity label="Run" value={String(handoff.runId)} />
            <Identity label="Manifest" value={String(handoff.intakeManifestId)} />
          </dl>
        </Outcome>
      </PhoneFrame>
    );
  }

  if (current.state === "discarded") {
    return (
      <PhoneFrame ready={ready} session={current}>
        <Outcome
          tone="neutral"
          icon={<Trash2 aria-hidden className="size-6 text-[color:var(--ds-fg-muted)]" />}
          title="This capture was discarded"
        >
          <p className="phone-text text-[color:var(--ds-fg-secondary)]">
            Nothing was sent. Ask the operator for a new link to start again.
          </p>
        </Outcome>
      </PhoneFrame>
    );
  }

  if (handoff.state === "failed") {
    return (
      <PhoneFrame ready={ready} session={current}>
        <Outcome
          tone="danger"
          icon={<AlertTriangle aria-hidden className="size-6 text-[color:var(--ds-danger)]" />}
          title={`${pageCount(total)} could not be sent`}
        >
          {/* The projector's own recorded reason, verbatim. The person holding
              the phone is the one who has to choose between Retry and Discard,
              and "something went wrong" decides nothing for them. */}
          <p role="alert" className="phone-text text-[color:var(--ds-fg)]">{handoff.message}</p>
        </Outcome>
        {/* OUTSIDE the tinted box. Reserved space inside a coloured panel reads
            as a rendering fault rather than as room held for a message. */}
        <NoticeSlot problem={problem} />
        <ActionBar>
          <PhoneButton
            tone="danger"
            icon={<Trash2 aria-hidden className="size-5" />}
            busy={pending === "discard"}
            disabled={sending}
            onClick={() => run("discard", async (row) => client.discard(row.version))}
          >
            Discard
          </PhoneButton>
          <PhoneButton
            tone="primary"
            grow
            icon={<RotateCcw aria-hidden className="size-5" />}
            busy={pending === "retry"}
            disabled={pending === "discard"}
            onClick={() => run("retry", async (row) => client.retryFinalize(row.version))}
          >
            Try again
          </PhoneButton>
        </ActionBar>
      </PhoneFrame>
    );
  }

  /* ── open: capture, then review ────────────────────────────────────────── */

  return (
    <PhoneFrame ready={ready} session={current}>
      {total === 0
        ? (
          <div className="flex flex-1 flex-col justify-center gap-[var(--ds-phone-gap)] text-center">
            <p className="phone-text-lead font-semibold text-[color:var(--ds-fg)]">
              No pages yet
            </p>
            <p className="phone-text text-[color:var(--ds-fg-muted)]">
              Photograph the form one page at a time. You can reorder or remove a page before you
              send it.
            </p>
          </div>
        )
        : (
          <ol className="flex flex-col gap-[var(--ds-phone-gap)]">
            {order.map((photoId, index) => {
              const photo = current.photos.find((entry) => String(entry.photoId) === photoId);
              if (photo === undefined) {
                throw new Error(`the capture order names photograph ${photoId}, which this session does not hold`);
              }
              return (
                <PhotoTile
                  key={photoId}
                  photo={photo}
                  position={index + 1}
                  total={total}
                  preview={previews[photoId] ?? { state: "loading" }}
                  reordering={reordering}
                  busyControl={pending}
                  enter={settled.has(photoId) ? "to" : "from"}
                  onMove={(direction) => move(photoId, direction)}
                  onRemove={() => run(
                    `remove:${photoId}`,
                    async (row) => client.deletePhoto(photoId, row.version),
                  )}
                />
              );
            })}
          </ol>
        )}

      <NoticeSlot problem={problem} />

      <ActionBar>
        {reordering
          ? (
            <>
              <PhoneButton
                tone="quiet"
                disabled={sending}
                onClick={() => setReordering(false)}
              >
                Done
              </PhoneButton>
              <PhoneButton
                tone="primary"
                grow
                icon={<Send aria-hidden className="size-5" />}
                busy={sending}
                onClick={() => run("finalize", async (row) => client.finalize(row.version))}
              >
                {`Send ${pageCount(total)}`}
              </PhoneButton>
            </>
          )
          : (
            /**
             * THE CAMERA KEEPS THE PRIMARY SLOT while capturing, and Review
             * sits quietly to its left. Two reasons, and the second is a
             * hazard rather than a preference:
             *
             * 1. Photographing is what this phase IS. The operator is going to
             *    press the camera between one and six times and Review once.
             * 2. Review and Send are both "the primary, on the right". If
             *    Review lived there, a second tap of a thumb already
             *    travelling — the commonest phone mis-input there is — would
             *    land on Send and finalize the bundle. Keeping the camera on
             *    the right means the control that changes the bar is never
             *    under the thumb that just pressed it.
             */
            <>
              {total > 0 && (
                <PhoneButton
                  tone="quiet"
                  icon={<ListOrdered aria-hidden className="size-5" />}
                  disabled={pending === "camera"}
                  onClick={() => setReordering(true)}
                >
                  Review
                </PhoneButton>
              )}
              <CameraButton
                tone="primary"
                grow
                label={total === 0 ? "Take the first page" : "Add a page"}
                busy={pending === "camera"}
                disabled={sending}
                onPhotograph={photograph}
              />
            </>
          )}
      </ActionBar>
    </PhoneFrame>
  );
}

/* ── the page's furniture ─────────────────────────────────────────────────── */

/**
 * The frame every phase renders inside: a scrolling body over a bar that never
 * moves. `data-parity-ready` is the app's own statement about itself, the same
 * one the operator shell makes — the parity lane waits on it so a capture can
 * never catch a half-painted page, and a person reading the DOM learns the
 * same thing.
 */
function PhoneFrame({
  ready,
  session,
  children,
}: {
  ready: "loading" | "true" | "refused";
  session?: CaptureSessionWire;
  children: React.ReactNode;
}) {
  return (
    <div
      data-parity-ready={ready}
      className="flex min-h-screen flex-col bg-[var(--ds-surface-page)] text-[color:var(--ds-fg)]"
    >
      <header className="flex flex-col gap-[var(--ds-space-tight)] p-[var(--ds-phone-inset)]">
        <h1 className="phone-text-lead font-semibold text-[color:var(--ds-fg)]">
          {session?.formType ?? "Photograph a form"}
        </h1>
        {session?.contextHint !== undefined && (
          <p className="phone-text text-[color:var(--ds-fg-secondary)]">{session.contextHint}</p>
        )}
      </header>
      <main className="flex flex-1 flex-col gap-[var(--ds-phone-gap)] px-[var(--ds-phone-inset)] pb-[var(--ds-phone-inset)]">
        {children}
      </main>
    </div>
  );
}

/**
 * THE RESERVED NOTICE. It occupies its height whether or not it holds a
 * message, so a refusal appears in place instead of shoving the action bar
 * down under a thumb already moving toward it.
 */
function NoticeSlot({ problem }: { problem: string | null }) {
  return (
    <div className="min-h-[var(--ds-phone-notice-min)] shrink-0">
      {problem !== null && (
        <p
          role="alert"
          className={cn(
            "flex items-start gap-[var(--ds-space-base)] border p-[var(--ds-space-cozy)]",
            "phone-text bg-[var(--ds-danger-quiet)] border-[color:var(--ds-danger-border)]",
            "text-[color:var(--ds-fg)]",
            dsRadius.md,
          )}
        >
          <AlertTriangle aria-hidden className="size-5 shrink-0 text-[color:var(--ds-danger)]" />
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * The bar. `sticky bottom-0` rather than `fixed`, so it participates in the
 * page's own layout and can never overlap the last tile; the safe-area inset is
 * what keeps the primary control clear of a home indicator.
 */
function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 -mx-[var(--ds-phone-inset)] mt-auto flex items-center gap-[var(--ds-phone-gap)]",
        "border-t bg-[var(--ds-surface-1)] border-[color:var(--ds-border)]",
        "px-[var(--ds-phone-inset)] pt-[var(--ds-phone-inset)]",
        "pb-[calc(var(--ds-phone-inset)+env(safe-area-inset-bottom))]",
      )}
    >
      {children}
    </div>
  );
}

function Outcome({
  tone,
  icon,
  title,
  children,
}: {
  tone: "success" | "danger" | "neutral";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const skin: Readonly<Record<"success" | "danger" | "neutral", string>> = {
    success: "bg-[var(--ds-success-bg)] border-[color:var(--ds-success-border)]",
    danger: "bg-[var(--ds-danger-quiet)] border-[color:var(--ds-danger-border)]",
    neutral: "bg-[var(--ds-recess-bg)] border-[color:var(--ds-recess-border)]",
  };
  return (
    <div
      className={cn(
        "flex flex-col gap-[var(--ds-phone-gap)] border p-[var(--ds-phone-inset)]",
        skin[tone],
        dsRadius.lg,
      )}
    >
      {icon}
      <p className="phone-text-lead font-semibold text-[color:var(--ds-fg)]">{title}</p>
      {children}
    </div>
  );
}

/** One handoff identity. Monospace because it is an identifier to be read back. */
function Identity({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[var(--ds-space-hair)]">
      <dt className="phone-text text-[color:var(--ds-fg-muted)]">{label}</dt>
      <dd className="ds-nums phone-text break-all text-[color:var(--ds-fg)]">{value}</dd>
    </div>
  );
}
