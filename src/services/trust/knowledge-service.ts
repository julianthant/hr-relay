/**
 * Ref operator-trust §4 — the knowledge/fix surface over the v10 authority tables.
 *
 * Admission is audited BEFORE the insert, because the tables are insert-only:
 * a duplicate that lands cannot be retracted, so `auditKnowledgeAdmission` /
 * `auditFixAdmission` are the only way in, and both run inside the same
 * authority transaction as the insert so two concurrent authors cannot both
 * read a clean world and then both write.
 *
 * `writeKnowledgeProjection` regenerates the per-system `KNOWLEDGE.md` from the
 * ACTIVE view alone. It is a generated view, never a competing authority: the
 * table is the source and the file says so in its own header.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import {
  activeKnowledgeView,
  auditFixAdmission,
  auditKnowledgeAdmission,
  projectKnowledgePages,
  type FixAdmission,
  type KnowledgeAdmission,
  type KnowledgeProjectionPage,
} from "../../domain/trust/knowledge-projection.js";
import type { FixRecord, KnowledgeRecord } from "../../domain/trust/knowledge.js";
import type { AuthorityRepositories } from "../../infra/sqlite/authority-database.js";

export interface KnowledgeAuthority {
  readonly authority: Pick<AuthorityRepositories, "knowledgeRecords" | "fixRecords">;
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

export const KnowledgeProjectionResultSchema = z.strictObject({
  root: z.string().min(1),
  pages: z.array(z.strictObject({ path: z.string().min(1), bytes: z.number().int().positive() })),
});
export type KnowledgeProjectionResult = z.infer<typeof KnowledgeProjectionResultSchema>;

export interface KnowledgeService {
  recordKnowledge(candidate: unknown): KnowledgeAdmission;
  recordFix(candidate: unknown): FixAdmission;
  activeKnowledge(): readonly KnowledgeRecord[];
  fixesForFailure(fingerprint: string): readonly FixRecord[];
  projectPages(): readonly KnowledgeProjectionPage[];
  writeKnowledgeProjection(outputRoot: string): KnowledgeProjectionResult;
}

export interface KnowledgeServiceDependencies {
  readonly authority: KnowledgeAuthority;
}

export function createKnowledgeService(
  dependencies: KnowledgeServiceDependencies,
): KnowledgeService {
  const repositories = dependencies.authority.authority;

  return Object.freeze({
    recordKnowledge: (candidate: unknown): KnowledgeAdmission =>
      dependencies.authority.withAuthorityTransaction((transactional) => {
        const admission = auditKnowledgeAdmission({
          candidate,
          existing: transactional.knowledgeRecords.list(),
        });
        if (admission.state === "refuse") return admission;
        transactional.knowledgeRecords.insert(admission.record);
        return admission;
      }),

    recordFix: (candidate: unknown): FixAdmission =>
      dependencies.authority.withAuthorityTransaction((transactional) => {
        const admission = auditFixAdmission({
          candidate,
          existingFixes: transactional.fixRecords.list(),
          knowledge: transactional.knowledgeRecords.list(),
        });
        if (admission.state === "refuse") return admission;
        transactional.fixRecords.insert(admission.record);
        return admission;
      }),

    activeKnowledge: () => activeKnowledgeView(repositories.knowledgeRecords.list()),
    fixesForFailure: (fingerprint: string) => repositories.fixRecords.listByFailureFingerprint(fingerprint),
    projectPages: () => projectKnowledgePages(repositories.knowledgeRecords.list()),

    writeKnowledgeProjection: (outputRoot: string): KnowledgeProjectionResult => {
      if (!isAbsolute(outputRoot)) throw new Error("the knowledge projection root must be an absolute path");
      const root = resolve(outputRoot);
      if (root === sep) throw new Error("the knowledge projection root cannot be the filesystem root");
      const pages = projectKnowledgePages(repositories.knowledgeRecords.list());
      const written: { path: string; bytes: number }[] = [];
      for (const page of pages) {
        const target = join(root, page.path);
        if (!target.startsWith(`${root}${sep}`)) {
          throw new Error(`generated knowledge page ${page.path} escapes ${root}`);
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, page.markdown, "utf8");
        written.push({ path: page.path, bytes: Buffer.byteLength(page.markdown, "utf8") });
      }
      return KnowledgeProjectionResultSchema.parse({ root, pages: written });
    },
  });
}
