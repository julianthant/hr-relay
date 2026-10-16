
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expectTypeOf, it } from "vitest";
import { createDashboardClient, DashboardClientError, type DashboardClient } from "../../../src/dashboard/client/index.js";
import {
  StartPlanIngressSchema,
  StartPlanRequestSchema,
  StartPlanWireSchema,
  type StartPlanIngress,
  type StartPlanRequest,
} from "../../../src/models/dashboard/start-plan.js";

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
  workers: "auto",
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
  planned: [{ logicalKey: UUID, title: "Person lookup", matchKey: "person-lookup:10873698" }],
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

    assert.equal(StartPlanWireSchema.safeParse({
      ...WIRE,
      refused: [{ entry: 1, code: "duplicate-active", message: "not a code the server can emit" }],
    }).success, false, "refusal codes are the closed StartRefusalCode vocabulary");
    assert.equal(StartPlanWireSchema.safeParse({
      ...WIRE,
      planned: [{ ...WIRE.planned[0], traceId: "fixture-plan-01" }],
    }).success, false, "a proposal cannot reserve or display any trace id");
  });

  it("the client parses the answer with the shared wire, so an impossible refusal code is a schema error, not a rendered string", async () => {
    const answer = (body: unknown): DashboardClient => createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    });
    const accepted = await answer(WIRE).submitStartPlan(REQUEST);
    assert.deepEqual(accepted, StartPlanWireSchema.parse(WIRE));
    await assert.rejects(
      answer({ ...WIRE, refused: [{ entry: 1, code: "duplicate-active", message: "x" }] }).submitStartPlan(REQUEST),
      (error: unknown) => error instanceof DashboardClientError && error.kind === "schema",
    );
    // And the request side: the client refuses before any fetch happens.
    let fetches = 0;
    const counting = createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: () => { fetches += 1; return Promise.reject(new Error("unreachable")); },
    });
    await assert.rejects(counting.submitStartPlan({ ...REQUEST, workflowId: "Not A Slug" }));
    assert.equal(fetches, 0);
  });

  it("the ingress and the request agree on every shared leaf's type", () => {
    expectTypeOf<StartPlanIngress["submissions"]>().toEqualTypeOf<StartPlanRequest["submissions"]>();
    expectTypeOf<StartPlanIngress["stepOmissions"]>().toEqualTypeOf<StartPlanRequest["stepOmissions"]>();
    expectTypeOf<StartPlanIngress["browserMode"]>().toEqualTypeOf<StartPlanRequest["browserMode"]>();
  });

  it("neither the client nor the server declares its own start-plan schema any more", () => {
    for (const path of ["src/dashboard/client/commands/start-commands.ts", "src/backend/runs/commands/start-plan-service.ts"]) {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.doesNotMatch(source, /const StartPlan\w*Schema\s*=/u, `${path} must import the shared owner, not redeclare it`);
      assert.match(source, /from "[./]*models\/dashboard\/start-plan\.js"/u, `${path} must import models/dashboard/start-plan.ts`);
    }
  });
});
