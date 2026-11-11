import { registerHooks } from "node:module";
import { URL } from "node:url";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@napi-rs/keyring") return { url: new URL("./credential-keychain-fake.ts", import.meta.url).href, shortCircuit: true };
  // Stylesheet imports in shared dashboard modules have no meaning outside the browser bundle.
  if (specifier.endsWith(".css")) return { url: "data:text/javascript,", shortCircuit: true };
  return nextResolve(specifier, context);
} });
