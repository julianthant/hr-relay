/**
 * Graph-level scenario coverage (doc 01 §1c · 1d · 1e's item 1e: "every branch/gate/delegation/
 * control path has an executable scenario"; ref operator-trust §3.2's minimum coverage).
 *
 * Task-level coverage is already the contract's job — `defineTaskContract`
 * requires `scenarios` at every tier above a pure workflow mini-store read. What
 * that cannot see is the GRAPH: a branch arm nobody exercises, a gate nobody
 * resolves, a delegation whose declared failure policy never fires. Those paths
 * exist only in the descriptor, so their coverage is derived from the node tuple
 * here and checked in both directions:
 *
 * - every derived coverage point is claimed by at least one registered scenario, and
 * - every scenario claim resolves to a real coverage point.
 *
 * The second direction matters as much as the first: a scenario that claims a
 * renamed branch arm would otherwise keep a deleted path looking covered.
 */
import { z } from "zod";
import { NodeIdSchema, ScenarioIdSchema } from "../../rules/identity/ids.js";
import type { NodeId } from "../../rules/identity/ids.js";
import type { RuntimeFlowNode } from "../../models/workflow/graph.js";

export const CoveragePointKindSchema = z.enum(["branch-case", "gate", "delegation", "transaction"]);

export const GraphCoveragePointSchema = z.strictObject({
  /** Stable, derived from the graph — `branch-case:mode-branch/write`. */
  id: z.string().regex(
    /^[a-z-]+:[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    "coverage point id must be <kind>:<node-id>/<path>",
  ),
  kind: CoveragePointKindSchema,
  nodeId: NodeIdSchema,
  /** Human-readable reason this path needs its own scenario. */
  detail: z.string().min(1),
});

export type CoveragePointKind = z.infer<typeof CoveragePointKindSchema>;
export type GraphCoveragePoint = z.infer<typeof GraphCoveragePointSchema>;

/**
 * Derive every graph path that needs its own scenario.
 *
 * A `many`-cardinality delegation contributes zero/one/many fan-out sizes
 * because those are genuinely different code paths (ref operator-trust §3.2), not three
 * spellings of one.
 */
export function deriveGraphCoveragePoints(
  nodes: readonly RuntimeFlowNode[],
): readonly GraphCoveragePoint[] {
  const points: GraphCoveragePoint[] = [];
  const push = (kind: CoveragePointKind, nodeId: NodeId, suffix: string, detail: string): void => {
    points.push({ id: `${kind}:${nodeId}/${suffix}`, kind, nodeId, detail });
  };

  for (const node of nodes) {
    switch (node.kind) {
      case "branch": {
        for (const caseName of Object.keys(node.cases)) {
          push("branch-case", node.id, caseName, `branch ${node.id} selects "${caseName}"`);
        }
        break;
      }
      case "gate": {
        push("gate", node.id, "opened", `gate ${node.id} opens and parks the run`);
        push("gate", node.id, "resolved", `gate ${node.id} is resolved by ${node.resolvedBy}`);
        break;
      }
      case "child-run": {
        const sizes = node.cardinality === "many"
          ? ["fan-out-zero", "fan-out-one", "fan-out-many"]
          : ["fan-out-one"];
        for (const size of sizes) {
          push("delegation", node.id, size, `delegation ${node.id} enqueues a ${size.slice("fan-out-".length)} fan-out`);
        }
        push("delegation", node.id, "replay", `delegation ${node.id} replays against its manifest`);
        if (node.await === "terminal") {
          const { onChildFailed, cascadeCancel, afterChildRetry } = node.policy;
          push("delegation", node.id, `on-child-failed-${onChildFailed}`,
            `delegation ${node.id} applies onChildFailed:${onChildFailed}`);
          push("delegation", node.id, `cascade-cancel-${cascadeCancel}`,
            `delegation ${node.id} applies cascadeCancel:${cascadeCancel}`);
          push("delegation", node.id, `after-child-retry-${afterChildRetry}`,
            `delegation ${node.id} applies afterChildRetry:${afterChildRetry}`);
        }
        break;
      }
      case "transaction": {
        if (node.dryRun === "stop-after-prepare") {
          push("transaction", node.id, "dry-run", `transaction ${node.id} previews prepare and creates no intent`);
        }
        push("transaction", node.id, "subject-mismatch",
          `transaction ${node.id} observes a mismatched subject and never fences`);
        push("transaction", node.id, "committed", `transaction ${node.id} commits once and proves it`);
        push("transaction", node.id, "already-present",
          `transaction ${node.id} finds its permanent key already satisfied`);
        break;
      }
      default:
        break;
    }
  }
  return Object.freeze(points);
}

/** What a registered scenario declares it exercises in the graph. */
export const ScenarioCoverageClaimSchema = z.strictObject({
  scenarioId: ScenarioIdSchema,
  /** Coverage point ids this scenario actually exercises. */
  covers: z.array(GraphCoveragePointSchema.shape.id),
});
export type ScenarioCoverageClaim = z.infer<typeof ScenarioCoverageClaimSchema>;

/**
 * Audit both directions. Returns human-readable violations; an empty array means
 * the graph's paths and the corpus agree exactly.
 */
export function auditGraphScenarioCoverage(
  points: readonly GraphCoveragePoint[],
  claims: readonly ScenarioCoverageClaim[],
): readonly string[] {
  const violations: string[] = [];
  const known = new Map(points.map((point) => [point.id, point]));
  const claimed = new Set<string>();

  for (const claim of claims) {
    if (claim.covers.length === 0) {
      violations.push(`scenario ${claim.scenarioId} claims no coverage point`);
      continue;
    }
    const seen = new Set<string>();
    for (const pointId of claim.covers) {
      if (seen.has(pointId)) {
        violations.push(`scenario ${claim.scenarioId} lists coverage point ${pointId} twice`);
        continue;
      }
      seen.add(pointId);
      if (!known.has(pointId)) {
        violations.push(`scenario ${claim.scenarioId} claims unknown coverage point ${pointId}`);
        continue;
      }
      claimed.add(pointId);
    }
  }

  for (const point of points) {
    if (!claimed.has(point.id)) {
      violations.push(`uncovered graph path ${point.id} — ${point.detail}`);
    }
  }
  return violations;
}

/** Fail-loud wrapper for composition roots and guards. */
export function assertGraphScenarioCoverage(
  workflowId: string,
  points: readonly GraphCoveragePoint[],
  claims: readonly ScenarioCoverageClaim[],
): void {
  const violations = auditGraphScenarioCoverage(points, claims);
  if (violations.length > 0) {
    throw new Error(`workflow ${workflowId} scenario coverage is incomplete: ${violations.join("; ")}`);
  }
}
