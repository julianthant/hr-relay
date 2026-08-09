/**
 * The capture surface service (doc 06 §5.1, doc 11, doc 12 §7, D174).
 *
 * The phone never speaks the command protocol. It presents a token and a verb;
 * this service turns that into exactly one of D167's seven journaled capture
 * arms, so the phone gets a small, closed API and authority still records the
 * same envelope an operator's own click would have produced. The one thing it
 * does NOT route through a command is CREATION: like the intake upload (D170),
 * starting a capture mints a credential, and a credential does not belong in a
 * journaled envelope — so there is no `capture-open` arm and the service owns
 * the create.
 *
 * ## Fail-closed enumeration
 *
 * `resolveToken` returns ONE refusal for every way a token can fail to name a
 * live session — unknown, expired, discarded, finalized-and-gone, malformed.
 * A phone on a public origin that could tell "no such session" from "not
 * yours" is an existence oracle, so the difference is deliberately not
 * observable. Only failures of an action on a session the caller has PROVEN it
 * holds the token for are named.
 *
 * ## Expiry is a durable transition, not a filter
 *
 * A session past `expiresAt` is written to `expired` before it is refused, so
 * a restarted dashboard does not re-open a window the clock already closed.
 * The two budgets are doc 06 §5.1's: `preConnectTtlMs` from creation, then
 * `activeIdleTtlMs` from the phone's first connect. The active budget is set
 * ONCE, at connect, rather than sliding on every read — a GET that rewrites
 * authority on every poll is a mutation wearing a read's clothes.
 */
import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import type { Config } from "../../../domain/config/schema.js";
import type { IdFactory } from "../../../domain/identifiers.js";
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import type { ContentAddressedArtifactWriter } from "../../../base/artifacts.js";
import type { CaptureSession } from "../../../domain/capture.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import type { DashboardCommandService } from "./command-service.js";
import { CaptureSessionSchema } from "../../../domain/capture.js";
import {
  CAPTURE_UNKNOWN_SESSION_MESSAGE,
  CaptureSessionWireSchema,
  CaptureStartResultSchema,
  CaptureTokenSchema,
  CaptureUploadMediaTypeSchema,
  CaptureIngressResolutionSchema,
  capturePhoneUrl,
  deriveCaptureOriginDigest,
  deriveCaptureTokenDigest,
  type CaptureIngressResolution,
  type CapturePhoneRefusalCode,
  type CaptureSessionWire,
  type CaptureStartResult,
} from "../../../domain/capture-surface.js";
import { CapturePhotoIdSchema, CaptureSessionIdSchema } from "../../../domain/ids.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../domain/ids.js";

/* ── refusals ────────────────────────────────────────────────────────────── */

/**
 * Thrown by every capture route boundary. It carries a CLOSED code so the
 * route maps it to a status without matching on prose, and it is deliberately
 * not a `WireError` — the route owns that translation.
 */
export class CaptureRefusal extends Error {
  readonly code: CapturePhoneRefusalCode;

  constructor(code: CapturePhoneRefusalCode, message: string) {
    super(message);
    this.name = "CaptureRefusal";
    this.code = code;
  }
}

function unknownSession(): never {
  throw new CaptureRefusal("unknown-session", CAPTURE_UNKNOWN_SESSION_MESSAGE);
}

/* ── the service ─────────────────────────────────────────────────────────── */

export interface CaptureStartRequest {
  readonly workflow: string;
  readonly formType?: string;
  readonly contextHint?: string;
}

