export interface ProjectSelection {
  readonly name: string;
  readonly files: readonly string[];
}

export function projectOwnershipViolations(
  authoredFiles: readonly string[],
  selections: readonly ProjectSelection[],
): string[] {
  const violations: string[] = [];
  const authored = new Set(authoredFiles);
  if (authored.size !== authoredFiles.length) violations.push("authored test listing contains duplicates");
  const names = selections.map(({ name }) => name);
  if (new Set(names).size !== names.length) violations.push("Vitest project names must be unique");
  for (const { name, files } of selections) {
    if (files.length === 0) violations.push(`${name}: project collects no tests`);
    if (new Set(files).size !== files.length) violations.push(`${name}: project listing contains duplicates`);
    for (const file of files) {
      if (!authored.has(file)) violations.push(`${name}: collected path is not a declared Vitest test: ${file}`);
    }
  }
  for (const file of authored) {
    const owners = selections.filter(({ files }) => files.includes(file)).map(({ name }) => name);
    if (owners.length !== 1) violations.push(`${file}: expected exactly one Vitest project, found ${owners.join(", ") || "none"}`);
  }
  return violations;
}
