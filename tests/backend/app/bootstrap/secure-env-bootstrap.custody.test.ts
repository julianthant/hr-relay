import assert from "node:assert/strict";
import { createServer, Server } from "node:net";
import { afterEach, it, vi } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { composeStorageCommand, RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";

vi.mock("node:net", async importOriginal => {
  const net = await importOriginal<typeof import("node:net")>();
  return { ...net, createServer: vi.fn() };
});
vi.mock("../../../../src/backend/app/composition/storage-compose.js", async importOriginal => {
  const composition = await importOriginal<typeof import("../../../../src/backend/app/composition/storage-compose.js")>();
  return { ...composition, composeStorageCommand: vi.fn() };
});
const originalArgv = [...process.argv];
afterEach(() => { vi.restoreAllMocks(); process.argv.splice(0, process.argv.length, ...originalArgv); });

async function fixture() {
  const server = new Server();
  let listening = false, closes = 0;
  Object.defineProperty(server, "listening", { get: () => listening });
  vi.spyOn(server, "listen").mockImplementation(() => {
    listening = true; queueMicrotask(() => server.emit("listening")); return server;
  });
  vi.spyOn(server, "address").mockReturnValue({ address: "127.0.0.1", family: "IPv4", port: 12345 });
  vi.spyOn(server, "close").mockImplementation(callback => {
    listening = false; closes++; queueMicrotask(() => callback?.()); return server;
  });
  vi.mocked(createServer).mockReturnValue(server);
  const lock = await RuntimeLifetimeLock.acquire(0), admission = RuntimeAdmission.syntheticFixture(":memory:");
  return { lock, admission, closes: () => closes, async close() { admission.release(); await lock.close(); } };
}

function lockReleaseFailure() {
  const body = new Error("fixture malformed registry");
  const closure = new AuthoritySourceClosureUnprovedError([new Error("fixture descriptor close failed")]);
  return new AggregateError([body, closure], "operation and private lock release failed", { cause: closure });
}

it("retains the listener and exact aggregate when admission acquisition cannot prove source closure", async () => {
  const f = await fixture(), failure = lockReleaseFailure();
  try {
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "help"], {
      acquireLifetimeLock: async () => f.lock,
      acquireAdmission: mode => { assert.equal(mode, "shared"); throw failure; },
    }), error => error === failure);
    assert.equal(failure.errors[1], failure.cause);
    assert.equal(f.closes(), 0); f.lock.assertHeld();
  } finally { await f.close(); }
});

it("closes the listener after an ordinary admission acquisition refusal", async () => {
  const f = await fixture(), failure = new Error("fixture malformed registry");
  try {
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "help"], {
      acquireLifetimeLock: async () => f.lock, acquireAdmission: () => { throw failure; },
    }), error => error === failure);
    assert.equal(f.closes(), 1); assert.throws(() => f.lock.assertHeld());
  } finally { await f.close(); }
});

for (const failure of [new AuthoritySourceClosureUnprovedError([new Error("fixture close failed")]),
  new RuntimeCustodyUncertainError([new Error("fixture drain failed")])]) {
  it(`retains existing direct ${failure.name} acquisition refusal behavior`, async () => {
    const f = await fixture();
    try {
      await assert.rejects(runSecureEnvironmentBootstrap(["cli", "help"], {
        acquireLifetimeLock: async () => f.lock, acquireAdmission: () => { throw failure; },
      }), error => error === failure);
      assert.equal(f.closes(), 0); f.lock.assertHeld();
    } finally { await f.close(); }
  });
}

for (const phase of ["ordinary", "maintenance"] as const) {
  for (const uncertain of [false, true]) {
    it(`${phase} bootstrap ${uncertain ? "retains" : "releases"} admission and listener for ${uncertain ? "nested closure uncertainty" : "ordinary refusal"}`, async () => {
      const f = await fixture(), failure = uncertain ? lockReleaseFailure() : new Error("fixture body refused");
      if (phase === "maintenance") {
        vi.spyOn(RuntimeAdmission, "acquireStoppedMachineControlMaintenance").mockReturnValue(f.admission);
        vi.mocked(composeStorageCommand).mockRejectedValue(failure);
      }
      try {
        await assert.rejects(runSecureEnvironmentBootstrap(phase === "maintenance"
          ? ["cli", "storage", "upgrade", "--machine-control"] : ["cli", "help"], {
          acquireLifetimeLock: async () => f.lock, acquireAdmission: () => f.admission,
          assertEnvironment: () => undefined, runCli: async () => { throw failure; },
        }), error => uncertain ? error instanceof AuthoritySourceClosureUnprovedError && error.errors[0] === failure : error === failure);
        assert.equal(f.closes(), uncertain ? 0 : 1);
        if (uncertain) { f.lock.assertHeld(); f.admission.assertLive(); }
        else { assert.throws(() => f.lock.assertHeld()); assert.throws(() => f.admission.assertLive(), /released admission/u); }
      } finally { await f.close(); }
    });
  }
}

it("preserves direct runtime custody identity even when its cause includes source closure uncertainty", async () => {
  const f = await fixture(), failure = new RuntimeCustodyUncertainError([lockReleaseFailure()]);
  try {
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "help"], {
      acquireLifetimeLock: async () => f.lock, acquireAdmission: () => f.admission,
      assertEnvironment: () => undefined, runCli: async () => { throw failure; },
    }), error => error === failure);
    assert.equal(f.closes(), 0); f.lock.assertHeld(); f.admission.assertLive();
  } finally { await f.close(); }
});
