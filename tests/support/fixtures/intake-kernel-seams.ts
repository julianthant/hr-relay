import { workflowPlanning } from "../../../src/workflow-kit/workflow.js";
import { deriveItemId } from "../../../src/rules/identity/identifiers.js";
import { ItemIdSchema } from "../../../src/rules/identity/ids.js";
import { IntakeParseSchema } from "../../../src/models/intake/parse.js";
import { deriveIntakeEnqueuePlan } from "../../../src/models/intake/enqueue.js";
import { intakeReviewBinding, resolveIntakeComparison } from "../../../src/models/intake/review.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";

import type { IntakeParser } from "../../../src/workflow-kit/intake-parser.js";
import type {
  IntakeProjectionResolver,
  RunConfigIdentity,
} from "../../../src/backend/runs/commands/command-kernel.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import type { IntakeService } from "../../../src/backend/runs/commands/intake-service.js";


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
  session: import("../../../src/models/intake/session.js").IntakeSession;
  parser: IntakeParser;
  projection: import("../../../src/models/intake/projection.js").IntakeProjection;
  descriptor: import("../../../src/workflow-kit/workflow.js").AnyWorkflowDescriptor;
  manifests: Pick<import("../../../src/backend/storage/sqlite/authority-database.js").AuthorityRepositories["intakeManifests"], "get" | "findBySource">;
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
