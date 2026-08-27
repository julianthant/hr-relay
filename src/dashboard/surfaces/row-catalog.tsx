/**
 * The row-and-panel VOCABULARY view of the catalog takeover (D274 item 4).
 *
 * The demo's counterpart is `DemoCatalogView.tsx` (legacy commit `1bffbd6`,
 * `src/dashboard/components/dev/rebuild-demo/`), and the port is deliberately
 * partial: every kind drawn here is read off a schema by
 * `row-catalog-model.ts`, and the four things the demo names that this build
 * cannot serve are drawn too — as a named-absence section, not as silence.
 *
 * The specimen chrome IS the demo's, because the page's job is to show what
 * this system's shapes look like: the flex-column card so a grid of specimens
 * ends on one line, the recessed neutral chip for a code or a step, and the
 * panel tab strip drawn with the SAME underline treatment the real Log Panel
 * uses — a specimen showing a control the product does not have teaches the
 * wrong thing.
 */
import type { ReactNode } from "react";
import { Layers, LayoutList, Link2, PanelRight } from "lucide-react";
import {
  CardBase,
  SectionLabel,
  dsBorder,
  dsClip,
  dsIcon,
  dsRadius,
  dsSurface,
  dsText,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import {
  ROLLUP_COUNTS,
  UNSERVED_VOCABULARY,
  containmentSpecs,
  panelKindSpecs,
  rowSurfaceSpecs,
} from "./row-catalog-model.js";

/**
 * One specimen card. A flex COLUMN because the cards sit in grids and stretch
 * to their row's tallest sibling; whatever must land on the row's bottom edge
 * goes in a `CardBase` inside it. Without that, a specimen whose prose ran a
 * line longer than its neighbour's pushed its own trailing block a line lower,
 * and a page whose whole job is to be compared across cannot be read across.
 */
const specimenCard = cn(
  "flex min-w-0 flex-col border p-[var(--ds-space-cozy)]",
  dsRadius.lg,
  dsBorder.base,
  dsSurface.card,
);

/** The neutral fact chip this page uses everywhere a wire value is named. */
const catalogChip = cn(
  "inline-flex items-center border",
  dsClip.token,
  "h-[var(--ds-h-xs)] gap-[var(--ds-space-tight)] px-[var(--ds-space-snug)]",
  dsRadius.sm,
  dsText.micro,
  dsText.nums,
  "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] text-[color:var(--ds-recess-fg)]",
);

/** The bullet a spec list hangs on — nudged down so it sits on the x-height. */
const specBullet = "mt-[var(--ds-space-snug)] size-1 shrink-0 rounded-full bg-[var(--ds-fg-faint)]";

function SectionHead({
  icon: Icon,
  title,
  blurb,
}: {
  icon: typeof LayoutList;
  title: string;
  blurb: string;
}) {
  return (
    <div className="mb-[var(--ds-space-cozy)] flex items-start gap-[var(--ds-space-cozy)]">
      <span
        className={cn(
          "mt-px flex size-7 shrink-0 items-center justify-center border",
          dsRadius.md,
          dsBorder.base,
          "bg-[var(--ds-surface-2)]",
        )}
      >
        <Icon aria-hidden className={cn(dsIcon.md, "text-[color:var(--ds-fg-muted)]")} />
      </span>
      <div className="min-w-0">
        <h2 className={cn(dsText.section, "font-semibold text-[color:var(--ds-fg)]")}>{title}</h2>
        <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-muted)]")}>{blurb}</p>
      </div>
    </div>
  );
}

function SpecBullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-[var(--ds-space-base)] flex flex-col gap-[var(--ds-space-hair)]">
      {items.map((item) => (
        <li
          key={item}
          className={cn(dsText.meta, "flex gap-[var(--ds-space-snug)] leading-relaxed text-[color:var(--ds-fg-muted)]")}
        >
          <span aria-hidden className={specBullet} />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * `Lives` and `Counts` are the two facts read STRAIGHT ACROSS the three
 * containment kinds. One row shape and one label column, so the pair reads as a
 * matched pair rather than as two prose paragraphs that line up with nothing.
 */
function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn(dsText.meta, "flex min-w-0 gap-[var(--ds-space-base)] leading-relaxed")}>
      <span className="w-11 shrink-0 text-[color:var(--ds-fg-secondary)]">{label}</span>
      <span className="min-w-0 flex-1 text-[color:var(--ds-fg-muted)]">{children}</span>
    </div>
  );
}

export function RowCatalogView() {
  return (
    <div className="flex flex-col gap-[var(--ds-space-page)] px-[var(--ds-space-cozy)] py-[var(--ds-space-section)]">
      <section aria-label="Queue row shapes">
        <SectionHead
          icon={LayoutList}
          title="Queue rows — the four shapes the projection emits"
          blurb="The shape is structural: it is folded from the run's own shape by the queue projector, and it decides what the row body carries. It is not a workflow, and it is not a name somebody typed."
        />
        <div className="grid gap-[var(--ds-space-cozy)] min-[1100px]:grid-cols-2">
          {rowSurfaceSpecs().map((spec) => (
            <article key={spec.key} className={specimenCard}>
              <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
                <h3 className={cn(dsText.title, "font-semibold text-[color:var(--ds-fg)]")}>{spec.name}</h3>
                <span className={catalogChip}>surfaceKind {spec.key}</span>
              </div>
              <p
                className={cn(
                  dsText.body,
                  "mt-[var(--ds-space-snug)] leading-relaxed text-[color:var(--ds-fg-secondary)]",
                )}
              >
                {spec.subject}
              </p>
              <p className={cn(dsText.meta, "mt-[var(--ds-space-tight)] leading-relaxed text-[color:var(--ds-fg-muted)]")}>
                {spec.producedWhen}
              </p>
              <CardBase className="pt-[var(--ds-space-base)]">
                <SectionLabel>Carries</SectionLabel>
                <SpecBullets items={spec.carries} />
              </CardBase>
            </article>
          ))}
        </div>
      </section>

      <section aria-label="Containment">
        <SectionHead
          icon={Link2}
          title="Containment — the one field that decides where a child lives"
          blurb="Not every child of a row is a member. Getting this wrong is what makes the same run appear in two panels and the counts disagree with the rows, which is why the wire projects it rather than letting the client reconstruct it."
        />
        <div className="grid gap-[var(--ds-space-cozy)] min-[1100px]:grid-cols-3">
          {containmentSpecs().map((spec) => (
            <article key={spec.key} className={specimenCard}>
              <div className="flex items-baseline gap-[var(--ds-space-base)]">
                <h3 className={cn(dsText.title, "font-semibold text-[color:var(--ds-fg)]")}>{spec.name}</h3>
                <span className={cn(dsText.micro, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>{spec.key}</span>
              </div>
              <p
                className={cn(
                  dsText.body,
                  "mt-[var(--ds-space-snug)] leading-relaxed text-[color:var(--ds-fg-secondary)]",
                )}
              >
                {spec.rule}
              </p>
              <CardBase className="mt-[var(--ds-space-snug)] gap-[var(--ds-space-tight)] pt-[var(--ds-space-base)]">
                <FactRow label="Lives">{spec.lives}</FactRow>
                <FactRow label="Counts">{spec.counts}</FactRow>
              </CardBase>
            </article>
          ))}
        </div>
      </section>

      <section aria-label="Group rollup">
        <SectionHead
          icon={Layers}
          title="Rollup — three counts, refused unless they agree with the members"
          blurb="A group's rollup is never authored. It rides the operation row beside the exact member ids it summarises, and the schema refuses a payload where the two disagree — so a group can never report a total nobody is in."
        />
        <div className={specimenCard}>
          <div className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>memberRollup</div>
          <div className="mt-[var(--ds-space-base)] flex flex-col gap-[var(--ds-space-tight)]">
            {ROLLUP_COUNTS.map((count) => (
              <div key={count.key} className="flex min-w-0 items-start gap-[var(--ds-space-base)]">
                <span className={cn(catalogChip, "shrink-0")}>{count.key}</span>
                <span className={cn(dsText.meta, "min-w-0 flex-1 leading-relaxed text-[color:var(--ds-fg-muted)]")}>
                  {count.meaning}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Log panels">
        <SectionHead
          icon={PanelRight}
          title="Log panels — four kinds, sections derived not fixed"
          blurb="One Log Panel surface, and the tab set comes from the row you selected. The strip below is derived from the same compatibility rule the run-detail wire enforces, so this page cannot document a tab the product would refuse."
        />
        <div className="grid gap-[var(--ds-space-cozy)] min-[1100px]:grid-cols-2">
          {panelKindSpecs().map((spec) => (
            <article key={spec.key} className={specimenCard}>
              <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
                <h3 className={cn(dsText.title, "font-semibold text-[color:var(--ds-fg)]")}>{spec.name}</h3>
                <span className={catalogChip}>panelKind {spec.key}</span>
              </div>
              <p className={cn(dsText.meta, "mt-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}>
                {spec.forRows}
              </p>

              {/*
                The SAME tab treatment the real panel uses — an underline on the
                first tab, not a filled pill. It is inert on purpose: this is a
                specimen of a strip, not a second copy of the panel's control.
              */}
              <div
                aria-hidden
                className={cn("mt-[var(--ds-space-base)] flex flex-wrap items-center border-b", dsBorder.subtle)}
              >
                {spec.tabs.map((tab, index) => (
                  <span
                    key={tab.key}
                    className={cn(
                      "-mb-px inline-flex items-center border-b-2 border-transparent",
                      "px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
                      dsText.meta,
                      index === 0
                        ? "border-b-[color:var(--ds-accent)] font-semibold text-[color:var(--ds-fg)]"
                        : "text-[color:var(--ds-fg-muted)]",
                    )}
                  >
                    {tab.label}
                  </span>
                ))}
              </div>
              <p className={cn(dsText.meta, "mt-[var(--ds-space-snug)] leading-relaxed text-[color:var(--ds-fg-muted)]")}>
                <span className="text-[color:var(--ds-fg-secondary)]">Tabs shown:</span>{" "}
                {spec.tabs.map((tab) => tab.label).join(" · ")}. Which of them a given run actually
                advertises is its own availableSections, so a run that produced no receipt draws no
                Receipt tab.
              </p>

              <CardBase className="gap-[var(--ds-space-tight)] pt-[var(--ds-space-cozy)]">
                <SectionLabel>Sections this kind may advertise</SectionLabel>
                <div className="flex flex-wrap gap-[var(--ds-space-tight)]">
                  {spec.sections.map((section) => (
                    <span key={section} className={catalogChip}>{section}</span>
                  ))}
                </div>
              </CardBase>
            </article>
          ))}
        </div>
      </section>

      <section aria-label="Not served here">
        <SectionHead
          icon={LayoutList}
          title="What the demo's catalog names and this build does not serve"
          blurb="Each row below is a fact about a producer, not a preference. A reference page that quietly omitted them would be indistinguishable from one nobody finished."
        />
        {/*
          NOT a `Banner`. Every banner tone carries `role="status"`, and five
          live regions announcing five STANDING facts on mount would read as
          five things that just happened. These are permanent properties of the
          build, so they take the page's own specimen chrome.
        */}
        <ul className="flex flex-col gap-[var(--ds-space-base)]">
          {UNSERVED_VOCABULARY.map((entry) => (
            <li key={entry.demo} className={specimenCard}>
              <p className={cn(dsText.body, "leading-relaxed text-[color:var(--ds-fg-secondary)]")}>
                {entry.demo}
              </p>
              <p
                className={cn(
                  dsText.meta,
                  "mt-[var(--ds-space-snug)] leading-relaxed text-[color:var(--ds-fg-muted)]",
                )}
              >
                {entry.why}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
