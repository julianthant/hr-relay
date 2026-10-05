import { CatalogSkeleton } from "../../shared/loading/loading.js";
import { observeAsyncResource } from "../../../state/async-resource.js";
import "../reference-settings.css";
/** The committed catalog is read-only; a stale artifact is a visible refusal. */
import { BookOpen, CircleAlert } from "lucide-react";
import { useCallback,useEffect,useId,useMemo,useState,type KeyboardEvent } from "react";
import type { UiCatalogWire } from "../../../../domain/dashboard/explorer.js";
import type { UiCatalogEntry } from "../../../../domain/ui/contracts.js";
import {
Banner,
Chip,
EmptyState,
BodySection,
FormGroup,
PageHeading,
ResultRow,
SearchInput,
SectionLabel,
Tab,
TabList,
TabPanel,
Tabs,
dsFocus,
dsIcon,
dsMotion,
dsText,
} from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { LOADING,type AsyncResource } from "../../../state/async-resource.js";
import { useExplorerClient as useDashboardClient } from "../../explorer/explorer-client.js";
import { parseCatalogView,type CatalogView } from "./row-catalog-model.js";
import { RowCatalogView } from "./row-catalog.js";
import { SYSTEM_HOST_PRESENTATION } from "../general/settings-hosts-model.js";
import {
ENTRY_KIND,
catalogRowDomId,
foldCatalogRail,
resolveCatalogSelection,
siblingsOnScreen,
stepCatalogSelection,
type CatalogRail,
type CatalogSelectionRequest,
} from "./ui-catalog-model.js";

function FactChips({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div
      aria-label={label}
      className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]"
    >
      {children}
    </div>
  );
}

function screenGroupLabel(system: UiCatalogEntry["system"], label: string): string {
  const displayName = SYSTEM_HOST_PRESENTATION[system].name;
  const rawPrefix = new RegExp(`^${system.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=[\\s:·-]|$)`, "iu");
  const displayPrefix = new RegExp(`^${displayName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=[\\s:·-]|$)`, "iu");
  const trimmed = label.replace(rawPrefix, "").replace(displayPrefix, "").replace(/^[\s:·-]+/u, "");
  const readable = trimmed || label;
  return `${displayName} · ${readable.charAt(0).toUpperCase()}${readable.slice(1)}`;
}

