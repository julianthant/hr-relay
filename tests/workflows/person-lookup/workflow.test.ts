import { InputRunSurfaceSchema } from "../../../src/models/workflow/ingress.js";
import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { workflowPlanning, workflowProjections } from "../../../src/workflow-kit/workflow.js";
import { personLookupDescriptor, personLookupModule, separationsIdentityCheckDescriptor, separationsKronosTimecardDescriptor, separationsUcpathTerminationDescriptor } from "../../support/helpers/registered-workflows.js";

describe("workflow definition public equivalence characterization", () => {
  it("declares the exact Queue outcome table for Search and Match", () => {
    assert.deepEqual(personLookupDescriptor.outcomeProjection, {
      fieldPath: "activeStatus.state",
      cases: [
        { value: "active", label: "Active", tone: "success" },
        { value: "inactive", label: "Inactive", tone: "neutral" },
        { value: "crm-only", label: "CRM only", tone: "warning" },
        { value: "multiple-matches", label: "Multiple matches", tone: "warning" },
        { value: "not-found", label: "Not found", tone: "neutral" },
        { value: "undetermined", label: "Undetermined", tone: "warning" },
        { value: "found", label: "Found", tone: "success" },
        { value: "not-found-in-ucpath", label: "Not found in UCPath", tone: "neutral" },
      ],
    });
  });
  it("carries the complete typed input declaration through a JSON surface round trip", () => {
    const surface = personLookupDescriptor.surfaces.inputRun;
    assert.ok(surface?.typedInput);
    assert.deepEqual(InputRunSurfaceSchema.parse(JSON.parse(JSON.stringify(surface))), surface);
    assert.deepEqual(surface.typedInput.modes.map(mode => mode.value), ["search", "match"]);
    assert.deepEqual(surface.typedInput.controls.map(control => [control.field, control.placement, control.modes, control.requires]), [
      ["crmCheck", "input", ["search", "match"], []],
      ["keepNonHdh", "hidden", ["search"], []],
      ["includeCrmDates", "step", ["search"], ["crmCheck"]],
    ]);
  });
  it("keeps person lookup's public descriptor, module stores, normalized timeline, and registry value", () => {
    const intake = personLookupModule.intake;
    if (intake === undefined) throw new Error("person-lookup registers no intake projection");

    expect({
      descriptor: {
        id: String(personLookupDescriptor.id),
        version: personLookupDescriptor.version,
        code: personLookupDescriptor.code,
        label: personLookupDescriptor.label,
        summary: personLookupDescriptor.summary,
        icon: personLookupDescriptor.icon,
        category: personLookupDescriptor.category,
        surface: personLookupDescriptor.surface,
        enqueue: personLookupDescriptor.enqueue,
        actions: personLookupDescriptor.actions,
        capabilities: personLookupDescriptor.capabilities,
        verdicts: personLookupDescriptor.verdicts,
        surfaces: personLookupDescriptor.surfaces,
        details: personLookupDescriptor.details,
        subjectProjection: personLookupDescriptor.subjectProjection,
        subtitleProjection: personLookupDescriptor.subtitleProjection,
        timelineDeclared: personLookupDescriptor.timelineDeclared,
        timeline: personLookupDescriptor.timeline.map((group) => ({
          key: group.key,
          label: group.label,
          nodes: group.nodes.map((node) => ({ id: String(node.id), label: node.label })),
        })),
        stepOmissions: personLookupDescriptor.stepOmissions,
      },
      module: {
        role: personLookupModule.role,
        stores: personLookupModule.stores.map((store) => ({ kind: store.kind, namespace: store.namespace })),
        intakeTargets: intake.targets.map((target) => ({
          targetFieldId: target.targetFieldId,
          canonicalFieldId: target.canonicalFieldId,
          label: target.label,
          required: target.required,
        })),
      },
      registryIndex: WORKFLOW_MODULES.indexOf(personLookupModule),
    }).toEqual({
  "descriptor": {
    "id": "person-lookup",
    "version": 3,
    "code": "pl",
    "label": "Person Lookup",
    "summary": "Searches or matches one person in UCPath, cross-checks CRM, and reads employment status and selected CRM dates.",
    "icon": "Search",
    "category": "search",
    "subjectProjection": undefined,
    "subtitleProjection": { "fieldPath": "activeStatus.details.eid", "display": "eid" },
    "surface": {
      "shape": "single"
    },
    "enqueue": "reject-active",
    "actions": {
      "enabled": [
        "retry",
        "restart",
        "cancel",
        "bump",
        "rename",
        "delete"
      ]
    },
    "capabilities": {
      "review": false,
      "editData": {
        "fields": [
          {
            "nodeId": "crm-dates",
            "fieldPath": "employmentDate",
            "label": "Employment date"
          },
          {
            "nodeId": "crm-dates",
            "fieldPath": "oathDate",
            "label": "Oath date"
          }
        ]
      }
    },
    "verdicts": [
      {
        "key": "not-found",
        "label": "Not found",
        "tone": "warning"
      },
      {
        "key": "inactive",
        "label": "Inactive",
        "tone": "warning",
        "tag": true
      },
      {
        "key": "multiple-matches",
        "label": "Multiple matches",
        "tone": "warning"
      }
    ],
    "surfaces": {
      "inputRun": {
        "typedInput": {
    modeField: "mode", modeLabel: "Lookup mode", initialMode: "search", description: "Each entry starts one run.",
    modes: [
      { value: "search", label: "Search", inputLabel: "Employee IDs or names", hint: "Separate people with a semicolon or a new line.", placeholder: "10000001; Lee, Jordan",
        defaults: [{ field: "crmCheck", value: { kind: "boolean", value: true } }, { field: "keepNonHdh", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: false } }],
        parser: { kind: "entries", spec: { split: { kind: "delimited", delimiters: [";", "\n"] }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }, { when: { kind: "otherwise" }, emit: "name" }] } },
        display: { kind: "first-present", fields: ["emplId", "name"] }, identityFields: ["emplId", "name"],
      },
      { value: "match", label: "Match", inputLabel: "Name, DOB and SSN", hint: "Last, First, DOB, SSN. Use x for an unavailable DOB or SSN, but not both. Separate people with semicolons.", placeholder: "Lee, Jordan, 01/01/2000, x",
        defaults: [{ field: "crmCheck", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: false } }],
        parser: { kind: "name-tuple", delimiter: ";", familyName: "lastName", givenName: "firstName", identifiers: [{ field: "dob", canonicalField: "text" }, { field: "ssn", canonicalField: "ssn" }], missing: "x", missingIdentifiersCode: "PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS" },
        display: { kind: "tuple", fields: ["lastName", "firstName", "dob", "ssn"], separator: ", ", missing: "x", masked: ["ssn"] }, identityFields: ["lastName", "firstName", "dob", "ssn"],
      },
    ],
    controls: [
      { field: "crmCheck", label: "CRM check", placement: "input", modes: ["search", "match"], requires: [] },
      { field: "keepNonHdh", label: "Keep non-HDH candidates", placement: "hidden", modes: ["search"], requires: [] },
      { field: "includeCrmDates", label: "Read CRM dates", placement: "step", modes: ["search"], requires: ["crmCheck"] },
    ],
  },
        "placeholder": "Enter employee IDs or names separated by semicolons or new lines",
        "parser": {
          "split": {
            "kind": "delimited",
            "delimiters": [
              ";",
              "\n"
            ]
          },
          "rules": [
            {
              "when": {
                "kind": "pattern",
                "pattern": "eid"
              },
              "emit": "emplId"
            },
            {
              "when": {
                "kind": "otherwise"
              },
              "emit": "name"
            }
          ],
          "constants": [
            {
              "field": "mode",
              "value": {
                "kind": "text",
                "text": "search"
              }
            },
            {
              "field": "crmCheck",
              "value": {
                "kind": "boolean",
                "value": true
              }
            },
            {
              "field": "keepNonHdh",
              "value": {
                "kind": "boolean",
                "value": false
              }
            },
            {
              "field": "includeCrmDates",
              "value": {
                "kind": "boolean",
                "value": false
              }
            }
          ]
        },
        "examples": [
          {
            "key": "one-eid",
            "label": "One employee ID",
            "text": "10000001",
            "note": "Search one employee ID"
          }
        ],
        "supportsDryRun": false
      }
    },
    "details": [
      {
        "key": "active-state",
        "label": "Outcome",
        "source": {
          "kind": "result",
          "fieldPath": "activeStatus.state"
        },
        "display": "badge"
      },
      {
        "key": "detail-eid",
        "label": "EID",
        "source": {
          "kind": "result",
          "fieldPath": "activeStatus.details.eid"
        },
        "display": "text"
      }
    ],
    "timelineDeclared": true,
    "timeline": [
      {
        "key": "searching",
        "label": "Search for person",
        "nodes": [
          {
            "id": "searching",
            "label": "Search for person"
          },
          {
            "id": "matching",
            "label": "Match person"
          },
          {
            "id": "search-identity",
            "label": "Resolve UCPath identity"
          }
        ]
      },
      {
        "key": "cross-verify",
        "label": "Cross-check identity",
        "nodes": [
          {
            "id": "cross-verify",
            "label": "Cross-check identity"
          },
          {
            "id": "crm-identity",
            "label": "Resolve cross-checked identity"
          },
          {
            "id": "crm-selected-record",
            "label": "Verify selected CRM record"
          },
          {
            "id": "crm-results",
            "label": "Read unresolved CRM results"
          }
        ]
      },
      {
        "key": "active-status",
        "label": "Read employment status",
        "nodes": [
          {
            "id": "crm-only-recovery",
            "label": "Searching"
          },
          {
            "id": "active-status",
            "label": "Read employment status"
          }
        ]
      },
      {
        "key": "crm-dates",
        "label": "Read CRM dates",
        "nodes": [
          {
            "id": "crm-dates",
            "label": "CRM Dates"
          }
        ]
      }
    ],
    "stepOmissions": []
  },
  "module": {
    "role": {
      "kind": "standalone"
    },
    "stores": [
      {
        "kind": "browser",
        "namespace": "ucpath"
      },
      {
        "kind": "browser",
        "namespace": "crm"
      },
      {
        "kind": "headless",
        "namespace": "workflow:person-lookup"
      }
    ],
    "intakeTargets": [
      {
        "targetFieldId": "emplId",
        "canonicalFieldId": "eid",
        "label": "Employee ID (EID)",
        "required": false
      },
      {
        "targetFieldId": "name",
        "canonicalFieldId": "fullName",
        "label": "Full Name",
        "required": false
      }
    ]
  },
  "registryIndex": 0
});
  });

  it("keeps person lookup's input-subject, node graph, and derived projections", () => {
    const projections = workflowProjections(personLookupDescriptor);

    expect({
      inputSubjects: [
        workflowPlanning(personLookupDescriptor).inputSubject({ mode: "search", crmCheck: true, name: "Battistessa, Johnnie", keepNonHdh: false, includeCrmDates: false }),
        workflowPlanning(personLookupDescriptor).inputSubject({ mode: "search", crmCheck: true, emplId: "10873698", keepNonHdh: false, includeCrmDates: false }),
      ],
      graph: personLookupDescriptor.nodes.map((node) => {
        const when = "when" in node ? node.when : undefined;
        return {
          id: String(node.id),
          kind: node.kind,
          dependsOn: node.dependsOn.map(String),
          ...(when === undefined ? {} : { when }),
          ...(node.kind === "transaction" ? { dryRun: node.dryRun } : {}),
        };
      }),
      steps: workflowProjections(personLookupDescriptor).steps.map(({ key, nodeId, label, kind, taskId, conditional }) => ({
        key,
        nodeId: String(nodeId),
        label,
        kind,
        ...(taskId === undefined ? {} : { taskId: String(taskId) }),
        conditional,
      })),
      gates: projections.gates,
      systems: projections.systems,
      requires: projections.requires,
      contracts: projections.contracts.map((contract) => String(contract.id)),
      dryRun: projections.dryRun,
    }).toEqual({
  "inputSubjects": [
    "name",
    "eid"
  ],
  "graph": [
    {
      "id": "searching",
      "kind": "task",
      "dependsOn": [],
      "when": {
        "kind": "equals",
        "of": {
          "from": "input",
          "path": "mode"
        },
        "value": "search"
      }
    },
    {
      "id": "matching",
      "kind": "task",
      "dependsOn": [
        "searching"
      ],
      "when": {
        "kind": "equals",
        "of": {
          "from": "input",
          "path": "mode"
        },
        "value": "match"
      }
    },
    {
      "id": "search-identity",
      "kind": "task",
      "dependsOn": [
        "searching",
        "matching"
      ]
    },
    {
      "id": "cross-verify",
      "kind": "task",
      "dependsOn": [
        "search-identity",
        "searching",
        "matching"
      ],
      "when": {
        "kind": "is-true",
        "of": {
          "from": "node",
          "nodeId": "search-identity",
          "path": "shouldCheckCrm"
        }
      }
    },
    {
      "id": "crm-identity",
      "kind": "task",
      "dependsOn": [
        "search-identity",
        "cross-verify",
        "searching",
        "matching"
      ],
      "when": {
        "kind": "is-true",
        "of": {
          "from": "node",
          "nodeId": "search-identity",
          "path": "shouldCheckCrm"
        }
      }
    },
    {
      "id": "crm-selected-record",
      "kind": "task",
      "dependsOn": [
        "crm-identity"
      ],
      "when": {
        "kind": "is-present",
        "of": {
          "from": "node",
          "nodeId": "crm-identity",
          "path": "crmRecord"
        }
      }
    },
    {
      "id": "crm-results",
      "kind": "task",
      "dependsOn": [
        "search-identity",
        "cross-verify",
        "crm-identity",
        "searching",
        "matching"
      ],
      "when": {
        "kind": "is-present",
        "of": {
          "from": "node",
          "nodeId": "crm-identity",
          "path": "unselectedCrmRecords"
        }
      }
    },
    {
      "id": "crm-only-recovery",
      "kind": "task",
      "dependsOn": [
        "crm-identity",
        "crm-selected-record",
        "crm-results"
      ],
      "when": {
        "kind": "is-present",
        "of": {
          "from": "node",
          "nodeId": "crm-identity",
          "path": "recoveryEid"
        }
      }
    },
    {
      "id": "active-status",
      "kind": "task",
      "dependsOn": [
        "search-identity",
        "crm-identity",
        "crm-only-recovery",
        "crm-selected-record",
        "crm-results"
      ],
      "when": {
        "kind": "equals",
        "of": {
          "from": "input",
          "path": "mode"
        },
        "value": "search"
      }
    },
    {
      "id": "crm-dates",
      "kind": "task",
      "dependsOn": [
        "active-status"
      ],
      "when": {
        "kind": "is-present",
        "of": {
          "from": "node",
          "nodeId": "active-status",
          "path": "datesEid"
        }
      }
    }
  ],
  "steps": [
    {
      "key": "searching",
      "nodeId": "searching",
      "label": "Search for person",
      "kind": "task",
      "taskId": "ucpath/search-person-org",
      "conditional": true
    },
    {
      "key": "matching",
      "nodeId": "matching",
      "label": "Match person",
      "kind": "task",
      "taskId": "ucpath/search-person-match",
      "conditional": true
    },
    {
      "key": "search-identity",
      "nodeId": "search-identity",
      "label": "Resolve UCPath identity",
      "kind": "task",
      "taskId": "workflow:person-lookup/read-resolved-identity",
      "conditional": false
    },
    {
      "key": "cross-verify",
      "nodeId": "cross-verify",
      "label": "Cross-check identity",
      "kind": "task",
      "taskId": "crm/search-onboarding-records",
      "conditional": true
    },
    {
      "key": "crm-identity",
      "nodeId": "crm-identity",
      "label": "Resolve cross-checked identity",
      "kind": "task",
      "taskId": "workflow:person-lookup/read-resolved-identity",
      "conditional": true
    },
    {
      "key": "crm-selected-record",
      "nodeId": "crm-selected-record",
      "label": "Verify selected CRM record",
      "kind": "task",
      "taskId": "crm/verify-onboarding-record",
      "conditional": true
    },
    {
      "key": "crm-results",
      "nodeId": "crm-results",
      "label": "Read unresolved CRM results",
      "kind": "task",
      "taskId": "crm/read-onboarding-results",
      "conditional": true
    },
    {
      "key": "crm-only-recovery",
      "nodeId": "crm-only-recovery",
      "label": "Searching",
      "kind": "task",
      "taskId": "ucpath/search-person-org",
      "conditional": true
    },
    {
      "key": "active-status",
      "nodeId": "active-status",
      "label": "Read employment status",
      "kind": "task",
      "taskId": "workflow:person-lookup/read-active-status",
      "conditional": true
    },
    {
      "key": "crm-dates",
      "nodeId": "crm-dates",
      "label": "CRM Dates",
      "kind": "task",
      "taskId": "crm/read-onboarding-dates",
      "conditional": true
    }
  ],
  "gates": [],
  "systems": [
    "crm",
    "ucpath"
  ],
  "requires": [],
  "contracts": [
    "ucpath/search-person-org",
    "ucpath/search-person-match",
    "workflow:person-lookup/read-resolved-identity",
    "crm/search-onboarding-records",
    "workflow:person-lookup/read-resolved-identity",
    "crm/verify-onboarding-record",
    "crm/read-onboarding-results",
    "ucpath/search-person-org",
    "workflow:person-lookup/read-active-status",
    "crm/read-onboarding-dates"
  ],
  "dryRun": {
    "state": "unsupported",
    "reason": "no-transaction-node"
  }
});
  });
});

