/**
 * The ONE `ucpath` driver surface every task in the store binds.
 *
 * D197 rule 1: a sibling task family EXTENDS the store's one invariant
 * `DriverDeclaration`, it never mints a second — `defineTask(driver, …)` binds
 * the exact declaration, and two declarations for one store is what the
 * task/driver boundary forbids. Chunk 4's Smart HR termination family is
 * therefore composed here beside the Person Organizational Summary family
 * rather than declaring a driver of its own.
 *
 * The two families share nothing but the system id — different route, different
 * frame model (Person Org lives inside `#main_target_win0`, Smart HR renders no
 * iframe at all), different anchor style. That is exactly why their SCHEMAS
 * live in their own modules and only the driver TYPE is joined.
 */
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

/**
 * The joined navigation surface. `read` has to accept BOTH families'
 * observations because the kernel calls it at doc 09 beat ③ with whichever
 * observation the running contract declared — a `read` typed to one family
 * would make the other family's subject binding unreachable.
 */
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
