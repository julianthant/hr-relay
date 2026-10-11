
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import {
PHASE1_ACTIVE_COMMAND_ARMS,
PHASE1_DEFERRED_COMMAND_ARMS
} from "../../../src/backend/runs/commands/command-kernel.js";
import {
COMMAND_FAMILY_REGISTRY
} from "../../../src/rules/commands/commands.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";


const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("deferred arms", () => {
  const _deferredKeys = new Set(
    Object.entries(
      PHASE1_DEFERRED_COMMAND_ARMS as Readonly<Record<string, readonly string[]>>,
    ).flatMap(([family, actions]) =>
      actions.map((action) => `${family}/${action}`)),
  );

  it("partitions every family/action exactly once between active and deferred", () => {
    const partitioned = new Map<string, number>();
    for (const partition of [PHASE1_ACTIVE_COMMAND_ARMS, PHASE1_DEFERRED_COMMAND_ARMS]) {
      for (const [family, actions] of Object.entries(partition)) {
        for (const action of actions) {
          const key = `${family}/${action}`;
          partitioned.set(key, (partitioned.get(key) ?? 0) + 1);
        }
      }
    }
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.map((action) => `${family}/${action}`));
    assert.deepEqual([...partitioned.keys()].sort(), [...registry].sort());
    for (const [key, count] of partitioned) assert.equal(count, 1, key);
  });


});
