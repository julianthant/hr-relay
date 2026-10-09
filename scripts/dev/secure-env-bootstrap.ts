import { pathToFileURL } from "node:url";
import { runSecureEnvironmentBootstrap } from "../../src/backend/app/bootstrap/secure-env-bootstrap.js";

export {
  runSecureEnvironmentBootstrap,
  secureEnvironmentEntrypoint,
} from "../../src/backend/app/bootstrap/secure-env-bootstrap.js";
export type {
  SecureEnvironmentBootstrapDependencies,
  SecureEnvironmentEntrypoint,
} from "../../src/backend/app/bootstrap/secure-env-bootstrap.js";

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  await runSecureEnvironmentBootstrap();
}
