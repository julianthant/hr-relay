import { describe,expect,it } from "vitest";
import { z } from "zod";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import type { WorkflowAuthor,WorkflowDefinitionSpec } from "../../../../src/workflow-kit/workflow-definition.js";
import {
defineWorkflow
} from "../../../../src/workflow-kit/workflow-definition.js";
import {
PersonLookupCanonicalInput,
PersonLookupInput
} from "../../../../src/workflows/person-lookup/workflow.js";

const lookupInput = ({ input }: { input: { emplId?: string; name?: string; keepNonHdh: boolean } }) =>
  input.emplId === undefined
    ? { kind: "by-name" as const, name: input.name ?? "Fixture Person", keepNonHdh: input.keepNonHdh }
    : { kind: "by-eid" as const, emplId: input.emplId };

type Author = WorkflowAuthor<typeof PersonLookupInput>;
type Authored = ReturnType<WorkflowDefinitionSpec<typeof PersonLookupInput, z.ZodType>["steps"]>;

/** A minimal person-lookup-shaped definition whose only variable part is its graph. */
function fixtureWorkflow(id: string, steps: (author: Author) => Authored) {
  return defineWorkflow({
    id,
    version: 1,
    code: "fx",
    label: "Fixture",
    icon: "Search",
    category: "search",
    input: PersonLookupInput,
    canonicalInput: PersonLookupCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: () => "fixture" },
    presentation: { title: () => "Fixture" },
    scenarios: ["person-lookup/happy-by-eid"],
    role: defineWorkflowRole({ kind: "standalone" }),
    steps,
  });
}

describe("workflow definition compiler", () => {

  it("refuses duplicate entry membership and duplicate entry ids by name", () => {
    expect(() => fixtureWorkflow("dup-member", ({ task, result }) => {
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [
          [{ key: "first", label: "First" }, [first]],
          [{ key: "second", label: "Second" }, [first]],
        ],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow entry "first" appears in more than one timeline tuple/u);

    expect(() => fixtureWorkflow("dup-id", ({ task, result }) => {
      const first = task({ id: "same-id", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const second = task({ id: "same-id", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [[{ key: "group", label: "Group" }, [first, second]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow dup-id declares entry id "same-id" more than once/u);
  });

  it("refuses duplicate or unstable timeline groups", () => {
    expect(() => fixtureWorkflow("dup-group", ({ task, result }) => {
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const second = task({ id: "second", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [
          [{ key: "duplicate", label: "First" }, [first]],
          [{ key: "duplicate", label: "Second" }, [second]],
        ],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow dup-group repeats timeline group key "duplicate"/u);

    expect(() => fixtureWorkflow("unstable", ({ task, result }) => {
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [[{ key: "Not Stable", label: "First" }, [first]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/kebab-case slug/u);
  });
});

describe("workflow definition entry algebra", () => {

  it("does not offer any fragment adapter or recipe-named authoring path", () => {
    const authored: string[] = [];
    fixtureWorkflow("author-surface", (author) => {
      authored.push(...Object.keys(author).toSorted());
      const only = author.task({ id: "only", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return { steps: [[{ key: "only", label: "Only" }, [only]]], result: author.result(z.string(), [], () => "done") };
    });
    expect(authored).toEqual(["delegate", "gate", "group", "parallel", "result", "task", "transaction"]);
  });
});
