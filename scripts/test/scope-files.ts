import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function isDirectExecution(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && moduleUrl === pathToFileURL(resolve(entry)).href;
}
