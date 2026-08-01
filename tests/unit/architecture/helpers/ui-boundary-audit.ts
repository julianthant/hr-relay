import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { walkFiles } from "./guard-files.js";

const PLAYWRIGHT_IMPORT = /from\s+["']playwright(?:\/[^"']*)?["']/u;
const RAW_BROWSER_TYPE = /\b(?:Page|Locator|FrameLocator|Browser|BrowserContext)\b/u;
const RAW_BROWSER_CALL = /\.(?:locator|frameLocator|getByRole|getByText|getByLabel|getByTestId)\s*\(/u;

function isRawBrowserOwner(path: string): boolean {
  return /^src\/stores\/[a-z0-9-]+\/driver\//u.test(path)
    || /^src\/stores\/[a-z0-9-]+\/session\.ts$/u.test(path);
}

export function auditTaskDriverBoundary(root: string): readonly string[] {
  const issues: string[] = [];
  const files = walkFiles(resolve(root, "src"), { missing: "planned-empty" });
  for (const absolute of files) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    const content = readFileSync(absolute, "utf8");
    if (isRawBrowserOwner(path)) continue;
    if (PLAYWRIGHT_IMPORT.test(content)) issues.push(`${path}: Playwright import crosses the driver/session boundary`);
    if (RAW_BROWSER_TYPE.test(content)) issues.push(`${path}: raw browser type crosses the driver/session boundary`);
    if (RAW_BROWSER_CALL.test(content)) issues.push(`${path}: raw browser call crosses the driver/session boundary`);
    if (/^src\/(?:tasks|workflows)\//u.test(path) && /\/driver\/(?:ui-registry|interpreter)(?:\.js)?["']/u.test(content)) {
      issues.push(`${path}: task/workflow imports a private driver recipe module`);
    }
  }
  return issues;
}
