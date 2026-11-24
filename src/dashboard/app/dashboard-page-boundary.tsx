import { Component, type ReactNode } from "react";
import { operatorFailureSentence } from "../../models/failures/error-catalog.js";
import { Button, EmptyState, Panel, PanelBody } from "../ds/ui.js";

export class DashboardPageBoundary extends Component<{ resetKey: string; onRecover: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { window.reportError(error); }
  override componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  override render() {
    return this.state.failed ? <Panel className="min-h-0 flex-1"><PanelBody><EmptyState title="Page unavailable"
      description={operatorFailureSentence("DASHBOARD_PAGE_FAILED")}
      action={<Button onClick={this.props.onRecover}>Open dashboard</Button>} /></PanelBody></Panel> : this.props.children;
  }
}
