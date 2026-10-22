import { personLookupDescriptor } from "../../registered-workflows.js";
import { personLookupModule } from "../../registered-workflows.js";
import { FrontendBootstrapWireSchema, type FrontendBootstrapWire } from "../../../../../src/models/dashboard/bootstrap.js";
import { SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID } from "../../../../../src/models/dashboard/settings.js";
import { descriptorSetHash } from "../../../../../src/backend/app/registries/workflow-registry.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";


export function createFixtureBootstrapSetup({ bootstrapDescriptorHash, at, CONTRACT_FINGERPRINT, FIXTURE_APP_VERSION, FIXTURE_NOW, WORKFLOW_ID }: {
bootstrapDescriptorHash: (CONTRACT_FINGERPRINT: string) => string;
at: typeof FixtureIdentityTypes.at;
CONTRACT_FINGERPRINT: typeof FixtureIdentityTypes.CONTRACT_FINGERPRINT;
FIXTURE_APP_VERSION: typeof FixtureIdentityTypes.FIXTURE_APP_VERSION;
FIXTURE_NOW: typeof FixtureIdentityTypes.FIXTURE_NOW;
WORKFLOW_ID: typeof FixtureIdentityTypes.WORKFLOW_ID;
}) {
  const FIXTURE_BOOTSTRAP: FrontendBootstrapWire = FrontendBootstrapWireSchema.parse({
    wireVersion: 1,
    appVersion: FIXTURE_APP_VERSION,
    descriptorHash: bootstrapDescriptorHash(CONTRACT_FINGERPRINT),
    settingsSchemaHash: descriptorSetHash(["settings-schema"]),
    protectedSchemaHash: descriptorSetHash(["protected-settings-schema"]),
    projectionGeneration: 1,
    actor: { id: "local-operator", label: "Local operator" },
    serverClock: { now: FIXTURE_NOW, zone: "America/Los_Angeles" },
    storage: { authority: "healthy", backup: "current", checkedAt: at(0) },
    workflows: [{
      id: WORKFLOW_ID,
      code: personLookupDescriptor.code,
      label: personLookupDescriptor.label,
      categoryId: personLookupDescriptor.category,
      descriptorFingerprint: CONTRACT_FINGERPRINT,
      availability: { state: "available" },

      role: { kind: "standalone" },

      start: {
        summary: "Resolves ONE person across UCPath and the CRM: searches Person Org by EID or name, cross-verifies the match against the CRM onboarding record, folds the two into an active / inactive verdict, and reads the CRM onboarding dates when the run asks for them.",
        enqueue: "reject-active",
        version: 7,
        steps: [
          {
            key: "searching",
            label: "Searching",
            includedByDefault: true,
            control: {
              state: "required",
              reason: "This workflow requires every node in this step."
            }
          },
          {
            key: "cross-verify",
            label: "Cross Verification",
            includedByDefault: true,
            control: {
              state: "required",
              reason: "This workflow requires every node in this step."
            }
          },
          {
            key: "active-status",
            label: "Active Status",
            includedByDefault: true,
            control: {
              state: "required",
              reason: "This workflow requires every node in this step."
            }
          },
          {
            key: "crm-dates",
            label: "CRM Dates",
            includedByDefault: false,
            control: {
              state: "selectable",
              inputField: "includeCrmDates"
            }
          }
        ],
        inputRun: {
          placeholder: "Enter EIDs or names, semicolon-separated (e.g. 10873698; Battistessa, Johnnie)",
          parser: {
            split: {
              kind: "delimited",
              delimiters: [
                ";",
                "\n"
              ]
            },
            rules: [
              {
                when: {
                  kind: "pattern",
                  pattern: "eid"
                },
                emit: "emplId"
              },
              {
                when: {
                  kind: "otherwise"
                },
                emit: "name"
              }
            ],
            constants: [
              {
                field: "keepNonHdh",
                value: {
                  kind: "boolean",
                  value: false
                }
              },
              {
                field: "includeCrmDates",
                value: {
                  kind: "boolean",
                  value: false
                }
              }
            ]
          },
          examples: [
            {
              key: "one-eid",
              label: "One EID",
              text: "10873698",
              note: "the ordinary case — one run for one employee id"
            },
            {
              key: "eid-and-name",
              label: "An EID and a name",
              text: "10873698; Battistessa, Johnnie",
              note: "two runs from one box: the parser reads the first as an employee id and the second as a name, and the comma inside the name is not a separator"
            }
          ]
        },

        spreadsheetIntake: personLookupModule.intake !== undefined,
      },
    }],
    systemInstances: [
      { system: "ucpath", prod: "available", test: { state: "available" } },
      { system: "crm", prod: "available", test: { state: "unavailable", code: "not-configured", reason: "no CRM test instance is configured" } },
    ],

    settingsSections: [
      { id: "storage", label: "Storage checks", revision: 1 },
      { id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, label: "Workflow capabilities", revision: 1 },
    ],
    featureAvailability: [
      { feature: "ocr", availability: { state: "unavailable", code: "deferred", reason: "OCR review lands in 2h" } },
      { feature: "archive", availability: { state: "unavailable", code: "deferred", reason: "archive lands in 2i" } },
      { feature: "workflow-editor", availability: { state: "unavailable", code: "deferred", reason: "the editor lands in a later phase" } },
    ],
  });

  return { FIXTURE_BOOTSTRAP };
}
