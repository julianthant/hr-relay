# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: archive-evidence.spec.ts >> paper-ink @ phone-390x844 >> verified archived capture evidence paper-ink @ phone-390x844
- Location: tests/parity/archive-evidence.spec.ts:122:5

# Error details

```
Error: a11y reference drift: archive-evidence--paper-ink--phone-390x844
  fixture: archive-evidence-verified  theme: paper-ink  viewport: phone-390x844  variant: default  adapter: fixture
  reference: /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/tests/parity/references/archive-evidence--paper-ink--phone-390x844.a11y.yml
  line 9:
    reference: - dialog "screenshot at cross-verify":
    actual:    - dialog "screenshot at ucpath-person":
  line 11:
    reference:     - heading "screenshot at cross-verify" [level=2]
    actual:        - heading "screenshot at ucpath-person" [level=2]
  line 12:
    reference:     - paragraph: Archived capture 1 of 1 on pl-090400-aa11.
    actual:        - paragraph: Archived capture 1 of 1 on pl-170002-9999.
  line 14:
    reference:   - paragraph: This viewer keeps the archive snapshot separate from the current byte check. What this capture was below is frozen; the availability state is verified only against that exact frozen id, digest, size and media type.
    actual:      - paragraph: This archive keeps the capture's POINTER facts frozen. The separate byte check is only for this exact archived id, digest, size and media type.
  line 15:
    reference:   - figure "Verified retained bytes for this frozen archived capture.":
    actual:      - figure "Archived capture preview":
  line 16:
    reference:     - img "Archived screenshot captured 2:11 AM"
    actual:        - img "Archived screenshot captured 10:00 AM"
  … further differences suppressed
The stored reference is the reviewed expectation, not a record of current
behaviour. If this change is intended, refresh it deliberately: npm run test:parity:update
```

# Test source

