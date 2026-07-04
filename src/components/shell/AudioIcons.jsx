// Inline SVG audio-toggle glyphs — shared by every game's BGM / SFX buttons.
// Style matches the verified Header speaker: 24 grid, strokeWidth 2, filled
// body, off state = slash. Color comes from the button's `color` (currentColor),
// which each game sets from its tokens.

// BGM — beamed music note (distinct from the SFX speaker at a glance)
export function MusicNoteIcon({ on = true, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} aria-hidden="true">
      <path d="M9 18V6l8-2.5V16" />
      <circle cx="6.6" cy="18" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="14.6" cy="15.6" r="2.4" fill="currentColor" stroke="none" />
      {!on && <line x1="4" y1="3.5" x2="20" y2="20.5" />}
    </svg>
  )
}

// SFX — speaker with wave arcs; muted = slash over the waves
export function SpeakerIcon({ on = true, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
      {on ? (
        <>
          <path d="M15 8.5a5 5 0 0 1 0 7" />
          <path d="M18 5.5a9.5 9.5 0 0 1 0 13" />
        </>
      ) : (
        <line x1="14.5" y1="8.5" x2="21.5" y2="15.5" />
      )}
    </svg>
  )
}
