import type { Mood } from './db';

/** The fixed five-face set used for "how I feel" notes. */
export const MOODS: { value: Mood; emoji: string }[] = [
  { value: 1, emoji: '😣' },
  { value: 2, emoji: '😕' },
  { value: 3, emoji: '😐' },
  { value: 4, emoji: '🙂' },
  { value: 5, emoji: '😄' },
];