```ts
  50  | 
  51  | /**
  52  |  * Update mode, read from ONE place.
  53  |  *
  54  |  * An unrecognised value throws rather than being read as "off": a typo'd
  55  |  * `PARITY_UPDATE=yes` that silently asserted instead of refreshing would send
  56  |  * an operator chasing a diff they had already decided to accept.
  57  |  */
  58  | export function parityUpdateRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  59  |   const raw = env.PARITY_UPDATE;
  60  |   if (raw === undefined || raw.trim() === "" || raw === "0") return false;
  61  |   if (raw === "1") return true;
  62  |   throw new Error(`PARITY_UPDATE must be "1" (refresh) or unset/"0" (assert); got ${JSON.stringify(raw)}`);
  63  | }
  64  | 
  65  | /* ── rendering ───────────────────────────────────────────────────────────── */
  66  | 
  67  | /** The exact stored form of an a11y reference: provenance header + tree. */
  68  | export function renderA11yReference(tree: string, metadata: CaptureMetadata): string {
  69  |   const name = captureName(metadata);
  70  |   return [
  71  |     `# ${name}`,
  72  |     `# adapter: ${metadata.adapter}`,
  73  |     `# fixture: ${metadata.fixtureId}`,
  74  |     `# descriptorHash: ${metadata.descriptorHash}`,
  75  |     `# appVersion: ${metadata.appVersion}`,
  76  |     `# viewport: ${metadata.viewport}  theme: ${metadata.theme}  variant: ${metadata.variant}`,
  77  |     `# capturedAt: ${metadata.capturedAt}`,
  78  |     "",
  79  |     tree,
  80  |     "",
  81  |   ].join("\n");
  82  | }
  83  | 
  84  | export function renderMetadataReference(metadata: CaptureMetadata): string {
  85  |   return `${JSON.stringify(metadata, null, 2)}\n`;
  86  | }
  87  | 
  88  | /* ── comparison ──────────────────────────────────────────────────────────── */
  89  | 
  90  | const MAX_REPORTED_DIFFERENCES = 6;
  91  | 
  92  | function describeDifferences(reference: string, actual: string): string[] {
  93  |   const expectedLines = reference.split("\n");
  94  |   const actualLines = actual.split("\n");
  95  |   const lines: string[] = [];
  96  |   let reported = 0;
  97  |   for (let index = 0; index < Math.max(expectedLines.length, actualLines.length); index += 1) {
  98  |     if (expectedLines[index] === actualLines[index]) continue;
  99  |     reported += 1;
  100 |     if (reported > MAX_REPORTED_DIFFERENCES) {
  101 |       lines.push("  … further differences suppressed");
  102 |       break;
  103 |     }
  104 |     lines.push(`  line ${String(index + 1)}:`);
  105 |     lines.push(`    reference: ${expectedLines[index] ?? "<end of file>"}`);
  106 |     lines.push(`    actual:    ${actualLines[index] ?? "<end of file>"}`);
  107 |   }
  108 |   return lines;
  109 | }
  110 | 
  111 | function identity(metadata: CaptureMetadata): string {
  112 |   return `fixture: ${metadata.fixtureId}  theme: ${metadata.theme}  viewport: ${metadata.viewport}  variant: ${metadata.variant}  adapter: ${metadata.adapter}`;
  113 | }
  114 | 
  115 | export interface ReferenceComparison {
  116 |   readonly path: string;
  117 |   readonly kind: string;
  118 |   readonly metadata: CaptureMetadata;
  119 |   readonly actual: string;
  120 | }
  121 | 
  122 | /**
  123 |  * Asserts one stored reference file against freshly captured content, or —
  124 |  * only under an explicit update request — rewrites it.
  125 |  */
  126 | export function assertOrUpdateReferenceFile(
  127 |   input: ReferenceComparison & { readonly update: boolean },
  128 | ): void {
  129 |   if (input.update) {
  130 |     mkdirSync(dirname(input.path), { recursive: true });
  131 |     writeFileSync(input.path, input.actual);
  132 |     return;
  133 |   }
  134 | 
  135 |   const name = captureName(input.metadata);
  136 |   if (!existsSync(input.path)) {
  137 |     throw new Error(
  138 |       [
  139 |         `no stored ${input.kind} reference for ${name}`,
  140 |         `  ${identity(input.metadata)}`,
  141 |         `  expected file: ${input.path}`,
  142 |         `Mint it deliberately with: ${PARITY_UPDATE_COMMAND}`,
  143 |       ].join("\n"),
  144 |     );
  145 |   }
  146 | 
  147 |   const stored = readFileSync(input.path, "utf8");
  148 |   if (stored === input.actual) return;
  149 | 
> 150 |   throw new Error(
      |         ^ Error: a11y reference drift: archive-evidence--paper-ink--phone-390x844
  151 |     [
  152 |       `${input.kind} reference drift: ${name}`,
  153 |       `  ${identity(input.metadata)}`,
  154 |       `  reference: ${input.path}`,
  155 |       ...describeDifferences(stored, input.actual),
  156 |       "The stored reference is the reviewed expectation, not a record of current",
  157 |       `behaviour. If this change is intended, refresh it deliberately: ${PARITY_UPDATE_COMMAND}`,
  158 |     ].join("\n"),
  159 |   );
  160 | }
  161 | 
  162 | /**
  163 |  * The whole semantic half of a capture pair: the a11y tree and the provenance
  164 |  * record, both asserted (or both refreshed) together.
  165 |  */
  166 | export function assertOrUpdateParityReference(input: Readonly<{
  167 |   referencesDir: string;
  168 |   tree: string;
  169 |   metadata: CaptureMetadata;
  170 |   update?: boolean;
  171 | }>): void {
  172 |   const update = input.update ?? parityUpdateRequested();
  173 |   const name = captureName(input.metadata);
  174 |   assertOrUpdateReferenceFile({
  175 |     path: join(input.referencesDir, `${name}.a11y.yml`),
  176 |     kind: "a11y",
  177 |     metadata: input.metadata,
  178 |     actual: renderA11yReference(input.tree, input.metadata),
  179 |     update,
  180 |   });
  181 |   assertOrUpdateReferenceFile({
  182 |     path: join(input.referencesDir, `${name}.meta.json`),
  183 |     kind: "metadata",
  184 |     metadata: input.metadata,
  185 |     actual: renderMetadataReference(input.metadata),
  186 |     update,
  187 |   });
  188 | }
  189 | 
```
