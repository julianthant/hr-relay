import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { ASSISTANT_START_ROWS_MAX, AssistantM2ProposalRecordSchema, AssistantM2ProposalSnapshotSchema, AssistantM2RowResultSchema, AssistantSessionClaimSchema, AssistantSessionOutcomeSchema,
  type AssistantM2ProposalRecord, type AssistantM2ProposalSnapshot } from "../../../models/dashboard/assistant.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { assistantM1MessageFromRow, type AssistantM1Attempt, type AssistantM1HistoryRepository } from "./assistant-history.js";

/** Candidate migration (renumbered when staging merges); installed only by the stopped activation owner. */
export const ASSISTANT_M2_PROPOSAL_STATEMENTS = Object.freeze([
  `CREATE TABLE assistant_proposals (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK(revision>0), rendered_message_id TEXT NOT NULL UNIQUE, rendered_digest TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('open','answered','superseded')), answer_message_id TEXT UNIQUE,
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), created_at TEXT NOT NULL,
    CHECK((state='answered')=(answer_message_id IS NOT NULL))
  ) STRICT`,
  "CREATE UNIQUE INDEX assistant_proposals_one_open ON assistant_proposals(conversation_id) WHERE state='open'",
  `CREATE TRIGGER assistant_proposals_answer_once BEFORE UPDATE ON assistant_proposals
    WHEN NOT (OLD.state='open' AND NEW.state IN ('answered','superseded') AND NEW.id=OLD.id AND NEW.conversation_id=OLD.conversation_id
      AND NEW.revision=OLD.revision AND NEW.rendered_message_id=OLD.rendered_message_id AND NEW.rendered_digest=OLD.rendered_digest
      AND NEW.snapshot_json=OLD.snapshot_json AND NEW.created_at=OLD.created_at)
    BEGIN SELECT RAISE(ABORT,'assistant-proposal-immutable'); END`,
  `CREATE TABLE assistant_proposal_rows (
    id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES assistant_proposals(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND ${String(ASSISTANT_START_ROWS_MAX)}), command_id TEXT UNIQUE,
    state TEXT NOT NULL CHECK(state IN ('not-started','claimed','applied','refused','unknown')),
    result_json TEXT NOT NULL CHECK(json_valid(result_json)), UNIQUE(proposal_id,ordinal),
    CHECK(state IN ('not-started','refused') OR command_id IS NOT NULL), CHECK(state<>'not-started' OR command_id IS NULL)
  ) STRICT`,
  `CREATE TRIGGER assistant_proposal_rows_settle_once BEFORE UPDATE ON assistant_proposal_rows
    WHEN NOT (NEW.id=OLD.id AND NEW.proposal_id=OLD.proposal_id AND NEW.ordinal=OLD.ordinal
      AND ((OLD.state='not-started' AND NEW.state IN ('claimed','refused') AND (NEW.state='refused' OR NEW.command_id IS NOT NULL))
        OR (OLD.state='claimed' AND NEW.state IN ('applied','refused','unknown') AND NEW.command_id IS OLD.command_id)))
    BEGIN SELECT RAISE(ABORT,'assistant-proposal-row-immutable'); END`,
  `CREATE TABLE assistant_session_claims (
    action_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    accepted_message_id TEXT NOT NULL, request_digest TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK(state IN ('claimed','started','refused','unknown')),
    claim_json TEXT NOT NULL CHECK(json_valid(claim_json)), outcome_json TEXT NOT NULL CHECK(json_valid(outcome_json)),
    UNIQUE(accepted_message_id,request_digest)
  ) STRICT`,
  `CREATE TRIGGER assistant_session_claims_settle_once BEFORE UPDATE ON assistant_session_claims
    WHEN NOT (OLD.state='claimed' AND NEW.state IN ('started','refused','unknown') AND NEW.action_id=OLD.action_id AND NEW.conversation_id=OLD.conversation_id
      AND NEW.accepted_message_id=OLD.accepted_message_id AND NEW.request_digest=OLD.request_digest AND NEW.command_id=OLD.command_id AND NEW.claim_json=OLD.claim_json)
    BEGIN SELECT RAISE(ABORT,'assistant-session-claim-immutable'); END`,
]);

type Table = "assistant_proposals" | "assistant_proposal_rows" | "assistant_session_claims";
interface Ports {
  database: DatabaseSync;
  profileId(): string;
  read<T>(work: () => T): T;
  mutate<T>(table: Table, work: () => Readonly<{ result: T; changes: number }>): T;
  /** The M1 owner's live accepted-attempt check (retained attempt, epoch, conversation lifetime). */
  readonly accepted: Pick<AssistantM1HistoryRepository, "sending">;
}
const ProposalRowSchema = z.strictObject({ id: z.uuid(), conversation_id: z.uuid(), revision: z.number(), rendered_message_id: z.uuid(), rendered_digest: z.string(),
  state: z.string(), answer_message_id: z.string().nullable(), snapshot_json: z.string(), created_at: z.string() });
