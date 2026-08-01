import { declareDriver, defineBrowserStore } from "../../base/store.js";
import { ucpathSession } from "./session.js";

export const ucpathStore = defineBrowserStore(
  "ucpath",
  declareDriver("ucpath", "semantic-ready"),
  ucpathSession,
  {},
);
