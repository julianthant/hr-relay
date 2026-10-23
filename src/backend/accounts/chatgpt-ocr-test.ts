import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { ArtifactRefSchema } from "../../models/artifacts/artifacts.js";
import type { z } from "zod";
import { sha256Hex } from "../../rules/validation/sha256.js";
import type { ContentAddressedArtifactWriter } from "../../workflow-kit/artifacts.js";
import { AdmittedExtractionSchema } from "../../models/ocr/extraction.js";
import { ExtractFormPageInputSchema } from "../../models/processing/ocr/extract-form-page.js";
import { ChatGptAccountError } from "./chatgpt-account-service.js";

const SYNTHETIC_PAGE = Buffer.from("JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyNDggPj4Kc3RyZWFtCkJUIC9GMSAxNiBUZiA2MCA3MzAgVGQgKE9BVEggT0YgQUxMRUdJQU5DRSkgVGogMCAtMzAgVGQgL0YxIDEyIFRmIChQcmludGVkIG5hbWU6IEV4YW1wbGUsIEF2ZXJ5KSBUaiAwIC0yMiBUZCAoRW1wbG95ZWUgSUQ6IDEwODAwMDAwKSBUaiAwIC0yMiBUZCAoU2lnbmF0dXJlIGRhdGU6IDA3LzIxLzIwMjYpIFRqIDAgLTIyIFRkIChFbXBsb3llZSBzaWduZWQ6IHllcykgVGogMCAtMjIgVGQgKE9mZmljZXIgc2lnbmVkOiB5ZXMpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTQwIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNjEwCiUlRU9GCg==", "base64");
const SYNTHETIC_EMPLOYEE_ID_SHA256 = "55fd1753fedf434d02ed5e05868f82bbdfef80117221158f897f188dda104398";

export function createChatGptOcrTestService(deps: {
  assertCurrent(): void;
  readonly dispatch: (input: z.infer<typeof ExtractFormPageInputSchema>, signal: AbortSignal, source: Pick<ContentAddressedArtifactWriter, "open">) => Promise<unknown>;
}) {
  return Object.freeze({
    async testOcr(signal: AbortSignal) {
      if (signal.aborted) throw new ChatGptAccountError("CHATGPT_OCR_CANCELLED");
      deps.assertCurrent();
      const page = ArtifactRefSchema.parse({ id: randomUUID(), sha256: createHash("sha256").update(SYNTHETIC_PAGE).digest("hex"), bytes: SYNTHETIC_PAGE.byteLength, mediaType: "application/pdf" });
      if (signal.aborted) throw new ChatGptAccountError("CHATGPT_OCR_CANCELLED");
      deps.assertCurrent();
      const input = ExtractFormPageInputSchema.parse({ formType: "oath", page, sourcePage: 1 });
      let opened = false, live = true;
      const source = Object.freeze({ async open(ref: unknown) {
        deps.assertCurrent();
        if (signal.aborted) throw new ChatGptAccountError("CHATGPT_OCR_CANCELLED");
        const parsed = ArtifactRefSchema.safeParse(ref);
        if (!live || opened || !parsed.success || parsed.data.id !== page.id || parsed.data.sha256 !== page.sha256
          || parsed.data.bytes !== page.bytes || parsed.data.mediaType !== page.mediaType) throw new ChatGptAccountError("CHATGPT_OCR_INVALID");
        opened = true;
        return Readable.from([Buffer.from(SYNTHETIC_PAGE)]);
      } });
      try {
        const result = await deps.dispatch(input, signal, source);
        if (signal.aborted) throw new ChatGptAccountError("CHATGPT_OCR_CANCELLED");
        deps.assertCurrent();
        const output = AdmittedExtractionSchema.parse(result);
        if (output.formType !== input.formType || output.sourcePage !== 1 || output.sourceSha256 !== page.sha256
          || output.source.kind !== "provider" || output.source.providerId !== "chatgpt-subscription" || output.pageKind !== "oath" || output.record === null)
          throw new ChatGptAccountError("CHATGPT_OCR_INVALID");
        const name = output.record.answers.find(answer => answer.path === "printedName");
        const employeeId = output.record.answers.find(answer => answer.path === "employeeId");
        if (name?.state !== "read" || name.value !== "Example, Avery" || employeeId?.state !== "read" || typeof employeeId.value !== "string"
          || sha256Hex(employeeId.value) !== SYNTHETIC_EMPLOYEE_ID_SHA256)
          throw new ChatGptAccountError("CHATGPT_OCR_INVALID");
        return { state: "completed" as const, model: output.source.modelId };
      } finally { live = false; }
    },
  });
}
export type ChatGptOcrTestService = ReturnType<typeof createChatGptOcrTestService>;
