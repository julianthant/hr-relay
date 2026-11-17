# Assistant

Dashboard assistant: allowlisted reads and proposals through the typed client. Only explicit operator confirmation dispatches a proposal.

## Sub-features

- Chat with source quotations; proposals showing subject, fingerprints, expiry, effects, stop point.
- `/assistant-model` reads the selected model and effort; `/assistant-model SLUG EFFORT` changes it.

## How to get to it (user POV)

Signed-in dashboard → assistant launcher (the panel starts closed). Needs a connected ChatGPT account in Settings.

## Driving it with playwright-cli

Open the launcher by snapshot ref, send `/assistant-model` and compare the reply with the composer's model control. Ask a read-only question about a visible run and check the answer's quoted sources and step names against Logs. Ask for a Separations dry-run proposal using a target's Kuali document number from `workflows.separations.publicInput.document` in `config/test-data.json` (not its test label) and read the proposal card. `/assistant-model SLUG EFFORT` only on operator say-so: it changes the saved choice.

## Passing dry run

The model/effort read matches the composer's model control. Answers cite sources and name steps as the Logs timeline shows them. The Separations proposal uses the test data's Kuali document number; its card shows effects and stop point, uses dry-run mode, and is left unconfirmed (or confirmed by the operator, never by the agent). No file attachment is accepted on setup commands.

## Gotchas

- An unreadable usage meter (`CHATGPT_USAGE_UNAVAILABLE`) still counts as signed in.
- Switching chats cancels a pending reply; drafts survive.
