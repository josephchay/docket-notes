import { useEffect, useState } from "react";

import "./constants/colors.css";
import "../src/base/commons.css";

import Home from "./pages/Home";
import CursorDot from "./components/Cursor/CursorDot";
import CursorAura from "./components/Cursor/CursorAura";
import LoadIntro from "./components/Intro/LoadIntro";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";
import { CURSOR_STYLE_EVENT } from "./components/Settings/SettingsPanel";
import { hasSeenIntro, loadSettings } from "./utils/storage";

import './App.css';

const App = () => {
  const [showIntro, setShowIntro] = useState(() => !hasSeenIntro());

  // Owned here (rather than by Home, which is this component's own child)
  // since this is what actually decides which cursor to mount — Settings
  // lives deep inside Home's tree, so it reaches this choice the same
  // event-based way every other cross-cutting concern in this app already
  // does, not a new prop threaded down and back up past a boundary that
  // currently has none.
  const [cursorStyle, setCursorStyle] = useState(() => (loadSettings().cursorStyle === "aura" ? "aura" : "dot"));

  useEffect(() => {
    const handleChange = (e) => setCursorStyle(e.detail === "aura" ? "aura" : "dot");
    window.addEventListener(CURSOR_STYLE_EVENT, handleChange);
    return () => window.removeEventListener(CURSOR_STYLE_EVENT, handleChange);
  }, []);

  return (
    <div className="App">
      <ErrorBoundary>
        <Home />
      </ErrorBoundary>
      { cursorStyle === "aura" ? <CursorAura /> : <CursorDot /> }
      {
        showIntro && (
          <LoadIntro onDone={ () => setShowIntro(false) } />
        )
      }
    </div>
  );
}

export default App;
