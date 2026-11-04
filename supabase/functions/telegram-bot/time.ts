// Utilidades de fechas con zona horaria de Madrid (incluye cambio de horario verano/invierno).
import type { Repeticion } from "./types.ts";

export const TZ = "Europe/Madrid";

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Descompone un instante en los componentes de hora local de Madrid. */
export function madridParts(date: Date): LocalParts {
  const map: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = parseInt(p.value, 10);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second
  };
}

/** Diferencia (en ms) entre la hora local de Madrid y UTC en un instante dado. */
function offsetMs(utcMs: number): number {
  const p = madridParts(new Date(utcMs));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** Convierte "YYYY-MM-DDTHH:mm:ss" (hora de Madrid) a ISO UTC. Devuelve null si no es válido. */
export function localToIso(local: string): string | null {
  const m = LOCAL_RE.exec((local || "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(asUtc)) return null;
  const guess = asUtc - offsetMs(asUtc);
  const result = asUtc - offsetMs(guess);
  return new Date(result).toISOString();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Instante ISO -> "YYYY-MM-DDTHH:mm:ss" en hora de Madrid. */
export function isoToLocal(iso: string | Date): string {
  const p = madridParts(typeof iso === "string" ? new Date(iso) : iso);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Instante ISO -> "YYYY-MM-DD" en hora de Madrid. */
export function isoToLocalDate(iso: string | Date): string {
  return isoToLocal(iso).slice(0, 10);
}

/** Suma días a una fecha "YYYY-MM-DD" (sin problemas de zona horaria). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Inicio (00:00 Madrid) de un día "YYYY-MM-DD" como ISO UTC. */
export function dayStartIso(dateStr: string): string {
  return localToIso(`${dateStr}T00:00:00`)!;
}

/** Fecha de hoy en Madrid "YYYY-MM-DD". */
export function todayLocal(now = new Date()): string {
  return isoToLocalDate(now);
}

/** Escapa texto para el formato HTML de Telegram. */
export function escapeHtml(text: string | null | undefined): string {
  return (text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface Cumple {
  fecha: string; // próxima fecha YYYY-MM-DD
  edad: number; // edad que cumple en esa fecha
  dias: number; // días que faltan (0 = hoy)
}

/** Próximo cumpleaños a partir de hoy (Madrid). */
export function proximoCumple(cumpleanos: string, now = new Date()): Cumple {
  const [anio, mes, dia] = cumpleanos.split("-").map(Number);
  const hoy = todayLocal(now);
  const [hy] = hoy.split("-").map(Number);
  let fecha = `${hy}-${pad(mes)}-${pad(dia)}`;
  if (fecha < hoy) fecha = `${hy + 1}-${pad(mes)}-${pad(dia)}`;
  const [fy, fm, fd] = fecha.split("-").map(Number);
  const [ty, tm, td] = hoy.split("-").map(Number);
  const dias = Math.round((Date.UTC(fy, fm - 1, fd) - Date.UTC(ty, tm - 1, td)) / 86400000);
  return { fecha, edad: fy - anio, dias };
}

const DIAS_RRULE: Record<string, string> = {
  LU: "MO", MA: "TU", MI: "WE", JU: "TH", VI: "FR", SA: "SA", DO: "SU",
  MO: "MO", TU: "TU", WE: "WE", TH: "TH", FR: "FR", SU: "SU"
};

/** Construye la regla de repetición de Google (RRULE) a partir de la respuesta de la IA. */
export function buildRRule(rep: Repeticion | null | undefined): string | null {
  if (!rep || !rep.frecuencia) return null;
  const freq = rep.frecuencia.toUpperCase();
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const parts = [`FREQ=${freq}`];
  if (freq === "WEEKLY" && rep.diasSemana?.length) {
    const dias = rep.diasSemana.map((d) => DIAS_RRULE[d.toUpperCase().slice(0, 2)]).filter(Boolean);
    if (dias.length) parts.push(`BYDAY=${[...new Set(dias)].join(",")}`);
  }
  if (rep.hasta && /^\d{4}-\d{2}-\d{2}$/.test(rep.hasta)) {
    const fin = localToIso(`${rep.hasta}T23:59:59`);
    if (fin) parts.push(`UNTIL=${fin.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  } else if (rep.veces && rep.veces > 0) {
    parts.push(`COUNT=${Math.min(Math.floor(rep.veces), 366)}`);
  }
  return `RRULE:${parts.join(";")}`;
}
