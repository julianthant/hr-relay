# Assistant

Dashboard assistant: allowlisted reads and proposals through the typed client. Only explicit operator confirmation dispatches a proposal.

## Sub-features

- Chat with source quotations; proposals showing subject, fingerprints, expiry, effects, stop point.
- `/assistant-model` reads the selected model and effort; `/assistant-model SLUG EFFORT` changes it.
- `/verify-assistant` runs the explicit public probe.

## How to get to it (user POV)

Signed-in dashboard → assistant launcher (the panel starts closed). Needs a connected ChatGPT account in Settings.

## Driving it with playwright-cli

Open the launcher by snapshot ref, send `/assistant-model` and read the reply. Ask a read-only question about a visible run and check the answer's quoted sources. Ask for a proposal (for example a Separations dry run) and read the proposal card. `/verify-assistant` and `/assistant-model SLUG EFFORT` only on operator say-so: they spend usage and change settings.

## Passing dry run

The model/effort read matches Settings. Answers cite sources. The proposal card shows effects and stop point, uses dry-run mode, and is left unconfirmed (or confirmed by the operator, never by the agent). No file attachment is accepted on setup commands.

## Gotchas

- `CHATGPT_USAGE_UNAVAILABLE` allows composing but not confirming.
- Switching chats cancels a pending reply; drafts survive.
