
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
WorkflowModuleRoleSchema
} from "../../../src/workflow-kit/validation/module-role.js";

describe("WorkflowModuleRoleSchema excludes proving roles", () => {
  it("rejects the retired proving role", () => {
    assert.equal(WorkflowModuleRoleSchema.safeParse({ kind: "proving" }).success, false);
  });
});
