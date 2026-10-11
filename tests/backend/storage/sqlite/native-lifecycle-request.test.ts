import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it } from "vitest";
import { validateNativeLifecycleRequest } from "../../../../src/backend/storage/sqlite/native-lifecycle-request.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { NOW,UUID_1,UUID_2,UUID_3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const databases:DatabaseSync[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
const request={commandId:UUID_1,runId:UUID_2,expectedVersion:5};
const command={kind:"run-lifecycle",commandId:UUID_1,operation:"delete",request,
  requestFingerprint:sha256Hex(`hrauto:run-lifecycle-command:v1\0delete\0${canonicalJsonStringify(request)}`),
  fence:{kind:"version",expectedVersion:5},recordedAt:NOW};
describe("whole native internal commands",()=>{
  it("refuses omitted requests, unknown payload members, altered command identity and stale fences",()=>{
    expect(()=>validateNativeLifecycleRequest({...command,request:undefined})).toThrow();
    expect(()=>validateNativeLifecycleRequest({...command,request:{...request,archiveDigest:"old"}})).toThrow();
    expect(()=>validateNativeLifecycleRequest({...command,request:{...request,commandId:UUID_3}})).toThrow();
    expect(()=>validateNativeLifecycleRequest({...command,fence:{kind:"version",expectedVersion:4}})).toThrow(/fence-mismatch/u);
    expect(()=>validateNativeLifecycleRequest({...command,operation:"unregistered-operation"})).toThrow(/Invalid option/u);
  });
});
