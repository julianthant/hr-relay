import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { createBoundProfileFixture, registerBoundProfile, unregisterBoundProfile, type BoundProfileStorageFixture } from "../../helpers/admission-fixture.js";
import { assertBoundFixtureWorkersReleased } from "../../helpers/synthetic-database-admission.js";

type Entry = Readonly<{ path: string; mode: number } & ({ kind: "directory" } | { kind: "file"; bytes: Buffer })>;

function snapshot(root: string, relative = ""): Entry[] {
  return readdirSync(join(root, relative)).flatMap((name): Entry[] => {
    const path = join(relative, name), fullPath = join(root, path), stat = lstatSync(fullPath), mode = stat.mode & 0o777;
    if (stat.isDirectory()) return [{ path, mode, kind: "directory" }, ...snapshot(root, path)];
    if (stat.isFile()) return [{ path, mode, kind: "file", bytes: readFileSync(fullPath) }];
    throw new Error("preflight-template-entry-not-regular");
  });
}

export async function createPreflightProfileFixtureSet() {
  const seed = await createBoundProfileFixture();
  const profileId = seed.admission.profileBinding.profileId;
  await seed.closeController();
  const entries = snapshot(seed.workspace);
  let held = false;
  return {
    async create(this: void): Promise<BoundProfileStorageFixture> {
      if (held) throw new Error("preflight-template-case-still-held");
      held = true;
      let lifetime: RuntimeLifetimeLock | undefined;
      let machine: RuntimeAdmission | undefined, admission: RuntimeAdmission | undefined, registered = false;
      try {
        rmSync(seed.workspace, { recursive: true });
        mkdirSync(seed.workspace, { mode: 0o700 });
        for (const entry of entries) {
          const path = join(seed.workspace, entry.path);
          if (entry.kind === "directory") mkdirSync(path, { mode: entry.mode });
          else writeFileSync(path, entry.bytes, { mode: entry.mode });
        }
        const controller = await RuntimeLifetimeLock.acquire(0); lifetime = controller;
        const installation = acquireEntrypointAdmission(seed.workspace, "exclusive", controller); machine = installation;
        const owner = installation.admitProfile(profileId); admission = owner;
        registerBoundProfile(owner, installation); registered = true;
        let closed = false;
        return { workspace: seed.workspace, stateRoot: owner.stateRoot, path: join(owner.stateRoot, "state.db"), machine: installation, admission: owner,
          async close() {
            if (closed) return;
            try {
              assertBoundFixtureWorkersReleased(owner); unregisterBoundProfile(owner);
              owner.release(); installation.release(); await controller.close();
            } catch (error) { throw retainAuthoritySourceClosure([error], { admission: { machine: installation, admission: owner, lifetime: controller } }); }
            closed = true; held = false;
          } };
      } catch (error) {
        try {
          if (registered && admission !== undefined) unregisterBoundProfile(admission);
          admission?.release(); machine?.release(); await lifetime?.close(); held = false;
        } catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: { machine, admission, lifetime } }); }
        throw error;
      }
    },
    async close() {
      if (held) throw new Error("preflight-template-case-still-held");
      await seed.close();
    },
  };
}
