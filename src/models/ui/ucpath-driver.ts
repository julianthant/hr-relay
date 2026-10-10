/** The ONE `ucpath` driver surface every task in the store binds; a sibling task family EXTENDS it rather than minting a second declaration. */
import type { SystemDriver } from "./driver.js";
import type {
  UcpathPersonOrgDriver,
  UcpathPersonOrgFields,
  UcpathPersonOrgObservations,
  UcpathPersonOrgScreens,
  UcpathPersonOrgStates,
} from "./ucpath-person-org.js";
import type {
  UcpathSmartHrObservations,
  UcpathSmartHrScreens,
  UcpathSmartHrStates,
  UcpathSmartHrTerminationDriver,
} from "./ucpath-smart-hr-termination.js";

/** The joined navigation surface; `read` has to accept BOTH families' observations because the kernel calls it with whichever observation the running contract declared. */
type UcpathNavigationDriver = SystemDriver<
  "ucpath",
  UcpathPersonOrgScreens | UcpathSmartHrScreens,
  UcpathPersonOrgStates | UcpathSmartHrStates,
  UcpathPersonOrgFields,
  UcpathPersonOrgObservations & UcpathSmartHrObservations
>;

export type UcpathStoreDriver =
  & UcpathNavigationDriver
  & Pick<UcpathPersonOrgDriver, "searchPersonOrg" | "readJobSummary">
  & UcpathSmartHrTerminationDriver;
