export const GENERATED_OUTPUTS = [
  {
    script: "build:registries",
    paths: [
      "src/workflows/generated-descriptors.ts",
      "src/backend/app/registries/generated-workflow-stores.ts",
      "src/backend/app/registries/generated-workflow-modules.ts",
      "src/backend/app/registries/generated-step-proof-modules.ts",
    ],
  },
  {
    script: "stores:catalog",
    paths: ["docs/reference/stores.md"],
    section: { start: "<!-- store-catalog:start -->", end: "<!-- store-catalog:end -->" },
  },
  { script: "roadmap", paths: ["docs/roadmap/index.html"] },
] as const;

export function generatedOnlyConflicts(paths: readonly string[]): boolean {
  const generated = new Set<string>(GENERATED_OUTPUTS.flatMap(output => [...output.paths]));
  return paths.length > 0 && paths.every(path => generated.has(path));
}

export function clearGeneratedSection(content: string, section: { start: string; end: string }): string {
  const start = content.indexOf(section.start);
  const end = content.indexOf(section.end);
  if (start < 0 || end <= start || content.indexOf(section.start, start + 1) >= 0
    || content.indexOf(section.end, end + 1) >= 0) throw new Error("generated-section-markers-invalid");
  const authored = content.slice(0, start + section.start.length) + "\n\n" + content.slice(end);
  if (/^(?:<{7}|={7}|>{7}|\|{7})(?: |$)/mu.test(authored)) throw new Error("authored-section-conflict");
  return authored;
}
