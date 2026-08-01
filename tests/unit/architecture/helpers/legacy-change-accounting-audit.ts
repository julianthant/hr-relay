export type LegacyChangeKind = "added" | "modified" | "deleted";

export interface LegacyPathChange {
  readonly path: string;
  readonly changeKind: LegacyChangeKind;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
}

export interface LegacyAccountingPathChange extends LegacyPathChange {
  readonly capabilityIds: readonly string[];
  readonly impactRationale: string;
  readonly rebuildRecheckIds: readonly string[];
}

export interface LegacyCommitSnapshot {
  readonly commit: string;
  readonly parentCommit: string;
  readonly changes: readonly LegacyPathChange[];
}

export interface LegacyAccountingCommit {
  readonly commit: string;
  readonly parentCommit: string;
  readonly changes: readonly LegacyAccountingPathChange[];
}

export interface ClosedRecheckEvidence {
  readonly id: string;
  readonly closedAt: string;
  readonly evidence: readonly string[];
}

export interface LegacyChangeAccountingManifest {
  readonly schemaVersion: number;
  readonly baselineCommit: string;
  readonly accountedRoots: readonly string[];
  readonly deletionPolicy: string;
  readonly closedRecheckCatalog: readonly ClosedRecheckEvidence[];
  readonly commits: readonly LegacyAccountingCommit[];
}

export interface ReviewedImpactRule {
  readonly kind: "exact" | "prefix";
  readonly path: string;
  readonly capabilityIds: readonly string[];
}

export interface LegacyChangeAccountingAuditInput {
  readonly manifest: LegacyChangeAccountingManifest;
  readonly history: readonly LegacyCommitSnapshot[];
  readonly knownCapabilityIds: ReadonlySet<string>;
  readonly impactRules: readonly ReviewedImpactRule[];
  readonly dirtyStatus: string;
  readonly baselineExists: boolean;
  readonly baselineIsAncestor: boolean;
}

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function ruleMatchesPath(rule: ReviewedImpactRule, path: string): boolean {
  return rule.kind === "exact" ? path === rule.path : path.startsWith(rule.path);
}

export function requiredCapabilitiesForPath(
  path: string,
  rules: readonly ReviewedImpactRule[],
): ReadonlySet<string> {
  return new Set(
    rules
      .filter((rule) => ruleMatchesPath(rule, path))
      .flatMap((rule) => rule.capabilityIds),
  );
}

function validateHashShape(
  change: LegacyPathChange,
  label: string,
  violations: string[],
): void {
  const beforeIsHash = change.beforeSha256 !== null && SHA256_PATTERN.test(change.beforeSha256);
  const afterIsHash = change.afterSha256 !== null && SHA256_PATTERN.test(change.afterSha256);
  if (change.changeKind === "added") {
    if (change.beforeSha256 !== null) violations.push(`${label}: an added path must have a null before hash`);
    if (!afterIsHash) violations.push(`${label}: an added path needs a SHA-256 after hash`);
    return;
  }
  if (change.changeKind === "modified") {
    if (!beforeIsHash) violations.push(`${label}: a modified path needs a SHA-256 before hash`);
    if (!afterIsHash) violations.push(`${label}: a modified path needs a SHA-256 after hash`);
    return;
  }
  if (!beforeIsHash) violations.push(`${label}: a deleted path needs a SHA-256 before hash`);
  if (change.afterSha256 !== null) violations.push(`${label}: a deleted path must have a null after hash`);
}

/**
 * Pure D94 accounting auditor.
 *
 * Git access stays in the guard file. Keeping comparison and policy logic here
 * makes every fail-closed arm executable against small adversarial fixtures.
 */
