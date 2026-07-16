import { AnimatePresence, motion } from 'framer-motion';
import { FaStar, FaMoon, FaSun, FaXmark, FaRotateLeft } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import searchIcon from '../../assets/icons/search.svg';

import './Header.css';

const springy = {
  type: "spring",
  stiffness: 400,
  damping: 17,
};

const Header = ({
  searchText,
  setNotesSortText,
  notesSortByFavorite,
  setNotesSortByFavorite,
  sortColor,
  setSortColor,
  notesCount,
  totalCount,
  clearFilters,
  theme,
  toggleTheme,
}) => {
  const filtersActive = searchText !== "" || notesSortByFavorite || sortColor !== null;

  const handleSearch = (e) => {
    setNotesSortText(e.target.value);
  }

  // Escape wipes the query and hands the caret back to the desk.
  const handleSearchKeyDown = (e) => {
    if (e.key === "Escape") {
      setNotesSortText("");
      e.target.blur();
    }
  }

  return (
    <motion.header
      initial={{
        opacity: 0,
        translateY: 80,
      }}
      animate={{
        opacity: 1,
        translateY: 0,
      }}
      transition={{
        duration: 0.8,
        type: "spring",
        stiffness: 100,
        delay: .4,
      }}
      className="header"
    >
      <div className="search">
        <div className="icon">
          <img src={ searchIcon } alt="Search Icon" />
        </div>
        <input
          type="text"
          placeholder="Search"
          value={ searchText }
          onChange={ handleSearch }
          onKeyDown={ handleSearchKeyDown }
        />
        {/* One slot, two moods: a "/" shortcut hint while idle, a clear
            button once there is something to clear. */}
        <span className="search-extra">
          <AnimatePresence initial={ false }>
            {
              searchText ? (
                <motion.button
                  key="clearSearch"
                  type="button"
                  aria-label="Clear the search"
                  className="search-clear"
                  initial={{ opacity: 0, scale: .5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: .5 }}
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .85 }}
                  transition={ springy }
                  onClick={ () => setNotesSortText("") }
                >
                  <FaXmark />
                </motion.button>
              ) : (
                <motion.kbd
                  key="searchHint"
                  className="search-hint"
                  aria-hidden="true"
                  initial={{ opacity: 0, scale: .5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: .5 }}
                  transition={ springy }
                >
                  /
                </motion.kbd>
              )
            }
          </AnimatePresence>
        </span>
        <motion.button
          type="button"
          aria-label={ notesSortByFavorite ? "Show every note" : "Show only starred notes" }
          aria-pressed={ notesSortByFavorite }
          whileHover={{ scale: 1.14 }}
          whileTap={{ scale: 0.96 }}
          transition={ springy }
          onClick={ setNotesSortByFavorite }
          className={ `star ${ notesSortByFavorite ? "active" : "" }` }
        >
          <FaStar className="star-icon" />
        </motion.button>
      </div>
      {/* The tally pops with a spring every time a note joins, leaves, or a
          filter narrows the desk; filtered views read "shown / total". */}
      <motion.span
        key={ `${ notesCount }/${ totalCount }` }
        className="notes-count"
        title={
          filtersActive
            ? `${ notesCount } of ${ totalCount } notes match`
            : `${ totalCount } notes on the desk`
        }
        initial={{
          opacity: 0,
          scale: .6,
          translateY: 8,
        }}
        animate={{
          opacity: 1,
          scale: 1,
          translateY: 0,
        }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 20,
        }}
      >
        { notesCount }
        {
          filtersActive && (
            <small>/ { totalCount }</small>
          )
        }
      </motion.span>
      {/* One square per palette color; tap to see only that color, tap
          again to let every note back onto the desk. */}
      <div className="color-filters">
        {
          Object.keys(NOTE_COLORS).map((name) => (
            <motion.button
              key={ name }
              type="button"
              title={ sortColor === name ? "Show every color" : `Show only ${ name } notes` }
              aria-label={ sortColor === name ? "Show every color" : `Show only ${ name } notes` }
              aria-pressed={ sortColor === name }
              className={ `color-filter ${ sortColor === name ? "active" : "" }` }
              whileHover={{ scale: 1.1, translateY: -2 }}
              whileTap={{ scale: .88 }}
              transition={ springy }
              onClick={ () => setSortColor(sortColor === name ? null : name) }
            >
              <span className={ `color-chip ${ name }-bg` } />
            </motion.button>
          ))
        }
      </div>
      <AnimatePresence>
        {
          filtersActive && (
            <motion.button
              key="clearFilters"
              type="button"
              className="clear-filters"
              initial={{ opacity: 0, scale: .7, translateX: -10 }}
              animate={{ opacity: 1, scale: 1, translateX: 0 }}
              exit={{ opacity: 0, scale: .7, translateX: -10 }}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: .92 }}
              transition={ springy }
              onClick={ clearFilters }
            >
              <FaRotateLeft className="clear-filters-icon" />
              <span>Clear</span>
            </motion.button>
          )
        }
      </AnimatePresence>
      <motion.div
        role="button"
        aria-label={ theme === "dark" ? "Switch to the light theme" : "Switch to the Ink theme" }
        whileHover={{
          scale: 1.14,
          rotate: 24,
        }}
        whileTap={{
          scale: 0.9,
        }}
        transition={ springy }
        onClick={ toggleTheme }
        className="theme"
      >
        {
          theme === "dark" ? (
            <FaSun className="theme-icon" />
          ) : (
            <FaMoon className="theme-icon" />
          )
        }
      </motion.div>
    </motion.header>
  );
}

export default Header;
