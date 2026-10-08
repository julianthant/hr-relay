import assert from "node:assert/strict";
import { SavedArchiveReportWireSchema } from "../../../src/domain/dashboard/archive.js";
import { it } from "vitest";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";
import { archiveCsvFields, archiveFieldRows } from "../../../src/domain/dashboard/archive-export.js";

it("encodes special object members reversibly without structural field-path collisions", () => {
  const special = { "a.b": 1, a: { b: 2 }, "x[0]": 3, x: [4], 'q"uote': 5, "back\\slash": 6, "": 7, "0": 8 };
  const report = SavedArchiveReportWireSchema.parse({ ...H_REPORT,
    sections: [{ kind: "values", title: "Special keys", values: [{ label: "Object", value: special }] }] });
  const prefix = "sections[0].values[0].value";
  const rows = archiveFieldRows([report]).filter(([, path]) => path.startsWith(prefix));
  assert.equal(new Set(rows.map(([, path]) => path)).size, 8);
  const actual = new Map(rows.map(([, path, , value]) => [path, value]));
  for (const [path, expected] of [[`${prefix}["a.b"]`, "1"], [`${prefix}.a.b`, "2"],
    [`${prefix}["x[0]"]`, "3"], [`${prefix}.x[0]`, "4"],
    [`${prefix}[${JSON.stringify('q"uote')}]`, "5"], [`${prefix}[${JSON.stringify("back\\slash")}]`, "6"],
    [`${prefix}[""]`, "7"], [`${prefix}["0"]`, "8"]]) assert.equal(actual.get(path), expected);
  assert.ok(archiveCsvFields([report]).includes('sections[0].values[0].value.a.b'));
  for (const [, path, type, value] of rows) {
    const tokens = [...path.matchAll(/(?:^|\.)([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+|"(?:\\.|[^"\\])*")\]/gu)];
    assert.equal(tokens.map(token => token[0]).join(""), path);
    let resolved: unknown = report;
    for (const token of tokens) {
      const key: string | number = token[1] ?? JSON.parse(token[2]);
      assert.ok(resolved !== null && typeof resolved === "object");
      resolved = Reflect.get(resolved, key);
    }
    assert.equal(type, "number");
    assert.equal(String(resolved), value);
  }
});
