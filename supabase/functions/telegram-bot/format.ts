// Formato de mensajes (HTML de Telegram) y utilidades de texto.
import type { Borrador, GoogleEvent } from "./types.ts";
import { addDays, escapeHtml, isoToLocal, isoToLocalDate, TZ, todayLocal } from "./time.ts";

const fmtFecha = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-ES", { timeZone: TZ, ...opts });

export function formatDateNice(iso: string, todoElDia: boolean): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  if (!todoElDia) {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
  }
  return fmtFecha(opts).format(new Date(iso));
}

/** "mar, 27 oct" a partir de "YYYY-MM-DD". */
export function diaCorto(fechaLocal: string): string {
  return fmtFecha({ weekday: "short", day: "numeric", month: "short" }).format(new Date(`${fechaLocal}T12:00:00Z`));
}

/** "martes 27 de octubre" a partir de "YYYY-MM-DD". */
export function diaLargo(fechaLocal: string): string {
  return fmtFecha({ weekday: "long", day: "numeric", month: "long" }).format(new Date(`${fechaLocal}T12:00:00Z`));
}

const hhmm = (iso: string) => isoToLocal(iso).slice(11, 16);

/** "mar, 27 oct, 17:00–18:00" o "mar, 27 oct (todo el día)". */
export function formatCuando(inicio: string, fin: string, todoElDia: boolean): string {
  if (todoElDia) {
    const d1 = isoToLocalDate(inicio);
    const d2 = isoToLocalDate(fin);
    return d1 === d2 ? `${diaCorto(d1)} (todo el día)` : `${diaCorto(d1)} → ${diaCorto(d2)} (todo el día)`;
  }
  const mismoDia = isoToLocalDate(inicio) === isoToLocalDate(fin);
  return mismoDia
    ? `${diaCorto(isoToLocalDate(inicio))}, ${hhmm(inicio)}–${hhmm(fin)}`
    : `${diaCorto(isoToLocalDate(inicio))} ${hhmm(inicio)} → ${diaCorto(isoToLocalDate(fin))} ${hhmm(fin)}`;
}

export function describirRepeticion(rrule: string | null): string | null {
  if (!rrule) return null;
  const freq = /FREQ=(\w+)/.exec(rrule)?.[1];
  const base = { DAILY: "cada día", WEEKLY: "cada semana", MONTHLY: "cada mes", YEARLY: "cada año" }[freq ?? ""] ?? "repetido";
  const hasta = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(rrule);
  const veces = /COUNT=(\d+)/.exec(rrule)?.[1];
  if (hasta) return `${base}, hasta el ${hasta[3]}/${hasta[2]}/${hasta[1]}`;
  if (veces) return `${base}, ${veces} veces`;
  return base;
}

export function formatDraftCard(d: Borrador, opts: { duplicado?: string | null } = {}): string {
  const editando = d.evento_id ? "✏️ <b>Cambios en un evento existente</b>" : "✨ <b>Evento preparado</b>";
  let card = `${editando}\n\n<b>📌 Título:</b> ${escapeHtml(d.titulo)}\n<b>📅 Cuándo:</b> ${formatCuando(d.fecha_inicio, d.fecha_fin, d.todo_el_dia)}\n`;
  const rep = describirRepeticion(d.recurrencia);
  if (rep) card += `<b>🔁 Se repite:</b> ${rep}\n`;
  if (d.ubicacion) card += `<b>📍 Dónde:</b> ${escapeHtml(d.ubicacion)}\n`;
  if (d.miembros_involucrados?.length) card += `<b>👥 Para:</b> ${escapeHtml(d.miembros_involucrados.join(", "))}\n`;
  if (d.llevar?.length) card += `<b>🎒 Llevar:</b> ${escapeHtml(d.llevar.join(", "))}\n`;
  if (d.descripcion) card += `<b>📝 Notas:</b> ${escapeHtml(d.descripcion)}\n`;
  if (d.imagen_url) card += `<b>🖼️ Adjunto:</b> <a href="${escapeHtml(d.imagen_url)}">ver archivo</a>\n`;
  if (opts.duplicado) card += `\n⚠️ <b>Ojo:</b> ya hay un evento parecido: <i>${escapeHtml(opts.duplicado)}</i>\n`;
  card += `\n💡 <i>Para cambiar algo, escríbeme el cambio (ej. «mejor a las 18:00»).</i>`;
  return card;
}

