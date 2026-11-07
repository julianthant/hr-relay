import { z } from "zod";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { ScenarioIdSchema } from "../../rules/identity/ids.js";
import { ScenarioManifestSchema } from "./scenario.js";

export const PreflightScenarioIdSchema = z.enum([
  "preflight/runtime-mismatch",
  "preflight/browser-missing",
  "preflight/config-invalid",
  "preflight/low-disk",
  "preflight/corrupt-db",
  "preflight/port-busy",
  "preflight/fiscal-stale",
  "preflight/workflow-secret-missing",
  "preflight/endpoint-prod",
  "preflight/provider-unavailable",
]);

const FAILURE_SCENARIOS = new Set([
  "preflight/runtime-mismatch", "preflight/browser-missing", "preflight/config-invalid",
  "preflight/low-disk", "preflight/corrupt-db", "preflight/port-busy", "preflight/fiscal-stale",
  "preflight/workflow-secret-missing",
  "preflight/endpoint-prod",
]);

export const PREFLIGHT_SCENARIO_MANIFESTS = deepFreeze(ScenarioManifestSchema.array().parse(
  PreflightScenarioIdSchema.options.map((id) => {
    const failed = FAILURE_SCENARIOS.has(id);
    const suffix = id.slice("preflight/".length);
    return {
      id: ScenarioIdSchema.parse(id),
      title: `Preflight ${suffix.replaceAll("-", " ")}`,
      scope: { runtime: "preflight" },
      kind: failed ? "permanent" : "expected-absence",
      fixture: "fixtures/preflight/environment-doctor.json",
      input: { check: suffix },
      injections: [],
      expect: {
        terminal: failed ? "failed" : "partial",
        actionCount: 0,
        externalCommitCount: 0,
        requiredEvidence: [`preflight.${suffix}`],
        failureCode: failed
          ? { state: "present", value: "PREFLIGHT_FAILED" }
          : { state: "absent" },
      },
      contractFingerprint: "1b2edb24492b2927b0ab849d1cb4f400715c913d5d61eaf71ded2e7efdd76684",
      requiredAssertions: [`reports-${suffix}`],
    };
  }),
));

export type PreflightScenarioId = z.infer<typeof PreflightScenarioIdSchema>;
