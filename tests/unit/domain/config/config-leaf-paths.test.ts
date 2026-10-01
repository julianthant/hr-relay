import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { configLeafPaths } from "../../../../src/domain/config/provenance.js";

describe("config leaf paths", () => {
  it("reports populated leaves in object order, with arrays and null as leaves", () => {
    const paths = configLeafPaths({
      paths: { stateRoot: "/synthetic/state", artifactRoot: "/synthetic/artifacts" },
      providers: { models: ["synthetic-model"], token: null },
      empty: {},
    });
    assert.deepEqual(paths, ["paths.stateRoot", "paths.artifactRoot", "providers.models", "providers.token"]);
    assert.equal(Object.isFrozen(paths), true);
  });

  it("returns no invented path for an empty or scalar root", () => {
    assert.deepEqual(configLeafPaths({}), []);
    assert.deepEqual(configLeafPaths(null), []);
    assert.deepEqual(configLeafPaths(["synthetic"]), []);
  });
});
