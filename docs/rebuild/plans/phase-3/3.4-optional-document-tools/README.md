# Phase 3.4 · Optional document tools and AI assistance

## Phase summary
<!-- roadmap: optional-document-tools -->

D342 (operator instruction, 2026-09-07) records these features as optional roadmap scope.
Every task is proposed and can be selected, deferred or skipped independently. None is a
prerequisite for Phase 3.5, Phase 4, cutover or ordinary dashboard operation. Existing mandatory
OCR/intake obligations owned elsewhere are not waived or duplicated by this optional track.

<!-- roadmap-status: optional-document-tools -->
- [?] select useful document features from the task menu; all may remain disabled or unbuilt
- [?] prove selected features against existing rules and measured operator benefit
> 2026-09-07 | D342 optional documents | scope recorded only; no feature, provider activation, model training or live document upload implemented
<!-- /roadmap-status -->

## Selection and execution

The slot follows closed Phase 3.3; it never modifies the candidate during 3.3's controlled proof.
If selected later, a feature uses the then-current implementation gates and records the candidate
it actually verifies; it cannot relabel old controlled-write evidence as proof of changed code.
Task numbers identify features, not a mandatory execution chain or an approved parallel plan.
A focused /phase-plan → /supervise assignment must bind each selected task's current scope,
dependencies, contracts, isolated checkout and gates before implementation.

For page-based features, reuse existing import/viewer/extraction capabilities where sufficient.
Tasks 3–11 need page text/provenance; Task 5 expands scope across files; Task 11 needs retrieval,
but keyword retrieval is sufficient and Tasks 9/10 are not compulsory. Task 14 needs a measured
baseline and verified corrections. A selected task owns its missing prerequisites without making
all other optional features mandatory. Task 13's applicable credential, cost and data controls are
required whenever any selected task calls a provider, even if its usage panel is not selected.

Local OCR is the first evaluation candidate, with Gemini and Mistral as optional comparison or
exception providers. Additional services are candidates only when a selected feature demonstrates
need; free-tier diversity is not a feature requirement. Models, quotas, prices, terms and hardware
compatibility must be verified at implementation time. No credentials belong in this plan.

## Governing boundaries

| Concern | Existing owner / requirement |
| --- | --- |
| OCR, form registry, field completeness, grouping, provenance and review | [Data intake contract](../../../reference/data-intake-and-edit-data.md), especially §4.3–§4.11 |
| Optional advice and retired AI surfaces | [Operator trust](../../../reference/operator-trust.md) §4.4; suggestions never become evidence or commands |
| API, UI, actor capability parity | [Frontend/backend integration](../../../reference/frontend-backend-integration.md); D338 and Phase 3.5 remain unchanged |
| Provider credentials and settings | [Clock/config/secrets](../../../reference/clock-config-secrets.md); secrets stay server-side |
| Writes and unknown outcomes | [Write safety](../../../reference/write-safety.md); no new HR transaction or approval authority |
| Implementation gates | [Guards and tests](../../../reference/guards-and-tests.md) D191 plus owning frontend/provider contracts |

## Task 1 · Evaluate and serve local OCR
<!-- roadmap: optional-local-ocr -->

**Optional; proposed.** Compare pretrained local OCR against selected Gemini/Mistral readings on a representative, verified corpus; integrate a private authenticated PC endpoint only if useful.

<!-- roadmap-status: optional-local-ocr -->
- [?] Measure field accuracy, missed pages, handwriting errors, review time and latency on the operator's 7800X3D / RTX 5080 / 32 GB RAM PC; record software/model versions and hardware limits.
- [?] Preserve the existing extraction admission and provenance; PC unavailability is explicit, with no silent cloud fallback. No model training or hardware purchase is required.
<!-- /roadmap-status -->

## Task 2 · Upload and inspect PDF pages
<!-- roadmap: optional-pdf-viewer -->

**Optional; proposed.** Add a page-preserving PDF viewer and import path using existing embedded text where trustworthy and OCR for scanned pages.

<!-- roadmap-status: optional-pdf-viewer -->
- [?] Preserve original artifact identity, page numbers, text provenance and available word coordinates; show page previews and extraction progress.
- [?] Distinguish unreadable, failed and unprocessed pages from successfully searched pages; no omitted page can appear as a successful empty result.
<!-- /roadmap-status -->

## Task 3 · Find words and phrases in a PDF
<!-- roadmap: optional-page-search -->

**Optional; proposed.** Search extracted text locally and open the matching source page with snippets and highlights where coordinates exist.

<!-- roadmap-status: optional-page-search -->
- [?] Support names, words and phrases with explicit matching behavior; exact search needs no embedding model or hosted AI.
- [?] Retain source-page links and visible coverage gaps; test multiple matches, empty results, OCR errors and missing coordinate data.
<!-- /roadmap-status -->

## Task 4 · Export selected PDF pages
<!-- roadmap: optional-page-export -->

**Optional; proposed.** Select pages manually or from search results and export them as a new PDF.

<!-- roadmap-status: optional-page-export -->
- [?] Preserve selected page order and content; keep source-to-output page mapping and original files intact.
- [?] Use ordinary PDF processing; selection and export require no model or search-by-meaning feature.
<!-- /roadmap-status -->

## Task 5 · Search across uploaded documents
<!-- roadmap: optional-document-library -->

**Optional; proposed.** Index retained page text across selected files or a document library, with explicit scope controls.

<!-- roadmap-status: optional-document-library -->
- [?] Scope results to this PDF, selected documents or the authorized library; link every result to its file and page.
- [?] Honor deletion, retention and permissions in text/index/cache artifacts; avoid duplicate OCR for unchanged documents.
<!-- /roadmap-status -->

