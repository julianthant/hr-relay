import { createRemoteRecordTask } from "./tasks/create-remote-record.js";
import { stageRemoteRecordTask } from "./tasks/stage-remote-record.js";
import { verifyRemoteRecordTask } from "./tasks/verify-remote-record.js";
import { matchRemoteRecordTask } from "./tasks/match-remote-record.js";
import { createProfileTask } from "./tasks/create-profile.js";
import { stageProfileTask } from "./tasks/stage-profile.js";
import { verifyProfileTask } from "./tasks/verify-profile.js";
import { matchProfileTask } from "./tasks/match-profile.js";
import { defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { i9Driver } from "./driver-declaration.js";
import { i9Session } from "./session.js";
import { readSection2SignerTask } from "./tasks/read-section2-signer.js";

export const i9Store = defineBrowserStore("i9", i9Driver, i9Session, {
  probeProfile: matchProfileTask,
  verifyProfile: verifyProfileTask,
  prepareProfile: stageProfileTask,
  createProfile: createProfileTask,
  probeRemoteRecord: matchRemoteRecordTask,
  verifyRemoteRecord: verifyRemoteRecordTask,
  prepareRemoteRecord: stageRemoteRecordTask,
  createRemoteRecord: createRemoteRecordTask,
  readSection2Signer: readSection2SignerTask,
});