const ResultRowSchema = z.strictObject({ id: z.uuid(), state: z.string(), command_id: z.string().nullable(), result_json: z.string() });
const ClaimRowSchema = z.strictObject({ state: z.string(), claim_json: z.string(), outcome_json: z.string() });

/** Prepared durable owner of proposal snapshots, answer and row claims, and session claims; one dispatch per row or claim. */
export function createAssistantProposalRepository(ports: Ports) {
  const { database } = ports;
  const conflict = (reason: string): never => { throw new Error(`assistant-proposal-${reason}`); };
  const owned = (conversationId: string) => {
    const row = database.prepare("SELECT profile_id FROM assistant_conversations WHERE id=?").get(conversationId);
    if (z.object({ profile_id: z.uuid() }).safeParse(row).data?.profile_id !== ports.profileId()) conflict("conversation-not-owned");
  };
  const message = (id: string) => {
    const raw = database.prepare("SELECT * FROM assistant_messages WHERE id=?").get(id);
    return raw === undefined ? undefined : assistantM1MessageFromRow(raw);
  };
  /** The accepted operator message that answered `snapshot`: its own live accepted turn, bound to exactly this proposal. */
  const answeredBy = (snapshot: AssistantM2ProposalSnapshot, answerMessageId: string) => {
    const answer = message(answerMessageId), recording = answer?.payload.recording;
    if (answer?.conversationId !== snapshot.conversationId || recording?.kind !== "accepted-turn") return undefined;
    const turn = recording.acceptedTurn;
    return turn.messageId === answer.id && turn.conversationId === snapshot.conversationId && turn.profileId === ports.profileId()
      && canonicalJsonStringify(turn.proposalAnswer) === canonicalJsonStringify({ proposalId: snapshot.id, proposalRevision: snapshot.revision,
        renderedMessageId: snapshot.renderedMessageId, renderedDigest: snapshot.renderedDigest }) ? answer : undefined;
  };
  const record = (raw: unknown): AssistantM2ProposalRecord => {
    const row = ProposalRowSchema.parse(raw), snapshot = AssistantM2ProposalSnapshotSchema.parse(JSON.parse(row.snapshot_json));
    if (snapshot.id !== row.id || snapshot.conversationId !== row.conversation_id || snapshot.revision !== row.revision || snapshot.renderedMessageId !== row.rendered_message_id
      || snapshot.renderedDigest !== row.rendered_digest || snapshot.createdAt !== row.created_at || snapshot.profileId !== ports.profileId()) conflict("record-invalid");
    const results = database.prepare("SELECT id,state,command_id,result_json FROM assistant_proposal_rows WHERE proposal_id=? ORDER BY ordinal").all(row.id).map(raw => {
      const result = ResultRowSchema.parse(raw), parsed = AssistantM2RowResultSchema.parse(JSON.parse(result.result_json));
      if (parsed.state !== result.state || ("commandId" in parsed ? parsed.commandId : null) !== result.command_id) conflict("row-invalid");
      return { rowId: result.id, result: parsed };
    });
    if (canonicalJsonStringify(results.map(entry => entry.rowId)) !== canonicalJsonStringify(snapshot.rows.map(entry => entry.id))) conflict("rows-invalid");
    if (row.state === "answered" && (row.answer_message_id === null || answeredBy(snapshot, row.answer_message_id) === undefined)) conflict("answer-invalid");
    return AssistantM2ProposalRecordSchema.parse({ snapshot, rows: results,
      lifecycle: row.state === "answered" ? { state: "answered", answerMessageId: row.answer_message_id } : { state: row.state } });
  };
  const find = (id: string) => {
    const raw = database.prepare("SELECT * FROM assistant_proposals WHERE id=?").get(z.uuid().parse(id));
    return raw === undefined ? undefined : record(raw);
  };
  const claimRecord = (raw: unknown) => {
    const row = ClaimRowSchema.parse(raw), claim = AssistantSessionClaimSchema.parse(JSON.parse(row.claim_json)), outcome = AssistantSessionOutcomeSchema.parse(JSON.parse(row.outcome_json));
    if (outcome.state !== row.state || claim.acceptedTurn.profileId !== ports.profileId()) conflict("session-claim-invalid");
    return Object.freeze({ claim, outcome });
  };
  /** The durable session claim port (`AssistantSessionClaims`). */
  const sessions = {
    claim(input: z.input<typeof AssistantSessionClaimSchema>) {
      const claim = AssistantSessionClaimSchema.parse(input);
      if (claim.acceptedTurn.profileId !== ports.profileId()) conflict("session-claim-not-owned");
      return ports.mutate("assistant_session_claims", () => {
        owned(claim.acceptedTurn.conversationId);
        const inserted = database.prepare(`INSERT INTO assistant_session_claims(action_id,conversation_id,accepted_message_id,request_digest,command_id,state,claim_json,outcome_json)
          VALUES(?,?,?,?,?,'claimed',?,?) ON CONFLICT DO NOTHING`).run(claim.actionId, claim.acceptedTurn.conversationId, claim.acceptedTurn.messageId, claim.requestDigest,
          claim.command.commandId, canonicalJsonStringify(claim), canonicalJsonStringify({ state: "claimed" }));
        return { result: inserted.changes === 1, changes: Number(inserted.changes) };
      });
    },
    settle(actionId: string, input: Exclude<z.input<typeof AssistantSessionOutcomeSchema>, { state: "claimed" }>) {
      const outcome = AssistantSessionOutcomeSchema.parse(input);
      ports.mutate("assistant_session_claims", () => {
        const updated = database.prepare("UPDATE assistant_session_claims SET state=?,outcome_json=? WHERE action_id=? AND state='claimed'")
          .run(outcome.state, canonicalJsonStringify(outcome), z.uuid().parse(actionId));
        if (updated.changes !== 1) conflict("session-claim-not-claimed");
        return { result: undefined, changes: 1 };
      });
    },
    byCommand(commandId: string) {
      return ports.read(() => {
        const raw = database.prepare("SELECT state,claim_json,outcome_json FROM assistant_session_claims WHERE command_id=?").get(z.uuid().parse(commandId));
        return raw === undefined ? undefined : claimRecord(raw);
      });
    },
  };
  return Object.freeze({
    sessions,
    /** Records a rendered proposal and supersedes the chat's earlier open one. */
    issue(input: AssistantM2ProposalSnapshot): AssistantM2ProposalRecord {
      const snapshot = AssistantM2ProposalSnapshotSchema.parse(input);
      if (snapshot.profileId !== ports.profileId()) conflict("not-owned");
      return ports.mutate("assistant_proposals", () => {
        owned(snapshot.conversationId);
        // The rendered message is this chat's latest message: the reply of the turn that proposed it.
        const rendered = message(snapshot.renderedMessageId), latest = z.object({ ordinal: z.number().int() })
          .parse(database.prepare("SELECT MAX(ordinal) AS ordinal FROM assistant_messages WHERE conversation_id=?").get(snapshot.conversationId)).ordinal;
        if (rendered?.conversationId !== snapshot.conversationId || rendered.payload.recording.kind !== "reply"
          || rendered.payload.recording.acceptedMessageId !== snapshot.sourceMessageId || rendered.ordinal !== latest) conflict("rendered-message-invalid");
        const superseded = database.prepare("UPDATE assistant_proposals SET state='superseded' WHERE conversation_id=? AND state='open'").run(snapshot.conversationId);
        database.prepare(`INSERT INTO assistant_proposals(id,conversation_id,revision,rendered_message_id,rendered_digest,state,answer_message_id,snapshot_json,created_at)
          VALUES(?,?,?,?,?,'open',NULL,?,?)`).run(snapshot.id, snapshot.conversationId, snapshot.revision, snapshot.renderedMessageId, snapshot.renderedDigest,
          canonicalJsonStringify(snapshot), snapshot.createdAt);
        const insertRow = database.prepare("INSERT INTO assistant_proposal_rows(id,proposal_id,ordinal,command_id,state,result_json) VALUES(?,?,?,NULL,'not-started',?)");
        for (const row of snapshot.rows) insertRow.run(row.id, snapshot.id, row.ordinal, canonicalJsonStringify({ state: "not-started" }));
        const issued = find(snapshot.id) ?? conflict("issue-unproved");
        return { result: issued, changes: 1 + snapshot.rows.length + Number(superseded.changes) };
      });
    },
    read: (id: string) => ports.read(() => find(id)),
    /** The chat's open proposal: the only one the next operator message can answer. */
    open(conversationId: string) {
      return ports.read(() => {
        const raw = database.prepare("SELECT * FROM assistant_proposals WHERE conversation_id=? AND state='open'").get(z.uuid().parse(conversationId));
        return raw === undefined ? undefined : record(raw);
      });
    },
    /** Moves the exact reviewed open proposal to answered once, by the live accepted attempt right after its rendered reply; false otherwise. */
    claimAnswer(input: Readonly<{ proposalId: string; proposalRevision: number; renderedMessageId: string; renderedDigest: string; attempt: AssistantM1Attempt; now: string }>): boolean {
      const answerMessageId = input.attempt.acceptedTurn.messageId;
      return ports.mutate("assistant_proposals", () => {
        const shown = find(input.proposalId), answer = shown === undefined ? undefined : answeredBy(shown.snapshot, answerMessageId);
        const rendered = shown === undefined ? undefined : message(shown.snapshot.renderedMessageId);
        if (shown === undefined || answer === undefined || rendered === undefined || answer.ordinal !== rendered.ordinal + 1
          || canonicalJsonStringify(answer.payload.recording.kind === "accepted-turn" ? answer.payload.recording.acceptedTurn : null) !== canonicalJsonStringify(input.attempt.acceptedTurn)
          || !ports.accepted.sending(input.attempt, input.now)) return { result: false, changes: 0 };
        owned(shown.snapshot.conversationId);
        const updated = database.prepare(`UPDATE assistant_proposals SET state='answered',answer_message_id=?
          WHERE id=? AND state='open' AND revision=? AND rendered_message_id=? AND rendered_digest=?`)
          .run(answerMessageId, z.uuid().parse(input.proposalId), input.proposalRevision, z.uuid().parse(input.renderedMessageId), input.renderedDigest);
        return { result: updated.changes === 1, changes: Number(updated.changes) };
      });
    },
    /** Any non-yes operator message is a change request: the open proposal can no longer be answered. */
    supersede(conversationId: string): void {
      ports.mutate("assistant_proposals", () => {
        const updated = database.prepare("UPDATE assistant_proposals SET state='superseded' WHERE conversation_id=? AND state='open'").run(z.uuid().parse(conversationId));
        return { result: undefined, changes: Number(updated.changes) };
      });
    },
    /** Claims one row of an answered proposal for its own command; false when that row was already claimed or settled. */
    claimRow(proposalId: string, rowId: string, commandId: string): boolean {
      return ports.mutate("assistant_proposal_rows", () => {
        if (find(proposalId)?.lifecycle.state !== "answered") conflict("not-answered");
        const result = AssistantM2RowResultSchema.parse({ state: "claimed", commandId });
        if (result.state !== "claimed") return conflict("row-claim-invalid");
        const updated = database.prepare("UPDATE assistant_proposal_rows SET state='claimed',command_id=?,result_json=? WHERE id=? AND proposal_id=? AND state='not-started'")
          .run(result.commandId, canonicalJsonStringify(result), z.uuid().parse(rowId), proposalId);
        return { result: updated.changes === 1, changes: Number(updated.changes) };
      });
    },
    /** Settles a claimed row, or refuses a row before its claim; any other prior state throws. */
    settleRow(proposalId: string, rowId: string, input: Exclude<z.input<typeof AssistantM2RowResultSchema>, { state: "not-started" | "claimed" }>): void {
      const result = AssistantM2RowResultSchema.parse(input);
      if (result.state === "not-started" || result.state === "claimed") return conflict("row-settlement-invalid");
      ports.mutate("assistant_proposal_rows", () => {
        const updated = result.state === "refused" && result.commandId === null
          ? database.prepare("UPDATE assistant_proposal_rows SET state='refused',result_json=? WHERE id=? AND proposal_id=? AND state='not-started'")
            .run(canonicalJsonStringify(result), z.uuid().parse(rowId), proposalId)
          : database.prepare("UPDATE assistant_proposal_rows SET state=?,result_json=? WHERE id=? AND proposal_id=? AND state='claimed' AND command_id=?")
            .run(result.state, canonicalJsonStringify(result), z.uuid().parse(rowId), proposalId, result.commandId);
        if (updated.changes !== 1) conflict("row-not-claimable");
        return { result: undefined, changes: 1 };
      });
    },
    /** Whether `commandId` belongs to a proposal row; the effect hook admits such a command only inside its own claim. */
    hasRowCommand(commandId: string): boolean {
      return ports.read(() => database.prepare("SELECT 1 FROM assistant_proposal_rows WHERE command_id=?").get(z.uuid().parse(commandId)) !== undefined);
    },
    /** Open proposals waiting on this profile's operator in unexpired chats: the served needs-you count. */
    needsYou(now: string): number {
      return ports.read(() => z.object({ count: z.number().int().nonnegative() }).parse(database.prepare(`SELECT COUNT(*) AS count FROM assistant_proposals p
        JOIN assistant_conversations c ON c.id=p.conversation_id WHERE p.state='open' AND c.profile_id=? AND c.expires_at>?`).get(ports.profileId(), now)).count);
    },
  });
}
export type AssistantProposalRepository = ReturnType<typeof createAssistantProposalRepository>;
