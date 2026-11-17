import { beforeAll, describe, expect, it } from "vitest";
import { auditScopedPlans, type PlanAudit } from "./check-closure-plan-audit.js";

/** Change kinds whose closure reaches every row of a kind, so the reader takes the whole-store route for them. */
const WHOLE_ROUTE = ["j", "k"];

describe("scoped check plan", () => {
  let audit: PlanAudit;
  beforeAll(async () => { audit = await auditScopedPlans(); });

  it("runs every change kind through the capture triggers", () => {
    expect(audit.routes.size).toBeGreaterThan(40);
  });

  it("takes the whole-store route only for a profile change and a completed search rebuild", () => {
    expect([...audit.routes].filter(([, route]) => route === "whole").map(([code]) => code).sort()).toEqual(WHOLE_ROUTE);
  });

  it("scans no growing table for any change kind it checks scoped", () => {
    const scoped = new Set([...audit.routes].filter(([, route]) => route === "scoped").map(([code]) => code));
    const growing = audit.scans.filter(scan => scan.growth === "GROWING" && scan.kinds.some(kind => scoped.has(kind)))
      .map(scan => `${scan.table}: ${scan.plan} <- ${scan.sql.slice(0, 120)}`);
    expect(growing).toEqual([]);
  });
});
