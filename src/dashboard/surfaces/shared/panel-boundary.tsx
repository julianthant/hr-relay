import { Component, type ReactNode } from "react";
import { FailureNotice } from "../../ds/ui.js";

type Props = { resetKey: string; sentence: string; className?: string; failed?: ReactNode; children: ReactNode };

/** Confines a render error to one panel: that panel shows the failure strip with Retry, the rest of the dashboard keeps working. */
export class PanelBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { window.reportError(error); }
  override componentDidUpdate(previous: Readonly<Props>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  override render() {
    return this.state.failed
      ? <><FailureNotice className={this.props.className} sentence={this.props.sentence} action={{ label: "Retry", onClick: () => this.setState({ failed: false }) }} />{this.props.failed}</>
      : this.props.children;
  }
}