export interface CapturePhotoUpload {
  readonly photoId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface CaptureCommandRequestFacts {
  readonly commandId: string;
  readonly expectedVersion: number;
}

export interface CapturePhotoBytes {
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface CaptureService {
  /** Loopback-only: mints the session AND the one raw token that ever exists. */
  start(request: CaptureStartRequest): Promise<CaptureStartResult>;
  /** Loopback-only: the operator's view of a session it already knows by id. */
  readSession(sessionId: string): CaptureSessionWire;
  /** Every phone route begins here. One refusal for every unresolvable token. */
  readByToken(token: string): CaptureSessionWire;
  uploadPhoto(token: string, upload: CapturePhotoUpload): Promise<CaptureSessionWire>;
  replacePhoto(token: string, upload: CapturePhotoUpload): Promise<CaptureSessionWire>;
  readPhotoBytes(token: string, photoId: string): Promise<CapturePhotoBytes>;
  deletePhoto(token: string, photoId: string, facts: CaptureCommandRequestFacts): CaptureSessionWire;
  reorder(token: string, orderedPhotoIds: readonly string[], facts: CaptureCommandRequestFacts): CaptureSessionWire;
  finalize(token: string, facts: CaptureCommandRequestFacts): Promise<CaptureSessionWire>;
  retryFinalize(token: string, facts: CaptureCommandRequestFacts): Promise<CaptureSessionWire>;
  discard(token: string, facts: CaptureCommandRequestFacts): CaptureSessionWire;
  /** Restart recovery: drain anything the last process left `pending`. */
  drainFinalizations(): Promise<void>;
}

export interface CaptureServiceDependencies {
  readonly authorityRead: Readonly<{
    getCaptureSession(sessionId: string): CaptureSession | undefined;
    findCaptureSessionByTokenDigest(tokenDigest: string): CaptureSession | undefined;
  }>;
  readonly authority: Readonly<{
    withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
  }>;
  readonly commands: DashboardCommandService;
  readonly descriptors: Readonly<{ resolve(workflowId: string): AnyWorkflowDescriptor | undefined }>;
  readonly artifacts: ContentAddressedArtifactWriter;
  readonly finalizations: Readonly<{ projectPending(): Promise<unknown> }>;
  readonly config: Config;
  /** Resolved once per process; a refusal is a NAMED configuration result. */
  readonly ingress: () => CaptureIngressResolution;
  /** 32 random bytes, base64url. Injected so a test can pin the credential. */
  readonly mintToken: () => string;
  readonly clock: Clock;
  readonly ids: IdFactory;
}

/** Every capture command this surface issues came from the phone (D174). */
const PHONE_SOURCE = "capture-phone";

/** The phone's own commands are still the local operator's acts (doc 12 §7). */
const ACTOR = LOCAL_OPERATOR_ACTOR_ID;

export function createCaptureService(dependencies: CaptureServiceDependencies): CaptureService {
  const captureConfig = dependencies.config.capture;

  function toWire(session: CaptureSession): CaptureSessionWire {
    return CaptureSessionWireSchema.parse({
      wireVersion: 1,
      sessionId: session.sessionId,
      workflow: session.workflow,
      ...(session.formType === undefined ? {} : { formType: session.formType }),
      ...(session.contextHint === undefined ? {} : { contextHint: session.contextHint }),
      state: session.state,
      photos: [...session.photoRefs]
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((photo) => ({
          photoId: photo.photoId,
          ordinal: photo.ordinal,
          mediaType: photo.artifact.mediaType,
          bytes: photo.artifact.bytes,
          artifactId: photo.artifact.id,
        })),
      ...(session.finalArtifact === undefined ? {} : {
        finalArtifact: {
          artifactId: session.finalArtifact.id,
          sha256: session.finalArtifact.sha256,
          bytes: session.finalArtifact.bytes,
        },
      }),
      handoff: session.handoff.state === "failed"
        // The phone's operator is the person who decides between Retry and
        // Discard, and the failure id decides nothing for them — so the wire
        // carries the projector's own recorded reason instead.
        ? { state: "failed", message: failedHandoffMessage(session) }
        : session.handoff,
      finalizationGeneration: session.finalizationGeneration,
      version: session.version,
      createdAt: session.createdAt,
      ...(session.connectedAt === undefined ? {} : { connectedAt: session.connectedAt }),
      expiresAt: session.expiresAt,
      ...(session.ingress === undefined ? {} : { ingress: session.ingress }),
    });
  }

  /**
   * The failed handoff's own recorded reason, read from the row the projector
   * wrote. It is deliberately NOT looked up in `failures`: a `FailureRecord`
   * binds a run, and a handoff that never reached one has no such row — a
   * lookup there always misses, and the `?? "something went wrong"` it invites
   * would hide exactly the sentence the operator needs. A row that records a
   * failure without its reason is a defect, so it throws by name.
   */
  function failedHandoffMessage(session: CaptureSession): string {
    if (session.handoff.state !== "failed") {
      throw new Error(`capture session ${session.sessionId} has no failure to describe`);
    }
    const { message } = session.handoff;
    if (message === undefined) {
      throw new Error(
        `capture session ${session.sessionId} records a failed handoff (${session.handoff.failureId}) with no `
        + "reason, so there is nothing honest to show the operator holding the phone",
      );
    }
    return message;
  }

  /**
   * The one durable expiry transition. It runs before every resolution so the
   * row is right, not merely the answer — and it applies ONLY to `open`: a
   * `finalizing` session is mid-flight and its outbox outlives any clock.
   */
  function expireIfOverdue(session: CaptureSession): CaptureSession {
    if (session.state !== "open") return session;
    const now = dependencies.clock.now();
    if (Date.parse(session.expiresAt) > now.getTime()) return session;
    return dependencies.authority.withAuthorityTransaction((repositories) =>
      repositories.captureSessions.update(CaptureSessionSchema.parse({
        ...session,
        state: "expired",
        version: session.version + 1,
      })));
  }

  /** Stamps the active budget once, on the phone's first appearance. */
  function connectIfFirstTouch(session: CaptureSession): CaptureSession {
    if (session.state !== "open" || session.connectedAt !== undefined) return session;
    const now = dependencies.clock.now();
    return dependencies.authority.withAuthorityTransaction((repositories) =>
      repositories.captureSessions.update(CaptureSessionSchema.parse({
        ...session,
        connectedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + captureConfig.activeIdleTtlMs).toISOString(),
        version: session.version + 1,
      })));
  }

