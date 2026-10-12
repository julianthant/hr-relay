import { createSearchWorkflowDefinitionFixtures } from "../../../support/helpers/search-workflow-definition-fixtures.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";

const { lookupInput, fixtureWorkflow } = createSearchWorkflowDefinitionFixtures();

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
