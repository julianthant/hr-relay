import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@napi-rs/keyring") return { url: new URL("./credential-keychain-fake.ts", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
