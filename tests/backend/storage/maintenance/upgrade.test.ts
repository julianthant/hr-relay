import { mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,expect,it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
describe("native authority backup", () => {
  it("plans a fresh native root without creating authority and initializes only behind stopped admission",async()=>{
    const root=realpathSync(mkdtempSync(join(tmpdir(),"relay-native-upgrade-"))),path=join(root,"state.db");
    cleanups.push(()=>rmSync(root,{recursive:true,force:true}));const admission=RuntimeAdmission.syntheticFixture(path),processLockRoot=join(root,"locks"),clock=capturedInstantClock(NOW);
    mkdirSync(processLockRoot,{mode:0o700});
    await expect(upgradeStorage(admission,{stateRoot:root,processLockRoot,plan:true},clock)).resolves.toMatchObject({state:"planned",fromSchemaVersion:0,toSchemaVersion:5});
    expect(()=>readFileSync(path)).toThrow();
    await expect(upgradeStorage(admission,{stateRoot:root,processLockRoot,plan:false},clock)).resolves.toMatchObject({state:"initialized"});
    expect(inspectAuthorityBackupReadOnly(admission,path).tables).toHaveLength(36);
  });

});
