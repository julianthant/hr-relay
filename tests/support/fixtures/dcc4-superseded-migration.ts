/**
 * Exact source-lineage bytes from DCC4 commit 68386456 migration v19.
 * D290 supersedes this suffix: it is never part of the integrated registry,
 * but remains executable here so open-time refusal is proven against the
 * actual divergent schema rather than a synthetic version-number stub.
 */
export const DCC4_SUPERSEDED_V19_MIGRATION = Object.freeze({
  version: 19,
  statements: Object.freeze([
    "\n    CREATE TABLE explorer_edit_reviews (\n      record_key TEXT PRIMARY KEY,\n      workflow TEXT NOT NULL,\n      draft_fingerprint TEXT NOT NULL,\n      state TEXT NOT NULL CHECK (state IN ('issued','consumed')),\n      expires_at TEXT NOT NULL,\n      consumed_by TEXT REFERENCES commands(record_key) ON DELETE RESTRICT,\n      record_json TEXT NOT NULL CHECK (json_valid(record_json)),\n      created_at TEXT NOT NULL,\n      CHECK ((state = 'consumed') = (consumed_by IS NOT NULL))\n    ) STRICT\n  ",
    "\n    CREATE TABLE explorer_edit_outbox (\n      record_key TEXT PRIMARY KEY REFERENCES commands(record_key) ON DELETE RESTRICT,\n      review_token_id TEXT NOT NULL UNIQUE REFERENCES explorer_edit_reviews(record_key) ON DELETE RESTRICT,\n      workflow TEXT NOT NULL,\n      revision INTEGER NOT NULL CHECK (revision >= 1),\n      state TEXT NOT NULL CHECK (state IN ('pending','projected')),\n      record_json TEXT NOT NULL CHECK (json_valid(record_json)),\n      created_at TEXT NOT NULL,\n      UNIQUE (workflow, revision)\n    ) STRICT\n  ",
    "CREATE INDEX explorer_edit_reviews_workflow_state_idx ON explorer_edit_reviews(workflow, state, expires_at)",
    "CREATE INDEX explorer_edit_outbox_workflow_state_idx ON explorer_edit_outbox(workflow, state, revision)",
    "CREATE TRIGGER explorer_edit_reviews_lifecycle_update\n        BEFORE UPDATE ON explorer_edit_reviews\n        WHEN OLD.state <> 'issued' OR NEW.state <> 'consumed'\n          OR NEW.record_key IS NOT OLD.record_key\n          OR NEW.workflow IS NOT OLD.workflow\n          OR NEW.draft_fingerprint IS NOT OLD.draft_fingerprint\n          OR NEW.expires_at IS NOT OLD.expires_at\n          OR NEW.created_at IS NOT OLD.created_at\n        BEGIN SELECT RAISE(ABORT, 'Explorer review token may transition once from issued to consumed'); END",
    "CREATE TRIGGER explorer_edit_reviews_never_deleted\n        BEFORE DELETE ON explorer_edit_reviews\n        BEGIN SELECT RAISE(ABORT, 'Explorer review tokens are never deleted'); END",
    "CREATE TRIGGER explorer_edit_outbox_lifecycle_update\n        BEFORE UPDATE ON explorer_edit_outbox\n        WHEN OLD.state <> 'pending' OR NEW.state <> 'projected'\n          OR NEW.record_key IS NOT OLD.record_key\n          OR NEW.review_token_id IS NOT OLD.review_token_id\n          OR NEW.workflow IS NOT OLD.workflow\n          OR NEW.revision IS NOT OLD.revision\n          OR NEW.created_at IS NOT OLD.created_at\n        BEGIN SELECT RAISE(ABORT, 'Explorer projection outbox may transition once from pending to projected'); END",
    "CREATE TRIGGER explorer_edit_outbox_never_deleted\n        BEFORE DELETE ON explorer_edit_outbox\n        BEGIN SELECT RAISE(ABORT, 'Explorer projection outbox rows are never deleted'); END",
  ]),
} as const);
