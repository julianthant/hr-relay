/**
 * The ONE workflow-listing rule, pinned as a pure function (ref dashboard-surfaces §Shell,
 * D219 — "a chunk harness is a step of its composition, never a peer
 * workflow").
 *
 * Three surfaces call `groupWorkflowsByCategory` — the Workflow Panel's rail,
 * the Run Modal's picker over BOTH its lists, and the Explorer — and the whole
 * point of one function is that none of them can answer differently. So what
 * is pinned here is the function's ANSWER, not any surface's markup: the
 * category order, the nesting, the ordering stability that keeps the rail from
 * reshuffling when a harness registers, and the orphan arm a filtered list
 * reaches when it genuinely omits a composition.
 *
 * Roles are parsed through `defineWorkflowRole`, so a fixture cannot state a
 * role no module could declare.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defineWorkflowRole, type WorkflowModuleRole } from "../../../../src/domain/workflow/module-role.js";
import {
  groupWorkflowsByCategory,
  workflowCategoryLabel,
  workflowHarnessOfName,
  type WorkflowCategoryGroup,
} from "../../../../src/dashboard/surfaces/workflow-category.js";

interface Entry {
  readonly id: string;
  readonly label: string;
  readonly categoryId: string;
  readonly role: WorkflowModuleRole;
}

const STANDALONE = defineWorkflowRole({ kind: "standalone" });
const COMPOSITION = defineWorkflowRole({ kind: "composition" });
/**
 * Grouping keys on `of` alone — a harness nests under the composition it names
 * — so these fixtures carry one arbitrary well-formed `step` (D265). A test
 * that varied it would be asserting nothing this surface reads.
 */
const harnessOf = (of: string, step = "a-step"): WorkflowModuleRole =>
  defineWorkflowRole({ kind: "chunk-harness", of, step });

function entry(id: string, categoryId: string, role: WorkflowModuleRole, label = id): Entry {
  return { id, label, categoryId, role };
}

/** the shape a surface renders, flattened to ids so an assertion reads as a tree */
function shape(groups: readonly WorkflowCategoryGroup<Entry>[]): Record<string, unknown> {
  return Object.fromEntries(
    groups.map((group) => [
      group.label,
      group.entries.map((node) => ({
        id: node.entry.id,
        ...(node.harness === undefined ? {} : { harnessOf: node.harness.ofWorkflowId, nested: node.harness.nested }),
        members: node.members.map((member) => member.entry.id),
      })),
    ]),
  );
}

describe("groupWorkflowsByCategory — the category half", () => {
  it("orders listed categories by the frontend's display order, whatever order they were served in", () => {
    const groups = groupWorkflowsByCategory([
      entry("operations-workflow", "operations", STANDALONE),
      entry("person-lookup", "search", STANDALONE),
      entry("separations", "separation", COMPOSITION),
    ]);
    assert.deepEqual(groups.map((group) => group.label), ["Separations", "Search", "Operations"]);
  });

  it("appends an unlisted category after the listed ones, headed by its raw id", () => {
    const groups = groupWorkflowsByCategory([
      entry("invented", "no-such-category", STANDALONE),
      entry("person-lookup", "search", STANDALONE),
    ]);
    assert.deepEqual(groups.map((group) => group.label), ["Search", "no-such-category"]);
    assert.equal(workflowCategoryLabel("no-such-category"), "no-such-category");
  });

  it("drops a category nothing is registered under rather than heading an empty list", () => {
    const groups = groupWorkflowsByCategory([entry("person-lookup", "search", STANDALONE)]);
    assert.deepEqual(groups.map((group) => group.label), ["Search"]);
  });
});