/** Descripción que se guarda en Google Calendar. */
export function buildDescripcion(d: Pick<Borrador, "descripcion" | "llevar" | "origen_texto" | "imagen_url">): string {
  const partes: string[] = [];
  if (d.descripcion) partes.push(d.descripcion);
  if (d.llevar?.length) partes.push(`🎒 Llevar: ${d.llevar.join(", ")}`);
  if (d.origen_texto && d.origen_texto !== "Imagen recibida" && d.origen_texto !== "Nota de voz") {
    partes.push(`💬 Mensaje original:\n${d.origen_texto}`);
  }
  if (d.imagen_url) partes.push(`🖼️ Invitación/archivo original:\n${d.imagen_url}`);
  return partes.join("\n\n");
}

export function eventoInicio(e: GoogleEvent): { iso: string; todoElDia: boolean } {
  const todoElDia = !e.start.dateTime;
  return { iso: e.start.dateTime ?? `${e.start.date}T00:00:00`, todoElDia };
}

/** Fecha local (YYYY-MM-DD) en la que empieza un evento de Google. */
export function eventoDia(e: GoogleEvent): string {
  return e.start.dateTime ? isoToLocalDate(e.start.dateTime) : (e.start.date as string);
}

export function formatEventLine(e: GoogleEvent): string {
  const hora = e.start.dateTime ? `${hhmm(e.start.dateTime)} ` : "☀️ ";
  const lugar = e.location ? ` 📍 ${escapeHtml(e.location)}` : "";
  return `• <b>${hora.trim()}</b> ${escapeHtml(e.summary ?? "(sin título)")}${lugar}`;
}

/** Agenda agrupada por día. Los eventos multi-día de día completo se muestran en su primer día. */
export function formatAgenda(events: GoogleEvent[], vacio = "<i>Nada programado.</i>"): string {
  if (!events.length) return vacio;
  const hoy = todayLocal();
  const manana = addDays(hoy, 1);
  const grupos = new Map<string, GoogleEvent[]>();
  for (const e of events) {
    const dia = eventoDia(e);
    grupos.set(dia, [...(grupos.get(dia) ?? []), e]);
  }
  const bloques: string[] = [];
  for (const [dia, lista] of [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const etiqueta = dia === hoy ? "Hoy" : dia === manana ? "Mañana" : "";
    const titulo = `📆 <b>${etiqueta ? `${etiqueta} · ` : ""}${diaLargo(dia)}</b>`;
    bloques.push(`${titulo}\n${lista.map(formatEventLine).join("\n")}`);
  }
  return bloques.join("\n\n");
}

// ---------- Detección de duplicados ----------
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Se comparan las 5 primeras letras de cada palabra para que "cumple" y "cumpleaños" coincidan.
const palabrasClave = (t: string) => new Set(normalizar(t).split(" ").filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));

/** Dos títulos se consideran parecidos si comparten al menos 2 palabras clave o todas las de uno de ellos. */
export function titulosParecidos(a: string, b: string): boolean {
  const pa = palabrasClave(a);
  const pb = palabrasClave(b);
  if (!pa.size || !pb.size) return normalizar(a) === normalizar(b);
  let comunes = 0;
  for (const w of pa) if (pb.has(w)) comunes++;
  return comunes >= 2 || comunes === Math.min(pa.size, pb.size);
}

/** Trocea un mensaje largo respetando el límite de Telegram (4096 caracteres). */
export function trocear(texto: string, max = 3800): string[] {
  if (texto.length <= max) return [texto];
  const trozos: string[] = [];
  let actual = "";
  for (const bloque of texto.split("\n\n")) {
    if ((actual + "\n\n" + bloque).length > max && actual) {
      trozos.push(actual);
      actual = bloque;
    } else {
      actual = actual ? `${actual}\n\n${bloque}` : bloque;
    }
  }
  if (actual) trozos.push(actual);
  return trozos;
}
