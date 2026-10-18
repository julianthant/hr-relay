import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import synthetic from "./privacy-synthetic.json" with { type: "json" };

export interface PrivacyFinding { readonly path: string; readonly rule: string }

const fixtureFiles = new Map(synthetic.fixtureFiles.map(({ path, sha256 }) => [path, sha256]));
const sourcePaths = new Set(synthetic.sourcePaths);
const publicConfigFiles = new Map(synthetic.publicConfigFiles.map(({ path, sha256 }) => [path, sha256]));
const credentialCanaries = new Map(synthetic.credentialCanaries.map(({ path, sha256 }) => [path, sha256]));
const allowedTokens = {
  eid: new Set(synthetic.eid),
  ssn: new Set(synthetic.ssn),
};
const valueRules = [
  { rule: "eid", pattern: /\b(?:eid|employee[ _]?id|empl[ _]?id)["'\s:=]{0,12}(\d{8})\b|\b(10\d{6})\b/giu },
  { rule: "ssn", pattern: /(?<!\d)(\d{3}-\d{2}-\d{4})(?!\d)|\b(?:ssn|social security(?: number)?)["'\s:=]{0,12}(\d{9})\b/giu },
] as const;

function decodeText(content: Buffer): string[] {
  const encodings = ["utf-8"];
  if (content[0] === 0xff && content[1] === 0xfe) encodings.push("utf-16le");
  else if (content[0] === 0xfe && content[1] === 0xff) encodings.push("utf-16be");
  else {
    let evenZeros = 0;
    let oddZeros = 0;
    for (let index = 0; index < content.length; index++) {
      if (content[index] === 0) {
        if (index % 2) oddZeros++;
        else evenZeros++;
      }
    }
    if (oddZeros > content.length / 4 && evenZeros < content.length / 20) encodings.push("utf-16le");
    if (evenZeros > content.length / 4 && oddZeros < content.length / 20) encodings.push("utf-16be");
  }
  const texts: string[] = [];
  for (const encoding of encodings) {
    try { texts.push(new TextDecoder(encoding, { fatal: true }).decode(content).replaceAll("\0", "")); }
    catch { continue; }
  }
  return [...new Set(texts)];
}

export function inspectTrackedFile(path: string, content: Buffer): PrivacyFinding[] {
  const rules = new Set<string>();
  const digest = createHash("sha256").update(content).digest("hex");
  if (/(?:^|\/)\.local-private(?:\/|$)/u.test(path)) rules.add("private-directory");
  if (/(?:^|\/)\.env(?:\.[^/]*)?$/iu.test(path) && path !== ".env.example") rules.add("environment-file");
  if (/\.(?:xlsx?|csv|tsv|pdf)$/iu.test(path) && fixtureFiles.get(path) !== digest) rules.add("private-document");
  if ((/(?:^|\/)\.?(?:credentials?|secrets?|auth|tokens?)(?:\.(?:json|ya?ml|toml|txt|ini|conf|cfg|properties|env|csv|xml|db|sqlite3?))?$|(?:^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|\.npmrc|\.pypirc|\.netrc|\.git-credentials|test-data\.local\.json)$|\.(?:pem|key|p12|pfx|jks)$/iu.test(path)
    || /(?:^|\/)(?:credentials|\.ssh|\.aws|\.kube)\//iu.test(path)) && publicConfigFiles.get(path) !== digest) rules.add("credential-file");
  const binaryImage = (/\.png$/iu.test(path) && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    || (/\.webp$/iu.test(path) && content.subarray(0, 4).equals(Buffer.from("RIFF")) && content.subarray(8, 12).equals(Buffer.from("WEBP")));
  const texts = fixtureFiles.get(path) === digest ? []
    : binaryImage ? [content.toString("utf8").replaceAll("\0", "")] : decodeText(content);
  if (!binaryImage && fixtureFiles.get(path) !== digest && !texts.length) rules.add("unsupported-text-encoding");
  for (const text of texts) {
    const credentialPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|AKIA[A-Z0-9]{16})\b/gu;
    for (const [value] of text.matchAll(credentialPattern)) {
      if (credentialCanaries.get(path) !== createHash("sha256").update(value).digest("hex")) rules.add("credential-value");
    }
    const syntheticPath = path.startsWith("tests/") || sourcePaths.has(path);
    for (const { rule, pattern } of valueRules) {
      for (const valueText of new Set([text, text.replace(/<[^>]*>/gu, " ")])) {
        for (const match of valueText.matchAll(pattern)) {
          const value = (match[1] ?? match[2]).replaceAll("-", "");
          const digest = createHash("sha256").update(value).digest("hex");
          if (!syntheticPath || !allowedTokens[rule].has(digest)) rules.add(rule);
        }
      }
    }
  }
  return [...rules].sort().map((rule) => ({ path, rule }));
}

export function scanTrackedFiles(cwd: string): PrivacyFinding[] {
  const entries = execFileSync("git", ["ls-files", "--stage", "-z"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  const findings: PrivacyFinding[] = [];
  for (const entry of entries) {
    const separator = entry.indexOf("\t");
    const metadata = entry.slice(0, separator);
    const path = entry.slice(separator + 1);
    const [, object, stage] = metadata.split(" ");
    if (stage !== "0") throw new Error("Privacy scan requires a resolved Git index");
    const content = execFileSync("git", ["cat-file", "blob", object], { cwd, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    findings.push(...inspectTrackedFile(path, content));
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path, "en") || a.rule.localeCompare(b.rule, "en"));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const findings = scanTrackedFiles(process.cwd());
    for (const { path, rule } of findings) console.error(`${JSON.stringify(path)}: ${rule}`);
    console.log(findings.length ? `Privacy check failed: ${findings.length} findings.` : "Privacy check passed (Git index).");
    process.exitCode = findings.length ? 1 : 0;
  } catch {
    console.error("Privacy check failed: scan-error.");
    process.exitCode = 1;
  }
}
