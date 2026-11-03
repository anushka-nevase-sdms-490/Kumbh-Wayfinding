import { Component, type ErrorInfo, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LangProvider } from "./i18n/LangProvider";
// Fonts are served from this site (no Google Fonts: visitors' phones talk to
// nobody else, and the fonts work offline from the first visit).
import "@fontsource/figtree/latin-400.css";
import "@fontsource/figtree/latin-600.css";
import "@fontsource/figtree/latin-700.css";
import "@fontsource/bricolage-grotesque/latin-700.css";
import "@fontsource/bricolage-grotesque/latin-800.css";
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
    console.error("Kumbh Wayfinding UI crashed:", error, info);
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
          {/* For pilgrims, in all three languages (the language settings may be what failed). */}
          <h1 style={{ marginTop: 0 }}>Something went wrong</h1>
          <p>Please reload the app. In an emergency call 112 (ambulance 108).</p>
          <p lang="hi">कुछ गड़बड़ हुई। ऐप दोबारा खोलें। आपात स्थिति में 112 (एम्बुलेंस 108) पर कॉल करें।</p>
          <p lang="mr">काहीतरी चुकलं. ॲप पुन्हा उघडा. आपत्कालीन स्थितीत 112 (रुग्णवाहिका 108) वर कॉल करा.</p>
          <p>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "12px 20px", fontSize: 16 }}>
              Reload · दोबारा खोलें · पुन्हा उघडा
            </button>{" "}
            <a href="tel:112" style={{ padding: "12px 8px", fontSize: 16 }}>
              Call 112
            </a>
          </p>
          <p style={{ fontSize: 13, opacity: 0.7 }}>Details for the Setu team:</p>
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
        <LangProvider>
          <App />
        </LangProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}
