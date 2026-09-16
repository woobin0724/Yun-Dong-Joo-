import { config } from '../config.js';

const dayFormatters = new Map();
const partsFormatters = new Map();

function dayFormatter(tz) {
  if (!dayFormatters.has(tz)) {
    dayFormatters.set(
      tz,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    );
  }
  return dayFormatters.get(tz);
}

function partsFormatter(tz) {
  if (!partsFormatters.has(tz)) {
    partsFormatters.set(
      tz,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    );
  }
  return partsFormatters.get(tz);
}

/** 앱 기준 시간대의 날짜 키(YYYY-MM-DD). */
export function dayKey(date = new Date(), tz = config.timezone) {
  return dayFormatter(tz).format(date); // en-CA 는 YYYY-MM-DD 형식
}

/** 앱 기준 시간대의 {day, hour, minute}. */
export function localParts(date = new Date(), tz = config.timezone) {
  const parts = Object.fromEntries(
    partsFormatter(tz)
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** YYYY-MM-DD 에 일수를 더한다. */
export function addDays(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** 두 날짜 키 사이의 일수 차이 (a - b). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

/** 해당 날짜가 속한 주의 월요일. */
export function weekStart(day) {
  const dt = new Date(`${day}T00:00:00Z`);
  const dow = (dt.getUTCDay() + 6) % 7; // 월=0
  return addDays(day, -dow);
}
