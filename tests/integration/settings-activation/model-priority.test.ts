import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { readSettings } from "../../../src/backend/runtime/settings/settings-runtime.js";
import { settingsFixture } from "./helpers/fixture.js";

const close: Array<() => void> = [];
afterEach(() => { for (const cleanup of close.splice(0).reverse()) cleanup(); });

it("keeps unconfigured provider model lists empty and refuses dashboard membership changes", () => {
  const fixture = settingsFixture(); close.push(fixture.close);
  for (const provider of ["gemini", "groq", "mistral", "openRouter", "sambanova"]) {
    const path = `providers.${provider}.models`;
    const outcome = fixture.save({ [path]: { set: ["invented-model"] } });
    assert.equal(outcome.state, "rejected", path);
    if (outcome.state === "rejected") assert.match(outcome.message, /may only reorder configured models/u);
  }
  assert.equal(readSettings(fixture.database.authority).revision, 1);
});

it("accepts only exact permutations of the backend-configured model membership", () => {
  const fixture = settingsFixture(false, ["alpha", "beta", "beta"]); close.push(fixture.close);
  const path = "providers.gemini.models";
  for (const operation of [
    { set: ["alpha", "beta"] },
    { set: ["alpha", "beta", "gamma"] },
    { set: ["alpha", "alpha", "beta"] },
    { set: ["alpha", "beta", "renamed"] },
    { clear: true },
  ] as const) {
    const outcome = fixture.save({ [path]: operation });
    assert.equal(outcome.state, "rejected", JSON.stringify(operation));
  }
  assert.equal(readSettings(fixture.database.authority).revision, 1);
  assert.equal(fixture.save({ [path]: { set: ["beta", "alpha", "beta"] } }).state, "applied");
  assert.equal(readSettings(fixture.database.authority).revision, 2);
  assert.equal(fixture.save({ [path]: { set: ["beta", "beta", "alpha"] } }).state, "applied");
  assert.equal(fixture.save({ [path]: { set: ["alpha", "beta"] } }).state, "rejected");
});
