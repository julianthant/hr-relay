import { describe, expect, it } from "vitest";
import { WorkerPoolMemberSchema } from "../../../../../src/models/run/worker-slot.js";
import { workerCliArgv } from "../../../../../src/backend/runtime/workers/worker-supervisor.js";
import { parseWorkerArguments } from "../../../../../src/backend/app/composition/worker-compose.js";
import { UUID_5 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
const member = WorkerPoolMemberSchema.parse({ workflowId: "person-lookup", workerId: "person-lookup-worker-17",
  ordinal: 17, poolIndex: 2, membershipRevision: 4 });
describe("current stable worker launch argv", () => {
  it("round-trips a global ordinal independently of bounded pool index and binds the original launch command", () => {
    const argv = workerCliArgv(member, UUID_5);
    expect(argv).toEqual(["worker", "person-lookup", "--pool-index", "2", "--worker-id", "person-lookup-worker-17",
      "--ordinal", "17", "--membership-revision", "4", "--launch-command-id", UUID_5]);
    expect(parseWorkerArguments(argv.slice(1))).toEqual({ workflowId: "person-lookup", poolIndex: 2, drain: false,
      launch: { workerId: member.workerId, ordinal: 17, membershipRevision: 4, commandId: UUID_5 } });
  });
  it("admits fresh direct CLI without inventing a worker identity and refuses partial or mismatched launch metadata", () => {
    expect(parseWorkerArguments(["person-lookup", "--pool-index", "2", "--drain"])).toEqual({ workflowId: "person-lookup", poolIndex: 2, drain: true });
    expect(() => parseWorkerArguments(["person-lookup", "--pool-index", "4"])).toThrow();
    expect(() => parseWorkerArguments(["person-lookup", "--pool-index", "2", "--worker-id", member.workerId])).toThrow();
    const argv = [...workerCliArgv(member, UUID_5).slice(1)];
    argv[argv.indexOf("--ordinal") + 1] = "2";
    expect(() => parseWorkerArguments(argv)).toThrow(/ordinal/u);
    expect(() => parseWorkerArguments([...workerCliArgv(member, UUID_5).slice(1), "--worker-id", member.workerId])).toThrow(/duplicate/u);
  });
});
