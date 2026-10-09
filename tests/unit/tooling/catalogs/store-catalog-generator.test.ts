
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  applyStoreCatalogSection,
  renderStoreCatalogSection,
  taskVerbOf,
} from "../../../../scripts/docs/generate-store-catalog.js";
import type {
  StoreCatalogPendingBindings,
  StoreCatalogRegistry,
} from "../../../../scripts/docs/generate-store-catalog.js";

const unionInput = z.union([
  z.strictObject({ kind: z.literal("by-eid"), emplId: z.string() }),
  z.strictObject({ kind: z.literal("by-name"), name: z.string(), keepNonHdh: z.boolean() }),
]);
const discriminatedOutput = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), proof: z.string() }),
  z.strictObject({ state: z.literal("absent"), reason: z.string() }),
]);

const FIXTURE_REGISTRY: StoreCatalogRegistry = {
  stores: [
    {
      kind: "browser",
      namespace: "ucpath",
      driver: { status: "semantic-ready" },
      tasks: {
        searchPersonOrg: {
          contract: {
            id: "ucpath/search-person-org",
            title: "Searching",
            effect: "read",
            input: unionInput,
            output: discriminatedOutput,
            freshness: { defaultMaxAgeMs: 14_400_000 },
          },
          impl: { sessions: [{ system: "ucpath", access: "read" }] },
        },
      },
    },
    {
      kind: "headless",
      namespace: "ocr",
      tasks: {
        extractFormPage: {
          contract: {
            id: "ocr/extract-form-page",
            title: "Reading form page",
            effect: "read",
            input: z.strictObject({ formType: z.string(), page: z.number() }),
            output: z.strictObject({ formType: z.string() }),
            providers: ["ocr.extract"],
            freshness: { defaultMaxAgeMs: 14_400_000 },
          },
          impl: { sessions: [] },
        },
      },
    },
    { kind: "browser", namespace: "onbase", driver: { status: "unwired" }, tasks: {} },
  ],
};

const NO_PENDING: StoreCatalogPendingBindings = { tasks: [] };

describe("store catalog generator", () => {
  it("renders identical bytes for identical inputs", () => {
    const first = renderStoreCatalogSection(FIXTURE_REGISTRY, NO_PENDING);
    const second = renderStoreCatalogSection(FIXTURE_REGISTRY, NO_PENDING);
    assert.equal(first, second);
    assert.ok(!/\d{4}-\d{2}-\d{2}/u.test(first), "a generated catalog must carry no timestamp");
  });

  it("renders both union arms with their discriminant literal, never a collapsed placeholder", () => {
    const rendered = renderStoreCatalogSection(FIXTURE_REGISTRY, NO_PENDING);
    assert.match(rendered, /`kind="by-eid"` \+ `emplId` \/ `kind="by-name"` \+ `name`, `keepNonHdh`/u);
    assert.match(rendered, /`state="present"` \+ `proof` \/ `state="absent"` \+ `reason`/u);
    assert.ok(!rendered.includes("?"), "an unreadable shape must throw, not render a question mark");
  });

  it("renders the store header, capability, session and freshness facts an author searches on", () => {
    const rendered = renderStoreCatalogSection(FIXTURE_REGISTRY, NO_PENDING);
    assert.match(rendered, /### `ucpath`/u);
    assert.match(rendered, /\*\*Kind:\*\* browser store · \*\*Browser system:\*\* `ucpath` · \*\*Driver declaration:\*\* `semantic-ready` · \*\*Tasks:\*\* 1 \(1 read · 0 prepare · 0 commit\)/u);
    assert.match(rendered, /\*\*Kind:\*\* service store · \*\*Browser system:\*\* none \(sessionless\)/u);
    assert.match(rendered, /_No tasks registered — this store is a declaration-only placeholder\._/u);
    assert.match(rendered, /\| `ocr\.extract` \| `formType`, `page` \| `formType` \| 4h \| bound \|/u);
    assert.match(rendered, /\| `ucpath` \(read\) \| — \|/u);
    assert.match(rendered, /_3 registered stores · 2 bound tasks · 0 pending contracts\._/u);
  });

  it("renders pending contracts as their own rows rather than omitting them", () => {
    const pending: StoreCatalogPendingBindings = {
      tasks: [{
        taskId: "i9/read-signer",
        workflowId: "i9-lookup",
        note: "Order 1 mints the i9 store.",
      }],
    };
    const rendered = renderStoreCatalogSection(FIXTURE_REGISTRY, pending);
    assert.match(rendered, /\| `i9\/read-signer` \| `i9-lookup` \| Order 1 mints the i9 store\. \| pending \|/u);
    assert.match(rendered, /_3 registered stores · 2 bound tasks · 1 pending contracts\._/u);
    assert.ok(!renderStoreCatalogSection(FIXTURE_REGISTRY, NO_PENDING).includes("i9/read-signer"));
  });

  it("refuses a contract that is registered AND listed as pending", () => {
    assert.throws(
      () => renderStoreCatalogSection(FIXTURE_REGISTRY, {
        tasks: [{
          taskId: "ocr/extract-form-page",
          workflowId: "intake",
          note: "stale row",
        }],
      }),
      /ocr\/extract-form-page is registered in the ocr store and also listed in the pending-impl bindings/u,
    );
  });

  it("derives the task verb from the contract id", () => {
    assert.equal(taskVerbOf("ucpath/search-person-org"), "search");
    assert.equal(taskVerbOf("workflow:separations/match-identity"), "match");
    assert.throws(() => taskVerbOf("ucpath/"), /carries no task verb/u);
  });

  it("splices the section between the markers and rewrites the Last updated line", () => {
    const doc = [
      "# Store catalog",
      "",
      "> **Last updated:** 2026-08-14 (by hand)",
      "",
      "<!-- store-catalog:start -->",
      "",
      "OLD-SECTION",
      "",
      "<!-- store-catalog:end -->",
      "",
      "## 2b · Store notes (hand-written)",
      "",
    ].join("\n");
    const next = applyStoreCatalogSection(doc, "FRESH");
    assert.ok(!next.includes("OLD-SECTION"));
    assert.ok(next.includes("<!-- store-catalog:start -->\n\nFRESH\n\n<!-- store-catalog:end -->"));
    assert.ok(next.includes("## 2b · Store notes (hand-written)"));
    assert.ok(!next.includes("2026-08-14 (by hand)"));
    assert.equal(applyStoreCatalogSection(next, "FRESH"), next);
  });

  it("refuses a document that lost its markers or its Last updated line", () => {
    assert.throws(
      () => applyStoreCatalogSection("# Store catalog\n\nno markers here\n", "FRESH"),
      /missing <!-- store-catalog:start -->/u,
    );
    assert.throws(
      () => applyStoreCatalogSection(
        "# Store catalog\n\n<!-- store-catalog:start -->\n\n<!-- store-catalog:end -->\n",
        "FRESH",
      ),
      /missing its "> \*\*Last updated:\*\*" header line/u,
    );
  });
});
