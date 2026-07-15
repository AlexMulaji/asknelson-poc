import { motion, MotionConfig } from 'framer-motion'

// Decorative, animated scene that reflects the chosen ambient sound.
// Pure inline SVG (no icon library), soft-gradient palette to match the v2 look.
// All motion uses transform properties, so it goes still for users who prefer
// reduced motion (via MotionConfig in App.jsx).

const SCENES = {
  none: { sky: ['#EAEEF8', '#F6F7FB'], accent: '#172B5C', caption: 'Silence' },
  rain: { sky: ['#C7D4E6', '#EAF0F7'], accent: '#4F6D8C', caption: 'Rainfall' },
  forest: { sky: ['#D8EED2', '#F0F7EC'], accent: '#3FA035', caption: 'Forest' },
  ocean: { sky: ['#C6E4EF', '#EAF4F9'], accent: '#185FA5', caption: 'Ocean waves' },
  bowls: { sky: ['#F4E1CC', '#FBEFE0'], accent: '#D8893A', caption: 'Singing bowls' },
}

// Deterministic "random-ish" spread so layouts are stable between renders.
const RAIN = Array.from({ length: 16 }, (_, i) => ({
  x: 18 + i * 23 + (i % 3) * 6,
  delay: (i % 7) * 0.18,
  dur: 0.9 + (i % 4) * 0.16,
  len: 8 + (i % 3) * 4,
}))

const LEAVES = [
  { x: 70, delay: 0, dur: 6, drift: 16 },
  { x: 190, delay: 1.6, dur: 7.2, drift: -14 },
  { x: 300, delay: 3.1, dur: 6.6, drift: 12 },
]

export default function SoundScene({ sound = 'none', isRunning = false }) {
  const scene = SCENES[sound] || SCENES.none
  const { accent } = scene

  return (
    // The scene's gentle, slow ambiance is part of the meditation experience, so
    // it keeps moving even under "reduce motion" — unlike the app's larger
    // entrance/transition animations, which still respect the OS setting.
    <MotionConfig reducedMotion="never">
    <div
      className="relative overflow-hidden rounded-hero shadow-card"
      style={{ background: `linear-gradient(180deg, ${scene.sky[0]} 0%, ${scene.sky[1]} 100%)` }}
    >
      <svg
        viewBox="0 0 400 168"
        className="block h-[150px] w-full lg:h-[180px]"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={`${scene.caption} scene`}
      >
        {sound === 'none' && <NoneScene accent={accent} />}
        {sound === 'rain' && <RainScene accent={accent} isRunning={isRunning} />}
        {sound === 'forest' && <ForestScene accent={accent} />}
        {sound === 'ocean' && <OceanScene accent={accent} />}
        {sound === 'bowls' && <BowlsScene accent={accent} />}
      </svg>

      {/* Caption chip */}
      <span
        className="absolute bottom-3 left-4 rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold backdrop-blur-sm"
        style={{ color: accent }}
      >
        {scene.caption}
      </span>
    </div>
    </MotionConfig>
  )
}

/* ── Scenes ─────────────────────────────────────────────────────────────── */

function NoneScene({ accent }) {
  return (
    <g>
      {/* Soft sun/orb, gently breathing */}
      <motion.circle
        cx="200"
        cy="86"
        r="34"
        fill={accent}
        opacity="0.12"
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <circle cx="200" cy="86" r="20" fill={accent} opacity="0.18" />
      {/* Slow drifting motes */}
      {[60, 130, 270, 330].map((x, i) => (
        <motion.circle
          key={x}
          cx={x}
          cy={50 + (i % 2) * 60}
          r="3"
          fill={accent}
          opacity="0.25"
          animate={{ y: [0, -8, 0], opacity: [0.15, 0.35, 0.15] }}
          transition={{ duration: 5 + i, repeat: Infinity, ease: 'easeInOut', delay: i * 0.6 }}
        />
      ))}
    </g>
  )
}

