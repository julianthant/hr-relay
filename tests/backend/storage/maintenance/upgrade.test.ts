import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { mkdirSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach,describe,expect,it } from "vitest";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
describe("native authority backup", () => {
  it("plans a fresh native root without creating authority and initializes only behind stopped admission",async()=>{
    const fixture=createBoundProfileFixture({pending:true}),root=fixture.stateRoot,path=fixture.path;
    cleanups.push(()=>fixture.close());const admission=fixture.admission,processLockRoot=join(root,"locks"),clock=capturedInstantClock(NOW);
    mkdirSync(processLockRoot,{mode:0o700});
    await expect(upgradeStorage(admission,{stateRoot:root,processLockRoot,plan:true},clock)).resolves.toMatchObject({state:"planned",fromSchemaVersion:0,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION});
    expect(()=>readFileSync(path)).toThrow();
    await expect(upgradeStorage(admission,{stateRoot:root,processLockRoot,plan:false},clock)).resolves.toMatchObject({state:"initialized"});
    expect(inspectAuthorityBackupReadOnly(admission,path).tables).toHaveLength(39);
  });

});
