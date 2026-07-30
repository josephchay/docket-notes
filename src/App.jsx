import { useState } from "react";

import "./constants/colors.css";
import "../src/base/commons.css";

import Home from "./pages/Home";
import CursorDot from "./components/Cursor/CursorDot";
import LoadIntro from "./components/Intro/LoadIntro";
import { hasSeenIntro } from "./utils/storage";

import './App.css';

const App = () => {
  const [showIntro, setShowIntro] = useState(() => !hasSeenIntro());

  return (
    <div className="App">
      <Home />
      <CursorDot />
      {
        showIntro && (
          <LoadIntro onDone={ () => setShowIntro(false) } />
        )
      }
    </div>
  );
}

export default App;
