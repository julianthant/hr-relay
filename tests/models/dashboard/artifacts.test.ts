import { createDashboardModelFixtures } from "../../support/helpers/dashboard-model-fixtures.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { ArtifactRefWireSchema,ArtifactResourceWireSchema,CapturePointerWireSchema } from "../../../src/models/dashboard/artifacts.js";

const { ARTIFACT_1, ARTIFACT } = createDashboardModelFixtures();


function isPlainObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectPaths(value: unknown, path: readonly (string | number)[] = []): readonly (readonly (string | number)[])[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => objectPaths(item, [...path, index]));
  }
  if (!isPlainObject(value)) return [];
  return [path, ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, [...path, key]))];
}

function addUnknownAt(value: unknown, target: readonly (string | number)[], depth = 0): unknown {
  if (depth === target.length) {
    if (!isPlainObject(value)) throw new Error("unknown-key target must be an object");
    return { ...value, unexpectedBoundaryKey: true };
  }
  const segment = target[depth];
  if (typeof segment === "number") {
    if (!Array.isArray(value)) throw new Error("unknown-key path expected an array");
    return Array.from(value, (child: unknown, index) => (
      index === segment ? addUnknownAt(child, target, depth + 1) : child
    ));
  }
  if (!isPlainObject(value)) throw new Error("unknown-key path expected an object");
  return Object.fromEntries(Object.entries(value).map(([key, child]) => (
    key === segment ? [key, addUnknownAt(child, target, depth + 1)] : [key, child]
  )));
}

function assertRecursivelyStrict(schema: { safeParse(input: unknown): { success: boolean } }, fixture: unknown): void {
  assert.equal(schema.safeParse(fixture).success, true);
  for (const path of objectPaths(fixture)) {
    assert.equal(schema.safeParse(addUnknownAt(fixture, path)).success, false, `accepted unknown key at ${path.join(".") || "root"}`);
  }
}

describe("lazy detail and artifact resources", () => {

  it("requires opaque content-addressed artifact metadata and explicit missing states", () => {
    assertRecursivelyStrict(ArtifactResourceWireSchema, ARTIFACT);
    const pdf = { ...ARTIFACT.value, mediaKind: "pdf", mediaType: "application/pdf", pageCount: 2 };
    const data = { ...ARTIFACT.value, mediaKind: "data", mediaType: "application/json" };
    assert.equal(ArtifactRefWireSchema.safeParse(pdf).success, false, "image dimensions are forbidden on PDF refs");
    const pdfWithoutImageDimensions = Object.fromEntries(Object.entries(pdf).filter(([key]) => key !== "width" && key !== "height"));
    const dataWithoutImageDimensions = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "width" && key !== "height"));
    assert.equal(ArtifactRefWireSchema.safeParse(pdfWithoutImageDimensions).success, true);
    assert.equal(ArtifactRefWireSchema.safeParse(dataWithoutImageDimensions).success, true);
    for (const resource of [
      { state: "missing", artifactId: ARTIFACT_1, reason: "not found" },
      { state: "purged", artifactId: ARTIFACT_1, reason: "retention expired" },
      { state: "error", artifactId: ARTIFACT_1, code: "ARTIFACT_READ_FAILED", message: "read failed", retryable: true },
    ]) assert.equal(ArtifactResourceWireSchema.safeParse(resource).success, true);
    assert.equal(ArtifactResourceWireSchema.safeParse({ state: "missing", artifactId: ARTIFACT_1, reason: "gone", path: "/tmp/secret" }).success, false);
    assert.equal(ArtifactResourceWireSchema.safeParse({ state: "available", value: { ...ARTIFACT.value, sha256: undefined } }).success, false);
    assert.equal(CapturePointerWireSchema.safeParse({ artifactId: ARTIFACT_1, dimensions: { state: "present", width: 100, height: 200 } }).success, true);
    assert.equal(CapturePointerWireSchema.safeParse({ artifactId: ARTIFACT_1, dimensions: { state: "missing", reason: "legacy capture had no geometry" } }).success, true);
    assert.equal(CapturePointerWireSchema.safeParse({ artifactId: ARTIFACT_1, dimensions: { state: "present" } }).success, false);
  });
});
