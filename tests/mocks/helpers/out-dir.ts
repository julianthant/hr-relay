import { join } from "node:path";
import { MOCK_REPO_ROOT } from "./bundle.js";

/** Scene output folder inside the repo's gitignored .work; an env override wins. */
export const mockOutDir = (override: string | undefined, ...segments: string[]): string =>
  override ?? join(MOCK_REPO_ROOT, ".work", "mocks-output", ...segments);
