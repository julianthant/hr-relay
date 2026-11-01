import { testProcessImport } from "../../compiled-process.js";
import { spawn, type ChildProcess } from "node:child_process";

export function createAdmissionChildFixtures(children: ChildProcess[]) {
  function launch(code: string, root: string): { child: ChildProcess; next: () => Promise<{ state: string; detail?: string }> } {
    const child = spawn(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e", code, root],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] });
    children.push(child);
    const queued: { state: string; detail?: string }[] = [];
    const readers: ((value: { state: string; detail?: string }) => void)[] = [];
    let output = "";
    child.stderr?.on("data", chunk => { output += String(chunk); });
    child.on("message", value => {
      const parsed = value as { state: string; detail?: string };
      const reader = readers.shift();
      if (reader === undefined) queued.push(parsed); else reader(parsed);
    });
    child.on("exit", code => {
      while (readers.length > 0) readers.shift()?.({ state: "exited", detail: `${String(code)} ${output}` });
    });
    return { child, next: () => {
      const value = queued.shift();
      return value === undefined ? new Promise(resolve => readers.push(resolve)) : Promise.resolve(value);
    } };
  }
  return { launch };
}
