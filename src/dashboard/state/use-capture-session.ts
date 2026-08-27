/**
 * The desktop's read of a phone capture (D274 item 7, ledger 3 CP2/CP21).
 *
 * Capture is the one live thing on this dashboard the day stream does not
 * carry: a capture session is not a run, so no SSE envelope moves when a page
 * lands. Until one exists these two reads POLL, and the poll is written to be
 * legible about that rather than dressed up as a subscription:
 *
 * - **It stops at a terminal phase.** `ready`, `discarded` and `expired` are
 *   ends of the state machine, so a session in one of them cannot move again
 *   and a tick that re-read it would be spending a request to be told so.
 * - **A failed read keeps ticking, and keeps SAYING it failed.** Re-issuing the
 *   same GET is a retry, not a substituted value, so it is the sanctioned kind
 *   of recovery — but the surface holds the failure until a read actually
 *   succeeds, because "the request died" and "the session is empty" are the two
 *   things this dashboard may never draw identically.
 * - **Nothing here derives a fact from the poll.** No arrival instants, no
 *   "last seen", no client-side page counting: the wire's fields are the whole
 *   of what the panel knows, and a tick only replaces them with newer ones.
 */
import { useEffect, useState } from "react";
import type {
  CaptureOperatorSessionListWire,
  CaptureOperatorSessionWire,
} from "../../domain/capture-operator.js";
import { DashboardClientError } from "../client/index.js";
import { failed, IDLE, loaded, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

/**
 * How often the OPEN session is re-read while it can still move.
 *
 * A phone pushes one page at a time over a human-paced camera loop, so two
 * seconds is the difference between "it appeared as I put the phone down" and
 * "it appeared". Faster buys nothing an operator can perceive; slower makes the
 * contact sheet feel like it is lagging the phone in the operator's hand.
 */
export const CAPTURE_SESSION_POLL_MS = 2_000;

/**
 * How often the ACTIVE LIST is re-read.
 *
 * Slower on purpose: the list changes only when a session is minted or ends,
 * which is an operator-paced event, and this read runs for as long as the
 * intake screen is open whether or not any capture exists.
 */
export const CAPTURE_SESSION_LIST_POLL_MS = 5_000;

/**
 * The three phases a session cannot leave. Everything else — including
 * `blocked`, whose finalization the phone may still retry — can still move, so
 * it keeps its tick.
 */
export const CAPTURE_TERMINAL_PHASES = Object.freeze(["ready", "discarded", "expired"] as const);

export function isCaptureSessionSettled(session: CaptureOperatorSessionWire): boolean {
  return (CAPTURE_TERMINAL_PHASES as readonly string[]).includes(session.phase);
}

/** Every active capture session, re-read on a slow tick. */
export function useActiveCaptureSessions(): AsyncResource<CaptureOperatorSessionListWire> {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<CaptureOperatorSessionListWire>>(LOADING);

  useEffect(() => {
    let live = true;
    let handle: ReturnType<typeof setTimeout> | undefined;

    const tick = (): void => {
      client.activeCaptureSessions().then(
        (value) => {
          if (!live) return;
          setResource(loaded(value));
          handle = setTimeout(tick, CAPTURE_SESSION_LIST_POLL_MS);
        },
        (error: unknown) => {
          if (!live) return;
          if (!(error instanceof DashboardClientError)) throw error;
          setResource(failed(error));
          handle = setTimeout(tick, CAPTURE_SESSION_LIST_POLL_MS);
        },
      );
    };

    tick();
    return () => {
      live = false;
      if (handle !== undefined) clearTimeout(handle);
    };
  }, [client]);

  return resource;
}

/**
 * ONE capture session, re-read while it can still move.
 *
 * A session ALREADY on screen keeps its last wire while the next read is in
 * flight — a contact sheet that blanked to a skeleton every two seconds would
 * be unreadable for exactly the captures worth watching. Switching to a
 * different session still loads, because the panel beside a session it is not
 * about is the wrong answer rather than a stale one (the rule `useRunDetail`
 * settled for run detail, landing here for the same reason).
 */
export function useCaptureSession(sessionId: string | undefined): AsyncResource<CaptureOperatorSessionWire> {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<CaptureOperatorSessionWire>>(IDLE);

  useEffect(() => {
    if (sessionId === undefined) {
      setResource(IDLE);
      return;
    }
    let live = true;
    let handle: ReturnType<typeof setTimeout> | undefined;

    setResource((current) => (
      current.state === "loaded" && current.value.sessionId === sessionId ? current : LOADING
    ));

    const tick = (): void => {
      client.captureSession(sessionId).then(
        (value) => {
          if (!live) return;
          setResource(loaded(value));
          // A settled session is the END of the state machine, so there is
          // nothing left for a tick to observe. Scheduling one anyway would
          // poll a finalized capture forever.
          if (isCaptureSessionSettled(value)) return;
          handle = setTimeout(tick, CAPTURE_SESSION_POLL_MS);
        },
        (error: unknown) => {
          if (!live) return;
          if (!(error instanceof DashboardClientError)) throw error;
          setResource(failed(error));
          handle = setTimeout(tick, CAPTURE_SESSION_POLL_MS);
        },
      );
    };

    tick();
    return () => {
      live = false;
      if (handle !== undefined) clearTimeout(handle);
    };
  }, [client, sessionId]);

  return resource;
}
