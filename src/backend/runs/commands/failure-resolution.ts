import { executeFailureResolution, failureResolutionCapability } from "../lifecycle/failure-resolution.js";
export function createFailureResolutionCommands(){return Object.freeze({execute:executeFailureResolution,capability:failureResolutionCapability});}
