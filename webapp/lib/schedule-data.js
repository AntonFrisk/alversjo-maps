/** Minutes from 09:00 to a clock time within the Borderland day (ends next 09:00). */

function absMin(H, Min = 0) {
  if (H >= 9) return (H - 9) * 60 + Min;
  return (24 - 9 + H) * 60 + Min;
}

export const ZONES = [
  { id: 'quiet', label: 'Quiet', description: 'Strict limit to both experience and production of sound.', color: 'quiet' },
  { id: 'chill', label: 'Chill', description: 'Limit to production of sound, but not to how sound is experienced.', color: 'chill' },
  { id: 'mellow', label: 'Mellow 24h', description: 'Limit to production of sound, but it is not quiet including the night.', color: 'mellow' },
  { id: 'dayFestive', label: 'Day festive', description: 'Some limit to production of sound, mostly daytime sound camps.', color: 'dayFestive' },
  { id: 'eveningParty', label: 'Evening Party', description: 'Some limit to production of sound, mostly night time soundcamps.', color: 'eveningParty' },
  { id: 'wild', label: 'Wild', description: 'Little limit to production of sound, 24 hour high volume music.', color: 'wild' },
];

export const TIERS = [
  { id: 0, label: 'Tier 0', summary: 'All basic rules are fulfilled.' },
  { id: 1, label: 'Tier 1', summary: 'T0 + hay bales / sound blocking OR T0 + directional subs ≥10 dB-C bass decrease.' },
  { id: 2, label: 'Tier 2', summary: 'T0 + cardioid subs ≥15 dB-C OR T0 + hay bales + directional subs ≥10 dB-C.' },
  { id: 3, label: 'Tier 3', summary: 'T0 + hay bales + cardioid subs ≥15 dB-C.' },
];

const END = 24 * 60; // 1440 — minutes from 09:00 to next 09:00

function fmt(min) {
  const total = (9 * 60 + min) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function mergeSegs(raw) {
  const out = [];
  raw.forEach(([a, b, dB]) => {
    if (b <= a) return;
    const prev = out[out.length - 1];
    if (prev && prev.dB === dB && prev.end === a) prev.end = b;
    else out.push({ start: a, end: b, dB });
  });
  return out;
}

function toCells(segs) {
  return segs.map((s) => ({
    dB: s.dB,
    hours: (s.end - s.start) / 60,
    timeLabel: `${fmt(s.start)}–${fmt(s.end)}`,
  }));
}

function quiet(day) {
  if (day === 'weekday') {
    return mergeSegs([[0, absMin(12), 80], [absMin(12), absMin(22), 80], [absMin(22), absMin(2), 50], [absMin(2), END, 50]]);
  }
  return mergeSegs([[0, absMin(12), 80], [absMin(12), absMin(22), 80], [absMin(22), absMin(2), 50], [absMin(2), absMin(4), 50], [absMin(4), END, 50]]);
}

function chill() {
  return mergeSegs([[0, absMin(22), 92], [absMin(22), END, 80]]);
}

function yellow(day, tier) {
  if (day === 'weekday') {
    if (tier <= 0) {
      return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(22), 98], [absMin(22), absMin(2), 92], [absMin(2), END, 92]]);
    }
    if (tier === 1) {
      return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(24), 98], [absMin(24), absMin(2), 92], [absMin(2), END, 92]]);
    }
    if (tier === 2) {
      return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(25), 98], [absMin(25), absMin(2), 92], [absMin(2), END, 92]]);
    }
    return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(2), 98], [absMin(2), END, 92]]);
  }
  if (tier <= 0) {
    return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(2), 98], [absMin(2), absMin(4), 92], [absMin(4), END, 92]]);
  }
  if (tier === 1) return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(4), 98], [absMin(4), END, 92]]);
  if (tier === 2) return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(5), 98], [absMin(5), END, 92]]);
  return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(6), 98], [absMin(6), END, 92]]);
}