/** Each option exposes the full raw id while its visible title stays readable. */
function RailRow({
  entry,
  domId,
  selected,
  nested,
  onSelect,
}: {
  entry: UiCatalogEntry;
  domId: string;
  selected: boolean;
  nested: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      id={domId}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      title={String(entry.id)}
      aria-label={`${entry.label} · ${String(entry.id)} · ${ENTRY_KIND[entry.kind].word} · Verified ${entry.verification.verifiedAt}`}
      className={cn(
        "flex min-w-0 cursor-pointer items-start rounded-[var(--ds-radius-md)]",
        "px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]",
        nested ? "settings-reference-catalog-child" : "",
        dsFocus,
        dsMotion.base,
        selected
          ? "bg-[var(--ds-surface-selected)]"
          : "hover:bg-[var(--ds-surface-3)]",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-[var(--ds-space-tight)]">
        <span className={cn(dsText.ui, "settings-reference-rail-label", selected || entry.kind === "screen" ? "font-semibold text-[color:var(--ds-fg)]" : "font-medium text-[color:var(--ds-fg-secondary)]")}>
          {entry.label}
        </span>
        <span className={cn(dsText.meta, "settings-reference-rail-meta text-[color:var(--ds-fg-muted)]")}>
          {ENTRY_KIND[entry.kind].word} · {entry.verification.verifiedAt}
        </span>
      </span>
    </div>
  );
}

function CatalogRailView({
  rail,
  baseId,
  selectedId,
  onSelect,
}: {
  rail: CatalogRail;
  baseId: string;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
      const next = stepCatalogSelection(rail.rows, selectedId, event.key);
      if (next === undefined) return;
      event.preventDefault();
      onSelect(String(next.id));
      // The row is already mounted (the rail draws every row), so focus can
      // move in the same tick the selection does.
      document.getElementById(catalogRowDomId(baseId, String(next.id)))?.focus();
    },
    [rail.rows, selectedId, onSelect, baseId],
  );

  return (
    <div
      role="listbox"
      aria-label="Catalog entries"
      aria-activedescendant={selectedId === undefined ? undefined : catalogRowDomId(baseId, selectedId)}
      onKeyDown={onKeyDown}
      className="settings-reference-catalog-rail min-h-0 overflow-y-auto border-r border-[color:var(--ds-border)]"
    >
      {rail.systems.map((system) => (
        <div key={system.system} role="group" aria-label={system.system}>
          {system.screens.map(({ screen, children }) => (
            <div key={String(screen.id)} className="settings-reference-catalog-screen">
              <SectionLabel className="settings-reference-catalog-screen-label text-[color:var(--ds-fg-muted)]">
                {screenGroupLabel(screen.system, screen.label)}
              </SectionLabel>
              <RailRow
                entry={screen}
                domId={catalogRowDomId(baseId, String(screen.id))}
                selected={selectedId === String(screen.id)}
                nested={false}
                onSelect={() => onSelect(String(screen.id))}
              />
              {children.map((child) => (
                <RailRow
                  key={String(child.id)}
                  entry={child}
                  domId={catalogRowDomId(baseId, String(child.id))}
                  selected={selectedId === String(child.id)}
                  nested
                  onSelect={() => onSelect(String(child.id))}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The selected entry, whole. Every served field is printed; nothing is behind
 * a disclosure. The scenarios are NAMED, not counted (D276 item 5, ledger 3
 * CA59): a count is the one shape of provenance that cannot be checked.
 */
function CatalogRecord({
  entry,
  siblings,
  onSelect,
}: {
  entry: UiCatalogEntry;
  siblings: readonly UiCatalogEntry[];
  onSelect: (id: string) => void;
}) {
  const kind = ENTRY_KIND[entry.kind];
  const verification = entry.verification;
  const propertyRows = [
    ["System", SYSTEM_HOST_PRESENTATION[entry.system].name],
    ...( "screen" in entry ? [["Screen", String(entry.screen)]] : []),
    ...( "role" in entry ? [["Role", entry.role]] : []),
    ...( "effect" in entry ? [["Effect", entry.effect]] : []),
    ...( "authoritativeFor" in entry ? [["Authoritative for", entry.authoritativeFor.join(", ")]] : []),
    ["Sensitivity", { public: "Public", hr: "HR data", restricted: "Restricted" }[entry.sensitivity]],
  ] as const;
  return <article aria-label={`${kind.word} ${String(entry.id)}`} className="settings-reference-catalog-record">
    <header className="settings-reference-record-heading">
      <div className="settings-reference-catalog-kind">
        <BookOpen aria-hidden className={dsIcon.sm} />
        <span>{kind.word} · {SYSTEM_HOST_PRESENTATION[entry.system].name}</span>
      </div>
      <h3 className="settings-reference-catalog-title">{entry.label}</h3>
      <p className={cn(dsText.nums, "settings-reference-record-id")}>{String(entry.id)}</p>
    </header>
    <BodySection as="h3" title="Properties">
      <FormGroup label="Catalog properties">
        {propertyRows.map(([label, value]) => <ResultRow key={label} label={label} value={value} />)}
        <ResultRow label="Used by" value={entry.taskUses.length === 0 ? "no task" : entry.taskUses.map(String).join(", ")} />
        <ResultRow label="Search terms" value={entry.searchTerms.join(", ")} />
      </FormGroup>
    </BodySection>
    <BodySection as="h3" title="Verification & evidence">
      <FormGroup label="Catalog verification and evidence">
        <ResultRow label="Verified" value={verification.verifiedAt} />
        <ResultRow label="Fixture evidence" value={verification.fixtureEvidenceRef} />
        <ResultRow label="Live evidence" value={verification.liveReadOnlyEvidenceRef} />
        <ResultRow label="Owner" value={entry.sourceLink} />
        <ResultRow label="Verified by" value={verification.scenarios.map(String).join(", ")} />
      </FormGroup>
    </BodySection>
    {siblings.length > 0 && <BodySection as="h3" title="On the same screen">
      <FactChips>
        {siblings.map(sibling => <Chip key={String(sibling.id)} onSelect={() => onSelect(String(sibling.id))} title={sibling.label}>{String(sibling.id)}</Chip>)}
      </FactChips>
    </BodySection>}
  </article>;
}

/**
 * The catalog, in TWO views (D274 item 4), as a Settings section (D295).
 *
 * `selectors` is the generated selector-semantics catalog this surface has
 * always been. `vocabulary` is the row-and-panel reference the demo carries and
 * this tree had nowhere to put — it lives here rather than behind a third route
 * key because both answer "what does this system call the thing I am looking
 * at", and the view is route-owned (`?catalogView=`) for the same reason the
 * Archive's is: a door from elsewhere must be able to land on the actual panel
 * in one navigation, and a local state authority beside a URL is two answers to
 * one question.
 *
 * The SELECTION is local, as the Explorer's node selection is: a search term
 * is what a link carries, and the record it opens on is the term's first hit.
 *
 * D295 moved it under `?settings=ui-catalog`. It does not own an exit action;
 * Settings navigation and the shell's dirty-exit guard own section changes.
 */
export function UiCatalogSection({
  query,
  onQuery,
  view,
  onView,
}: {
  query: string;
  onQuery: (next: string) => void;
  view: CatalogView;
  onView: (next: CatalogView) => void;
}) {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<UiCatalogWire>>(LOADING);
  const [request, setRequest] = useState<CatalogSelectionRequest | undefined>(undefined);
  const baseId = useId();

  // The vocabulary view reads no server artifact at all, so it must not ask for
  // one: a fetch fired for a panel that never renders its result is a request
  // whose only visible effect is a refusal banner on the wrong screen.
  useEffect(() => {
    if (view !== "selectors") return undefined;
    setResource(LOADING);
    return observeAsyncResource(() => client.uiCatalog(), setResource);
  }, [client, view]);

  const wire = resource.state === "loaded" ? resource.value : undefined;
  const rail = useMemo(() => foldCatalogRail(wire?.entries ?? [], query), [wire, query]);
  const selected = resolveCatalogSelection(wire?.entries ?? [], rail, request, query);
  const siblings = useMemo(
    () => (wire === undefined || selected === undefined ? [] : siblingsOnScreen(wire.entries, selected)),
    [wire, selected],
  );
  const select = useCallback((id: string) => setRequest({ id, query }), [query]);

  return (
    <div className="settings-reference-page settings-reference-catalog">
      <PageHeading title="UI catalog" description="Reference material for workflow pages and controls." />
      <Tabs value={view} onValueChange={(next) => {
        const parsed = parseCatalogView(next);
        if (parsed === undefined) throw new Error(`catalog tab ${next} is not a catalog view`);
        onView(parsed);
      }} className="min-h-0 flex-1">
        <TabList label="Catalog views">
          <Tab value="selectors">Selectors</Tab>
          <Tab value="vocabulary">Rows &amp; panels</Tab>
        </TabList>
        <TabPanel value="vocabulary" className="settings-reference-vocabulary">
          <RowCatalogView />
        </TabPanel>
        <TabPanel value="selectors" className="settings-reference-catalog-panel">
          <div className="settings-reference-catalog-toolbar">
            <SearchInput className="settings-reference-catalog-search" value={query}
              aria-label="Search the UI catalog by id, label, system or search term"
              placeholder="Search systems, screens, or controls"
              onChange={(event) => onQuery(event.currentTarget.value)} onClear={() => onQuery("")} />
            {wire !== undefined && <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
              {rail.matchedCount === wire.entries.length
                ? `${String(wire.entries.length)} entries`
                : `${String(rail.matchedCount)} of ${String(wire.entries.length)} entries`}
            </span>}
          </div>
          {resource.state === "loading" && <CatalogSkeleton />}
          {resource.state === "failed" && <Banner tone="danger" title="The committed UI catalog could not be served">{resource.error.message}</Banner>}
          {wire !== undefined && selected === undefined && <EmptyState icon={<CircleAlert aria-hidden className={dsIcon.lg} />}
            title={`Nothing in the catalog matches “${query}”`}
            description={`All ${String(wire.entries.length)} entries were searched by id, label, system, kind and registered search terms. Try one word — a system (kuali), a kind (observation), or part of an id (timekeeper).`} />}
          {wire !== undefined && selected !== undefined && <FormGroup label="UI catalog browser" className="settings-reference-catalog-browser">
            <div className="settings-reference-catalog-rail-frame">
              <CatalogRailView rail={rail} baseId={baseId} selectedId={String(selected.id)} onSelect={select} />
            </div>
            <div className="settings-reference-catalog-detail"><CatalogRecord entry={selected} siblings={siblings} onSelect={select} /></div>
          </FormGroup>}
        </TabPanel>
      </Tabs>
    </div>
  );
}
