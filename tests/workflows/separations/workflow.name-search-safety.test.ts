import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parsePersonOrgGridRows, searchPersonOrgWithPagePort } from "../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { SearchPersonOrg, SearchPersonOrgInputSchema } from "../../../src/models/systems/ucpath/search-person-org.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { separationsDescriptor, separationsIdentityCheckDescriptor, separationsUcpathTerminationDescriptor, separationsKualiFinalizationDescriptor } from "../../support/helpers/registered-workflows.js";

const employeeName = "Quillan, Petra";
const eid = EidSchema.parse("10873698");

describe("Separations shared Person Org search safety", () => {
  for (const descriptor of [separationsDescriptor, separationsIdentityCheckDescriptor, separationsUcpathTerminationDescriptor, separationsKualiFinalizationDescriptor]) {
    it(`${descriptor.id} uses its declared criterion and rejects a non-exact person`, async () => {
      const nodes = descriptorRuntimeNodes(descriptor);
      const search = nodes.find(node => node.id === "name-search");
      assert.ok(search?.kind === "task");
      assert.equal(search.uses, SearchPersonOrg);
      const searchesByEid = descriptor === separationsDescriptor || descriptor === separationsIdentityCheckDescriptor;
      const input = SearchPersonOrgInputSchema.parse(search.bind({
        input: { employeeName, emplId: eid },
        outputs: { document: { employee: { eid: { state: "present", value: eid } } } },
      }));
      assert.deepEqual(input, searchesByEid
        ? { kind: "by-eid", emplId: eid }
        : { kind: "by-name", name: employeeName, keepNonHdh: true });
      for (const exact of [false, true]) {
        const name = exact ? "Petra Quillan" : "Petral Quillanmore";
        const returnedEid = searchesByEid && !exact ? "10401814" : eid;
        const row = [returnedEid, "0", "Active", "SDCMP", "004921", "Fictional analyst", exact ? "Quillan" : "Quillanmore", name];
        const rows = parsePersonOrgGridRows(searchesByEid && exact
          ? [["10401814", "0", "Active", "SDCMP", "004921", "Fictional analyst", "Quillan", name], row]
          : [row]);
        const drills: number[] = [];
        const output = await searchPersonOrgWithPagePort(() => undefined, {
          search: async () => ({ kind: "grid", rows }),
          drill: async rowIndex => {
            drills.push(rowIndex);
            return { observedEid: eid, displayedName: name, employmentInstances: "already-complete",
              startDate: "", terminationDate: "", terminationReason: "",
              cells: [["0", "08/01/2026", "Active", "SDCMP", "40000000", "000412", "Fictional department", "004921", "Fictional analyst", "", "0.50", "Student"]] };
          },
          returnToResults: async () => rows,
        }, input);
        assert.equal(output.selection.status, exact ? "resolved" : "not-found");
        assert.deepEqual(drills, exact ? (searchesByEid ? [1, 1] : [0, 0]) : []);
        if (exact) {
          assert.equal(output.selection.selected?.emplId, eid);
        } else {
          assert.deepEqual(output.results, []);
        }
      }
      const gate = nodes.find(node => node.id === "identity-approval");
      assert.ok(gate?.kind === "gate" && "when" in gate);
      assert.deepEqual(gate.when, { kind: "is-true", of: { from: "node", nodeId: "comparison", path: "approvalRequired" } });
      const approval = nodes.find(node => node.id === "approval");
      assert.ok(approval);
      assert.ok(approval.dependsOn.includes(gate.id));
      for (const transaction of nodes.filter(node => node.kind === "transaction")) {
        assert.ok(transaction.dependsOn.includes(approval.id), `${transaction.id} must depend on identity authority`);
      }
    });
  }
});
