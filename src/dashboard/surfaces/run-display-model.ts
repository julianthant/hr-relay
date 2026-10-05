import { sha256Hex } from "../../domain/sha256.js";

/** A compact display alias; routing and command identity remain the full run ID. */
export function runDisplayId(runId: string, traceId: string): string {
  const code = traceId.split("-")[0].toUpperCase();
  const number = (Number.parseInt(sha256Hex(runId).slice(0, 12), 16) % 100_000_000).toString().padStart(8, "0");
  return `${code}${number}`;
}

export function workflowDisplayCode(label: string): string {
  if (label === "Separations") return "sp";
  const words = label.replaceAll("-", " ").split(/\s+/u);
  return (words.length === 1 ? label.slice(0, 3) : words.map(word => word[0]).join("")).toLowerCase();
}
