import { isAbsolute, relative } from "node:path";

export interface TestArtifactListing {
  readonly repositoryRoot: string;
  readonly scratchRoot: string;
  readonly evidenceRoot: string;
  readonly tracked: readonly string[];
  readonly ignored: readonly string[];
}

export function artifactOwnershipViolations(input: TestArtifactListing): string[] {
  const violations: string[] = [];
  const withinRepository = (path: string): boolean => {
    const rel = relative(input.repositoryRoot, path);
    return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
  };
  if (!isAbsolute(input.scratchRoot) || withinRepository(input.scratchRoot)) violations.push("test scratch must be outside the repository");
  if (!isAbsolute(input.evidenceRoot) || withinRepository(input.evidenceRoot)) violations.push("retained evidence must be outside the repository");
  for (const path of input.tracked) {
    if (path === "test-results/.last-run.json" || path.startsWith("test-results/")
      || path.startsWith("coverage/")) {
      violations.push(`generated test output is tracked: ${path}`);
    }
  }
  for (const path of ["test-results/.last-run.json", "coverage/index.html"]) {
    if (!input.ignored.includes(path)) violations.push(`generated test output is not ignored: ${path}`);
  }
  return violations;
}
