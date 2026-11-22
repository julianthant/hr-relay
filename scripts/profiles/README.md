# Staging and development copies

`npm run profile:staging` and `npm run profile:development` set up or update a copy. Run them from the production checkout while production keeps running; they only read production's verified backup files.

Each run:

1. Takes the profile's lifetime lock (staging 3942, development 3943) and holds it until done. A running copy dashboard, or another update, holds it, so the command refuses.
2. Fetches, then moves the copy's worktree to the one `origin/cut/*` (`~/Projects/hr-relay-staging`; several cuts need `--ref origin/cut/<name>`) or `origin/development` (`~/Projects/hr-relay-dev`). It creates the worktree when missing and refuses a dirty one.
3. Clears leftovers of an interrupted earlier copy, then copies each person's newest verified authority backup (database and manifest, checked against the manifest's size and SHA-256) into the profile's data folder. A person with no verified backup refuses the run. If production prunes a backup mid-copy the person's backups are re-listed; repeated pruning refuses. Backups hold no credentials or tokens; nothing else is copied.
4. Prints the profile, ref and SHA, ports, backups copied and the start command.

## Known gap: the copied backup cannot yet become the copy's store

A restore accepts a backup only when its installation and profile IDs equal the target's issued binding (`same-person-restore-candidate.ts`), and the manifest's source identity derives from those IDs. A fresh isolated installation mints new IDs, so the store refuses these backups; the only workarounds (copying production's installation files, or rewriting manifests) break custody and are not done. The copy therefore starts with its own empty store until a store-owned prerequisite exists: an offline "fork backup into a new installation" maintenance operation in the storage lane, which verifies the backup, mints the target's IDs inside the store's own transaction, drops credential, session and queued-run state, and writes a fresh verified manifest. Operator steps today: Duo sign-in in each copy.