describe("groupWorkflowsByCategory — the membership half (D219)", () => {
  it("nests a harness under its composition instead of listing it as a peer", () => {
    const groups = groupWorkflowsByCategory([
      entry("separations", "separation", COMPOSITION, "Separations"),
      entry("separations-kuali-read", "separation", harnessOf("separations")),
      entry("separations-identity-check", "separation", harnessOf("separations")),
    ]);
    assert.deepEqual(shape(groups), {
      Separations: [
        { id: "separations", members: ["separations-kuali-read", "separations-identity-check"] },
      ],
    });
  });

  it("marks a nested harness with the composition's own served label", () => {
    const groups = groupWorkflowsByCategory([
      entry("separations", "separation", COMPOSITION, "Separations"),
      entry("separations-kuali-read", "separation", harnessOf("separations"), "Kuali read"),
    ]);
    const member = groups[0]?.entries[0]?.members[0];
    assert.ok(member !== undefined);
    assert.ok(member.harness !== undefined);
    assert.equal(member.harness.ofWorkflowId, "separations");
    assert.equal(member.harness.ofLabel, "Separations");
    assert.equal(member.harness.nested, true);
    assert.equal(workflowHarnessOfName(member.harness), "Separations");
  });

  it("gives a standalone and a composition entry no harness marking and no members", () => {
    const groups = groupWorkflowsByCategory([
      entry("person-lookup", "search", STANDALONE),
      entry("separations", "separation", COMPOSITION),
    ]);
    for (const group of groups) {
      for (const node of group.entries) {
        assert.equal(node.harness, undefined);
        assert.deepEqual(node.members, []);
      }
    }
  });

  it("nests one level only — a member never carries members of its own", () => {
    const groups = groupWorkflowsByCategory([
      entry("separations", "separation", COMPOSITION),
      entry("separations-kuali-read", "separation", harnessOf("separations")),
    ]);
    assert.deepEqual(groups[0]?.entries[0]?.members[0]?.members, []);
  });

  it("places all five real separations harnesses under Separations, including the cross-category Kronos step", () => {
    const groups = groupWorkflowsByCategory([
      entry("separations", "separation", COMPOSITION, "Separations"),
      // This real harness's HR category is timekeeping, but its role address
      // says it is a step of the Separations composition.
      entry("separations-kronos-timecard", "timekeeping", harnessOf("separations"), "Separation Timecard"),
      entry("separations-kuali-read", "separation", harnessOf("separations"), "Separation Document"),
      entry("separations-identity-check", "separation", harnessOf("separations"), "Identity Check"),
      entry("separations-ucpath-termination", "separation", harnessOf("separations"), "UCPath Termination"),
      entry("separations-kuali-finalization", "separation", harnessOf("separations"), "Kuali Finalization"),
    ]);

    assert.deepEqual(shape(groups), {
      Separations: [
        {
          id: "separations",
          members: [
            "separations-kronos-timecard",
            "separations-kuali-read",
            "separations-identity-check",
            "separations-ucpath-termination",
            "separations-kuali-finalization",
          ],
        },
      ],
    });
  });
});

describe("groupWorkflowsByCategory — the orphan rule", () => {
  it("keeps a harness whose composition is not in the list at all — marked, named by its id", () => {
    const groups = groupWorkflowsByCategory([
      entry("separations-kuali-read", "separation", harnessOf("separations"), "Kuali read"),
    ]);
    const node = groups[0]?.entries[0];
    assert.ok(node?.harness !== undefined);
    assert.equal(node.harness.nested, false);
    assert.equal(node.harness.ofLabel, undefined);
    // The honest fallback: the raw id, never a fabricated title and never a
    // silently dropped entry.
    assert.equal(workflowHarnessOfName(node.harness), "separations");
  });

  it("takes the orphan arm when the named target is not a composition", () => {
    // Unrepresentable through the composition root, which is the point: if it
    // ever reached a browser, the rule refuses to nest two levels deep.
    const groups = groupWorkflowsByCategory([
      entry("separations", "separation", harnessOf("other")),
      entry("separations-kuali-read", "separation", harnessOf("separations")),
    ]);
    assert.deepEqual(shape(groups), {
      Separations: [
        { id: "separations", harnessOf: "other", nested: false, members: [] },
        { id: "separations-kuali-read", harnessOf: "separations", nested: false, members: [] },
      ],
    });
  });
});

describe("groupWorkflowsByCategory — ordering stability", () => {
  it("leaves the top-level order untouched when a harness is lifted out of it", () => {
    const withoutHarness = groupWorkflowsByCategory([
      entry("a", "separation", COMPOSITION),
      entry("b", "separation", STANDALONE),
      entry("c", "separation", STANDALONE),
    ]);
    const withHarness = groupWorkflowsByCategory([
      entry("a", "separation", COMPOSITION),
      entry("harness", "separation", harnessOf("a")),
      entry("b", "separation", STANDALONE),
      entry("c", "separation", STANDALONE),
    ]);
    const topLevel = (groups: readonly WorkflowCategoryGroup<Entry>[]): string[] =>
      (groups[0]?.entries ?? []).map((node) => node.entry.id);
    assert.deepEqual(topLevel(withoutHarness), ["a", "b", "c"]);
    assert.deepEqual(topLevel(withHarness), ["a", "b", "c"]);
  });

  it("orders members by first-seen, independently of where they sat in the served list", () => {
    const groups = groupWorkflowsByCategory([
      entry("h1", "separation", harnessOf("a")),
      entry("b", "separation", STANDALONE),
      entry("a", "separation", COMPOSITION),
      entry("h2", "separation", harnessOf("a")),
    ]);
    assert.deepEqual(shape(groups), {
      Separations: [
        { id: "b", members: [] },
        { id: "a", members: ["h1", "h2"] },
      ],
    });
  });

  it("is a pure function of its input — the same list twice is the same answer", () => {
    const list = [
      entry("separations", "separation", COMPOSITION),
      entry("separations-kuali-read", "separation", harnessOf("separations")),
      entry("person-lookup", "search", STANDALONE),
    ];
    assert.deepEqual(shape(groupWorkflowsByCategory(list)), shape(groupWorkflowsByCategory(list)));
  });
});
