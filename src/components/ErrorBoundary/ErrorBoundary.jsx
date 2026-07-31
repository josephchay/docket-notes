import React from "react";

import ErrorSpill from "./ErrorSpill";

// A real error boundary must be a class component — React has no hook
// equivalent for componentDidCatch/getDerivedStateFromError. Kept to just
// the catching itself; the actual fallback (ErrorSpill) is a plain
// functional component underneath it, free to use hooks/framer as normal.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("docket-notes crashed:", error, info);
  }

  render() {
    if (this.state.hasError) {
      // A reload rather than clearing hasError and re-rendering the same
      // crashed subtree in place — notes are already safe in session/
      // localStorage independent of whatever broke, and a real reload is
      // a far more reliable recovery than hoping a boundary-level
      // setState alone clears whatever put the tree in a bad state.
      return <ErrorSpill onRecover={ () => window.location.reload() } />;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
