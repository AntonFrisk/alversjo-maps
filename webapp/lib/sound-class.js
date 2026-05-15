// 0=quiet/green → 10=loud/deep red
export const SOUND_NUM_COLORS = [
  '#3cc954', // 0
  '#6dbf47', // 1
  '#9eb53a', // 2
  '#cfab2d', // 3
  '#f1ae29', // 4
  '#e89422', // 5
  '#cc4515', // 6
  '#cc1b15', // 7
  '#b5140f', // 8
  '#9e100c', // 9
  '#870d09', // 10
];

// Letter badge display colors — used in UI only, never stored in GeoJSON
export const SOUND_CLASS_COLORS = {
  A: '#cc1b15',
  B: '#cc4515',
  C: '#f1ae29',
  D: '#ffcc01',
  E: '#3cc954',
  none: '#888',
};

// Letter-mode feature colors (used for map4/map5 where only letter class matters)
export const SOUND_LETTER_COLORS = {
  A: '#cc1b15',  // red
  B: '#e89422',  // orange
  C: '#e75480',  // pink
  D: '#ffcc01',  // yellow
  E: '#3cc954',  // green
  F: '#4a90d9',  // blue
  none: '#888',  // gray
};

const CLASS_RANGES = [
  { letter: 'E', min: 0, max: 0 },
  { letter: 'D', min: 1, max: 2 },
  { letter: 'C', min: 3, max: 4 },
  { letter: 'B', min: 5, max: 6 },
  { letter: 'A', min: 7, max: 10 },
];

/**
 * Derive sound class letter and on-map feature color from a sound-class-num (0-10).
 *
 * featureColor → written to marker-color / fill in GeoJSON properties
 * soundClass   → written to sound-class in GeoJSON properties
 * letterColor  → display-only, used for the class badge background in the UI
 */
export function deriveFromNum(n) {
  const num = Math.max(0, Math.min(10, Math.round(Number(n))));
  const soundClass = CLASS_RANGES.find((r) => num >= r.min && num <= r.max)?.letter ?? 'E';
  return {
    soundClass,
    featureColor: SOUND_NUM_COLORS[num],
    letterColor: SOUND_CLASS_COLORS[soundClass],
  };
}