function pink(day, tier) {
  if (day === 'weekday') {
    if (tier <= 0) return mergeSegs([[0, absMin(12), 98], [absMin(12), absMin(22), 104], [absMin(22), END, 80]]);
    if (tier === 1) {
      return mergeSegs([[0, absMin(12), 98], [absMin(12), absMin(22), 104], [absMin(22), absMin(24), 104], [absMin(24), END, 80]]);
    }
    if (tier === 2) {
      return mergeSegs([[0, absMin(12), 98], [absMin(12), absMin(22), 104], [absMin(22), absMin(25), 104], [absMin(25), END, 80]]);
    }
    return mergeSegs([[0, absMin(12), 98], [absMin(12), absMin(1, 30), 107], [absMin(1, 30), END, 80]]);
  }
  if (tier <= 0) return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(2), 104], [absMin(2), END, 80]]);
  if (tier === 1) return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(3), 104], [absMin(3), END, 80]]);
  if (tier === 2) return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(4), 104], [absMin(4), END, 80]]);
  return mergeSegs([[0, absMin(12), 92], [absMin(12), absMin(4, 30), 107], [absMin(4, 30), END, 80]]);
}

function orange(day, tier) {
  if (day === 'weekday') {
    if (tier <= 0) {
      return mergeSegs([[0, absMin(12), 80], [absMin(12), absMin(22), 104], [absMin(22), absMin(2), 98], [absMin(2), END, 92]]);
    }
    if (tier === 1) {
      return mergeSegs([[0, absMin(12), 80], [absMin(12), absMin(2), 104], [absMin(2), absMin(4), 98], [absMin(4), END, 92]]);
    }
    if (tier === 2) {
      return mergeSegs([[0, absMin(12), 80], [absMin(12), absMin(4), 104], [absMin(4), END, 92]]);
    }
    return mergeSegs([[0, absMin(12), 80], [absMin(12), absMin(5), 110], [absMin(5), END, 92]]);
  }
  if (tier <= 0) {
    return mergeSegs([[0, absMin(12), 80], [absMin(12), absMin(2), 104], [absMin(2), absMin(4), 98], [absMin(4), END, 92]]);
  }
  if (tier === 1) {
    return mergeSegs([[0, absMin(12), 80], [absMin(12), absMin(5), 104], [absMin(5), absMin(6), 98], [absMin(6), END, 92]]);
  }
  if (tier === 2) {
    return mergeSegs([[0, absMin(12), 80], [absMin(12), absMin(8), 104], [absMin(8), END, 92]]);
  }
  return mergeSegs([[0, absMin(12), 80], [absMin(12), END, 110]]);
}

function wild(_day, tier) {
  const add = tier >= 2 ? 6 : tier === 1 ? 3 : 0;
  return mergeSegs([[0, END, 110 + add]]);
}

const HANDLERS = {
  quiet: (day) => quiet(day),
  chill: (day) => chill(day),
  mellow: (day, tier) => yellow(day, tier),
  dayFestive: (day, tier) => pink(day, tier),
  eveningParty: (day, tier) => orange(day, tier),
  wild: (day, tier) => wild(day, tier),
};

/** @param {'weekday'|'weekend'} dayMode */
export function getScheduleRow(zoneId, dayMode, tier) {
  const t = Math.min(3, Math.max(0, tier));
  const fn = HANDLERS[zoneId];
  if (!fn) return [];
  const segs = fn(dayMode, t);
  return toCells(segs);
}

export const SOUND_LEVEL_REF = [
  { dB: 50, text: 'Quiet café' },
  { dB: 80, text: 'Street traffic' },
  { dB: 92, text: 'Lively bar' },
  { dB: 98, text: 'Bar dance floor' },
  { dB: 104, text: 'Club dance floor' },
  { dB: 110, text: 'Rave dance floor' },
];
