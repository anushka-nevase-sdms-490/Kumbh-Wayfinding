import { Component, type ErrorInfo, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Routefinding UI crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            background: "#f7f3ea",
            color: "#14201c",
          }}
        >
          <h1 style={{ marginTop: 0 }}>Routefinding hit an error</h1>
          <p>Open DevTools (F12) → Console for details.</p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#fff",
              padding: 12,
              borderRadius: 8,
            }}
          >
            {this.state.error.message}
          </pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (!root) {
  document.body.innerHTML =
    "<h1 style='font-family:system-ui;padding:24px'>Missing #root</h1>";
} else {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}
