import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { z } from "zod";
import { systemClock } from "../../src/rules/time/clock.js";

const NumberSchema = z.number().finite().nonnegative();
const CpuProfileSchema = z.object({
  nodes: z.array(z.object({ id: NumberSchema, hitCount: NumberSchema.optional(), children: z.array(NumberSchema).optional(),
    callFrame: z.object({ functionName: z.string(), url: z.string(), lineNumber: z.number().int(), columnNumber: z.number().int(), scriptId: z.string() }) })).max(200_000),
  startTime: NumberSchema, endTime: NumberSchema, samples: z.array(NumberSchema).max(2_000_000).optional(),
  timeDeltas: z.array(NumberSchema).max(2_000_000).optional(),
});

export function sanitizeCpuProfile(value: unknown) {
  const profile = CpuProfileSchema.parse(value);
  return { ...profile, nodes: profile.nodes.map(node => ({ ...node, callFrame: {
    functionName: "(sample)", url: node.callFrame.url.startsWith("node:") ? "node:runtime" : "relay:code",
    lineNumber: node.callFrame.lineNumber, columnNumber: node.callFrame.columnNumber, scriptId: "0",
  } })) };
}

export function machineSnapshot() {
  const processors = cpus();
  return { version: 1, collectedAt: systemClock.now().toISOString(), platform: process.platform, architecture: process.arch,
    node: process.version, v8: process.versions.v8, logicalProcessors: processors.length,
    cpuMHz: processors.map(cpu => cpu.speed), freeMemoryBytes: freemem(), totalMemoryBytes: totalmem() };
}

function regularBytes(path: string, maxBytes: number): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error("relay-diagnostics-file-refused");
  return readFileSync(path);
}

export async function collectDiagnostics(input: { appRoot: string; workspace: string; output: string }): Promise<string> {
  const output = resolve(input.output);
  const appRoot = resolve(input.appRoot);
  if (!isAbsolute(input.output) || output === appRoot || output.startsWith(`${appRoot}${sep}`)) throw new Error("relay-diagnostics-output-must-be-outside-app");
  if (existsSync(join(input.workspace, "launcher/broker.json"))) throw new Error("relay-diagnostics-stop-first");
  const zip = new JSZip();
  zip.file("machine.json", `${JSON.stringify(machineSnapshot())}\n`);
  zip.file("logs/status.json", JSON.stringify({ version: 1, safeLogFiles: 0 }));
  const profiles = join(input.workspace, "diagnostics/cpu");
  if (existsSync(profiles)) {
    if (!lstatSync(profiles).isDirectory() || lstatSync(profiles).isSymbolicLink()) throw new Error("relay-diagnostics-directory-refused");
    const entries = readdirSync(profiles).filter(name => /^relay-[a-f0-9-]+\.cpuprofile$/u.test(name));
    if (entries.length > 8) throw new Error("relay-diagnostics-too-many-profiles");
    for (const [index, name] of entries.sort().entries()) {
      zip.file(`profiles/cpu-${index + 1}.cpuprofile`, JSON.stringify(sanitizeCpuProfile(JSON.parse(regularBytes(join(profiles, name), 32 * 1024 * 1024).toString("utf8")))));
    }
  }
  await pipeline(zip.generateNodeStream({ streamFiles: true, compression: "DEFLATE" }), createWriteStream(output, { flags: "wx", mode: 0o600 }));
  return output;
}

export function defaultDiagnosticName(workspace: string): string {
  return join(workspace, `relay-diagnostics-${randomUUID()}.zip`);
}
