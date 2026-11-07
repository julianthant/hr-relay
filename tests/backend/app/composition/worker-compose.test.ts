import { describe,expect,it } from "vitest";
import { parseWorkerArguments } from "../../../../src/backend/app/composition/worker-compose.js";
import { UUID_5, UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const launchArgv = ["person-lookup", "--pool-index", "2", "--worker-id", "person-lookup-worker-17", "--ordinal", "17",
  "--launch-command-id", UUID_5, "--profile-id", UUID_6, "--session-generation", "3"];
describe("current stable worker launch argv", () => {
  it("parses a global ordinal independently of the bounded pool index and binds the launch and sign-in", () => {
    expect(parseWorkerArguments(launchArgv)).toEqual({ workflowId: "person-lookup", poolIndex: 2, drain: false,
      launch: { workerId: "person-lookup-worker-17", ordinal: 17, commandId: UUID_5, profileId: UUID_6, sessionGeneration: 3 } });
  });
  it("admits fresh direct CLI without inventing a worker identity and refuses partial or mismatched launch metadata", () => {
    expect(parseWorkerArguments(["person-lookup", "--pool-index", "2", "--drain"])).toEqual({ workflowId: "person-lookup", poolIndex: 2, drain: true });
    expect(parseWorkerArguments(["person-lookup", "--pool-index", "4"])).toEqual({ workflowId: "person-lookup", poolIndex: 4, drain: false });
    expect(() => parseWorkerArguments(["person-lookup", "--pool-index", "0"])).toThrow();
    expect(() => parseWorkerArguments(["person-lookup", "--pool-index", "2", "--worker-id", "person-lookup-worker-17"])).toThrow();
    const argv = [...launchArgv];
    argv[argv.indexOf("--ordinal") + 1] = "2";
    expect(() => parseWorkerArguments(argv)).toThrow(/ordinal/u);
    expect(() => parseWorkerArguments([...launchArgv, "--worker-id", "person-lookup-worker-17"])).toThrow(/duplicate/u);
  });
});
