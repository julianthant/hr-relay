import { EidSchema } from "../../../domain/ids.js";
import { directIdentifierDisplay } from "../../../domain/redaction.js";
import { SearchPersonOrgOutputSchema } from "../../../domain/contracts/ucpath/search-person-org.js";
import type { SearchPersonOrgOutput } from "../../../domain/contracts/ucpath/search-person-org.js";
import { PageStateProofSchema, UiActionProofSchema } from "../../../domain/ui/driver.js";
import type { UiActionProof } from "../../../domain/ui/driver.js";
import { UcpathJobSummaryReadSchema } from "../../../domain/ui/ucpath-job-summary.js";
import type { UcpathJobSummaryRead } from "../../../domain/ui/ucpath-job-summary.js";
import {
  UCPATH_PERSON_ORG_DETAIL_READY,
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../../domain/ui/ucpath-person-org.js";
import type { UcpathPersonOrgScreens } from "../../../domain/ui/ucpath-person-org.js";
import type { UcpathStoreDriver } from "../../../domain/ui/ucpath-driver.js";
import { refuseUnimplementedSmartHrHalf } from "./smart-hr-fake.js";

export function createDeterministicUcpathPersonOrgDriver(
  result?: SearchPersonOrgOutput,
  jobSummary?: UcpathJobSummaryRead,
): UcpathStoreDriver {
  let screen: UcpathPersonOrgScreens = UCPATH_PERSON_ORG_SEARCH_SCREEN;
  let eid: ReturnType<typeof EidSchema.parse> | undefined;
  return {
    ...refuseUnimplementedSmartHrHalf("the Person Org fixture"),
    system: "ucpath",
    async readJobSummary(input) {
      if (jobSummary === undefined) {
        throw new Error(
          "deterministic UCPath driver requires an explicit job summary; a fabricated employment grid "
          + "would make every S21–S24 arm agree with whatever the fixture wanted",
        );
      }
      const parsed = UcpathJobSummaryReadSchema.parse(jobSummary);
      if (parsed.state === "read" && parsed.summary.emplId !== input.emplId) {
        throw new Error(
          `deterministic UCPath job summary is for ${directIdentifierDisplay(parsed.summary.emplId)}, not ${directIdentifierDisplay(input.emplId)}`,
        );
      }
      return parsed;
    },
    async searchPersonOrg(input) {
      if (result !== undefined) return SearchPersonOrgOutputSchema.parse(result);
      if (input.kind !== "by-eid") {
        throw new Error("deterministic UCPath driver requires an explicit result for a by-name search");
      }
      const candidate = {
        emplId: input.emplId,
        name: "Deterministic, Person",
        department: "Housing Dining Hospitality",
        jobTitle: "Fixture employee",
        employeeStatus: "active" as const,
        hdh: true,
      };
      return SearchPersonOrgOutputSchema.parse({
        results: [candidate],
        selection: { status: "resolved", selected: candidate, candidateEids: [input.emplId] },
      });
    },
    async goto(nextScreen) {
      if (nextScreen !== UCPATH_PERSON_ORG_SEARCH_SCREEN && nextScreen !== UCPATH_PERSON_ORG_DETAIL_SCREEN) {
        throw new Error(`the Person Org fixture has no screen ${String(nextScreen)}`);
      }
      screen = nextScreen;
      const stateId = nextScreen === UCPATH_PERSON_ORG_SEARCH_SCREEN
        ? UCPATH_PERSON_ORG_SEARCH_READY
        : UCPATH_PERSON_ORG_DETAIL_READY;
      return PageStateProofSchema.parse({ system: "ucpath", stateId, matched: true });
    },
    async waitFor(stateId) {
      const expected = screen === UCPATH_PERSON_ORG_SEARCH_SCREEN
        ? UCPATH_PERSON_ORG_SEARCH_READY
        : UCPATH_PERSON_ORG_DETAIL_READY;
      if (stateId !== expected) throw new Error(`fixture screen ${screen} does not satisfy ${stateId}`);
      return PageStateProofSchema.parse({ system: "ucpath", stateId, matched: true });
    },
    async fill(id, value) {
      if (id !== UCPATH_PERSON_ORG_EID_INPUT) throw new Error(`fixture cannot fill ${id}`);
      eid = EidSchema.parse(value);
      return UiActionProofSchema.parse({ elementId: id, effect: "prepare", performed: true });
    },
    async read(id) {
      if (id !== UCPATH_PERSON_ORG_DISPLAYED_EID) throw new Error(`fixture cannot read ${id}`);
      if (screen !== UCPATH_PERSON_ORG_DETAIL_SCREEN) throw new Error("fixture displayed EID requires the detail screen");
      if (!eid) throw new Error("fixture displayed EID requires a prior canonical EID fill");
      return eid;
    },
    async click(id: never): Promise<UiActionProof> {
      throw new Error(`fixture has no registered non-commit click ${String(id)}`);
    },
  };
}
