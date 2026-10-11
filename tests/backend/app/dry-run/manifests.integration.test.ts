import assert from "node:assert/strict";
import {
rmSync
} from "node:fs";
import { afterEach,describe,it } from "vitest";
import { loadDryRunScenarioManifest } from "../../../../src/backend/app/dry-run/manifests.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("dry-run scenario manifest registry", () => {
  it("names exactly the registered workflows for an unknown workflow, even a prototype key", async () => {
    for (const workflow of ["constructor", "nope"]) {
      await assert.rejects(
        async () => loadDryRunScenarioManifest(workflow),
        new RegExp(
          `unknown dry-run scenario workflow ${workflow}; registered:`,
        ),
      );
    }
  });
});
