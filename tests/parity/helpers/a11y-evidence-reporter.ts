import { createHash } from "node:crypto";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const REQUIRED = "required-a11y-evidence";
const DIGEST = "a11y-attachment-sha256:";

/** Fails the run when a passed test declaring required a11y evidence lacks the exact attached tree and its digest. */
export default class A11yEvidenceReporter implements Reporter {
  readonly #problems: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "passed") return;
    const names = test.annotations.filter(({ type }) => type === REQUIRED).map(({ description }) => description ?? "");
    for (const name of names) {
      const bodies = result.attachments.filter(attachment => attachment.name === name && attachment.body !== undefined);
      const digests = [...test.annotations, ...result.annotations].filter(({ type }) => type === `${DIGEST}${name}`);
      const body = bodies[0]?.body;
      const problem = !name.endsWith(".a11y.yml") ? "invalid declaration"
        : bodies.length !== 1 || body === undefined ? `${String(bodies.length)} body attachments`
        : new Set(digests.map(({ description }) => description)).size !== 1 ? `${String(digests.length)} digest annotations`
        : digests[0]?.description !== createHash("sha256").update(body).digest("hex") ? "digest does not match the attached body" : undefined;
      if (problem !== undefined) this.#problems.push(`${test.location.file}:${String(test.location.line)} ${test.title}: required a11y evidence ${name}: ${problem}`);
    }
  }

  onEnd(): Promise<{ status: FullResult["status"] } | undefined> {
    if (this.#problems.length === 0) return Promise.resolve(undefined);
    process.stderr.write(`${this.#problems.join("\n")}\n`);
    return Promise.resolve({ status: "failed" });
  }

  printsToStdio(): boolean {
    return false;
  }
}
