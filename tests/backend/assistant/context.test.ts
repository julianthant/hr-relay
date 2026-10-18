import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "vitest";
import { createAssistantContext, PUBLIC_ASSISTANT_REPOSITORY_ID } from "../../../src/backend/assistant/context.js";

const PUBLIC_ASSISTANT_SOURCE = { repositoryId: PUBLIC_ASSISTANT_REPOSITORY_ID, revision: "9af76694409eeff5e0ac954fc9501bc69991643a" };
const file = { path: "docs/rebuild/assistant.md", mode: "100644", text: "Synthetic public reference.\nDry runs stop before writes." };
const bytes = Buffer.from(JSON.stringify({ ...PUBLIC_ASSISTANT_SOURCE, files: [file] }));
const policy = { ...PUBLIC_ASSISTANT_SOURCE, exportSha256: "13b64308f627d12991b2c68f1ee59211763f37393b93fc01f4d5b59a561bab26" };
it("binds exact bytes to separate policy and verifies actual line quotations", () => {
  const context = createAssistantContext(bytes, policy);
  const citation = { path: file.path, revision: policy.revision, startLine: 2, endLine: 2, quote: "Dry runs stop before writes." };
  assert.deepEqual(context.citation(citation), citation);
  for (const patch of [{ quote: "Forged quote" }, { revision: "a".repeat(40) }, { startLine: 3 }, { endLine: 99 }, { path: "../.env" }]) assert.throws(() => context.citation({ ...citation, ...patch }));
  assert.throws(() => context.assertRuntime({ ...policy, revision: "a".repeat(40) }), { code: "ASSISTANT_CONTEXT_STALE" });
  assert.throws(() => createAssistantContext(Buffer.from(bytes.toString().replace("Synthetic", "Substitute")), policy));
  assert.equal(Object.isFrozen(context.reference.files[0]), true);
});
for (const path of ["../.env", "docs/rebuild/../private.md", "/etc/passwd", "src/models/secrets.ts", ".git/config", "docs/rebuild/credentials.md", "docs/rebuild/a\\b.md"])
  it(`refuses non-public path ${path}`, () => {
    const changed = Buffer.from(JSON.stringify({ ...PUBLIC_ASSISTANT_SOURCE, files: [{ ...file, path }] }));
    assert.throws(() => createAssistantContext(changed, { ...policy, exportSha256: createHash("sha256").update(changed).digest("hex") }));
  });
it("rejects symlinks, arbitrary refs, duplicate paths, oversized bytes and invalid utf8", () => {
  for (const payload of [{ ...PUBLIC_ASSISTANT_SOURCE, files: [{ ...file, mode: "120000", text: "/private/source" }] },
    { ...PUBLIC_ASSISTANT_SOURCE, revision: "HEAD", files: [file] }, { ...PUBLIC_ASSISTANT_SOURCE, files: [file, file] }]) {
    const changed = Buffer.from(JSON.stringify(payload));
    assert.throws(() => createAssistantContext(changed, { ...policy, exportSha256: createHash("sha256").update(changed).digest("hex") }));
  }
  for (const changed of [Buffer.alloc(100_001), Buffer.from([255])]) assert.throws(() => createAssistantContext(changed, { ...policy, exportSha256: createHash("sha256").update(changed).digest("hex") }));
});
it("rejects binary controls disguised as allowlisted text", () => {
  const changed = Buffer.from(JSON.stringify({ ...PUBLIC_ASSISTANT_SOURCE, files: [{ ...file, text: "binary\u0000content" }] }));
  assert.throws(() => createAssistantContext(changed, { ...policy, exportSha256: createHash("sha256").update(changed).digest("hex") }));
});
it("admits a later separately trusted synthetic revision without embedding the runtime HEAD", () => {
  const revision = "b".repeat(40), changed = Buffer.from(JSON.stringify({ ...PUBLIC_ASSISTANT_SOURCE, revision, files: [file] }));
  const trusted = { repositoryId: PUBLIC_ASSISTANT_REPOSITORY_ID, revision, exportSha256: "6976842cc20379b2b4b91cb7beaa7f19a52a9d3c8950eae42d7bf231a3334453" };
  const later = createAssistantContext(changed, trusted);
  later.assertRuntime(trusted);
  assert.equal(later.citation({ path: file.path, revision, startLine: 1, endLine: 1, quote: "Synthetic public reference." }).revision, revision);
  assert.throws(() => later.assertRuntime(PUBLIC_ASSISTANT_SOURCE), { code: "ASSISTANT_CONTEXT_STALE" });
  assert.throws(() => createAssistantContext(bytes, trusted));
  for (const badRevision of ["HEAD", "staging", "b".repeat(39), "B".repeat(40), "../private"]) assert.throws(() => createAssistantContext(changed, { ...trusted, revision: badRevision }));
});
