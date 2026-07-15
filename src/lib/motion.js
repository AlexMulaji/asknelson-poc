// Shared Framer Motion variants for consistent entrance choreography.
// Wrap a list in motion.div variants={listContainer} initial="hidden" animate="show"
// and give each child variants={listItem} for a gentle staggered rise.
// (MotionConfig reducedMotion="user" in App.jsx makes these respect the OS setting.)

export const listContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
}

export const listItem = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 360, damping: 30 },
  },
}

// A simple fade-and-rise for single blocks (heroes, result sections).
export const fadeRise = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
}

// Horizontal slide for the one-question-at-a-time flow.
export const questionSlide = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 340, damping: 32 } },
  exit: { opacity: 0, x: -24, transition: { duration: 0.18, ease: 'easeIn' } },
}
