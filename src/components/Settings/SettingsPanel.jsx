import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark, FaMoon, FaSun, FaLock, FaLockOpen, FaFeather, FaArrowPointer, FaVolumeHigh, FaVolumeXmark } from "react-icons/fa6";

import { loadSettings, saveSettings } from "../../utils/storage";
import useBlobClipMorph from "../../hooks/useBlobClipMorph";
import useFocusTrap from "../../hooks/useFocusTrap";
import HistoryAmbient from "../History/HistoryAmbient";
import SettingsToggle from "./SettingsToggle";

import "./SettingsPanel.css";

// The event the command palette / Header's own gear wand fire to summon
// this panel from anywhere — same pattern as every other dot-to-sheet
// panel in this app (see INSIGHTS_EVENT, HISTORY_EVENT, TRASH_EVENT).
export const SETTINGS_EVENT = "docket:settings";

// App.jsx renders the cursor as a sibling of Home, not a descendant — this
// panel lives deep inside Home's own tree, so a preference chosen here
// reaches App.jsx the same event-based way every other cross-cutting
// concern in this app already does, rather than threading a new prop down
// through (and back up past) a boundary that currently has none.
export const CURSOR_STYLE_EVENT = "docket:cursor-style";

// The app's only three real user preferences, finally given the same
// dot-to-sheet panel every comparable feature (Trash, Insights, Sprint,
// History) already has — theme and persistNotes were previously just bare
// icon toggles in Header; reduceMotion previously lived entirely inside
// the History panel, discoverable only while that panel happened to be
// open. All three are passed in from Home.jsx, same state/handlers those
// call sites already used — nothing here owns its own copy of any of them.
const SettingsPanel = ({
  theme,
  toggleTheme,
  persistNotes,
  togglePersistNotes,
  reduceMotion,
  toggleReduceMotion,
  systemReducedMotion,
  soundEnabled,
  toggleSound,
}) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  const onBlobUpdate = useBlobClipMorph(panelRef, open, 22);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(SETTINGS_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(SETTINGS_EVENT, handleSummon);
    };
  }, []);

  // Traps Tab/Shift+Tab within the panel while open and returns focus to
  // whatever triggered it once closed — see useFocusTrap.js.
  useFocusTrap(panelRef, open);

  // The ink wash washes out from the toggle itself, same reasoning as
  // Header's own handleThemeToggle — it should look the same whether it
  // was toggled here, from the Header, or from the command palette.
  const themeRowRef = useRef(null);
  const handleThemeToggle = () => {
    const rect = themeRowRef.current?.getBoundingClientRect();
    toggleTheme(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined);
  };

  // The only preference this panel owns outright rather than receiving
  // from Home.jsx — persisted through the same generic saveSettings/
  // loadSettings store theme already uses, and broadcast live so App.jsx
  // can swap the mounted cursor component without a reload.
  const [cursorStyle, setCursorStyle] = useState(() => (loadSettings().cursorStyle === "aura" ? "aura" : "dot"));

  const chooseCursor = (next) => {
    if (next === cursorStyle) return;
    setCursorStyle(next);
    saveSettings({ cursorStyle: next });
    window.dispatchEvent(new CustomEvent(CURSOR_STYLE_EVENT, { detail: next }));
  };

  return (
    <AnimatePresence>
      {
        open && (
          <div className="settings-layer">
            <motion.div
              className="settings-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .2 } }}
              onClick={ () => setOpen(false) }
            />
            <motion.div
              ref={ panelRef }
              tabIndex={ -1 }
              className="settings-panel"
              initial={{ opacity: 0, scale: .1, translateY: 90, borderRadius: 60 }}
              onUpdate={ onBlobUpdate }
              animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 22 }}
              exit={{
                opacity: 0,
                scale: .24,
                translateY: 60,
                borderRadius: 50,
                transition: { duration: .2, ease: "easeIn" },
              }}
              transition={{ type: "spring", stiffness: 190, damping: 14 }}
            >
              <div className="settings-header">
                <h3>Settings</h3>
                <motion.button
                  type="button"
                  aria-label="Close"
                  className="settings-close"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ () => setOpen(false) }
                >
                  <FaXmark />
                </motion.button>
              </div>

              <div className="settings-body">
                {/* A live sample of the page's own ink — the exact same
                    raw-Three.js drifting-dust technique (and, since round
                    11, the exact same live theme-flip retint) History's
                    right pane already uses, reused wholesale rather than
                    standing up a second WebGL scene for the same effect. */}
                <div className="settings-preview">
                  <HistoryAmbient color="var(--page-ink-color)" />
                </div>

                <div ref={ themeRowRef } className="settings-row">
                  <span className="settings-row-icon">
                    <AnimatePresence mode="wait" initial={ false }>
                      <motion.span
                        key={ theme }
                        initial={{ rotate: -140, scale: 0, opacity: 0 }}
                        animate={{ rotate: 0, scale: 1, opacity: 1 }}
                        exit={{ rotate: 140, scale: 0, opacity: 0, transition: { duration: .15, ease: "easeIn" } }}
                        transition={{ type: "spring", stiffness: 380, damping: 16 }}
                        style={{ display: "flex" }}
                      >
                        { theme === "dark" ? <FaSun /> : <FaMoon /> }
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  <span className="settings-row-text">
                    <span className="settings-row-label">Ink theme</span>
                    <span className="settings-row-description">
                      { theme === "dark" ? "The Ink theme is on" : "Fresh paper is on" }
                    </span>
                  </span>
                  <SettingsToggle
                    checked={ theme === "dark" }
                    onChange={ handleThemeToggle }
                    label={ theme === "dark" ? "Switch to the light theme" : "Switch to the Ink theme" }
                  />
                </div>

                <div className="settings-row">
                  <span className="settings-row-icon">
                    <AnimatePresence mode="wait" initial={ false }>
                      <motion.span
                        key={ persistNotes ? "locked" : "unlocked" }
                        initial={{ rotate: -140, scale: 0, opacity: 0 }}
                        animate={{ rotate: 0, scale: 1, opacity: 1 }}
                        exit={{ rotate: 140, scale: 0, opacity: 0, transition: { duration: .15, ease: "easeIn" } }}
                        transition={{ type: "spring", stiffness: 420, damping: 15 }}
                        style={{ display: "flex" }}
                      >
                        { persistNotes ? <FaLock /> : <FaLockOpen /> }
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  <span className="settings-row-text">
                    <span className="settings-row-label">Remember notes</span>
                    <span className="settings-row-description">
                      {
                        persistNotes
                          ? "Notes stick around after you close this tab"
                          : "Notes clear when this tab closes"
                      }
                    </span>
                  </span>
                  <SettingsToggle
                    checked={ persistNotes }
                    onChange={ togglePersistNotes }
                    label={ persistNotes ? "Stop remembering notes after this tab" : "Remember notes across sessions" }
                  />
                </div>

                <div className="settings-row">
                  <span className="settings-row-icon">
                    <FaFeather />
                  </span>
                  <span className="settings-row-text">
                    <span className="settings-row-label">Reduce motion</span>
                    <span className="settings-row-description">
                      {
                        systemReducedMotion
                          ? "Already on via your system settings"
                          : "Calms the largest, most continuous motion in the app"
                      }
                    </span>
                  </span>
                  <SettingsToggle
                    checked={ reduceMotion }
                    onChange={ toggleReduceMotion }
                    disabled={ systemReducedMotion }
                    label={ reduceMotion ? "Turn animations back on" : "Reduce motion" }
                  />
                </div>

                <div className="settings-row">
                  <span className="settings-row-icon">
                    <AnimatePresence mode="wait" initial={ false }>
                      <motion.span
                        key={ soundEnabled ? "on" : "off" }
                        initial={{ rotate: -140, scale: 0, opacity: 0 }}
                        animate={{ rotate: 0, scale: 1, opacity: 1 }}
                        exit={{ rotate: 140, scale: 0, opacity: 0, transition: { duration: .15, ease: "easeIn" } }}
                        transition={{ type: "spring", stiffness: 420, damping: 16 }}
                        style={{ display: "flex" }}
                      >
                        { soundEnabled ? <FaVolumeHigh /> : <FaVolumeXmark /> }
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  <span className="settings-row-text">
                    <span className="settings-row-label">Sound cues</span>
                    <span className="settings-row-description">
                      { soundEnabled ? "Soft ink cues play on key actions" : "Silent" }
                    </span>
                  </span>
                  <SettingsToggle
                    checked={ soundEnabled }
                    onChange={ toggleSound }
                    label={ soundEnabled ? "Turn sound cues off" : "Turn sound cues on" }
                  />
                </div>

                <div className="settings-row">
                  <span className="settings-row-icon">
                    <FaArrowPointer />
                  </span>
                  <span className="settings-row-text">
                    <span className="settings-row-label">Cursor style</span>
                    <span className="settings-row-description">
                      {
                        cursorStyle === "aura"
                          ? "A comet of color trails the pointer"
                          : "A simple ink pen with a wet nib"
                      }
                    </span>
                  </span>
                  <div className="settings-segmented" role="radiogroup" aria-label="Cursor style">
                    {
                      [{ key: "dot", label: "Pen" }, { key: "aura", label: "Comet" }].map((option) => (
                        <button
                          key={ option.key }
                          type="button"
                          role="radio"
                          aria-checked={ cursorStyle === option.key }
                          className={ `settings-segmented-option ${ cursorStyle === option.key ? "active" : "" }` }
                          onClick={ () => chooseCursor(option.key) }
                        >
                          {
                            cursorStyle === option.key && (
                              <motion.span
                                layoutId="settingsSegmentedThumb"
                                className="settings-segmented-thumb"
                                transition={{ type: "spring", stiffness: 480, damping: 30 }}
                              />
                            )
                          }
                          <span className="settings-segmented-label">{ option.label }</span>
                        </button>
                      ))
                    }
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )
      }
    </AnimatePresence>
  );
};

export default SettingsPanel;
