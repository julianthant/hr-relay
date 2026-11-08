import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ActionCommandKeySchema } from "../../../../src/models/dashboard/actions.js";
import { RunDecisionTypeSchema } from "../../../../src/models/dashboard/run-decision.js";
import { COMMAND_FAMILY_REGISTRY } from "../../../../src/rules/commands/commands.js";
import { DECISION_CATALOG } from "../../../../src/backend/runs/decisions/decision-catalog.js";
import { projectDecision, rowActionOption } from "../../../../src/backend/runs/decisions/project-decision.js";

describe("decision catalog", () => {
  it("declares every decision type once, with unique options and a declared recommendation", () => {
    assert.deepEqual(Object.keys(DECISION_CATALOG).sort(), [...RunDecisionTypeSchema.options].sort());
    for (const [type, declaration] of Object.entries(DECISION_CATALOG)) {
      const ids = declaration.options.map(({ id }) => id);
      assert.equal(new Set(ids).size, ids.length, type);
      for (const id of declaration.recommended) assert.ok(ids.includes(id), `${type} recommends undeclared ${id}`);
      for (const option of declaration.options) assert.ok(option.label.length > 0 && option.hint.length > 0, `${type}/${option.id}`);
    }
  });

  it("names only served run-control commands for actions and registered family commands otherwise", () => {
    const registered = new Set(COMMAND_FAMILY_REGISTRY.flatMap(family => family.actions.map(action => `${family.family}/${action}`)));
    for (const [type, declaration] of Object.entries(DECISION_CATALOG)) {
      for (const { id, send } of declaration.options) {
        if (send.via === "action" || send.via === "row-action") {
          assert.ok(ActionCommandKeySchema.safeParse(send.command).success, `${type}/${id}`);
          if (send.fallback !== undefined) assert.ok(ActionCommandKeySchema.safeParse(send.fallback).success, `${type}/${id} fallback`);
        }
        if (send.via === "verification") assert.ok(ActionCommandKeySchema.safeParse(send.present).success && ActionCommandKeySchema.safeParse(send.absent).success, `${type}/${id}`);
        if (send.via === "command") assert.ok(registered.has(`${send.family}/${send.type}`), `${type}/${id}`);
      }
    }
  });

  it("declares Check again as the held check, falling back to recheck-write", () => {
    for (const type of ["write-parked", "write-unknown"] as const) {
      assert.deepEqual(DECISION_CATALOG[type].options.find(({ id }) => id === "check-again")?.send, { via: "action", command: "check-parked-write", fallback: "recheck-write" });
    }
  });

  it("keeps sign-in and refused catalog-only and cancelling a line", () => {
    assert.equal(DECISION_CATALOG["sign-in"].projected, false);
    assert.equal(DECISION_CATALOG.refused.projected, false);
    assert.deepEqual(DECISION_CATALOG.cancelling.options, []);
    assert.throws(() => projectDecision("sign-in", []), /catalog-only/u);
    assert.deepEqual(projectDecision("cancelling", []).options, []);
  });
});

describe("projectDecision", () => {
  it("orders served options by the catalog and preselects the first recommended one served", () => {
    const decision = projectDecision("write-parked", [
      { id: "didnt-land", send: { via: "action", actionKey: "resolve-write-absent" } },
      { id: "check-again", send: { via: "action", actionKey: "recheck-write" } },
    ]);
    assert.deepEqual(decision.options.map(({ id, recommended }) => [id, recommended]), [["check-again", true], ["didnt-land", undefined]]);
  });

  it("refuses an option the catalog does not declare", () => {
    assert.throws(() => projectDecision("paused", [{ id: "delete", send: { via: "row-action", actionKey: "delete" } }]), /undeclared/u);
  });

  it("binds a row action to the served descriptor key, label and confirm", () => {
    const confirm = { title: "Cancel this group", confirmLabel: "Cancel the group", tone: "destructive" as const };
    const [cancel] = rowActionOption("cancel-run", "cancel", [{ kind: "command", key: "cancel-tree", label: "Cancel group", command: "cancel", confirm }]);
    assert.deepEqual(cancel, { id: "cancel-run", send: { via: "row-action", actionKey: "cancel-tree" }, label: "Cancel group", confirm });
    assert.deepEqual(rowActionOption("cancel-run", "cancel", []), []);
  });
});
