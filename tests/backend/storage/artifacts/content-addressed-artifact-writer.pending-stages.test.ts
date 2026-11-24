import { default as assert } from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { createContentAddressedArtifactWriter, pendingDiagnosticArtifacts } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const interleave = vi.hoisted(() => ({
  root: "",
  afterList: undefined as (() => void) | undefined,
  beforePathStatus: undefined as ((path: string) => void) | undefined,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual,
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) => {
      const names: unknown = Reflect.apply(actual.readdirSync, actual, args);
      if (String(args[0]) === interleave.root) { const hook = interleave.afterList; interleave.afterList = undefined; hook?.(); }
      return names;
    },
    lstatSync: (...args: Parameters<typeof actual.lstatSync>) => {
      interleave.beforePathStatus?.(String(args[0]));
      return Reflect.apply(actual.lstatSync, actual, args);
    } };
});

afterEach(() => { interleave.root = ""; interleave.afterList = undefined; interleave.beforePathStatus = undefined; });

it("omits a stage another capture disposes between listing and opening it", async () => {
  const profile = await createBoundProfileFixture();
  try {
    const writer = createContentAddressedArtifactWriter({ admission: profile.admission });
    const settled = await writer.stageDiagnostic(Buffer.from("settled elsewhere"), { mediaType: "application/json" }, "ordinary");
    const pending = await writer.stageDiagnostic(Buffer.from("still pending"), { mediaType: "application/json" }, "ordinary");
    settled.publish();
    interleave.root = profile.admission.artifactRoot;
    interleave.afterList = () => settled.dispose();
    assert.deepEqual(pendingDiagnosticArtifacts(profile.admission), [pending.ref]);
    assert.equal(interleave.afterList, undefined);
  } finally { await profile.close(); }
});

it("omits a stage another capture disposes after its bytes are read", async () => {
  const profile = await createBoundProfileFixture();
  try {
    const writer = createContentAddressedArtifactWriter({ admission: profile.admission });
    const settled = await writer.stageDiagnostic(Buffer.from("settled after read"), { mediaType: "application/json" }, "ordinary");
    const pending = await writer.stageDiagnostic(Buffer.from("pending after read"), { mediaType: "application/json" }, "ordinary");
    settled.publish();
    interleave.beforePathStatus = path => {
      if (!path.endsWith(".diagnostic.tmp") || !path.includes(settled.ref.sha256)) return;
      interleave.beforePathStatus = undefined;
      settled.dispose();
    };
    assert.deepEqual(pendingDiagnosticArtifacts(profile.admission), [pending.ref]);
    assert.equal(interleave.beforePathStatus, undefined);
  } finally { await profile.close(); }
});
