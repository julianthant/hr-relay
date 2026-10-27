import assert from "node:assert/strict";
import { existsSync,readFileSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe,it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { ArtifactSinkBusyError,createArtifactSinkProjector,type ArtifactSinkProjectorOptions } from "../../../../src/backend/storage/artifacts/artifact-sink-projector.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createXlsxRetentionSink,type PublicationFaultPoint } from "../../../../src/backend/storage/artifacts/xlsx-retention-sink.js";
import type { ArtifactRef } from "../../../../src/models/artifacts/artifacts.js";
import { foundationFixture,id,NOW,update } from "../../../support/helpers/database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

async function fixture() {
  const f = await foundationFixture();
  const artifacts = createContentAddressedArtifactWriter({ admission: RuntimeAdmission.syntheticRoots(join(f.root, ".tracker"), join(f.root, ".tracker/data/artifacts")) });
  await artifacts.ready;
  const path = join(f.root, "retention.xlsx");
  const make = (db = f.db, fault?: (point: PublicationFaultPoint) => void | Promise<void>, settlementFault?: ArtifactSinkProjectorOptions["fault"], destination = path) => createArtifactSinkProjector({
    authority: db.authority, withAuthorityTransaction: work => db.withAuthorityTransaction(work),
    sinks: { "xlsx-retention": createXlsxRetentionSink({ workbookPath: destination, artifacts, ...(fault === undefined ? {} : { fault }) }) },
    lockDir: join(f.root, "locks"), clock: f.clock, ...(settlementFault === undefined ? {} : { fault: settlementFault }),
  });
  const read = async (ref: ArtifactRef) => {
    const chunks: Buffer[] = [];
    for await (const chunk of await artifacts.open(ref)) {
      assert.ok(chunk instanceof Uint8Array);
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  };
  const file = () => { const record = f.db.authority.generatedArtifacts.get("sink:xlsx-retention"); assert.ok(record); return record; };
  const seed = async () => {
    f.db.authority.artifactOutbox.insert(update(1));
    await make().projectOutbox([id(1)]);
    const version = file().versions[0]; assert.equal(version?.state, "verified");
    if (version?.state !== "verified") throw new Error("missing verified fixture version");
    return { ref: version.artifact, bytes: readFileSync(path), head: file().head };
  };
  return { ...f, artifacts, path, make, read, file, seed };
}

describe("G ordered publication and durable intent", () => {
  it("preserves two independent enqueues and a later enqueue while one destination writer is active", async () => {
    const f = await fixture();
    const second = AuthorityDatabase.open({ path: f.path.replace("retention.xlsx", "state.db"), busyTimeoutMs: 250, migrationOwner: "g-second" }, f.clock);
    try {
      f.db.authority.artifactOutbox.insert(update(1));
      second.authority.artifactOutbox.insert(update(2));
      let reached = false;
      const writer = f.make(f.db, async point => {
        if (point !== "after-prepare") return;
        reached = true;
        assert.equal(second.authority.generatedArtifacts.get("sink:xlsx-retention")?.state, "writing");
        second.authority.artifactOutbox.insert(update(3));
        await assert.rejects(f.make(second).projectOutbox([id(1)]), ArtifactSinkBusyError);
      });
      await writer.projectOutbox([id(1)]);
      assert.equal(reached, true);
      assert.deepEqual(second.authority.artifactOutbox.listPending().map(r => r.outboxId), [id(2), id(3)]);
      assert.equal(f.file().state, "pending");
      assert.equal(f.file().prepared, null);
      await f.make(second).projectOutbox([id(2), id(3)]);
      const latest = readFileSync(f.path);
      assert.equal(f.file().state, "ready");
      assert.equal(f.file().head?.generation, 3);
      assert.deepEqual(await f.make().projectOutbox([id(1)]), { projected: 0 });
      assert.deepEqual(readFileSync(f.path), latest);
    } finally { second.close(); await f.dispose(); }
  });

  const windows = ["before-stage", "after-stage", "after-stage-sync", "after-prepare", "before-replace", "after-replace", "after-directory-sync", "before-settlement", "after-head", "after-ack"] as const;
  for (const window of windows) it(`retains exact intent and old immutable bytes across ${window} failure and restart`, async () => {
    const f = await fixture();
    try {
      const old = await f.seed();
      f.db.authority.artifactOutbox.insert(update(2));
      const fail = (point: string) => { if (point === window) throw new Error(`fault:${window}`); };
      await assert.rejects(f.make(f.db, fail, fail).projectOutbox([id(2)]), new RegExp(`fault:${window}`, "u"));
      assert.equal(f.file().state, "failed");
      assert.equal(f.file().prepared?.updateId, id(2));
      assert.deepEqual(f.file().head, old.head);
      assert.equal(f.db.authority.artifactOutbox.get(id(2))?.state, "pending");
      assert.deepEqual(await f.read(old.ref), old.bytes);
      const intended = f.file().prepared; assert.ok(intended);
      assert.ok((await f.read(intended.artifact)).length > 0);
      const destination = readFileSync(f.path);
      const restarted = AuthorityDatabase.open({ path: join(f.root, "state.db"), busyTimeoutMs: 250, migrationOwner: "g-restart" }, f.clock);
      try {
        await assert.rejects(f.make(restarted).projectOutbox([id(2)]), /prepared-conflict/u);
        restarted.authority.artifactOutbox.insert(update(3));
        await assert.rejects(f.make(restarted).projectOutbox([id(3)]), /out-of-order/u);
        assert.deepEqual(readFileSync(f.path), destination);
        assert.deepEqual(restarted.authority.generatedArtifacts.get("sink:xlsx-retention")?.prepared, intended);
      } finally { restarted.close(); }
      assert.equal(existsSync(join(f.root, ".retention.xlsx.writer.lock")), false);
    } finally { await f.dispose(); }
  });

  it("refuses staged corruption before replacing the verified destination", async () => {
    const f = await fixture();
    try {
      const old = await f.seed(); f.db.authority.artifactOutbox.insert(update(2));
      await assert.rejects(f.make(f.db, point => {
        if (point === "after-stage-sync") writeFileSync(`${f.path}.tmp-${id(2)}`, "corrupt staged bytes");
      }).projectOutbox([id(2)]), /staged-bytes-conflict/u);
      assert.deepEqual(readFileSync(f.path), old.bytes);
      assert.deepEqual(await f.read(old.ref), old.bytes);
      assert.equal(f.file().prepared?.updateId, id(2));
    } finally { await f.dispose(); }
  });

  it("detects an external edit during publication without replacing it or losing the last good version", async () => {
    const f = await fixture();
    try {
      const old = await f.seed(); f.db.authority.artifactOutbox.insert(update(2));
      await assert.rejects(f.make(f.db, point => { if (point === "before-replace") writeFileSync(f.path, "external edit"); }).projectOutbox([id(2)]), /destination-changed-before-replace/u);
      assert.equal(readFileSync(f.path, "utf8"), "external edit");
      assert.equal(f.file().state, "conflict");
      assert.deepEqual(f.file().head, old.head);
      assert.deepEqual(await f.read(old.ref), old.bytes);
    } finally { await f.dispose(); }
  });

  it("refuses stale preparation, divergent settlement and acknowledgement outside the exact head transaction", async () => {
    const f = await fixture();
    try {
      const old = await f.seed(); f.db.authority.artifactOutbox.insert(update(2));
      const a = f.db.authority;
      assert.throws(() => a.generatedArtifacts.publication.prepare({ sinkId: "xlsx-retention", updateId: id(2), expectedGeneration: 0, artifact: old.ref }), /generation-conflict/u);
      a.generatedArtifacts.publication.prepare({ sinkId: "xlsx-retention", updateId: id(2), expectedGeneration: 1, artifact: old.ref });
      a.generatedArtifacts.publication.assertPrepared({ sinkId: "xlsx-retention", updateId: id(2), expectedGeneration: 1, artifact: old.ref });
      assert.throws(() => a.generatedArtifacts.publication.assertPrepared({ sinkId: "xlsx-retention", updateId: id(2), expectedGeneration: 0, artifact: old.ref }), /generation-conflict/u);
      const generation = f.db.getMeta().authorityGeneration;
      assert.throws(() => f.db.withAuthorityTransaction(r => {
        r.artifactSinkHeads.record({ sinkId: "xlsx-retention", lastOutboxId: id(2), expectedGeneration: 1, artifact: { ...old.ref, id: id(99) }, contentSha256: old.ref.sha256, projectedAt: NOW });
      }), /prepared-identity-conflict/u);
      assert.throws(() => a.artifactOutbox.markProjected({ outboxId: id(2), projectedAt: NOW }), /ack-requires-exact-head/u);
      assert.equal(f.db.getMeta().authorityGeneration, generation);
      assert.deepEqual(f.file().head, old.head);
      assert.equal(f.file().prepared?.updateId, id(2));
    } finally { await f.dispose(); }
  });

  it("uses one destination fence through directory aliases and refuses a symlink destination", async () => {
    const f = await fixture();
    try {
      await f.seed(); f.db.authority.artifactOutbox.insert(update(2));
      const alias = `${f.root}-alias`; symlinkSync(f.root, alias);
      try {
        await f.make(f.db, async point => {
          if (point === "after-prepare") await assert.rejects(f.make(f.db, undefined, undefined, join(alias, "retention.xlsx")).projectOutbox([id(2)]), ArtifactSinkBusyError);
        }).projectOutbox([id(2)]);
        symlinkSync(f.path, join(f.root, "linked.xlsx"));
        f.db.authority.artifactOutbox.insert(update(3));
        await assert.rejects(f.make(f.db, undefined, undefined, join(f.root, "linked.xlsx")).projectOutbox([id(3)]), /symlink-destination-conflict/u);
      } finally { rmSync(alias); }
    } finally { await f.dispose(); }
  });

  it("refuses oversized metadata before committing any member of the producing transaction", async () => {
    const f = await fixture();
    try {
      const generation = f.db.getMeta().authorityGeneration;
      assert.throws(() => f.db.withAuthorityTransaction(r => {
        r.artifactOutbox.insert(update(1));
        r.artifactOutbox.insert({ ...update(2), payload: { ...update(2).payload, value: "x".repeat(8 * 1024 * 1024) } });
      }), /generated-artifact-metadata-limit/u);
      assert.equal(f.db.authority.generatedArtifacts.get("sink:xlsx-retention"), undefined);
      assert.equal(f.db.getMeta().authorityGeneration, generation);
      await f.seed();
      assert.equal(f.file().state, "ready");
    } finally { await f.dispose(); }
  });

  for (const damage of ["missing", "corrupt"] as const) it(`refuses publication when its retained current immutable version is ${damage}`, async () => {
    const f = await fixture();
    try {
      const old = await f.seed();
      f.db.authority.artifactOutbox.insert(update(2));
      const objectPath = join(f.root, ".tracker/data/artifacts", `${old.ref.sha256}.artifact`);
      const object = readFileSync(objectPath);
      if (damage === "missing") rmSync(objectPath); else writeFileSync(objectPath, "corrupt");
      await assert.rejects(f.make().projectOutbox([id(2)]));
      assert.deepEqual(readFileSync(f.path), old.bytes);
      assert.equal(f.file().prepared, null);
      assert.equal(f.file().state, "failed");
      assert.deepEqual(f.file().versions[0], { state: "verified", artifact: old.ref });
      writeFileSync(objectPath, object);
      await f.make().projectOutbox([id(2)]);
      assert.equal(f.file().state, "ready");
      assert.deepEqual(await f.read(old.ref), old.bytes);
    } finally { await f.dispose(); }
  });

  it("refuses missing or corrupt immutable old versions while keeping shared receipt references", async () => {
    const f = await fixture();
    try {
      const old = await f.seed(); f.db.authority.artifactOutbox.insert(update(2)); await f.make().projectOutbox([id(2)]);
      assert.deepEqual(await f.read(old.ref), old.bytes);
      assert.deepEqual(f.file().versions[0], { state: "verified", artifact: old.ref });
      const storedPath = join(f.root, ".tracker/data/artifacts", `${old.ref.sha256}.artifact`);
      const stored = readFileSync(storedPath); writeFileSync(storedPath, "corrupt");
      await assert.rejects(f.read(old.ref));
      writeFileSync(storedPath, stored); assert.deepEqual(await f.read(old.ref), old.bytes);
      rmSync(storedPath); await assert.rejects(f.read(old.ref), /ENOENT/u);
      assert.equal(f.file().versions.length, 2);
    } finally { await f.dispose(); }
  });
});
