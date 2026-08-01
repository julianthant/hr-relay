import { EidSchema } from "../../../domain/ids.js";
import { PageStateProofSchema, UiActionProofSchema } from "../../../domain/ui/driver.js";
import type { MutationCapability, UiActionProof } from "../../../domain/ui/driver.js";
import {
  UCPATH_PERSON_ORG_DETAIL_READY,
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../../domain/ui/ucpath-person-org.js";
import type { UcpathPersonOrgDriver, UcpathPersonOrgScreens } from "../../../domain/ui/ucpath-person-org.js";

export function createDeterministicUcpathPersonOrgDriver(): UcpathPersonOrgDriver {
  let screen: UcpathPersonOrgScreens = UCPATH_PERSON_ORG_SEARCH_SCREEN;
  let eid: ReturnType<typeof EidSchema.parse> | undefined;
  return {
    system: "ucpath",
    async goto(nextScreen) {
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
    async commit(id: never, _capability: MutationCapability): Promise<UiActionProof> {
      throw new Error(`fixture has no registered external-commit element ${String(id)}`);
    },
  };
}
