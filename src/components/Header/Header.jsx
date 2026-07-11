import { motion } from 'framer-motion';
import { FaStar, FaMoon, FaSun } from "react-icons/fa6";

import searchIcon from '../../assets/icons/search.svg';

import './Header.css';

const Header = ({
  setNotesSortText,
  notesSortByFavorite,
  setNotesSortByFavorite,
  theme,
  toggleTheme,
}) => {
  const handleSearch = (e) => {
    setNotesSortText((e.target.value).toLowerCase());
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
          onChange={ handleSearch }
        />
        <motion.div
          whileHover={{
            scale: 1.14
          }}
          whileTap={{
            scale: 0.96
          }}
          transition={{
            scale: {
              type: "spring",
              stiffness: 400,
              damping: 17,
            },
          }}
          onClick={ setNotesSortByFavorite }
          style={{
            backgroundColor: notesSortByFavorite ? "var(--black-color)" : "rgb(200, 200, 200)"
          }}
          className="star"
        >
          <FaStar
            className="star-icon"
          />
        </motion.div>
      </div>
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
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 17,
        }}
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