  /**
   * Token → session, or the ONE refusal. Every branch below produces the same
   * message on purpose; a difference here is an enumeration oracle.
   */
  function resolveToken(token: string): CaptureSession {
    const parsed = CaptureTokenSchema.safeParse(token);
    if (!parsed.success) unknownSession();
    const found = dependencies.authorityRead.findCaptureSessionByTokenDigest(
      deriveCaptureTokenDigest(parsed.data),
    );
    if (found === undefined) unknownSession();
    const current = expireIfOverdue(found);
    if (current.state === "discarded" || current.state === "expired") unknownSession();
    return connectIfFirstTouch(current);
  }

  function reread(sessionId: string): CaptureSessionWire {
    const session = dependencies.authorityRead.getCaptureSession(sessionId);
    if (session === undefined) {
      throw new Error(`capture session ${sessionId} vanished between its own command and its read-back`);
    }
    return toWire(session);
  }

  /**
   * One capture command, executed and translated. A `rejected` result is the
   * kernel's own sentence — the phone shows it verbatim rather than a generic
   * "could not save", because the kernel is the only thing that knows why.
   */
  function runCommand(input: Record<string, unknown>, sessionId: string): CaptureSessionWire {
    const result = dependencies.commands.execute(input);
    if (result.state === "rejected") throw new CaptureRefusal("invalid-state", result.message);
    if (result.state === "conflict") throw new CaptureRefusal("invalid-state", result.message);
    return reread(sessionId);
  }

  function envelope(
    type: string,
    session: CaptureSession,
    facts: CaptureCommandRequestFacts,
    source: string,
  ): Record<string, unknown> {
    return {
      commandId: facts.commandId,
      requestedAt: dependencies.clock.now().toISOString(),
      requestedBy: ACTOR,
      source,
      family: "capture",
      type,
      target: { captureSessionId: session.sessionId, expectedVersion: facts.expectedVersion },
    };
  }

  async function acceptPhoto(upload: CapturePhotoUpload): Promise<Record<string, unknown>> {
    const mediaType = CaptureUploadMediaTypeSchema.safeParse(upload.mediaType);
    if (!mediaType.success) {
      throw new CaptureRefusal(
        "unsupported-media-type",
        `a capture photograph must be image/jpeg or image/png; this one declared ${upload.mediaType || "nothing"}`,
      );
    }
    if (upload.bytes.byteLength === 0) {
      throw new CaptureRefusal("empty-upload", "that photograph arrived with no bytes; take it again");
    }
    if (upload.bytes.byteLength > captureConfig.maxPhotoBytes) {
      throw new CaptureRefusal(
        "upload-too-large",
        `that photograph is ${String(upload.bytes.byteLength)} bytes, over the ${String(captureConfig.maxPhotoBytes)}-byte limit`,
      );
    }
    // The artifact is written BEFORE the authority mutation, exactly as doc 06
    // §5.1 requires: the command carries a resolvable ref, never bytes.
    const artifact = await dependencies.artifacts.put(upload.bytes, { mediaType: mediaType.data });
    return {
      photoId: CapturePhotoIdSchema.parse(upload.photoId),
      artifact,
      originalMediaType: mediaType.data,
    };
  }

