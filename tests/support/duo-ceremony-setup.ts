import { afterEach, vi } from "vitest";
import { closeDuoCeremonyFixtures } from "./helpers/duo-ceremony-cleanup.js";

vi.mock("@napi-rs/keyring", async () => {
  const { FakeKeyringEntry } = await import("./helpers/credential-keychain-fake.js");
  return { Entry: FakeKeyringEntry };
});

const keychainPreload = new URL("./helpers/credential-keychain-process-preload.ts", import.meta.url).href;
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${keychainPreload}`;

afterEach(closeDuoCeremonyFixtures);
