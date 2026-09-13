import { registerReferenceServers } from "./helpers/reference-harness.js";
import { ANCHORS,SCENES } from "./helpers/reference-intake-scenes.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
const servers = registerReferenceServers(["server"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);