  return Object.freeze({
    async start(request: CaptureStartRequest): Promise<CaptureStartResult> {
      const workflow = z.string().min(1).parse(request.workflow);
      if (dependencies.descriptors.resolve(workflow) === undefined) {
        throw new Error(`workflow ${workflow} is not registered; capture cannot be started for it`);
      }
      const ingress = dependencies.ingress();
      if (ingress.state === "refused") {
        return CaptureStartResultSchema.parse({
          state: "refused",
          code: ingress.code,
          message: ingress.message,
          remediation: ingress.remediation,
        });
      }

      const token = CaptureTokenSchema.parse(dependencies.mintToken());
      const now = dependencies.clock.now();
      const session = dependencies.authority.withAuthorityTransaction((repositories) =>
        repositories.captureSessions.create(CaptureSessionSchema.parse({
          sessionId: CaptureSessionIdSchema.parse(dependencies.ids.uuid()),
          tokenDigest: deriveCaptureTokenDigest(token),
          workflow,
          ...(request.formType === undefined ? {} : { formType: request.formType }),
          ...(request.contextHint === undefined ? {} : { contextHint: request.contextHint }),
          state: "open",
          photoRefs: [],
          handoff: { state: "pending" },
          finalizationGeneration: 0,
          version: 1,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + captureConfig.preConnectTtlMs).toISOString(),
          ingress: { mode: ingress.mode, originDigest: ingress.originDigest },
        })));

      // Awaiting nothing — but `start` stays async so the phone-origin
      // resolution can grow an on-demand tunnel launch without every caller
      // changing shape.
      await Promise.resolve();
      return CaptureStartResultSchema.parse({
        state: "started",
        session: toWire(session),
        token,
        phoneUrl: capturePhoneUrl(ingress.origin, token),
        ingressMode: ingress.mode,
      });
    },

    readSession(sessionId: string): CaptureSessionWire {
      const session = dependencies.authorityRead.getCaptureSession(
        CaptureSessionIdSchema.parse(sessionId),
      );
      if (session === undefined) throw new Error(`capture session ${sessionId} is not in authority`);
      return toWire(expireIfOverdue(session));
    },

    readByToken(token: string): CaptureSessionWire {
      return toWire(resolveToken(token));
    },

    async uploadPhoto(token: string, upload: CapturePhotoUpload): Promise<CaptureSessionWire> {
      const session = resolveToken(token);
      const payload = await acceptPhoto(upload);
      if (session.photoRefs.length >= captureConfig.maxPhotos
        && !session.photoRefs.some((photo) => String(photo.photoId) === upload.photoId)) {
        throw new CaptureRefusal(
          "invalid-state",
          `this capture already holds ${String(captureConfig.maxPhotos)} photographs, which is the limit`,
        );
      }
      return runCommand(
        {
          ...envelope("capture-upload", session, upload, PHONE_SOURCE),
          payload,
        },
        String(session.sessionId),
      );
    },

    async replacePhoto(token: string, upload: CapturePhotoUpload): Promise<CaptureSessionWire> {
      const session = resolveToken(token);
      if (!session.photoRefs.some((photo) => String(photo.photoId) === upload.photoId)) {
        throw new CaptureRefusal("unknown-photo", `this capture holds no photograph ${upload.photoId}`);
      }
      const payload = await acceptPhoto(upload);
      return runCommand(
        {
          ...envelope("capture-replace", session, upload, PHONE_SOURCE),
          payload,
        },
        String(session.sessionId),
      );
    },

    async readPhotoBytes(token: string, photoId: string): Promise<CapturePhotoBytes> {
      const session = resolveToken(token);
      const photo = session.photoRefs.find((entry) => String(entry.photoId) === photoId);
      if (photo === undefined) {
        throw new CaptureRefusal("unknown-photo", `this capture holds no photograph ${photoId}`);
      }
      const stream = await dependencies.artifacts.open(photo.artifact);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
      return { mediaType: photo.artifact.mediaType, bytes: new Uint8Array(Buffer.concat(chunks)) };
    },

    deletePhoto(token: string, photoId: string, facts: CaptureCommandRequestFacts): CaptureSessionWire {
      const session = resolveToken(token);
      return runCommand(
        {
          ...envelope("capture-delete", session, facts, PHONE_SOURCE),
          payload: { photoId: CapturePhotoIdSchema.parse(photoId) },
        },
        String(session.sessionId),
      );
    },

    reorder(
      token: string,
      orderedPhotoIds: readonly string[],
      facts: CaptureCommandRequestFacts,
    ): CaptureSessionWire {
      const session = resolveToken(token);
      return runCommand(
        {
          ...envelope("capture-reorder", session, facts, PHONE_SOURCE),
          payload: { orderedPhotoIds: orderedPhotoIds.map((id) => CapturePhotoIdSchema.parse(id)) },
        },
        String(session.sessionId),
      );
    },

    async finalize(token: string, facts: CaptureCommandRequestFacts): Promise<CaptureSessionWire> {
      const session = resolveToken(token);
      runCommand(envelope("capture-finalize", session, facts, PHONE_SOURCE), String(session.sessionId));
      // The command inserted the outbox; the projector is what settles it, and
      // draining here is what makes the phone's "Sent" mean something. A
      // projector throw is NOT swallowed: the durable state is already right
      // (`failed` on both rows), and the caller re-reads it below.
      await dependencies.finalizations.projectPending();
      return reread(String(session.sessionId));
    },

    async retryFinalize(token: string, facts: CaptureCommandRequestFacts): Promise<CaptureSessionWire> {
      const session = resolveToken(token);
      runCommand(envelope("capture-retry-finalize", session, facts, PHONE_SOURCE), String(session.sessionId));
      await dependencies.finalizations.projectPending();
      return reread(String(session.sessionId));
    },

    discard(token: string, facts: CaptureCommandRequestFacts): CaptureSessionWire {
      const session = resolveToken(token);
      return runCommand(
        envelope("capture-discard", session, facts, PHONE_SOURCE),
        String(session.sessionId),
      );
    },

    async drainFinalizations(): Promise<void> {
      await dependencies.finalizations.projectPending();
    },
  });
}

