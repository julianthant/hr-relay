import { afterEach, vi } from "vitest";
import { closeDuoCeremonyFixtures } from "./helpers/duo-ceremony-cleanup.js";
import { scaledMs, TEST_TIME_SCALE } from "./time-scale.js";

vi.mock("@napi-rs/keyring", async () => {
  const { FakeKeyringEntry } = await import("./helpers/credential-keychain-fake.js");
  return { Entry: FakeKeyringEntry };
});

const keychainPreload = new URL("./helpers/credential-keychain-process-preload.mjs", import.meta.url).href;
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${keychainPreload}`;

afterEach(closeDuoCeremonyFixtures);

// vi.waitFor and vi.waitUntil default to 1000ms; stretch them with RELAY_TEST_TIME_SCALE like every other test wait.
if (TEST_TIME_SCALE !== 1) {
  const waitFor = vi.waitFor.bind(vi), waitUntil = vi.waitUntil.bind(vi);
  const stretched = (options: number | { timeout?: number; interval?: number } | undefined) => {
    const given = typeof options === "number" ? { timeout: options } : options ?? {};
    return { ...given, timeout: scaledMs(given.timeout ?? 1000) };
  };
  vi.waitFor = ((callback, options) => waitFor(callback, stretched(options)));
  vi.waitUntil = ((callback, options) => waitUntil(callback, stretched(options)));
}
