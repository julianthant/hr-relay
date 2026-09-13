import { ANCHORS,SCENES } from "./helpers/reference-activity-scenes.js";
import { registerReferenceServers } from "./helpers/reference-harness.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
const servers = registerReferenceServers(["server"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);