/* ── the ingress resolution ──────────────────────────────────────────────── */

export interface CaptureIngressResolverDependencies {
  readonly config: Config;
  /** Whether the on-demand tunnel's credential is configured at all. */
  readonly ngrokCredentialPresent: () => boolean;
}

/**
 * Doc 11's three modes, resolved to an origin or to a NAMED refusal.
 *
 * `on-demand-ngrok` is the shipped default and its tunnel launcher does not
 * exist in this repository yet, so it refuses `ingress-not-built` rather than
 * quietly serving `127.0.0.1` — a QR pointing at loopback scans perfectly and
 * then fails on the phone with a network error that explains nothing, which is
 * exactly the plausible-but-wrong outcome this program forbids.
 */
export function createCaptureIngressResolver(
  dependencies: CaptureIngressResolverDependencies,
): () => CaptureIngressResolution {
  return (): CaptureIngressResolution => {
    const { ingress, forwardedUrl } = dependencies.config.capture;
    if (ingress === "disabled") {
      return CaptureIngressResolutionSchema.parse({
        state: "refused",
        code: "ingress-disabled",
        message: "capture.ingress is disabled, so no phone can reach this dashboard",
        remediation: "set capture.ingress to \"forwarded\" with an explicit HTTPS forwardedUrl",
      });
    }
    if (ingress === "forwarded") {
      if (forwardedUrl === undefined) {
        throw new Error("forwarded capture ingress passed config validation without a forwardedUrl");
      }
      return CaptureIngressResolutionSchema.parse({
        state: "ready",
        mode: "forwarded",
        origin: forwardedUrl,
        originDigest: deriveCaptureOriginDigest(forwardedUrl),
      });
    }
    if (!dependencies.ngrokCredentialPresent()) {
      return CaptureIngressResolutionSchema.parse({
        state: "refused",
        code: "ingress-credential-missing",
        message: "capture.ingress is \"on-demand-ngrok\" but no ngrok credential is configured",
        remediation: "configure the ngrok authtoken, or set capture.ingress to \"forwarded\" with an HTTPS URL",
      });
    }
    return CaptureIngressResolutionSchema.parse({
      state: "refused",
      code: "ingress-not-built",
      message:
        "capture.ingress is \"on-demand-ngrok\" and the credential is present, but the on-demand tunnel "
        + "launcher is not built in this repository yet",
      remediation: "set capture.ingress to \"forwarded\" with an explicit HTTPS forwardedUrl",
    });
  };
}
