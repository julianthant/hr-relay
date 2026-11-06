export const GENERATED_OUTPUTS = [
  { script: "roadmap", paths: ["docs/roadmap/index.html"] },
] as const;

export function generatedOnlyConflicts(paths: readonly string[]): boolean {
  const generated = new Set<string>(GENERATED_OUTPUTS.flatMap(output => [...output.paths]));
  return paths.length > 0 && paths.every(path => generated.has(path));
}
