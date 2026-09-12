import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SQLITE_MIGRATIONS } from "../../../src/infra/sqlite/migrations.js";
import { activeKnowledgeView, projectKnowledgePages } from "../../../src/domain/trust/knowledge-projection.js";
/**
 * Guard: `knowledge-fix-integrity` (ref guards-and-tests §3.10; ref operator-trust §4 + §9).
 *
 * Live guidance authority retired by F (2.6.6). These historical schema-41 controls remain.
 * Knowledge records carry status/scope/evidence/validity and supersession refs;
 * no two ACTIVE records may claim the same scoped rule without an explicit
 * conflict link. Fix records link failure, changed contracts/UI ids, scenarios,
 * verification, and commit — a verified one requires a commit plus non-empty
 * evidence, and a draft stays out of active guidance. A raw chronological
 * lesson append is not accepted as active architecture authority: `triageLesson`
 * has no arm that returns a record at all.
 *
 * The generated `KNOWLEDGE.md` projection is checked here too, because ref operator-trust §9
 * makes "generated active knowledge contains no superseded/retired/unverified
 * records" a guard obligation and the file is the thing an AI tool reads.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import {
  KnowledgeRecordSchema,
  FixRecordSchema,
} from "../../../src/domain/trust/knowledge.js";
import {
  auditFixAdmission,
  auditKnowledgeAdmission,
  triageLesson,
} from "../../../src/domain/trust/knowledge-projection.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { HASH_A, NOW, UUID_1, UUID_2, UUID_3, UUID_4 } from "../../fixtures/phase1c-contract-fixtures.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const EVIDENCE_A = `artifact:${UUID_1}`;
const EVIDENCE_B = `receipt:${UUID_2}`;
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/**
 * An explicit `undefined` override REMOVES the key. A strict optional field
 * that is present-but-undefined is not the same record as one that omits it,
 * and only the omission is what these arms mean to build.
 */
function withoutUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function knowledge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return withoutUndefined({
    id: UUID_1,
    status: "active",
    scope: { system: "ucpath", element: "ucpath.smart-hr.save-submit" },
    title: "Save and Submit needs the ready state proven first",
    symptom: "The click lands on a disabled control and nothing is filed.",
    trigger: "Submitting before the transaction page reports ready.",
    rootCause: "The control is enabled asynchronously after validation returns.",
    invariant: "Prove ucpath.smart-hr.ready-to-submit before commit.",
    fix: "Wait for the page state, then commit through the mutation capability.",
    regressionScenarios: ["ucpath/submit-before-ready"],
    evidence: [EVIDENCE_A],
    verifiedAt: NOW,
    ...overrides,
  });
}

function fix(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return withoutUndefined({
    id: UUID_3,
    failureFingerprint: HASH_A,
    status: "verified",
    requestedBy: "claude",
    summary: "Wait for the ready page state before the submit click.",
    affected: ["ucpath.smart-hr.save-submit"],
    files: ["src/stores/ucpath/driver/smart-hr.ts"],
    scenarios: ["ucpath/submit-before-ready"],
    verification: [EVIDENCE_B],
    commit: COMMIT,
    createdAt: NOW,
    ...overrides,
  });
}

/** Frozen schema-41 adapter exercises historical semantics after live retirement. */
function serviceFor() {
  const history = new DatabaseSync(":memory:");
  for (const migration of SQLITE_MIGRATIONS.filter(m=>m.version<=41)) for(const statement of migration.statements)history.exec(statement);
  disposers.push(()=>history.close());
  const knowledgeRows=()=>history.prepare("SELECT record_json FROM knowledge_records ORDER BY created_at,record_key").all().map(row=>KnowledgeRecordSchema.parse(JSON.parse(String(row.record_json))));
  const fixRows=()=>history.prepare("SELECT record_json FROM fix_records ORDER BY created_at,record_key").all().map(row=>FixRecordSchema.parse(JSON.parse(String(row.record_json))));
  const service={
    recordKnowledge(candidate:unknown){
      const result=auditKnowledgeAdmission({candidate,existing:knowledgeRows()});
      if(result.state==="admit")history.prepare("INSERT INTO knowledge_records VALUES(?,?,?,?)").run(result.record.id,result.record.status,JSON.stringify(result.record),NOW);
      return result;
    },
    recordFix(candidate:unknown){
      const result=auditFixAdmission({candidate,existingFixes:fixRows(),knowledge:knowledgeRows()});
      if(result.state==="admit")history.prepare("INSERT INTO fix_records VALUES(?,?,?,?,?)").run(result.record.id,result.record.status,result.record.failureFingerprint ?? null,JSON.stringify(result.record),NOW);
      return result;
    },
    activeKnowledge:()=>activeKnowledgeView(knowledgeRows()),
    fixesForFailure:(fingerprint:string)=>fixRows().filter(row=>row.failureFingerprint===fingerprint),
    projectPages:()=>projectKnowledgePages(knowledgeRows()),
    writeKnowledgeProjection(root:string){
      const pages=projectKnowledgePages(knowledgeRows());
      for(const page of pages){const path=join(root,page.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,page.markdown);}
      return {pages};
    },
  };
  return {service,database:{authority:{knowledgeRecords:{get:(id:string)=>knowledgeRows().find(row=>row.id===id)}}}};
}

