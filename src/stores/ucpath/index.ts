import { declareDriverFor, defineBrowserStore } from "../../base/store.js";
import type { UcpathPersonOrgDriver } from "../../domain/ui/ucpath-person-org.js";
import { ucpathSession } from "./session.js";

export const ucpathDriver = declareDriverFor<UcpathPersonOrgDriver>()("ucpath", "semantic-ready");

export const ucpathStore = defineBrowserStore(
  "ucpath",
  ucpathDriver,
  ucpathSession,
  {},
);
