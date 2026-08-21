/**
 * A fixture that breaks `dashboard-memo-prop-stability` in every way the rule
 * names, so the walker cannot pass by resolving nothing. It is never imported
 * by the app; only the guard reads it, as text.
 *
 * Each violating prop is exactly a shape that shipped in `dashboard-app.tsx`
 * before Track D row D4 (an inline `nav={{…}}`, a `?? []`, an inline
 * `onDay` closure, an inline `handlers={{…}}`) — a fixture that invents its
 * own shapes proves the guard catches shapes nobody writes.
 */
/* eslint-disable */
// @ts-nocheck
export function Bad({ dayWire, route, setRoute, navHistory, detailValue }: any) {
  return (
    <div>
      <TopBar
        daySurfaces={dayWire?.queueSurfaces ?? []}
        onDay={(next) => setRoute({ ...route, day: next })}
        nav={{ canBack: navHistory.length > 0, onBack: () => travel("back") }}
        actorId={boot.actor.id}
        day={route.day}
      />
      <QueuePanel
        surfaces={surfaces}
        handlers={{ onSelect: selectRun }}
        sort={sort}
      />
      <LogPanel
        detail={detailValue}
        onDetailEdited={function bump() { setDetailNonce((n) => n + 1); }}
        surface={new Wrapper(detailValue)}
      />
    </div>
  );
}