const EID = "10833507";

describe("workflow durable match-key identity", () => {
  it("preserves the byte-exact natural keys that predate identifier redaction", () => {
    const personByEid = personLookupDescriptor.input.parse({ emplId: EID });
    const personByName = personLookupDescriptor.input.parse({ name: "Hernandez, Jose Santos" });
    const identityCheck = separationsIdentityCheckDescriptor.input.parse({
      documentNumber: "4510",
      employeeName: "Hernandez, Jose Santos",
      emplId: EID,
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: EID },
    });
    const timecard = separationsKronosTimecardDescriptor.input.parse({
      emplId: EID,
      expectedName: "Hernandez, Jose Santos",
      rangeStart: "06/01/2026",
      rangeEnd: "08/12/2026",
    });
    const termination = separationsUcpathTerminationDescriptor.input.parse({
      documentNumber: "4510",
      employeeName: "Hernandez, Jose Santos",
      emplId: EID,
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: EID },
      terminationType: { state: "present", value: "No Reason Given" },
      observedTerminationTypeOptions: ["- - -", "No Reason Given"],
      emplRecord: "0",
      effectiveDate: "06/11/2026",
      lastDateWorked: "06/10/2026",
      initiatorComments: "Separation filed from Kuali RRSS document 4510.",
    });

    assert.deepEqual([
      personLookupDescriptor.identity.matchKey(personByEid),
      personLookupDescriptor.identity.matchKey(personByName),
      separationsIdentityCheckDescriptor.identity.matchKey(identityCheck),
      separationsKronosTimecardDescriptor.identity.matchKey(timecard),
      separationsUcpathTerminationDescriptor.identity.matchKey(termination),
    ], [
      `eid:${EID}`,
      "name:hernandez, jose santos",
      `separations-identity:4510:${EID}`,
      `kronos-timecard:${EID}:06/01/2026:08/12/2026`,
      `separations-ucpath-termination:${EID}:06/11/2026`,
    ]);
  });
});
