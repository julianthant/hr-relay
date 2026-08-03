import { defineBrowserStore } from "../../base/store.js";
import { ucpathDriver } from "./driver/declaration.js";
import { ucpathSession } from "./session.js";
import { searchPersonOrgTask } from "./tasks/search-person-org.js";

export { ucpathDriver };

export const ucpathStore = defineBrowserStore(
  "ucpath",
  ucpathDriver,
  ucpathSession,
  { searchPersonOrg: searchPersonOrgTask },
);