describe("F retired guidance authority",()=>{
 it("has neither live tables nor repository doors",()=>{
  const root=mkdtempSync(join(tmpdir(),"foundation-retired-guidance-"));
  const database=AuthorityDatabase.open({path:join(root,"state.db"),busyTimeoutMs:250,migrationOwner:"retirement-proof"},manualClock(new Date(NOW)));
  try {
   assert.equal("knowledgeRecords" in database.authority,false);assert.equal("fixRecords" in database.authority,false);
   const raw=new DatabaseSync(join(root,"state.db"),{readOnly:true});
   try{assert.deepEqual(raw.prepare("SELECT name FROM sqlite_master WHERE name IN ('knowledge_records','fix_records')").all(),[]);}finally{raw.close();}
  }finally{database.close();rmSync(root,{recursive:true,force:true});}
 });
});

describe("knowledge-fix-integrity: status, scope, evidence, and validity", () => {
  it("refuses a record whose status its own fields cannot support", () => {
    assert.equal(KnowledgeRecordSchema.safeParse(knowledge({ verifiedAt: undefined })).success, false);
    assert.equal(KnowledgeRecordSchema.safeParse(knowledge({ status: "superseded" })).success, false);
    assert.equal(KnowledgeRecordSchema.safeParse(knowledge({ scope: {} })).success, false);
    assert.equal(KnowledgeRecordSchema.safeParse(knowledge({ evidence: [] })).success, false);
    assert.equal(KnowledgeRecordSchema.safeParse(knowledge({ regressionScenarios: [] })).success, false);
    assert.equal(
      KnowledgeRecordSchema.safeParse(knowledge({ evidence: ["a lesson I wrote down"] })).success,
      false,
    );
  });

  it("admits a well-formed record and stores it", () => {
    const { service, database } = serviceFor();
    const admission = service.recordKnowledge(knowledge());
    assert.equal(admission.state, "admit");
    assert.ok(database.authority.knowledgeRecords.get(UUID_1));
    assert.deepEqual(service.activeKnowledge().map(({ id }) => id), [UUID_1]);
  });
});

describe("knowledge-fix-integrity: two active records cannot claim one scoped rule", () => {
  it("refuses an unlinked duplicate scope and names the conflict", () => {
    const { service } = serviceFor();
    service.recordKnowledge(knowledge());
    const duplicate = service.recordKnowledge(knowledge({
      id: UUID_2,
      title: "SAVE AND SUBMIT needs the ready state proven first",
    }));
    assert.equal(duplicate.state, "refuse");
    assert.equal(duplicate.state === "refuse" ? duplicate.reason : "", "unlinked-duplicate-scope");
    assert.deepEqual(duplicate.state === "refuse" ? duplicate.conflicts : [], [UUID_1]);
  });

  it("also treats a shared regression scenario in one scope as the same rule", () => {
    const { service } = serviceFor();
    service.recordKnowledge(knowledge());
    const overlapping = service.recordKnowledge(knowledge({
      id: UUID_2,
      title: "A completely different sentence",
    }));
    assert.equal(overlapping.state, "refuse");
  });

  it("admits the successor when it explicitly supersedes, and drops the predecessor from the view", () => {
    const { service } = serviceFor();
    service.recordKnowledge(knowledge());
    const successor = service.recordKnowledge(knowledge({
      id: UUID_2,
      title: "Save and Submit needs the ready state proven first",
      supersedes: [UUID_1],
    }));
    assert.equal(successor.state, "admit");
    assert.deepEqual(service.activeKnowledge().map(({ id }) => id), [UUID_2]);
  });

  it("refuses a supersedes ref that names nothing recorded, and a self-reference", () => {
    const { service } = serviceFor();
    const unknown = service.recordKnowledge(knowledge({ supersedes: [UUID_4] }));
    assert.equal(unknown.state === "refuse" ? unknown.reason : "", "supersedes-unknown");
    const itself = auditKnowledgeAdmission({
      candidate: KnowledgeRecordSchema.parse(knowledge({ supersedes: [UUID_1] })),
      existing: [],
    });
    assert.equal(itself.state === "refuse" ? itself.reason : "", "supersedes-self");
  });

  it("refuses a duplicate id whatever the existing record's status", () => {
    const { service } = serviceFor();
    service.recordKnowledge(knowledge({ status: "unverified", verifiedAt: undefined }));
    const again = service.recordKnowledge(knowledge());
    assert.equal(again.state === "refuse" ? again.reason : "", "duplicate-id");
  });
});

