import React from 'react';

// Same flattened geometry as docs/logo.svg and the renderer's EVoiceMark (340-unit space).
const BARS =
  'M101.5 44C101.5 27.984 114.484 15 130.5 15C146.516 15 159.5 27.984 159.5 44V150.171Q149.405 165.615 130.25 172Q149.405 178.385 159.5 193.829V296C159.5 312.016 146.516 325 130.5 325C114.484 325 101.5 312.016 101.5 296ZM173 120C173 103.984 185.984 91 202 91C218.016 91 231 103.984 231 120V225C231 241.016 218.016 254 202 254C185.984 254 173 241.016 173 225V193.829Q183.095 178.385 202.25 172Q183.095 165.615 173 150.171ZM30 124C30 107.984 42.984 95 59 95C75.016 95 88 107.984 88 124V215C88 231.016 75.016 244 59 244C42.984 244 30 231.016 30 215ZM244.5 161C244.5 144.984 257.484 132 273.5 132C289.516 132 302.5 144.984 302.5 161V184C302.5 200.016 289.516 213 273.5 213C257.484 213 244.5 200.016 244.5 184Z';
const SPARK = 'M273.5 42.5Q282.5 69.5 309.5 78.5Q282.5 87.5 273.5 114.5Q264.5 87.5 237.5 78.5Q264.5 69.5 273.5 42.5Z';

/**
 * The eVoice Studio mark in one colour (`currentColor`) for the shared legacy chrome:
 * four voice bars with a cut-out star, and a star above. The desktop icon draws it
 * in the brand gradient on a dark tile.
 */
export default function VoiceStudioMark({ className = '', title, ...props }) {
  return (
    <svg
      viewBox="0 0 340 340"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d={BARS} fill="currentColor" />
      <path d={SPARK} fill="currentColor" opacity="0.72" />
    </svg>
  );
}
