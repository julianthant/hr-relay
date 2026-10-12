import { resolve } from "node:path";

export function isDirectExecution(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && moduleUrl === new URL(`file://${resolve(entry)}`).href;
}
