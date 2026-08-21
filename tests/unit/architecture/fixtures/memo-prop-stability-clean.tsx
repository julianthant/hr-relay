/**
 * The clean counterpart: the same three memoized panels, every prop slot a
 * shape that is stable across renders or primitive by construction — a bare
 * identifier, a member-access chain, a string/boolean literal, a comparison,
 * and a call whose result the guard does not judge (see the guard's own
 * doc comment for why it deliberately says nothing about calls).
 */
/* eslint-disable */
// @ts-nocheck
export function Good({ boot, route }: any) {
  return (
    <div>
      <TopBar
        daySurfaces={daySurfaces}
        onDay={onSelectDay}
        nav={nav}
        actorId={boot.actor.id}
        day={route.day}
        today={today}
        settingsOpen={settingsOpen}
        onSettingsOpen={setSettingsOpen}
      />
      <QueuePanel
        surfaces={surfaces}
        state={viewState}
        handlers={queueHandlers}
        actionsOf={servedActions}
        panelLabel={workflowLabelOf(activeWorkflowId)}
        isToday={day === today}
        sort={sort}
        {...(queueFilterScope === undefined ? {} : { filter: queueFilterScope })}
      />
      <LogPanel
        detail={detailValue}
        surface={openPanelSurface}
        actions={openPanelActions}
        onDetailEdited={onDetailEdited}
        workflowLabel={workflowLabelOf(detailValue.header.workflowId)}
        servedNow={nowIso}
      />
    </div>
  );
}
