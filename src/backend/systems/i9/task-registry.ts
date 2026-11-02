import { defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { i9Driver } from "./driver-declaration.js";
import { i9Session } from "./session.js";
import { readSection2SignerTask } from "./tasks/read-section2-signer.js";

export const i9Store = defineBrowserStore("i9", i9Driver, i9Session, {
  readSection2Signer: readSection2SignerTask,
});
