/**
 * The `ocr` command — the transport that makes routes 2 and 3 usable (D151).
 *
 * The gate in `src/domain/ocr/extraction.ts` is what guarantees every producer
 * yields the same record. This is how a producer that is NOT the automated
 * provider pipeline reaches it:
 *
 *   rebuild:cli ocr forms                     which forms exist
 *   rebuild:cli ocr instruction <formType>    the exact brief every route gets
 *   rebuild:cli ocr admit <submission.json>   run the gate; print record or problems
 *
 * An AI the operator runs in their own terminal reads `instruction`, writes the
 * JSON it describes, and hands it to `admit`. So does the operator. So, later,
 * does the provider adapter — through the same gate, with the same brief.
 *
 * **This command adds no rule of its own.** It reads a file, calls
 * `admitOcrExtraction`, and prints what came back. Every check lives in the
 * gate, so a producer cannot get a different answer by choosing a different
 * transport — which is the whole point of there being one gate.
 *
 * `admit` exits non-zero on refusal, so a terminal agent's own tooling can tell
 * the difference without parsing prose.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitOcrExtraction } from "../../domain/ocr/extraction.js";
import {
  OCR_FORM_TYPES,
  OcrFormTypeSchema,
  ocrForm,
  type OcrFormType,
} from "../../domain/ocr/form-registry.js";
import { buildExtractionInstruction } from "../../domain/ocr/instruction.js";

const USAGE = [
  "usage:",
  "  rebuild:cli ocr forms",
  "  rebuild:cli ocr instruction <form-type>",
  "  rebuild:cli ocr admit <submission.json> [--json]",
].join("\n");

export interface OcrCommandOutcome {
  readonly output: string;
  /** Non-zero when the gate refused, so a caller need not parse the text. */
  readonly exitCode: number;
}

export interface OcrComposeInput {
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Injected so the command is testable without touching the filesystem. */
  readonly readFile?: (path: string) => string;
}

function parseFormType(candidate: string | undefined): OcrFormType {
  const parsed = OcrFormTypeSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `unknown OCR form type ${JSON.stringify(candidate ?? "")}; known: ${OCR_FORM_TYPES.join(", ")}`,
    );
  }
  return parsed.data;
}

export function composeOcrCommand(input: OcrComposeInput): OcrCommandOutcome {
  const [subject, ...rest] = input.args;
  const read = input.readFile ?? ((path: string): string => readFileSync(path, "utf8"));

  if (subject === undefined || subject === "help") return { output: USAGE, exitCode: 0 };

  if (subject === "forms") {
    return {
      output: OCR_FORM_TYPES
        .map((formType) => {
          const form = ocrForm(formType);
          const mandatory = form.fields.filter((field) => field.mandatory).length;
          return `${formType}  ${form.title} — ${String(form.fields.length)} fields`
            + ` (${String(mandatory)} mandatory)`;
        })
        .join("\n"),
      exitCode: 0,
    };
  }

  if (subject === "instruction") {
    return { output: buildExtractionInstruction(parseFormType(rest[0])), exitCode: 0 };
  }

  if (subject === "admit") {
    const path = rest[0];
    if (path === undefined) throw new Error(USAGE);
    const asJson = rest.includes("--json");
    const absolute = resolve(input.cwd ?? process.cwd(), path);

    let parsed: unknown;
    try {
      parsed = JSON.parse(read(absolute));
    } catch (error) {
      // A file that is not JSON is a producer error worth naming precisely; it
      // must not reach the gate as `undefined` and be reported as a schema
      // problem the producer cannot act on.
      throw new Error(
        `${absolute} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const admission = admitOcrExtraction(parsed);
    if (asJson) {
      return { output: JSON.stringify(admission, null, 2), exitCode: admission.admitted ? 0 : 1 };
    }
    if (!admission.admitted) {
      return {
        output: [
          `REFUSED — ${String(admission.problems.length)} problem(s). Nothing was recorded.`,
          ...admission.problems.map((problem) => `  - ${problem}`),
        ].join("\n"),
        exitCode: 1,
      };
    }
    const { extraction } = admission;
    if (extraction.pageKind !== extraction.formType) {
      // A correct answer, not a failure: a scanned stack is mixed.
      return {
        output: `ADMITTED — page ${String(extraction.sourcePage)} is a ${extraction.pageKind} page, `
          + `not ${extraction.formType}. No records; nothing was skipped.`,
        exitCode: 0,
      };
    }
    const lines = [
      `ADMITTED — ${extraction.formType} page ${String(extraction.sourcePage)}, `
        + `${String(extraction.records.length)} record(s)`,
      `  source: ${extraction.source.kind}`,
      `  page fingerprint: ${extraction.pageFingerprint}`,
    ];
    for (const record of extraction.records) {
      lines.push("", `  record ${String(record.rowIndex)} (${record.answersFingerprint.slice(0, 12)})`);
      for (const answer of record.answers) {
        lines.push(answer.state === "read"
          ? `    ${answer.path} = ${JSON.stringify(answer.value)}`
          : answer.state === "absent"
            ? `    ${answer.path} — absent (${answer.reason})`
            : `    ${answer.path} — UNREADABLE ${JSON.stringify(answer.raw)}: ${answer.reason}`);
      }
      if (record.blockingPaths.length > 0) {
        lines.push(
          `    ${String(record.blockingPaths.length)} mandatory field(s) need a human: `
            + record.blockingPaths.join(", "),
        );
      }
    }
    return { output: lines.join("\n"), exitCode: 0 };
  }

  throw new Error(`unknown ocr subcommand ${JSON.stringify(subject)}\n${USAGE}`);
}
