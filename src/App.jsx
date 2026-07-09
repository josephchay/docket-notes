import "./constants/colors.css";
import "../src/base/commons.css";

import Home from "./pages/Home";
import CursorDot from "./components/Cursor/CursorDot";

import './App.css';

const App = () => {
  return (
    <div className="App">
      <Home />
      <CursorDot />
    </div>
  );
}

export default App;
