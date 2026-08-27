/**
 * The capture surface's composition value (2i-F, D174).
 *
 * Capture is the only subsystem whose pieces span every layer at once — a
 * deterministic bundler in `infra`, the intake handoff in `core`, the seven
 * command arms behind the kernel, and a token-scoped service on top — so it
 * gets its own compose seam rather than being spelled out inside the dashboard
 * root. The dashboard runtime and the BFF test harnesses then wire the SAME
 * object, which is what stops a test from proving a capture surface the
 * product does not have.
 */
import type { AnyWorkflowDescriptor } from "../../base/workflow.js";
import type { ContentAddressedArtifactWriter } from "../../base/artifacts.js";
import type { Clock } from "../../domain/clock.js";
import type { Config } from "../../domain/config/schema.js";
import type { IdFactory } from "../../domain/identifiers.js";
import type { CaptureIntakeBinding } from "../../domain/capture-intake.js";
import type { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import { inspectSecret } from "../../domain/secrets.js";
import { createCaptureFinalizeProjector } from "../../infra/capture/finalize-projector.js";
import { createCapturePdfBundler } from "../../infra/capture/pdf-bundler.js";
import { createCapturePhotoImageFactReader } from "../../infra/capture/photo-image-facts.js";
import { mintCaptureToken } from "../../infra/capture/capture-token.js";
import { createCaptureIntakeHandoff } from "../../core/capture-intake-handoff.js";
import type { DashboardCommandService } from "../dashboard/commands/command-service.js";
import {
  createCaptureIngressResolver,
  createCaptureService,
  type CaptureService,
} from "../dashboard/commands/capture-service.js";

export interface CaptureComposeInput {
  readonly database: AuthorityDatabase;
  readonly artifacts: ContentAddressedArtifactWriter;
  readonly commands: DashboardCommandService;
  readonly descriptors: Readonly<{ resolve(workflowId: string): AnyWorkflowDescriptor | undefined }>;
  readonly bindings: Readonly<Record<string, CaptureIntakeBinding>>;
  readonly config: Config;
  readonly configIdentity: Readonly<{ configFingerprint: string; configSnapshotId: string }>;
  /** The running app build, stamped on the run a capture handoff enqueues (D179). */
  readonly appVersion: string;
  readonly env: NodeJS.ProcessEnv;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** Test seam only; production mints from the platform CSPRNG. */
  readonly mintToken?: () => string;
}

export function composeCaptureSurface(input: CaptureComposeInput): CaptureService {
  const { database } = input;

  const finalizations = createCaptureFinalizeProjector({
    authority: {
      captureSessions: {
        get: (sessionId) => database.authority.captureSessions.get(sessionId),
        update: (record) => database.authority.captureSessions.update(record),
      },
      captureFinalizationOutboxes: {
        listPending: () => database.authority.captureFinalizationOutboxes.listPending(),
        settle: (record) => database.authority.captureFinalizationOutboxes.settle(record),
      },
    },
    withAuthorityTransaction: (work) => database.withAuthorityTransaction(work),
    artifacts: input.artifacts,
    bundler: createCapturePdfBundler({ artifacts: input.artifacts }),
    handoff: createCaptureIntakeHandoff({
      repositories: database.authority,
      bindings: { resolve: (workflowId) => input.bindings[workflowId] },
      descriptors: input.descriptors,
      configIdentity: input.configIdentity,
      appVersion: input.appVersion,
      clock: input.clock,
    }),
    ids: input.ids,
    clock: input.clock,
  });

  return createCaptureService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: {
      getCaptureSession: (sessionId) => database.authority.captureSessions.get(sessionId),
      findCaptureSessionByTokenDigest: (tokenDigest) =>
        database.authority.captureSessions.findByTokenDigest(tokenDigest),
      listActiveCaptureSessions: () => database.authority.captureSessions.listActive(),
    },
    commands: input.commands,
    descriptors: input.descriptors,
    artifacts: input.artifacts,
    photoImageFacts: createCapturePhotoImageFactReader({ artifacts: input.artifacts }),
    finalizations,
    config: input.config,
    ingress: createCaptureIngressResolver({
      config: input.config,
      ngrokCredentialPresent: () => inspectSecret("ngrokCredential", input.env).state === "present",
    }),
    mintToken: input.mintToken ?? mintCaptureToken,
    clock: input.clock,
    ids: input.ids,
  });
}
