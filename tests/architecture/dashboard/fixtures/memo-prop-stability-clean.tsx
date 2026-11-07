
/* eslint-disable */
// @ts-nocheck
export function Good({ boot, route }: any) {
  return (
    <div>
      <WorkspaceRail
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