describe("knowledge-fix-integrity: a verified fix needs a commit and evidence", () => {
  it("refuses a verified fix without a commit or without evidence", () => {
    assert.equal(FixRecordSchema.safeParse(fix({ commit: undefined })).success, false);
    assert.equal(FixRecordSchema.safeParse(fix({ verification: [] })).success, false);
    assert.equal(FixRecordSchema.safeParse(fix({ scenarios: [] })).success, false);
  });

  it("refuses a draft that claims a commit or verification evidence", () => {
    assert.equal(FixRecordSchema.safeParse(fix({ status: "draft" })).success, false);
    assert.equal(
      FixRecordSchema.safeParse(fix({ status: "draft", commit: undefined, verification: [] })).success,
      true,
    );
  });

  it("refuses a verified fix that links knowledge which is not recorded or not itself authority", () => {
    const { service } = serviceFor();
    const missing = service.recordFix(fix({ knowledge: [UUID_1] }));
    assert.equal(missing.state === "refuse" ? missing.reason : "", "unknown-knowledge");

    service.recordKnowledge(knowledge({ status: "unverified", verifiedAt: undefined }));
    const unverified = service.recordFix(fix({ knowledge: [UUID_1] }));
    assert.equal(unverified.state === "refuse" ? unverified.reason : "", "unverified-knowledge");
  });

  it("admits a verified fix over recorded active knowledge and finds it by fingerprint", () => {
    const { service } = serviceFor();
    service.recordKnowledge(knowledge());
    const admitted = service.recordFix(fix({ knowledge: [UUID_1] }));
    assert.equal(admitted.state, "admit");
    assert.deepEqual(service.fixesForFailure(HASH_A).map(({ id }) => id), [UUID_3]);
    assert.equal(
      auditFixAdmission({ candidate: fix(), existingFixes: [fix()], knowledge: [] }).state,
      "refuse",
    );
  });
});

describe("knowledge-fix-integrity: raw lessons are migration input, never authority", () => {
  it("has no path from an appended lesson to a record", () => {
    const triage = triageLesson({
      title: "Kuali text gadgets debounce into the document model",
      body: "Measured 0/8 carried at 600ms and 8/8 at 700ms.",
      recordedOn: "2026-08-04",
    });
    assert.equal(triage.state, "needs-structure");
    assert.ok(triage.missing.includes("regressionScenarios"));
    assert.ok(triage.missing.includes("evidence"));
    // The union has exactly one arm; there is no `record` to reach for.
    assert.equal("record" in triage, false);
  });

  it("keeps superseded, retired, unverified, and lesson prose out of the generated guide", () => {
    const { service } = serviceFor();
    service.recordKnowledge(knowledge());
    service.recordKnowledge(knowledge({
      id: UUID_2,
      title: "Save and Submit needs the ready state proven first",
      supersedes: [UUID_1],
    }));
    service.recordKnowledge(knowledge({
      id: UUID_3,
      scope: { system: "kuali" },
      title: "Retired guidance",
      status: "retired",
      verifiedAt: undefined,
      regressionScenarios: ["kuali/retired-case"],
    }));
    service.recordKnowledge(knowledge({
      id: UUID_4,
      scope: { system: "crm" },
      title: "Unverified guidance",
      status: "unverified",
      verifiedAt: undefined,
      regressionScenarios: ["crm/unverified-case"],
    }));

    const root = mkdtempSync(join(tmpdir(), "hrauto-knowledge-out-"));
    disposers.push(() => rmSync(root, { recursive: true, force: true }));
    const result = service.writeKnowledgeProjection(root);
    assert.deepEqual(result.pages.map(({ path }) => path), ["knowledge/ucpath/KNOWLEDGE.md"]);

    const markdown = readFileSync(join(root, "knowledge/ucpath/KNOWLEDGE.md"), "utf8");
    // The superseded predecessor appears ONLY as the successor's `Supersedes`
    // provenance line, never as a record of its own.
    assert.ok(markdown.includes(`**Record:** \`${UUID_2}\``));
    assert.ok(!markdown.includes(`**Record:** \`${UUID_1}\``), "a superseded record may not reach the active guide");
    assert.equal(markdown.split("\n").filter((line) => line.startsWith("### ")).length, 1);
    assert.ok(!markdown.includes("Retired guidance"));
    assert.ok(!markdown.includes("Unverified guidance"));
    assert.ok(markdown.includes("active records only"));
    assert.ok(markdown.includes("Do not edit this file"));
  });

  it("renders an explicit empty page rather than an implied one", () => {
    const { service } = serviceFor();
    assert.deepEqual(service.projectPages(), []);
  });
});
