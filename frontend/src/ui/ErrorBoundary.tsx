import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error: Error | null; stack: string };

/* Catches render errors in the 3D tree so the HUD can keep working and we
 * can read the component stack instead of a dead canvas. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, State> {
  state: State = { error: null, stack: "" };
  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[rhea] render error", error.message, info.componentStack);
    (window as unknown as { __rheaErr?: unknown }).__rheaErr = { message: error.message, stack: error.stack, componentStack: info.componentStack };
    this.setState({ stack: info.componentStack ?? "" });
  }
  render() {
    if (this.state.error) return this.props.fallback ?? <div style={{ padding: 20, color: "#ff8ab8", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>Scene error: {this.state.error.message}{"\n"}{this.state.stack}</div>;
    return this.props.children;
  }
}
