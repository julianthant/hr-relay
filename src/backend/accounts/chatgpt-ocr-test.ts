import type { z } from "zod";
import type { ContentAddressedArtifactWriter } from "../../workflow-kit/artifacts.js";
import { AdmittedExtractionSchema } from "../../models/ocr/extraction.js";
import { ExtractFormPageInputSchema } from "../../models/processing/ocr/extract-form-page.js";
import { ChatGptAccountError } from "./chatgpt-account-service.js";

const SYNTHETIC_PAGE = Buffer.from("JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyNDggPj4Kc3RyZWFtCkJUIC9GMSAxNiBUZiA2MCA3MzAgVGQgKE9BVEggT0YgQUxMRUdJQU5DRSkgVGogMCAtMzAgVGQgL0YxIDEyIFRmIChQcmludGVkIG5hbWU6IEV4YW1wbGUsIEF2ZXJ5KSBUaiAwIC0yMiBUZCAoRW1wbG95ZWUgSUQ6IDEwODAwMDAwKSBUaiAwIC0yMiBUZCAoU2lnbmF0dXJlIGRhdGU6IDA3LzIxLzIwMjYpIFRqIDAgLTIyIFRkIChFbXBsb3llZSBzaWduZWQ6IHllcykgVGogMCAtMjIgVGQgKE9mZmljZXIgc2lnbmVkOiB5ZXMpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTQwIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNjEwCiUlRU9GCg==", "base64");
export function createChatGptOcrTestService(deps: {
  readonly artifacts: Pick<ContentAddressedArtifactWriter, "put">;
  readonly dispatch: (input: z.infer<typeof ExtractFormPageInputSchema>, signal: AbortSignal) => Promise<unknown>;
}) {
  return Object.freeze({
    async testOcr(signal: AbortSignal) {
      if (signal.aborted) throw new ChatGptAccountError("CHATGPT_OCR_CANCELLED");
      const page = await deps.artifacts.put(SYNTHETIC_PAGE, { mediaType: "application/pdf" });
      if (signal.aborted) throw new ChatGptAccountError("CHATGPT_OCR_CANCELLED");
      const input = ExtractFormPageInputSchema.parse({ formType: "oath", page, sourcePage: 1 });
      const result = await deps.dispatch(input, signal);
      if (signal.aborted) throw new ChatGptAccountError("CHATGPT_OCR_CANCELLED");
      const output = AdmittedExtractionSchema.parse(result);
      if (output.formType !== input.formType || output.sourcePage !== 1 || output.sourceSha256 !== page.sha256
        || output.source.kind !== "provider" || output.source.providerId !== "chatgpt-subscription" || output.pageKind !== "oath" || output.record === null)
        throw new ChatGptAccountError("CHATGPT_OCR_INVALID");
      const name = output.record.answers.find(answer => answer.path === "printedName");
      const employeeId = output.record.answers.find(answer => answer.path === "employeeId");
      if (name?.state !== "read" || name.value !== "Example, Avery" || employeeId?.state !== "read" || employeeId.value !== "20000000")
        throw new ChatGptAccountError("CHATGPT_OCR_INVALID");
      return { state: "completed" as const, model: output.source.modelId };
    },
  });
}
export type ChatGptOcrTestService = ReturnType<typeof createChatGptOcrTestService>;