function RainScene({ accent, isRunning }) {
  return (
    <g>
      {/* Cloud */}
      <g opacity="0.9">
        <ellipse cx="150" cy="44" rx="46" ry="22" fill="#FFFFFF" opacity="0.75" />
        <ellipse cx="196" cy="38" rx="34" ry="24" fill="#FFFFFF" opacity="0.7" />
        <ellipse cx="240" cy="48" rx="40" ry="20" fill="#FFFFFF" opacity="0.65" />
      </g>
      {/* Falling drops */}
      {RAIN.map((d, i) => (
        <motion.line
          key={i}
          x1={d.x}
          x2={d.x}
          y1={60}
          y2={60 + d.len}
          stroke={accent}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.5"
          animate={{ y: [0, 120], opacity: [0, 0.55, 0] }}
          transition={{
            duration: isRunning ? d.dur : d.dur * 1.5,
            repeat: Infinity,
            ease: 'easeIn',
            delay: d.delay,
          }}
        />
      ))}
    </g>
  )
}

function ForestScene({ accent }) {
  const tree = (x, h, c) => (
    <g>
      <rect x={x - 2.5} y={120} width="5" height="22" rx="2" fill="#8A6A4A" opacity="0.7" />
      <path d={`M ${x} ${118 - h} L ${x - 22} ${122} L ${x + 22} ${122} Z`} fill={c} opacity="0.85" />
      <path d={`M ${x} ${108 - h} L ${x - 17} ${102} L ${x + 17} ${102} Z`} fill={c} />
    </g>
  )
  return (
    <g>
      {/* Soft sun */}
      <circle cx="320" cy="48" r="22" fill={accent} opacity="0.16" />
      {/* Rolling hills */}
      <path d="M0 142 Q 120 118 240 138 T 400 132 L400 168 L0 168 Z" fill={accent} opacity="0.18" />
      {/* Trees */}
      {tree(70, 54, accent)}
      {tree(150, 70, accent)}
      {tree(250, 48, accent)}
      {/* Drifting leaves */}
      {LEAVES.map((l, i) => (
        <motion.path
          key={i}
          d={`M ${l.x} 30 q 6 4 0 10 q -6 -4 0 -10 Z`}
          fill={accent}
          opacity="0.6"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={{ y: [0, 120], x: [0, l.drift, 0], rotate: [0, 180, 360], opacity: [0, 0.7, 0] }}
          transition={{ duration: l.dur, repeat: Infinity, ease: 'easeIn', delay: l.delay }}
        />
      ))}
    </g>
  )
}

function OceanScene({ accent }) {
  const wave = (y, opacity, dur, dir) => (
    <motion.path
      d={`M-60 ${y} q 40 -14 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 L 540 168 L -60 168 Z`}
      fill={accent}
      opacity={opacity}
      animate={{ x: dir > 0 ? [0, -80, 0] : [0, 80, 0] }}
      transition={{ duration: dur, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
  return (
    <g>
      {/* Low sun on the horizon */}
      <circle cx="300" cy="64" r="24" fill={accent} opacity="0.16" />
      <circle cx="300" cy="64" r="13" fill={accent} opacity="0.22" />
      {/* Layered swelling waves */}
      {wave(118, 0.16, 7, 1)}
      {wave(130, 0.24, 5.5, -1)}
      {wave(144, 0.4, 4.5, 1)}
    </g>
  )
}

function BowlsScene({ accent }) {
  return (
    <g>
      {/* Concentric sound ripples rising from the bowl */}
      {[0, 1, 2].map((i) => (
        <motion.ellipse
          key={i}
          cx="200"
          cy="120"
          rx="40"
          ry="14"
          fill="none"
          stroke={accent}
          strokeWidth="2"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={{ scale: [0.6, 1.8], opacity: [0.5, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeOut', delay: i * 1.06 }}
        />
      ))}
      {/* The bowl */}
      <path d="M158 116 a 42 42 0 0 0 84 0 Z" fill={accent} opacity="0.85" />
      <ellipse cx="200" cy="116" rx="42" ry="11" fill={accent} opacity="0.45" />
      <ellipse cx="200" cy="116" rx="30" ry="7" fill="#FFFFFF" opacity="0.25" />
    </g>
  )
}
