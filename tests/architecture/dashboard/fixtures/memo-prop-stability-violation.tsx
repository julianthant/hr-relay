
/* eslint-disable */
// @ts-nocheck
export function Bad({ dayWire, route, setRoute, navHistory, detailValue }: any) {
  return (
    <div>
      <WorkspaceRail
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