## Task 6 · Classify forms and group packets
<!-- roadmap: optional-document-classify -->

**Optional; proposed.** Suggest form types and page groupings for mixed HR document stacks.

<!-- roadmap-status: optional-document-classify -->
- [?] Recognize declared form types and show unknown, ambiguous, incomplete or mixed-person groups for review.
- [?] Reuse the form registry and grouping contracts; model confidence never establishes employee identity or admits another workflow.
<!-- /roadmap-status -->

## Task 7 · Review structured field extraction
<!-- roadmap: optional-document-extract -->

**Optional; proposed.** Display extracted HR fields beside their source pages and accept explicit corrections through the existing intake rules.

<!-- roadmap-status: optional-document-extract -->
- [?] Preserve every declared field, typed blank/not-on-form/illegible outcomes, page provenance and ordinary validation.
- [?] Treat model results as proposed readings; review and downstream workflow gates retain their existing authority.
<!-- /roadmap-status -->

## Task 8 · Reread difficult fields and compare readings
<!-- roadmap: optional-document-reread -->

**Optional; proposed.** Request a second reading of a selected page or field using an eligible local, Gemini or Mistral model.

<!-- roadmap-status: optional-document-reread -->
- [?] Show each provider/model and the original source; preserve conflicting readings instead of silently choosing or repairing values.
- [?] Use cloud only when explicitly configured for the data and operation; retain human correction as a provider-independent route.
<!-- /roadmap-status -->

## Task 9 · Find pages by meaning
<!-- roadmap: optional-semantic-search -->

**Optional; proposed.** Retrieve passages for concept-based queries such as leaving employment even when the document says separation.

<!-- roadmap-status: optional-semantic-search -->
- [?] Evaluate a local embedding model and optional Cohere, Cloudflare or Voyage alternatives only against a measured search need.
- [?] Bind each index and query to compatible versioned embeddings; changing models requires explicit compatible routing or re-indexing, not quota-driven vector mixing.
<!-- /roadmap-status -->

## Task 10 · Rank search results by relevance
<!-- roadmap: optional-search-rerank -->

**Optional; proposed.** Optionally rerank retrieved passages to put more useful pages first.

<!-- roadmap-status: optional-search-rerank -->
- [?] Compare relevance against the existing search baseline; local ranking, Cohere or another tested service are options, not required dependencies.
- [?] Keep original matches and citations; reranker failure must not fabricate a result or conceal an incomplete search.
<!-- /roadmap-status -->

## Task 11 · Ask document questions with page citations
<!-- roadmap: optional-document-questions -->

**Optional; proposed.** Answer questions from retrieved passages within the selected document scope.

<!-- roadmap-status: optional-document-questions -->
- [?] Link substantive answer claims to supporting pages and say when the documents do not contain enough information; evaluate unsupported claims and missed evidence.
- [?] An eligible local model, Gemini or a tested hosted text provider may compose answers; document text is untrusted content, never instructions granting tools or write authority.
<!-- /roadmap-status -->

## Task 12 · Evaluate focused failure assistance
<!-- roadmap: optional-failure-assistance -->

**Optional; proposed.** Assess the existing on-demand failure advice and improve it only if it reduces operator effort.

<!-- roadmap-status: optional-failure-assistance -->
- [?] Reuse redacted failure evidence and existing advisory boundaries; measure useful advice against the deterministic failure display.
- [?] No autonomous dashboard agent, duplicate AI run summary, AI identity verdict or revived retired sanity-check surface is admitted.
<!-- /roadmap-status -->

## Task 13 · Control optional providers and view usage
<!-- roadmap: optional-provider-controls -->

**Optional; proposed.** Make eligible OCR/search/advisory providers explicit and show observed usage and availability.

<!-- roadmap-status: optional-provider-controls -->
- [?] Local-first operation, per-capability enablement, server-side credentials, approved data handling, observed quota/reset information and provider/model attribution; unknown quota remains unknown.
- [?] Honor actual project/account quotas, Retry-After and explicit cost ceilings; no paid spillover, account multiplication assumption or indiscriminate cross-provider document forwarding. All hosted providers can remain disabled.
<!-- /roadmap-status -->

## Task 14 · Evaluate OCR fine-tuning from verified corrections
<!-- roadmap: optional-ocr-finetuning -->

**Optional; proposed.** Consider a small model adaptation only if a pretrained baseline has persistent, measurable form-reading errors.

<!-- roadmap-status: optional-ocr-finetuning -->
- [?] Use verified image/answer pairs, synthetic or de-identified examples where suitable, and held-out people/document packets; raw PDFs or unchecked model output are not ground truth.
- [?] Measure generalization and regressions; verify memory/license/data suitability before training. No automatic learning from corrections, mandatory training or training from scratch.
<!-- /roadmap-status -->

## Task 15 · Find public instructions with citations
<!-- roadmap: optional-public-instructions -->

**Optional; proposed.** Optionally search approved public sources alongside the private document library.

<!-- roadmap-status: optional-public-instructions -->
- [?] Keep web and uploaded-document scopes distinct, label source dates and cite official instructions; Tavily is one candidate only if a public-web feature is selected.
- [?] Never send employee identifiers or private document content as web queries; external instructions do not change workflow rules or approve actions.
<!-- /roadmap-status -->

## Completion policy

This part has no all-features release gate. For each selected feature, record the actual provider
and artifact boundaries, accuracy/retrieval evidence where applicable, required checks, independent
implementation review and cleanup. Deferred or skipped features stay visibly unbuilt; skipping is
never reported as implementation success. Existing functionality remains usable with all optional
features disabled. A later operator decision can select more work without reopening completed 3.3
acceptance or blocking the required 3.5 cooperation proof.
