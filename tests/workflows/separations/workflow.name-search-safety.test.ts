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
        const rows = parsePersonOrgGridRows([[returnedEid, "0", "Active", "SDCMP", "004921", "Fictional analyst", exact ? "Quillan" : "Quillanmore", name]]);
        let drills = 0;
        const read = searchPersonOrgWithPagePort(() => undefined, {
          search: async () => ({ kind: "grid", rows }),
          drill: async () => {
            drills += 1;
            return { observedEid: eid, displayedName: name, employmentInstances: "already-complete",
              startDate: "", terminationDate: "", terminationReason: "",
              cells: [["0", "08/01/2026", "Active", "SDCMP", "40000000", "000412", "Fictional department", "004921", "Fictional analyst", "", "0.50", "Student"]] };
          },
          returnToResults: async () => rows,
        }, input);
        if (searchesByEid && !exact) {
          await assert.rejects(read, /unexpected results grid/u);
          assert.equal(drills, 0);
          continue;
        }
        const output = await read;
        assert.equal(output.selection.status, exact ? "resolved" : "not-found");
        assert.equal(drills, exact ? 2 : 0);
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
