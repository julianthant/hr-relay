import { z } from "zod";
import { deepFreeze } from "../immutability.js";
import { SecretFamilyNameSchema } from "../secret-names.js";

export const SecretFamilySpecSchema = z.strictObject({
  name: SecretFamilyNameSchema,
  envPrefix: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  modelsConfigKey: z.enum(["gemini", "groq", "mistral", "openRouter", "sambanova"]),
  maximum: z.number().int().positive(),
  requiredAtBoot: z.boolean(),
  classification: z.literal("secret"),
});

export const SECRET_FAMILY_SPECS = deepFreeze(SecretFamilySpecSchema.array().parse([
  { name: "geminiApiKeys", envPrefix: "GEMINI_API_KEY", modelsConfigKey: "gemini", maximum: 8, requiredAtBoot: false, classification: "secret" },
  { name: "groqApiKeys", envPrefix: "GROQ_API_KEY", modelsConfigKey: "groq", maximum: 8, requiredAtBoot: false, classification: "secret" },
  { name: "mistralApiKeys", envPrefix: "MISTRAL_API_KEY", modelsConfigKey: "mistral", maximum: 8, requiredAtBoot: false, classification: "secret" },
  { name: "openRouterApiKeys", envPrefix: "OPEN_ROUTER_API_KEY", modelsConfigKey: "openRouter", maximum: 8, requiredAtBoot: false, classification: "secret" },
  { name: "sambaNovaApiKeys", envPrefix: "SAMBANOVA_API_KEY", modelsConfigKey: "sambanova", maximum: 8, requiredAtBoot: false, classification: "secret" },
]));
