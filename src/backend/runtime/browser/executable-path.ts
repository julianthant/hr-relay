import { chromium } from "playwright";

export function bundledChromiumExecutablePath(): string {
  return chromium.executablePath();
}
