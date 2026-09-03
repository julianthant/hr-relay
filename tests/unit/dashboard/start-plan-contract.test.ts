/**
 * The start-plan wire has ONE owner (ref frontend-backend-integration §3.4, 2026-09-03):
 * the browser's request, the server's admission of it, and the answer are
 * three schemas in `domain/dashboard/start-plan.ts`, imported by both sides.
 * Before this, the client held a looser "mirror" the server could drift from.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expectTypeOf, it } from "vitest";
import {
  StartPlanIngressSchema,
  StartPlanRequestSchema,
  StartPlanWireSchema,
  type StartPlanIngress,
  type StartPlanRequest,
  type StartPlanWire,
} from "../../../src/domain/dashboard/start-plan.js";

const REPO_ROOT = process.cwd();
const HEX64 = "a".repeat(64);
const UUID = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b74";

const REQUEST = {
  workflowId: "person-lookup",
  submissions: [{ eid: "10873698", mode: "read-only" }],
  dryRun: true,
  browserMode: "headless",
  captureBrowserScreenshots: false,
  selectedStepKeys: ["identity", "search"],
  stepOmissions: [{ step: "identity", facts: { emplId: "10873698" } }],
} as const;

const WIRE = {
  wireVersion: 1,
  startPlanId: UUID,
  workflowId: "person-lookup",
  expectedVersion: 1,
  expiresAt: "2026-09-03T10:00:00.000Z",
  dryRun: true,
  priority: "interactive",
  plannedBy: "local-operator",
  configSnapshotId: UUID,
  omittedSteps: ["identity"],
  fingerprints: {
    descriptorFingerprint: HEX64,
    configFingerprint: HEX64,
    ingressSchemaHash: HEX64,
    canonicalInputSchemaHash: HEX64,
    inputFingerprint: HEX64,
  },
  planned: [{ runId: UUID, traceId: "pl-100000-9e8d", title: "Person lookup", matchKey: "person-lookup:10873698" }],
  refused: [],
} as const;

describe("start-plan wire contract (one shared owner)", () => {
  it("the browser's preflight refuses what the server would refuse: generic ids, missing explicit choices, open omission facts", () => {
    assert.equal(StartPlanRequestSchema.safeParse(REQUEST).success, true);
    assert.equal(StartPlanRequestSchema.safeParse({ ...REQUEST, workflowId: "Not A Slug" }).success, false, "workflow id is the domain slug, not any string");
    const { captureBrowserScreenshots: _capture, ...withoutCapture } = REQUEST;
    assert.equal(StartPlanRequestSchema.safeParse(withoutCapture).success, false, "the browser states every choice explicitly; no default fills it in");
    const { browserMode: _mode, ...withoutMode } = REQUEST;
    assert.equal(StartPlanRequestSchema.safeParse(withoutMode).success, false);
    assert.equal(StartPlanRequestSchema.safeParse({
      ...REQUEST,
      stepOmissions: [{ step: "identity", facts: "10873698" }],
    }).success, false, "omission facts are a keyed object of closed leaves, never a bare value");
    assert.equal(StartPlanRequestSchema.safeParse({
      ...REQUEST,
      stepOmissions: [{ step: "Identity Step", facts: { emplId: "10873698" } }],
    }).success, false, "an omitted step is a timeline category key");
    assert.equal(StartPlanRequestSchema.safeParse({ ...REQUEST, extra: true }).success, false, "strict: no unknown keys");
  });

  it("the server admits exactly what the browser authors, and its defaults appear only at ingress", () => {
    const authored = StartPlanRequestSchema.parse(REQUEST);
    const admitted = StartPlanIngressSchema.parse(authored);
    assert.deepEqual(admitted, { ...authored, priority: "interactive" });
    // A programmatic caller may omit the choices the dashboard always sends;
    // the ingress, and only the ingress, supplies the established defaults.
    const { browserMode: _mode, captureBrowserScreenshots: _capture, ...programmatic } = REQUEST;
    const defaulted = StartPlanIngressSchema.parse(programmatic);
    assert.equal(defaulted.browserMode, "headless");
    assert.equal(defaulted.captureBrowserScreenshots, false);
    assert.equal(defaulted.priority, "interactive");
    assert.equal(StartPlanRequestSchema.safeParse(programmatic).success, false, "the same omission is a refusal in the browser");
  });

  it("the answer carries omitted step KEYS only; facts never ride back", () => {
    assert.equal(StartPlanWireSchema.safeParse(WIRE).success, true);
    assert.equal(StartPlanWireSchema.safeParse({
      ...WIRE,
      omittedSteps: [{ step: "identity", facts: { emplId: "10873698" } }],
    }).success, false);
    assert.equal(StartPlanWireSchema.safeParse({ ...WIRE, rawInput: REQUEST.submissions }).success, false, "rawInput never echoes");
    assert.equal(StartPlanWireSchema.safeParse({ ...WIRE, startPlanId: "plan-1" }).success, false, "ids are domain ids, not any string");
  });

  it("types are inferred from the shared schemas on both sides", () => {
    expectTypeOf<StartPlanRequest>().toEqualTypeOf<ReturnType<typeof StartPlanRequestSchema.parse>>();
    expectTypeOf<StartPlanIngress>().toEqualTypeOf<ReturnType<typeof StartPlanIngressSchema.parse>>();
    expectTypeOf<StartPlanWire>().toEqualTypeOf<ReturnType<typeof StartPlanWireSchema.parse>>();
    expectTypeOf<StartPlanIngress["submissions"]>().toEqualTypeOf<StartPlanRequest["submissions"]>();
  });

  it("neither the client nor the server declares its own start-plan schema any more", () => {
    for (const path of ["src/dashboard/client/commands.ts", "src/server/dashboard/commands/start-plan-service.ts"]) {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.doesNotMatch(source, /const StartPlan\w*Schema\s*=/u, `${path} must import the shared owner, not redeclare it`);
      assert.match(source, /from "[./]*domain\/dashboard\/start-plan\.js"/u, `${path} must import domain/dashboard/start-plan.ts`);
    }
  });
});
