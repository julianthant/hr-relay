import { workflowPlanning } from "../../src/base/workflow.js";
import { deriveItemId } from "../../src/domain/identifiers.js";
import { ItemIdSchema } from "../../src/domain/ids.js";
import { IntakeParseSchema } from "../../src/domain/intake/parse.js";
import { deriveIntakeEnqueuePlan } from "../../src/domain/intake/enqueue.js";
import { intakeReviewBinding, resolveIntakeComparison } from "../../src/domain/intake/review.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
/**
 * The kernel's D170 intake seams, for a kernel under test that issues no
 * intake command.
 *
 * Both fail loud rather than answering with a plausible empty parse or an
 * empty target set: a suite that accidentally reaches an intake arm must see
 * the reason, not a session mapped against nothing.
 */
import type { IntakeParser } from "../../src/base/intake-parser.js";
import type {
  IntakeProjectionResolver,
  RunConfigIdentity,
} from "../../src/backend/runs/command-kernel.js";
import { CommandRequestSchema } from "../../src/domain/commands.js";
import type { IntakeService } from "../../src/backend/runs/dashboard/commands/intake-service.js";

/**
 * The D171 config identity for a kernel that enqueues no intake manifest.
 *
 * It names a snapshot no database holds, so an intake fan-out reached by
 * accident throws by name instead of stamping runs with a config identity
 * nobody can read back. Every other arm copies its config identity from the
 * start plan or the run it retries, so none of them can reach this.
 */
export const UNSTORED_CONFIG_IDENTITY: RunConfigIdentity = Object.freeze({
  configFingerprint: "e".repeat(64),
  configSnapshotId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
});

export const UNWIRED_INTAKE_PARSER: IntakeParser = Object.freeze({
  parse: (request: Readonly<{ artifact: { sha256: string }; sheet: string }>): never => {
    throw new Error(
      `this kernel wires no intake parser; nothing prepared artifact ${request.artifact.sha256} `
      + `sheet ${JSON.stringify(request.sheet)}`,
    );
  },
});

export const NO_INTAKE_PROJECTIONS: IntakeProjectionResolver = Object.freeze({
  resolve: () => undefined,
});

/**
 * A BFF harness that serves no intake surface. `prepare` runs on EVERY command
 * post, so it stays a no-op for every other family and refuses only when an
 * intake command it could not have prepared actually arrives.
 */
export const UNWIRED_INTAKE_SERVICE: IntakeService = Object.freeze({
  upload: (): never => {
    throw new Error("this dashboard wires no intake service");
  },
  read: (): never => {
    throw new Error("this dashboard wires no intake service");
  },
  prepare: async (command: unknown): Promise<void> => {
    const parsed = CommandRequestSchema.safeParse(command);
    if (parsed.success && parsed.data.family === "intake") {
      throw new Error("this dashboard wires no intake service; an intake command cannot be prepared");
    }
    await Promise.resolve();
  },
});

/** Test callers explicitly review the same prepared plan the service serves. */
export function reviewedIntakeFixture(input: {
  session: import("../../src/domain/intake/session.js").IntakeSession;
  parser: IntakeParser;
  projection: import("../../src/domain/intake/projection.js").IntakeProjection;
  descriptor: import("../../src/base/workflow.js").AnyWorkflowDescriptor;
  manifests: Pick<import("../../src/backend/storage/sqlite/authority-database.js").AuthorityRepositories["intakeManifests"], "get" | "findBySource">;
}): string | undefined {
  const s = input.session;
  if (s.validation.state !== "validated" || s.sourceName === undefined || s.reservedManifestId === undefined) return undefined;
  const parse = IntakeParseSchema.parse(input.parser.parse({ artifact: s.artifact, sheet: s.sheet, headerRowIndex: s.headerRowIndex }));
  if (parse.state !== "parsed" || parse.layout === null) return undefined;
  const planning = workflowPlanning(input.descriptor);
  const plan = deriveIntakeEnqueuePlan({ session: { ...s, sourceName: s.sourceName, readAt: s.validation.readAt },
    projection: input.projection, layout: parse.layout, manifestId: s.reservedManifestId, createdAt: s.updatedAt,
    workflowContractFingerprint: input.descriptor.contractFingerprint,
    canonicalInputSchemaHash: deriveSchemaHash(input.descriptor.canonicalInput, "output"),
    deriveItemId: value => ItemIdSchema.parse(deriveItemId(s.workflow, planning.matchKey(value))),
  });
  return intakeReviewBinding(s, plan.manifest, resolveIntakeComparison(s, input.manifests));
}
