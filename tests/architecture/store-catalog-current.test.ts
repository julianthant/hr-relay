/**
 * D312 (doc 03.2 Task 2) — ref stores §2 is GENERATED from `taskStoreRegistry`, not written.
 *
 * The reuse index is the one document an author consults before minting a task. A hand-maintained
 * index goes stale silently, and a stale index is exactly what mints a second implementation of a
 * page visit D194 says must exist once. This guard fails on stale checked-in bytes, proves the
 * renderer refuses a shape it cannot derive rather than printing a placeholder, and proves every
 * registered task appears in the block exactly once.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  STORE_CATALOG_DOC_PATH,
  STORE_CATALOG_END_MARKER,
  STORE_CATALOG_START_MARKER,
  applyStoreCatalogSection,
  renderStoreCatalogSection,
} from "../../scripts/generate-store-catalog.js";
import type { StoreCatalogRegistry } from "../../scripts/generate-store-catalog.js";
import { readPendingImplBindings } from "../../src/backend/app/control/workflow-registry.js";
import { taskStoreRegistry } from "../../src/backend/app/task-registry.js";
import { REPO_ROOT } from "./helpers/guard-files.js";

const DOC = readFileSync(join(REPO_ROOT, STORE_CATALOG_DOC_PATH), "utf8");
const PENDING = readPendingImplBindings(REPO_ROOT);

function checkedInSection(): string {
  const start = DOC.indexOf(STORE_CATALOG_START_MARKER);
  const end = DOC.indexOf(STORE_CATALOG_END_MARKER);
  assert.ok(start >= 0 && end > start, `${STORE_CATALOG_DOC_PATH} lost its store-catalog markers`);
  return DOC.slice(start + STORE_CATALOG_START_MARKER.length, end).trim();
}

describe("generated store catalog (ref stores §2)", () => {
  it("keeps the checked-in catalog current", () => {
    const rendered = renderStoreCatalogSection(taskStoreRegistry, PENDING);
    assert.equal(
      checkedInSection(),
      rendered.trim(),
      "run `npm run stores:catalog` and commit the result",
    );
    assert.equal(
      applyStoreCatalogSection(DOC, rendered),
      DOC,
      "`npm run stores:catalog` would rewrite the checked-in bytes",
    );
  });

  it("lists every registered task exactly once, and only registered tasks", () => {
    const rendered = renderStoreCatalogSection(taskStoreRegistry, PENDING);
    const registered = taskStoreRegistry.stores
      .flatMap((store) => Object.values(store.tasks).map((task) => String(task.contract.id)));
    assert.ok(registered.length > 0, "an empty registry would make this guard vacuous");
    for (const id of registered) {
      const rows = rendered.split("\n").filter((line) => line.startsWith(`| \`${id}\` |`));
      assert.equal(rows.length, 1, `${id} must appear in exactly one catalog row`);
    }
    const rowIds = rendered.split("\n")
      .filter((line) => line.startsWith("| `") && line.endsWith("| bound |"))
      .map((line) => line.slice(3, line.indexOf("` |")));
    assert.deepEqual([...rowIds].sort(), [...registered].sort());
  });

  it("names every registered store, in registry order", () => {
    const rendered = renderStoreCatalogSection(taskStoreRegistry, PENDING);
    const headings = rendered.split("\n")
      .filter((line) => line.startsWith("### `"))
      .map((line) => line.slice(5, line.length - 1));
    assert.deepEqual(headings, taskStoreRegistry.stores.map((store) => store.namespace));
  });

  it("refuses a task whose input schema shape it cannot read", () => {
    const unreadable: StoreCatalogRegistry = {
      stores: [{
        kind: "headless",
        namespace: "roster",
        tasks: {
          matchSpreadsheet: {
            contract: {
              id: "roster/match-spreadsheet",
              title: "Matching against roster",
              effect: "read",
              input: z.string(),
              output: z.strictObject({ matches: z.array(z.string()) }),
              freshness: { defaultMaxAgeMs: 86_400_000 },
            },
            impl: { sessions: [] },
          },
        },
      }],
    };
    assert.throws(
      () => renderStoreCatalogSection(unreadable, { tasks: [] }),
      /roster\/match-spreadsheet input schema shape is unreadable \(zod type "string"\)/u,
      "an underivable shape must fail the generator, never render a placeholder cell",
    );
  });

  it("refuses a union arm that is not an object", () => {
    const unreadable: StoreCatalogRegistry = {
      stores: [{
        kind: "headless",
        namespace: "roster",
        tasks: {
          matchSpreadsheet: {
            contract: {
              id: "roster/match-spreadsheet",
              title: "Matching against roster",
              effect: "read",
              input: z.strictObject({ a: z.string() }),
              output: z.union([z.strictObject({ state: z.literal("ok") }), z.string()]),
              freshness: { defaultMaxAgeMs: 86_400_000 },
            },
            impl: { sessions: [] },
          },
        },
      }],
    };
    assert.throws(
      () => renderStoreCatalogSection(unreadable, { tasks: [] }),
      /roster\/match-spreadsheet output union arm schema shape is unreadable/u,
    );
  });

  it("refuses a read contract with no freshness policy", () => {
    const missing: StoreCatalogRegistry = {
      stores: [{
        kind: "headless",
        namespace: "roster",
        tasks: {
          matchSpreadsheet: {
            contract: {
              id: "roster/match-spreadsheet",
              title: "Matching against roster",
              effect: "read",
              input: z.strictObject({ a: z.string() }),
              output: z.strictObject({ b: z.string() }),
            },
            impl: { sessions: [] },
          },
        },
      }],
    };
    assert.throws(
      () => renderStoreCatalogSection(missing, { tasks: [] }),
      /roster\/match-spreadsheet is a read task with no freshness policy/u,
    );
  });
});
