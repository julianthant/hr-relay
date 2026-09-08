# Phase 4A · Next approved workflow

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## Admission
<!-- roadmap: workflow-admission -->

Record one selected candidate, verify its complete current-behavior and proposed-workflow admission
packet, and obtain operator approval before defining its migration tasks. This existing roadmap
placeholder does not admit a candidate. Later approved workflows receive 4B, 4C and onward.

Follow [workflow-model §1.6.2](../../../reference/workflow-model.md) and the
[roadmap's 4A node](../../../../roadmap/roadmap.md#workflow-admission).

### Background Check workflow discovery — 2026-09-08

The operator requested a live, collaborative walkthrough of the **Background Check** workflow,
calling it **Phase 4.1**, and asked that it be recorded in the timeline. This discovery is recorded
under the existing 4A admission owner. It does not yet establish the complete D319 admission packet,
change Phase 3 prerequisites, or authorize product implementation.

**Requested outcome.** Prepare a multiple-applicant background-check request for every applicant
whose **Date Background Entered** cell is highlighted yellow in the supplied student roster. Show
the completed submission workbook to the operator before submitting. Blank dates or accepted terms
alone must not be substituted for the operator's color-based selection.

**Sources.** The operator supplied `Background Check Request Form.pdf` (four pages),
`26-27 Student Applicants(Sept 28).csv`, and a SharePoint link to the original workbook. The CSV
contains 121 applicant records and no cell formatting; selection requires the original workbook.
Applicant data and authenticated browser artifacts remain outside committed documentation.

**Procedure described by the operator and PDF pages 1–2; live verification pending:**

1. Open `https://support.ucsd.edu/services` in headed Chrome, choose Human Resources, and search
   for `background check request`.
2. Choose **Human Resources Catalog → Talent Management → Talent Support Services – Request
   Forms**, described as requesting background checks, online reference checks, and/or skills
   assessments.
3. Select **Background Check Request**, then **Multiple Applicants (10 or more)** under
   **Background Check Request is for**. Advance to the workbook attachment step.
4. Download the current **Background Check Request for Multiple Users Workbook** and populate it
   with only the selected applicants. Inspect the current template before assigning fields.
5. Present the completed workbook to the operator for review before submission. The PDF's later
   attachment, Next, and Submit instructions describe the workflow; they do not override this
   session's review boundary.

| Workbook field | Value described in the supplied PDF |
| --- | --- |
| Job number | Catering: `10022932`; Residential & Retail: `10000954` (PDF says these vary) |
| Job title | Culinary & Market Services Residential & Retail |
| Department | HOUSING/ DINING/ HOSPITALITY |
| Project / Task | `1500819` / `1` |
| Hiring supervisor | Careen Cumper |
| Hiring supervisor email | `person@example.edu` |
| Selected service | Universal Background Check: Any Position Posted On Or After 12/1/24 (SB791 Compliance) |
| Report results to | Careen Cumper, `person@example.edu` |

**Current evidence and remaining discovery (updated 2026-09-08).** After operator sign-in, headed
Chrome session `background-check` reached the live Talent Support Services order guide, selected
Background Check Request and Multiple Applicants (10 or more), and advanced to Choose Options.
The expanded item requires a workbook attachment. Submitted By is the authenticated operator;
item-level Report Results to was set to the PDF's recipient and read back. The page has not advanced
to Summary or Submit.

The original SharePoint roster was downloaded with its formatting. Its Sept 28 sheet contains 121
applicants, of whom 87 have solid yellow (`FFFFFF00`) Date Background Entered cells. Their dates
are blank. Three orange cells contain prior-entry dates and are excluded. Color, rather than
visibility under the source table's current filter, determines membership. The selected cohort has
85 Residential/Retail applicants and two Catering applicants; the PDF's corresponding job numbers
were applied. There are no duplicate selected email addresses. One selected applicant has a blank
Accept Terms field, and two compound-name splits await operator confirmation in the private review.

The portal's current 19-column workbook was downloaded through **Create a Copy → Download a Copy**.
The operator explicitly required a copy and no edits to the shared original. The first separate
87-applicant copy retained native checkboxes, but Excel for the web did not display those controls.
The operator then supplied a compact example and requested matching cell sizes. The revised copy
uses that example's 18-column layout, exact column widths, 60-point blue header, 15-point body rows,
and alternating blue/white fills. It marks only the post-December-1-2024 SB791 service with a visible
`Y` for each of the 87 applicants, as in the example; other service cells are blank. All applicant
and fixed values were reconciled to the preceding verified copy, and the revised formatting and
visible selections were inspected in Excel for the web. Both shared originals remain unchanged.
Applicant-specific review notes and artifacts remain outside committed documentation.

The operator explicitly authorized uploading a browser review copy and attaching it without
submission. The revised copy is in the operator's OneDrive; its 14.2 KB workbook replaced the earlier
attachment in Choose Options. Operator review remains pending. No request was submitted; final
Summary state and receipt remain unverified. The PDF's two batch
pages were extracted and visually inspected.
The single-applicant branch (PDF pages 3–4), automated task/store boundaries, ordered tuple model,
resume/no-repeat-write mechanics and controlled proof targets remain outside this completed evidence.

## Shared capabilities assigned with 4A
<!-- roadmap: cross-cutting -->

Keep the current capability inventory and its dated evidence on the roadmap's `cross-cutting` node.
Assign implementation only through the verified admission packet under workflow-model §1.6.3;
creating this file does not change that scope, its completion claims, or its prerequisites.
