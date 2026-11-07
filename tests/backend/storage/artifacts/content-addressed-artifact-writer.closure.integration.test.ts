import assert from "node:assert/strict";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { fstatSync, readdirSync } from "node:fs";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { join } from "node:path";
import { it, vi } from "vitest";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createChatGptOcrPageReader } from "../../../../src/backend/processing/providers/chatgpt-ocr-adapter.js";
import { ChatGptResourceClosureUnprovedError } from "../../../../src/backend/accounts/chatgpt-account-service.js";
import { buildExtractionInstruction } from "../../../../src/models/ocr/instruction.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { chatGptFixture } from "../../../support/helpers/chatgpt-account-fixtures.js";


it("retains actual artifact close uncertainty through the account owner and proves the exact native handle before test-only release", async () => {
  const profile = await createBoundProfileFixture(), f = await chatGptFixture(profile.admission);
  const writer = createContentAddressedArtifactWriter({ admission: profile.admission });
  let handle: filesystem.FileHandle | undefined, originalClose: (() => Promise<void>) | undefined, fd: number | undefined;
  let restoreClose: (() => void) | undefined;
  const actualOpen = filesystem.open;
  let proved = false;
  try {
    await writer.ready; await f.connected();
    const page = await writer.put(Buffer.from("synthetic owned artifact"), { mediaType: "image/png" });
    const target = join(profile.admission.artifactRoot, `${page.sha256}.artifact`);
    const fault = new Error("synthetic close failure");
    const openSpy = vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
      const actual = await actualOpen(...args);
      if (args[0] === target) {
        handle = actual; fd = actual.fd; originalClose = actual.close.bind(actual);
        const closeSpy = vi.spyOn(actual, "close").mockRejectedValue(fault);
        restoreClose = () => closeSpy.mockRestore();
      }
      return actual;
    });
    syncBuiltinESMExports();
    const reader = createChatGptOcrPageReader({ account: f.service, artifacts: writer, clock: f.clock, model: "gpt-6.1-sol",
      assertCurrent: () => profile.admission.assertProfileRuntime() });
    await assert.rejects(reader.readPage({ formType: "oath", page, sourcePage: 1, instruction: buildExtractionInstruction("oath") }, new AbortController().signal), ChatGptResourceClosureUnprovedError);
    openSpy.mockRestore(); syncBuiltinESMExports();
    assert.ok(handle); assert.ok(originalClose); assert.ok(fd !== undefined);
    const ownedFd = fd;
    assert.equal(fstatSync(ownedFd).isFile(), true);
    await assert.rejects(f.service.close(), ChatGptResourceClosureUnprovedError);
    profile.admission.assertLive(); profile.machine.assertLive();
    assert.equal(f.calls.filter(call => call.url.endsWith("/responses")).length, 0);
    restoreClose?.(); await originalClose();
    assert.equal(handle.fd, -1);
    assert.throws(() => fstatSync(ownedFd), { code: "EBADF" });
    proved = true;
  } finally {
    vi.restoreAllMocks(); syncBuiltinESMExports();
    assert.equal(proved, true, "artifact-closure-fixture-custody-unproved");
    await assert.rejects(f.cleanup(), ChatGptResourceClosureUnprovedError);
    await profile.close();
  }
});


it.each(["put", "stageDiagnostic"] as const)("refuses %s after async open revocation and closes its exact owned file", async method => {
  const profile = await createBoundProfileFixture();
  const writer = createContentAddressedArtifactWriter({ admission: profile.admission });
  const root = profile.admission.artifactRoot, before = readdirSync(root).sort();
  const actualOpen = filesystem.open;
  let handle: filesystem.FileHandle | undefined, writes = 0;
  const open = vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
    const actual = await actualOpen(...args);
    if (args[1] === "wx") {
      handle = actual;
      const write = actual.writeFile.bind(actual);
      vi.spyOn(actual, "writeFile").mockImplementation((...input) => { writes++; return write(...input); });
      createProfileRegistry(profile.machine).advanceSession(null);
    }
    return actual;
  });
  syncBuiltinESMExports();
  try {
    const bytes = Buffer.from("synthetic revoked artifact");
    const effect = method === "put" ? writer.put(bytes, { mediaType: "application/json" })
      : writer.stageDiagnostic(bytes, { mediaType: "application/json" }, "ordinary");
    await assert.rejects(effect, /profile-storage-claim-generation-changed/u);
    assert.equal(writes, 0);
    assert.ok(handle);
    assert.equal(handle.fd, -1);
    assert.deepEqual(readdirSync(root).sort(), before);
    profile.admission.assertLive();
  } finally { open.mockRestore(); vi.restoreAllMocks(); syncBuiltinESMExports(); await profile.close(); }
});
