// 0=quiet/blue → 10=loud/dark red
export const SOUND_NUM_COLORS = [
  '#1565c0', // 0  deep blue
  '#0288d1', // 1  medium blue
  '#00bcd4', // 2  cyan
  '#4caf50', // 3  green
  '#cddc39', // 4  lime
  '#fdd835', // 5  yellow
  '#ffc107', // 6  amber
  '#ff5722', // 7  deep orange
  '#f44336', // 8  red
  '#c62828', // 9  dark red
  '#7f0000', // 10 maroon
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