export function legacyChangeAccountingViolations(
  input: LegacyChangeAccountingAuditInput,
): string[] {
  const { manifest, history, knownCapabilityIds, impactRules } = input;
  const violations: string[] = [];

  if (manifest.schemaVersion !== 2) violations.push("legacy change accounting must use schemaVersion 2");
  if (!COMMIT_PATTERN.test(manifest.baselineCommit)) violations.push("baselineCommit must be a full commit hash");
  if (!input.baselineExists) violations.push(`baseline commit does not exist: ${manifest.baselineCommit}`);
  if (!input.baselineIsAncestor) violations.push(`baseline commit is not an ancestor of legacy HEAD: ${manifest.baselineCommit}`);
  if (manifest.deletionPolicy !== "forbidden-through-initial-cutover") {
    violations.push("legacy deletion policy must remain forbidden-through-initial-cutover");
  }
  if (
    manifest.accountedRoots.length !== 2
    || manifest.accountedRoots[0] !== "src"
    || manifest.accountedRoots[1] !== "tests"
  ) {
    violations.push("accountedRoots must be exactly src and tests");
  }
  if (input.dirtyStatus.length > 0) {
    violations.push(`legacy src/tests must be clean before accounting by commit:\n${input.dirtyStatus}`);
  }

  const recheckIds = new Set<string>();
  for (const entry of manifest.closedRecheckCatalog) {
    if (!entry.id.trim()) violations.push("closed recheck evidence needs a non-empty id");
    if (recheckIds.has(entry.id)) violations.push(`duplicate closed recheck id: ${entry.id}`);
    recheckIds.add(entry.id);
    if (!ISO_DATE_PATTERN.test(entry.closedAt)) violations.push(`${entry.id}: closedAt must be an ISO date`);
    if (entry.evidence.length === 0 || entry.evidence.some((item) => !item.trim())) {
      violations.push(`${entry.id}: closed recheck evidence must be non-empty`);
    }
  }

  const actualByCommit = new Map(history.map((entry) => [entry.commit, entry]));
  const recordedByCommit = new Map(manifest.commits.map((entry) => [entry.commit, entry]));
  if (actualByCommit.size !== history.length) violations.push("legacy history contains duplicate commit ids");
  if (recordedByCommit.size !== manifest.commits.length) violations.push("accounting contains duplicate commit ids");

  for (const entry of history) {
    if (!recordedByCommit.has(entry.commit)) violations.push(`missing commit record: ${entry.commit}`);
  }
  for (const entry of manifest.commits) {
    if (!actualByCommit.has(entry.commit)) violations.push(`unknown or out-of-range commit record: ${entry.commit}`);
  }
  const actualOrder = history.map(({ commit }) => commit);
  const recordedOrder = manifest.commits.map(({ commit }) => commit);
  if (actualOrder.length === recordedOrder.length && actualOrder.some((commit, index) => commit !== recordedOrder[index])) {
    violations.push("legacy commits must be recorded in git rev-list --reverse order");
  }

  const referencedRecheckIds = new Set<string>();
  for (const recordedCommit of manifest.commits) {
    const commitLabel = recordedCommit.commit;
    if (!COMMIT_PATTERN.test(recordedCommit.commit)) violations.push(`invalid recorded commit hash: ${recordedCommit.commit}`);
    if (!COMMIT_PATTERN.test(recordedCommit.parentCommit)) violations.push(`${commitLabel}: invalid parent commit hash`);
    const actualCommit = actualByCommit.get(recordedCommit.commit);
    if (!actualCommit) continue;
    if (recordedCommit.parentCommit !== actualCommit.parentCommit) {
      violations.push(`${commitLabel}: parent commit does not match the named commit`);
    }

    const actualByPath = new Map(actualCommit.changes.map((change) => [change.path, change]));
    const recordedByPath = new Map(recordedCommit.changes.map((change) => [change.path, change]));
    if (actualByPath.size !== actualCommit.changes.length) violations.push(`${commitLabel}: git history contains duplicate paths`);
    if (recordedByPath.size !== recordedCommit.changes.length) violations.push(`${commitLabel}: accounting contains duplicate paths`);
    for (const actualChange of actualCommit.changes) {
      if (!recordedByPath.has(actualChange.path)) {
        violations.push(`${commitLabel}: missing path record: ${actualChange.path}`);
      }
      if (actualChange.changeKind === "deleted") {
        violations.push(`${commitLabel}:${actualChange.path}: deletion is forbidden through initial cutover`);
      }
    }
    for (const recordedChange of recordedCommit.changes) {
      const label = `${commitLabel}:${recordedChange.path}`;
      const actualChange = actualByPath.get(recordedChange.path);
      if (!actualChange) {
        violations.push(`${commitLabel}: stale path record: ${recordedChange.path}`);
        continue;
      }
      validateHashShape(recordedChange, label, violations);
      if (recordedChange.changeKind === "deleted") {
        violations.push(`${label}: deletion record is forbidden through initial cutover`);
      }
      if (recordedChange.changeKind !== actualChange.changeKind) {
        violations.push(`${label}: stale change kind`);
      }
      if (recordedChange.beforeSha256 !== actualChange.beforeSha256) {
        violations.push(`${label}: stale before hash for named commit`);
      }
      if (recordedChange.afterSha256 !== actualChange.afterSha256) {
        violations.push(`${label}: stale after hash for named commit`);
      }
      if (recordedChange.capabilityIds.length === 0) violations.push(`${label}: affected capability ids are required`);
      if (new Set(recordedChange.capabilityIds).size !== recordedChange.capabilityIds.length) {
        violations.push(`${label}: affected capability ids must be unique`);
      }
      for (const capabilityId of recordedChange.capabilityIds) {
        if (!knownCapabilityIds.has(capabilityId)) violations.push(`${label}: unknown capability id ${capabilityId}`);
      }
      if (!recordedChange.impactRationale.trim()) violations.push(`${label}: impact rationale is required`);

      const requiredCapabilities = requiredCapabilitiesForPath(recordedChange.path, impactRules);
      if (requiredCapabilities.size === 0) violations.push(`${label}: no reviewed exact/prefix impact rule`);
      const recordedCapabilities = new Set(recordedChange.capabilityIds);
      for (const capabilityId of requiredCapabilities) {
        if (!recordedCapabilities.has(capabilityId)) {
          violations.push(`${label}: missing required affected capability ${capabilityId}`);
        }
      }

      if (recordedChange.rebuildRecheckIds.length === 0) violations.push(`${label}: rebuild recheck ids are required`);
      if (new Set(recordedChange.rebuildRecheckIds).size !== recordedChange.rebuildRecheckIds.length) {
        violations.push(`${label}: rebuild recheck ids must be unique`);
      }
      for (const recheckId of recordedChange.rebuildRecheckIds) {
        referencedRecheckIds.add(recheckId);
        if (!recheckIds.has(recheckId)) violations.push(`${label}: unknown or open rebuild recheck id ${recheckId}`);
      }
    }
  }

  for (const recheckId of recheckIds) {
    if (!referencedRecheckIds.has(recheckId)) violations.push(`stale closed recheck evidence: ${recheckId}`);
  }
  for (const rule of impactRules) {
    if (!rule.path.trim()) violations.push("reviewed impact rules need a non-empty path");
    if (rule.capabilityIds.length === 0) violations.push(`${rule.path}: reviewed impact rule needs capability ids`);
    for (const capabilityId of rule.capabilityIds) {
      if (!knownCapabilityIds.has(capabilityId)) violations.push(`${rule.path}: impact rule names unknown capability ${capabilityId}`);
    }
  }

  return violations;
}
