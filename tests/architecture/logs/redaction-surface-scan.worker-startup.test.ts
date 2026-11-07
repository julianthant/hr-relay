import assert from "node:assert/strict";
import { it } from "vitest";
import { auditSurfaceOrigins, decidableLeaves, REDACTION_SURFACES, SURFACE_LEAF_ORIGINS } from "./helpers/redaction-surface-audit.js";

it("pins every worker startup text origin across the two command-result surfaces", () => {
  const origins = SURFACE_LEAF_ORIGINS.filter(entry => entry.path.includes("workerStartup"));
  assert.deepEqual(origins.map(entry => `${entry.surface}|${entry.path}|${entry.origin}`).sort(), [
    "wire/intake-command-result|result.workerStartup.message|repository-authored",
    "wire/intake-command-result|result.workerStartup.detail|external-text",
    "wire/ocr-command-result|result.workerStartup.message|repository-authored",
    "wire/ocr-command-result|result.workerStartup.detail|external-text",
  ].sort());
});

for (const [id, prefix] of [
  ["wire/intake-command-result", "result.workerStartup"],
  ["wire/ocr-command-result", "result.workerStartup"],
] as const) it(`refuses missing startup origins and forbids dynamic detail outside loopback (${id})`, () => {
  const surface = REDACTION_SURFACES.find(surface => surface.id === id); assert.ok(surface);
  assert.equal(surface.egress, "operator-loopback");
  assert.deepEqual(decidableLeaves(surface.schema).filter(leaf => leaf.path.includes("workerStartup")), [
    { path: `${prefix}.detail`, kind: "free-text" },
    { path: `${prefix}.message`, kind: "free-text" },
  ]);
  const origins = SURFACE_LEAF_ORIGINS.filter(entry => entry.surface === id);
  assert.deepEqual(auditSurfaceOrigins([surface], origins), []);
  for (const path of [`${prefix}.message`, `${prefix}.detail`]) {
    const remaining = origins.filter(entry => entry.path !== path);
    assert.equal(remaining.length, origins.length - 1);
    const missing = auditSurfaceOrigins([surface], remaining);
    assert.equal(missing.length, 1);
    assert.ok(missing[0]?.startsWith(`${id} (operator-loopback) leaf "${path}"`));
    assert.match(missing[0] ?? "", /carries no declared origin/u);
  }
  for (const egress of ["process-egress", "os-notification"] as const) {
    const foreign = auditSurfaceOrigins([{ ...surface, egress }], origins);
    assert.deepEqual(foreign.filter(problem => problem.startsWith(`${id} (${egress}) leaf "${prefix}.message"`)), []);
    assert.deepEqual(foreign.filter(problem => problem.startsWith(`${id} (${egress}) leaf "${prefix}.detail"`)), [
      `${id} (${egress}) leaf "${prefix}.detail" is declared external-text, which a ${egress} surface may not carry at all; redact it at the producer or move the field`,
    ]);
  }
});
