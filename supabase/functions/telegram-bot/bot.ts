// Lógica del bot de Telegram: acceso, comandos, borradores, avisos y resúmenes.
import { Bot, Context, InlineKeyboard } from "grammy";
import { config } from "./config.ts";
import {
  actualizarBorrador, actualizarEvento, addApodo, aprobarChat, borrarEventoLogico, caducarBorradores, chatsActivos,
  chatsAdmin, crearBorrador, eventosDelDia, eventosParaAviso, getBorrador, getChat, getEvento, getMembers,
  insertarEvento, LIMITE_ADJUNTO_BYTES, limpiarUpdatesAntiguos, marcarAviso, marcarBorrador, MIMES_ADMITIDOS,
  proximosEventos, reclamarBorrador, reclamarUpdate, registrarChatPendiente, setChatFlag, setColor, subirAdjunto, ultimoBorradorPendiente
} from "./repo.ts";
import type { Borrador, EventoDB, EventoIA, GoogleEvent, Miembro } from "./types.ts";
import {
  addDays, buildRRule, dayStartIso, escapeHtml, isoToLocal, isoToLocalDate, localToIso, madridParts, proximoCumple, todayLocal
} from "./time.ts";
import {
  buildDescripcion, diaCorto, eventoDia, eventoInicio, formatAgenda, formatCuando, formatDateNice, formatDraftCard,
  normalizar, titulosParecidos, trocear
} from "./format.ts";
import {
  deleteGoogleEvent, insertGoogleEvent, listGoogleEvents, updateGoogleEvent
} from "./google.ts";
import { interpretarMensaje, responderPregunta, type Adjunto } from "./gemini.ts";

export const bot = new Bot(config.telegramToken);

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

export const COMANDOS = [
  { command: "hoy", description: "Eventos de hoy" },
  { command: "manana", description: "Eventos de mañana" },
  { command: "semana", description: "Agenda de los próximos 7 días" },
  { command: "agenda", description: "Agenda de una persona" },
  { command: "cumples", description: "Cumpleaños de la familia" },
  { command: "editar", description: "Modificar un evento ya creado" },
  { command: "borrar", description: "Eliminar un evento" },
  { command: "miembros", description: "Ver miembros y apodos" },
  { command: "avisos", description: "Activar/desactivar recordatorios" },
  { command: "diario", description: "Activar/desactivar resumen diario" },
  { command: "ayuda", description: "Cómo usar el bot" }
];

// ------------------------------------------------------------------
// UTILIDADES
// ------------------------------------------------------------------

async function responder(ctx: Context, texto: string, extra: Record<string, unknown> = {}) {
  const trozos = trocear(texto);
  for (let i = 0; i < trozos.length; i++) {
    await ctx.reply(trozos[i], { ...HTML, ...(i === trozos.length - 1 ? extra : {}) });
  }
}

async function conTyping<T>(ctx: Context, fn: () => Promise<T>): Promise<T> {
  const chatId = ctx.chat!.id;
  const enviar = () => ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  await enviar();
  const t = setInterval(enviar, 4000);
  try {
    return await fn();
  } finally {
    clearInterval(t);
  }
}

function aBase64(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

const esGrupo = (ctx: Context) => ctx.chat?.type !== "private";

function resolverMiembro(miembros: Miembro[], texto: string): Miembro | null {
  const t = normalizar(texto);
  if (!t) return null;
  return miembros.find((m) => normalizar(m.nombre) === t || (m.apodos ?? []).some((a) => normalizar(a) === t)) ?? null;
}

/** Color de Google (1-11) si la persona del evento tiene uno asignado con /color. */
function colorDe(miembros: Miembro[], nombres: string[]): string | null {
  const colores = new Set<string>();
  for (const n of nombres) {
    const m = resolverMiembro(miembros, n);
    if (m?.color && /^([1-9]|1[01])$/.test(m.color)) colores.add(m.color);
  }
  return colores.size === 1 ? [...colores][0] : null;
}

function borradorAEventoIA(d: Borrador): EventoIA {
  return {
    titulo: d.titulo,
    fechaInicio: isoToLocal(d.fecha_inicio),
    fechaFin: isoToLocal(d.fecha_fin),
    todoElDia: d.todo_el_dia,
    ubicacion: d.ubicacion,
    miembrosInvolucrados: d.miembros_involucrados ?? [],
    notas: d.descripcion,
    llevar: d.llevar ?? [],
    confirmarAntes: null,
    repeticion: null
  };
}

function eventoIAABorrador(e: EventoIA) {
  let descripcion = e.notas ?? "";
  if (e.confirmarAntes) {
    descripcion += `${descripcion ? "\n" : ""}⚠️ Confirmar asistencia antes del ${e.confirmarAntes.split("-").reverse().join("/")}`;
  }
  return {
    titulo: e.titulo,
    descripcion: descripcion || null,
    fecha_inicio: localToIso(e.fechaInicio)!,
    fecha_fin: localToIso(e.fechaFin)!,
    todo_el_dia: e.todoElDia,
    ubicacion: e.ubicacion,
    miembros_involucrados: e.miembrosInvolucrados,
    llevar: e.llevar,
    recurrencia: buildRRule(e.repeticion)
  };
}

function tecladoBorrador(d: Borrador): InlineKeyboard {
  return new InlineKeyboard()
    .text(d.evento_id ? "💾 Guardar cambios" : "✅ Crear evento", `confirm:${d.id}`)
    .text("❌ Descartar", `cancel:${d.id}`)
    .row()
    .text(d.todo_el_dia ? "🕐 Poner hora" : "☀️ Todo el día", `toggle_dia:${d.id}`)
    .text("✏️ Corregir", `edit_draft:${d.id}`);
}

async function eventoDuplicado(d: Pick<Borrador, "titulo" | "fecha_inicio" | "evento_id">): Promise<string | null> {
  if (d.evento_id) return null;
  const delDia = await eventosDelDia(isoToLocalDate(d.fecha_inicio));
  return delDia.find((e) => titulosParecidos(e.titulo, d.titulo))?.titulo ?? null;
}

const MENCION_FECHA = /\b(\d{1,2}[:.h]\d{2}|\d{1,2}\s+de\s+\w+|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|ma[ñn]ana|hoy|pasado|semana|\d{1,2}\/\d{1,2}|cumple|cita|reuni[oó]n|excursi[oó]n)\b/i;

// ------------------------------------------------------------------
// MIDDLEWARES: reintentos, errores y control de acceso
// ------------------------------------------------------------------

bot.catch((err) => console.error("Error no controlado:", err.error));

bot.use(async (ctx, next) => {
  if (!(await reclamarUpdate(ctx.update.update_id))) return; // reintento de Telegram: ya procesado
  await next();
});

async function pedirAprobacion(ctx: Context) {
  const chat = ctx.chat!;
  const titulo = chat.type === "private"
    ? [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Privado"
    : (chat as { title?: string }).title ?? "Grupo";
  await registrarChatPendiente(chat.id, chat.type, titulo);
  const admins = await chatsAdmin();
  const quien = `${escapeHtml(ctx.from?.first_name ?? "Alguien")}${ctx.from?.username ? ` (@${escapeHtml(ctx.from.username)})` : ""}`;
  const teclado = new InlineKeyboard().text("✅ Aprobar", `aprobar:${chat.id}`).text("🚫 Rechazar", `rechazar:${chat.id}`);
  for (const a of admins) {
    await bot.api.sendMessage(
      a.chat_id,
      `🔔 <b>Solicitud de acceso</b>\n\nChat: <b>${escapeHtml(titulo)}</b> (${chat.type})\nDe: ${quien}\n\n¿Le doy acceso al calendario familiar?`,
      { ...HTML, reply_markup: teclado }
    ).catch((e) => console.error("aviso admin:", e));
  }
}

bot.use(async (ctx, next) => {
  if (!ctx.chat) return;
  const chat = await getChat(ctx.chat.id);
  const aprobado = chat?.aprobado === true && chat.activo !== false;
  const esStart = ctx.message?.text?.startsWith("/start") ?? false;

  if (aprobado) return await next();

  if (esStart) {
    if (chat) {
      await ctx.reply("⏳ Tu solicitud está pendiente de aprobación. Te avisaré cuando puedas usar el bot.");
    } else {
      await pedirAprobacion(ctx);
      await ctx.reply("👋 Hola. Este calendario es privado: he enviado tu solicitud al administrador. Te avisaré cuando te dé acceso.");
    }
    return;
  }
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: "No autorizado", show_alert: true }).catch(() => {});
    return;
  }
  if (!esGrupo(ctx)) await ctx.reply("⛔ Este bot es privado. Envía /start para solicitar acceso.");
});

// ------------------------------------------------------------------
// /start, /ayuda, aprobación
// ------------------------------------------------------------------

bot.command("start", async (ctx) => {
  await responder(
    ctx,
    `👋 <b>¡Hola! Soy el asistente del Calendario Familiar.</b>\n\n` +
      `Envíame un <b>texto</b>, una <b>foto o PDF</b> (invitaciones, circulares, citas) o una <b>nota de voz</b> y te preparo el evento.\n` +
      `Ejemplo: <i>«Pediatra de NombreHijo1 el martes a las 17:30»</i>\n\n` +
      `Escribe /ayuda para ver todo lo que puedo hacer.`
  );
});

bot.command("ayuda", async (ctx) => {
  await responder(
    ctx,
    `ℹ️ <b>Cómo usarme</b>\n\n` +
      `<b>Crear un evento</b>\nEscribe, envía una foto/PDF o una nota de voz. Verás una tarjeta con botones: ✅ crear, ❌ descartar, ☀️ todo el día o ✏️ corregir.\n\n` +
      `<b>Corregir</b>\nTras ver la tarjeta, escribe el cambio («mejor a las 18:00», «es en el parque»).\n\n` +
      `<b>Eventos repetidos</b>\n«Natación todos los martes a las 17:30 hasta junio».\n\n` +
      `<b>Preguntas</b>\n«¿Qué tiene NombreHija2 el viernes?» (termina con ?)\n\n` +
      `<b>Comandos</b>\n` +
      `/hoy · /manana · /semana\n/agenda <i>Nombre</i> — agenda de una persona\n/cumples — cumpleaños\n` +
      `/editar — modificar un evento\n/borrar — eliminar un evento\n` +
      `/miembros — personas y apodos · /apodo <i>Nombre apodo</i> · /color <i>Nombre 1-11</i>\n` +
      `/avisos <i>on|off</i> — recordatorios en este chat\n/diario <i>on|off</i> — resumen cada mañana (8:00)\n\n` +
      `<b>Automático</b>\nResumen semanal los domingos a las 20:00 y recordatorios el día antes y 1 hora antes.`
  );
});

bot.callbackQuery(/^(aprobar|rechazar):(-?\d+)$/, async (ctx) => {
  const actual = await getChat(ctx.chat!.id);
  if (!actual?.es_admin) return ctx.answerCallbackQuery({ text: "Solo el administrador puede hacer esto", show_alert: true });
  const objetivo = Number(ctx.match[2]);
  const aprobar = ctx.match[1] === "aprobar";
  await aprobarChat(objetivo, aprobar);
  await ctx.answerCallbackQuery({ text: aprobar ? "Aprobado" : "Rechazado" });
  await ctx.editMessageText(aprobar ? "✅ <b>Acceso concedido.</b>" : "🚫 <b>Solicitud rechazada.</b>", HTML).catch(() => {});
  await bot.api
    .sendMessage(objetivo, aprobar ? "✅ ¡Listo! Ya puedes usar el bot. Escribe /ayuda para empezar." : "🚫 No se ha concedido acceso a este chat.")
    .catch(() => {});
});

// ------------------------------------------------------------------
// CONSULTAS: hoy, mañana, semana, agenda, cumples
// ------------------------------------------------------------------

async function eventosDelRango(desdeDia: string, hastaDiaExcl: string): Promise<GoogleEvent[]> {
  return await listGoogleEvents(dayStartIso(desdeDia), dayStartIso(hastaDiaExcl));
}

function cumplesEnVentana(miembros: Miembro[], dias: number): string[] {
  const lineas: string[] = [];
  for (const m of miembros) {
    if (!m.cumpleanos) continue;
    const c = proximoCumple(m.cumpleanos);
    if (c.dias > dias) continue;
    const cuando = c.dias === 0 ? "¡HOY!" : c.dias === 1 ? "mañana" : `el ${diaCorto(c.fecha)}`;
    lineas.push(`🎉 <b>${escapeHtml(m.nombre)}</b> cumple ${c.edad} años ${cuando} ${m.emoji ?? "🎂"}`);
  }
  return lineas;
}

async function textoDia(fecha: string, titulo: string): Promise<string> {
  const [eventos, miembros] = await Promise.all([eventosDelRango(fecha, addDays(fecha, 1)), getMembers()]);
  const cumples = miembros
    .filter((m) => m.cumpleanos && proximoCumple(m.cumpleanos, new Date(`${fecha}T12:00:00Z`)).dias === 0)
    .map((m) => `🎉 Hoy cumple ${escapeHtml(m.nombre)} ${m.emoji ?? "🎂"}`);
  let msg = `📅 <b>${titulo}</b>\n\n`;
  if (cumples.length) msg += cumples.join("\n") + "\n\n";
  msg += formatAgenda(eventos, "☀️ <i>No hay eventos programados.</i>");
  return msg;
}

bot.command("hoy", async (ctx) => {
  try {
    await responder(ctx, await textoDia(todayLocal(), "Hoy"));
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ No pude consultar el calendario ahora mismo. Inténtalo de nuevo en un momento.");
  }
});

bot.command("manana", async (ctx) => {
  try {
    await responder(ctx, await textoDia(addDays(todayLocal(), 1), "Mañana"));
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ No pude consultar el calendario ahora mismo. Inténtalo de nuevo en un momento.");
  }
});

export async function textoSemanal(): Promise<string> {
  const hoy = todayLocal();
  const fin = addDays(hoy, 7);
  const [eventos, miembros] = await Promise.all([eventosDelRango(hoy, fin), getMembers()]);
  let msg = `📅 <b>Agenda familiar · ${diaCorto(hoy)} – ${diaCorto(addDays(fin, -1))}</b>\n\n`;
  const cumples = cumplesEnVentana(miembros, 7);
  if (cumples.length) msg += `🎂 <b>Cumpleaños de la semana</b>\n${cumples.join("\n")}\n\n`;
  msg += formatAgenda(eventos, "☀️ <i>No hay eventos programados esta semana.</i>");
  return msg;
}

bot.command(["semana", "resumen"], async (ctx) => {
  try {
    await responder(ctx, await textoSemanal());
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ No pude consultar el calendario ahora mismo. Inténtalo de nuevo en un momento.");
  }
});

async function mostrarAgendaPersona(ctx: Context, miembro: Miembro) {
  const hoy = todayLocal();
  const [eventos, registrados] = await Promise.all([eventosDelRango(hoy, addDays(hoy, 15)), proximosEventos(200)]);
  const porGoogleId = new Map<string, EventoDB>(registrados.map((r) => [r.google_event_id, r]));
  const claves = [miembro.nombre, ...(miembro.apodos ?? [])].map(normalizar);

  const propios = eventos.filter((e) => {
    const texto = normalizar(`${e.summary ?? ""} ${e.description ?? ""}`);
    if (claves.some((c) => c && texto.includes(c))) return true;
    const reg = porGoogleId.get(e.id.split("_")[0]);
    return !!reg?.miembros_involucrados?.some((n) => claves.includes(normalizar(n)) || normalizar(n) === "familia");
  });

  const titulo = `${miembro.emoji ?? "👤"} <b>${escapeHtml(miembro.nombre)} · próximos 14 días</b>`;
  const texto = `${titulo}\n\n${formatAgenda(propios, "<i>No hay eventos programados.</i>")}`;
  if (ctx.callbackQuery) await ctx.editMessageText(texto, HTML).catch(() => responder(ctx, texto));
  else await responder(ctx, texto);
}

bot.command("agenda", async (ctx) => {
  const miembros = (await getMembers()).filter((m) => normalizar(m.nombre) !== "familia");
  const arg = ctx.match?.toString().trim();
  if (!arg) {
    const teclado = new InlineKeyboard();
    miembros.forEach((m, i) => {
      teclado.text(`${m.emoji ?? "👤"} ${m.nombre}`, `agenda_filter:${m.id}`);
      if (i % 2 === 1) teclado.row();
    });
    return await ctx.reply("👥 ¿De quién quieres ver la agenda?", { reply_markup: teclado });
  }
  const m = resolverMiembro(miembros, arg);
  if (!m) return await ctx.reply(`No conozco a «${arg}». Personas: ${miembros.map((x) => x.nombre).join(", ")}.`);
  try {
    await mostrarAgendaPersona(ctx, m);
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ No pude consultar el calendario ahora mismo.");
  }
});

bot.callbackQuery(/^agenda_filter:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const m = (await getMembers()).find((x) => x.id === ctx.match[1]);
  if (!m) return;
  try {
    await mostrarAgendaPersona(ctx, m);
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ No pude consultar el calendario ahora mismo.");
  }
});

bot.command("cumples", async (ctx) => {
  const miembros = (await getMembers()).filter((m) => m.cumpleanos);
  const ordenados = miembros
    .map((m) => ({ m, c: proximoCumple(m.cumpleanos!) }))
    .sort((a, b) => a.c.dias - b.c.dias);
  if (!ordenados.length) return await ctx.reply("No hay cumpleaños registrados.");
  const lista = ordenados
    .map(({ m, c }) => {
      const cuando = c.dias === 0 ? "¡hoy!" : c.dias === 1 ? "mañana" : `en ${c.dias} días`;
      return `• ${m.emoji ?? "🎂"} <b>${escapeHtml(m.nombre)}</b> — ${diaCorto(c.fecha)} · cumple ${c.edad} (${cuando})`;
    })
    .join("\n");
  await responder(ctx, `🎂 <b>Próximos cumpleaños</b>\n\n${lista}`);
});

// ------------------------------------------------------------------
// MIEMBROS, AJUSTES
// ------------------------------------------------------------------

bot.command("miembros", async (ctx) => {
  const miembros = await getMembers();
  const lista = miembros
    .map((m) => {
      const apodos = m.apodos?.length ? ` · apodos: ${escapeHtml(m.apodos.join(", "))}` : "";
      const color = m.color ? ` · color ${escapeHtml(m.color)}` : "";
      return `${m.emoji ?? "👤"} <b>${escapeHtml(m.nombre)}</b>${apodos}${color}`;
    })
    .join("\n");
  await responder(
    ctx,
    `👨‍👩‍👧‍👦 <b>Miembros</b>\n\n${lista}\n\n` +
      `Añadir apodo: <code>/apodo NombreHija2 Apodo1</code>\nColor en Google Calendar (1-11): <code>/color NombreHija2 9</code>`
  );
});

bot.command("apodo", async (ctx) => {
  const [nombre, ...resto] = (ctx.match?.toString() ?? "").trim().split(/\s+/);
  const apodo = resto.join(" ").trim();
  if (!nombre || !apodo) return await ctx.reply("Uso: /apodo Nombre apodo  (ej. /apodo NombreHija2 Apodo1)");
  const m = await addApodo(nombre, apodo);
  await ctx.reply(m ? `✅ Apodo «${apodo}» añadido a ${m.nombre}.` : `No encuentro a «${nombre}». Mira /miembros.`);
});

bot.command("color", async (ctx) => {
  const [nombre, color] = (ctx.match?.toString() ?? "").trim().split(/\s+/);
  if (!nombre || !/^([1-9]|1[01])$/.test(color ?? "")) {
    return await ctx.reply("Uso: /color Nombre número  (1 a 11, colores de Google Calendar). Ej: /color NombreHija2 9");
  }
  const ok = await setColor(nombre, color);
  await ctx.reply(ok ? `🎨 Color ${color} asignado a ${nombre}. Se aplicará a los eventos nuevos de esa persona.` : `No encuentro a «${nombre}».`);
});

async function alternarAjuste(ctx: Context, campo: "recordatorios" | "resumen_diario", etiqueta: string) {
  const arg = ctx.match?.toString().trim().toLowerCase();
  const chat = await getChat(ctx.chat!.id);
  if (arg !== "on" && arg !== "off") {
    const estado = chat?.[campo] ? "activado ✅" : "desactivado ❌";
    return await ctx.reply(`${etiqueta}: ${estado}\nUsa /${campo === "recordatorios" ? "avisos" : "diario"} on  o  off`);
  }
  await setChatFlag(ctx.chat!.id, campo, arg === "on");
  await ctx.reply(`${etiqueta} ${arg === "on" ? "activado ✅" : "desactivado ❌"} en este chat.`);
}

bot.command("avisos", (ctx) => alternarAjuste(ctx, "recordatorios", "Recordatorios"));
bot.command("diario", (ctx) => alternarAjuste(ctx, "resumen_diario", "Resumen diario (8:00)"));

// ------------------------------------------------------------------
// EDITAR Y BORRAR
// ------------------------------------------------------------------

async function listaEventosBoton(ctx: Context, titulo: string, prefijo: string) {
  const eventos = await proximosEventos(8);
  if (!eventos.length) return await ctx.reply("No hay eventos próximos registrados por el bot.");
  const teclado = new InlineKeyboard();
  for (const ev of eventos) {
    teclado.text(`${ev.titulo.slice(0, 40)} · ${formatDateNice(ev.fecha_inicio, ev.todo_el_dia)}`, `${prefijo}:${ev.id}`).row();
  }
  teclado.text("❌ Cerrar", "cerrar_menu");
  await ctx.reply(titulo, { reply_markup: teclado });
}

bot.command("editar", (ctx) => listaEventosBoton(ctx, "✏️ ¿Qué evento quieres modificar?", "edit_event"));
bot.command("borrar", (ctx) => listaEventosBoton(ctx, "🗑️ ¿Qué evento quieres eliminar?", "ask_delete"));

bot.callbackQuery("cerrar_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => {});
});

bot.callbackQuery(/^edit_event:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ev = await getEvento(ctx.match[1]);
  if (!ev || ev.borrado_en) return await ctx.editMessageText("⚠️ Ese evento ya no existe.");
  const borrador = await crearBorrador({
    chat_id: ctx.chat!.id,
    mensaje_id: null,
    titulo: ev.titulo,
    descripcion: ev.descripcion,
    fecha_inicio: ev.fecha_inicio,
    fecha_fin: ev.fecha_fin,
    todo_el_dia: ev.todo_el_dia,
    ubicacion: ev.ubicacion,
    miembros_involucrados: ev.miembros_involucrados ?? [],
    origen_texto: null,
    imagen_url: ev.imagen_url,
    imagen_path: ev.imagen_path,
    recurrencia: ev.recurrencia,
    llevar: ev.llevar ?? [],
    evento_id: ev.id
  });
  await ctx.editMessageText(formatDraftCard(borrador), { ...HTML, reply_markup: tecladoBorrador(borrador) });
  await ctx.reply("✏️ Escríbeme qué quieres cambiar (ej. «pásalo al jueves a las 18:00») y pulsa 💾 Guardar cambios.");
});

bot.callbackQuery(/^ask_delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ev = await getEvento(ctx.match[1]);
  if (!ev || ev.borrado_en) return await ctx.editMessageText("⚠️ Ese evento ya no existe.");
  const teclado = new InlineKeyboard().text("🗑️ Sí, eliminar", `delete_event:${ev.id}`).text("Cancelar", "cerrar_menu");
  await ctx.editMessageText(
    `¿Eliminar <b>${escapeHtml(ev.titulo)}</b> (${formatDateNice(ev.fecha_inicio, ev.todo_el_dia)}) de Google Calendar?`,
    { ...HTML, reply_markup: teclado }
  );
});

bot.callbackQuery(/^delete_event:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Eliminando..." });
  try {
    const ev = await getEvento(ctx.match[1]);
    if (!ev || ev.borrado_en) return await ctx.editMessageText("⚠️ Evento no encontrado o ya eliminado.");
    await deleteGoogleEvent(ev.google_event_id);
    await borrarEventoLogico(ev.id);
    await ctx.editMessageText(`🗑️ <b>Evento eliminado:</b>\n<i>${escapeHtml(ev.titulo)}</i>`, HTML);
  } catch (e) {
    console.error("borrar:", e);
    await ctx.reply("❌ No se pudo eliminar el evento. Inténtalo de nuevo.");
  }
});

// ------------------------------------------------------------------
// CREACIÓN DE EVENTOS (texto, imagen, PDF, voz)
// ------------------------------------------------------------------

interface Entrada {
  texto: string;
  adjunto?: Adjunto;
  bytes?: Uint8Array;
  usarBorradorActivo: boolean;
  borradorForzado?: Borrador | null;
}

async function procesarEntrada(ctx: Context, entrada: Entrada) {
  const chatId = ctx.chat!.id;
  const silencioso = esGrupo(ctx) && !entrada.borradorForzado;

  try {
    const { resultado, activo, adjuntoGuardado } = await conTyping(ctx, async () => {
      const miembros = await getMembers();
      let activo: Borrador | null = entrada.borradorForzado ?? null;
      if (!activo && entrada.usarBorradorActivo) activo = await ultimoBorradorPendiente(chatId);

      const guardado = entrada.bytes && entrada.adjunto ? await subirAdjunto(entrada.bytes, entrada.adjunto.mimeType) : null;
      const resultado = await interpretarMensaje({
        texto: entrada.texto,
        adjunto: entrada.adjunto,
        miembros,
        borradorActivo: activo ? borradorAEventoIA(activo) : null,
        forzarCorreccion: !!entrada.borradorForzado
      });
      return { resultado, activo, adjuntoGuardado: guardado };
    });

    if (!resultado.eventos.length) {
      if (!silencioso) await ctx.reply("🤔 No he encontrado ningún evento ni fecha clara. Prueba a indicar el día y la hora.");
      return;
    }

    // Corrección del borrador activo
    if (resultado.accion === "corregir" && activo) {
      const cambios = eventoIAABorrador(resultado.eventos[0]);
      const actualizado = await actualizarBorrador(activo.id, {
        ...cambios,
        recurrencia: cambios.recurrencia ?? activo.recurrencia,
        origen_texto: activo.origen_texto ?? entrada.texto
      });
      await responder(ctx, formatDraftCard(actualizado, { duplicado: await eventoDuplicado(actualizado) }), {
        reply_markup: tecladoBorrador(actualizado)
      });
      return;
    }

    // Eventos nuevos
    for (const ev of resultado.eventos) {
      const datos = eventoIAABorrador(ev);
      const borrador = await crearBorrador({
        chat_id: chatId,
        mensaje_id: ctx.message?.message_id ?? null,
        ...datos,
        origen_texto: entrada.texto || (entrada.adjunto?.mimeType.startsWith("audio") ? "Nota de voz" : "Imagen recibida"),
        imagen_url: adjuntoGuardado?.url ?? null,
        imagen_path: adjuntoGuardado?.path ?? null,
        evento_id: null
      });
      await responder(ctx, formatDraftCard(borrador, { duplicado: await eventoDuplicado(borrador) }), {
        reply_markup: tecladoBorrador(borrador)
      });
    }
  } catch (err) {
    console.error("procesarEntrada:", err);
    if (!silencioso) await ctx.reply("❌ No he podido analizar el mensaje. Inténtalo de nuevo en un momento.");
  }
}

async function responderPreguntaAgenda(ctx: Context, pregunta: string) {
  try {
    const texto = await conTyping(ctx, async () => {
      const hoy = todayLocal();
      const [eventos, miembros] = await Promise.all([eventosDelRango(hoy, addDays(hoy, 60)), getMembers()]);
      const agenda = eventos.slice(0, 150).map((e) => {
        const ini = eventoInicio(e);
        const hora = ini.todoElDia ? "todo el día" : isoToLocal(ini.iso).slice(11, 16);
        return `${eventoDia(e)} ${hora} — ${e.summary ?? ""}${e.location ? ` (${e.location})` : ""}`;
      }).join("\n");
      const cumples = miembros.filter((m) => m.cumpleanos).map((m) => {
        const c = proximoCumple(m.cumpleanos!);
        return `${c.fecha} cumpleaños de ${m.nombre} (${c.edad} años)`;
      }).join("\n");
      return await responderPregunta(pregunta, `${agenda}\n${cumples}`, miembros);
    });
    await ctx.reply(texto.slice(0, 4000));
  } catch (e) {
    console.error("pregunta:", e);
    await ctx.reply("❌ No he podido consultar la agenda ahora mismo.");
  }
}

bot.on("message:text", async (ctx) => {
  const texto = ctx.message.text.trim();
  if (texto.startsWith("/")) return;

  // Respuesta explícita a una tarjeta de corrección («borrador: <id>»)
  let forzado: Borrador | null = null;
  const respuesta = ctx.message.reply_to_message?.text ?? "";
  const m = respuesta.match(/borrador: ([a-f0-9-]{36})/i);
  if (m) {
    const b = await getBorrador(m[1]);
    if (b && b.estado === "pendiente") forzado = b;
  }

  if (esGrupo(ctx) && !forzado) {
    const mencion = !!ctx.me.username && texto.toLowerCase().includes(`@${ctx.me.username.toLowerCase()}`);
    const respondeAlBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
    if (!mencion && !respondeAlBot && !MENCION_FECHA.test(texto)) return;
  }

  const esPregunta = texto.endsWith("?") || texto.startsWith("¿");
  if (esPregunta && !forzado && !(await ultimoBorradorPendiente(ctx.chat.id))) {
    return await responderPreguntaAgenda(ctx, texto);
  }

  await procesarEntrada(ctx, { texto, usarBorradorActivo: true, borradorForzado: forzado });
});

async function descargarArchivo(ctx: Context): Promise<{ bytes: Uint8Array; ruta: string } | null> {
  const file = await ctx.getFile();
  if ((file.file_size ?? 0) > LIMITE_ADJUNTO_BYTES) {
    await ctx.reply("⚠️ El archivo es demasiado grande (máximo 10 MB).");
    return null;
  }
  const res = await fetch(`https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`, {
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Descarga Telegram ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), ruta: file.file_path ?? "" };
}

bot.on(["message:photo", "message:document"], async (ctx) => {
  try {
    const mimeType = ctx.message.photo ? "image/jpeg" : ctx.message.document?.mime_type ?? "";
    if (!MIMES_ADMITIDOS.includes(mimeType)) {
      return await ctx.reply("⚠️ Solo puedo leer fotos, imágenes y PDF.");
    }
    const archivo = await descargarArchivo(ctx);
    if (!archivo) return;
    await procesarEntrada(ctx, {
      texto: ctx.message.caption ?? "",
      adjunto: { base64: aBase64(archivo.bytes), mimeType },
      bytes: archivo.bytes,
      usarBorradorActivo: false
    });
  } catch (e) {
    console.error("archivo:", e);
    await ctx.reply("⚠️ No he podido descargar el archivo. Inténtalo de nuevo.");
  }
});

bot.on(["message:voice", "message:audio"], async (ctx) => {
  try {
    const mimeType = ctx.message.voice?.mime_type ?? ctx.message.audio?.mime_type ?? "audio/ogg";
    const archivo = await descargarArchivo(ctx);
    if (!archivo) return;
    await procesarEntrada(ctx, {
      texto: "",
      adjunto: { base64: aBase64(archivo.bytes), mimeType },
      usarBorradorActivo: true
    });
  } catch (e) {
    console.error("voz:", e);
    await ctx.reply("⚠️ No he podido procesar la nota de voz. Inténtalo de nuevo.");
  }
});

// ------------------------------------------------------------------
// BOTONES DE LA TARJETA
// ------------------------------------------------------------------

bot.callbackQuery(/^edit_draft:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `✏️ Escríbeme el cambio (ej. <i>«cambia la hora a las 18:00»</i>, <i>«es en el parque»</i>, <i>«es para NombreHijo1»</i>).\n\n` +
      `<code>borrador: ${ctx.match[1]}</code>`,
    HTML
  );
});

bot.callbackQuery(/^toggle_dia:(.+)$/, async (ctx) => {
  const d = await getBorrador(ctx.match[1]);
  if (!d || d.estado !== "pendiente") return await ctx.answerCallbackQuery({ text: "Este evento ya está gestionado" });
  await ctx.answerCallbackQuery();
  const dia = isoToLocalDate(d.fecha_inicio);
  const cambios = d.todo_el_dia
    ? { todo_el_dia: false, fecha_inicio: localToIso(`${dia}T09:00:00`)!, fecha_fin: localToIso(`${dia}T10:00:00`)! }
    : { todo_el_dia: true, fecha_inicio: localToIso(`${dia}T00:00:00`)!, fecha_fin: localToIso(`${dia}T23:59:59`)! };
  const nuevo = await actualizarBorrador(d.id, cambios);
  await ctx.editMessageText(formatDraftCard(nuevo, { duplicado: await eventoDuplicado(nuevo) }), {
    ...HTML,
    reply_markup: tecladoBorrador(nuevo)
  }).catch(() => {});
  if (!nuevo.todo_el_dia) await ctx.reply("🕐 He puesto las 9:00 por defecto. Escríbeme la hora correcta («a las 17:30»).");
});

bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const d = await reclamarBorrador(id); // atómico: evita crear el evento dos veces
  if (!d) {
    await ctx.answerCallbackQuery({ text: "Ya gestionado" });
    return await ctx.editMessageText("⚠️ Este evento ya ha sido gestionado o no existe.").catch(() => {});
  }
  await ctx.answerCallbackQuery({ text: "Guardando en Google Calendar..." });

  try {
    const miembros = await getMembers();
    const descripcion = d.evento_id ? (d.descripcion ?? "") : buildDescripcion(d);
    const datos = {
      titulo: d.titulo,
      descripcion,
      ubicacion: d.ubicacion,
      fechaInicio: d.fecha_inicio,
      fechaFin: d.fecha_fin,
      todoElDia: d.todo_el_dia,
      recurrencia: d.recurrencia,
      colorId: colorDe(miembros, d.miembros_involucrados ?? [])
    };
    const campos = {
      chat_id: d.chat_id,
      titulo: d.titulo,
      descripcion,
      fecha_inicio: d.fecha_inicio,
      fecha_fin: d.fecha_fin,
      todo_el_dia: d.todo_el_dia,
      ubicacion: d.ubicacion,
      miembros_involucrados: d.miembros_involucrados ?? [],
      imagen_url: d.imagen_url,
      imagen_path: d.imagen_path,
      recurrencia: d.recurrencia,
      llevar: d.llevar ?? []
    };

    let enlace: string | undefined;
    if (d.evento_id) {
      const ev = await getEvento(d.evento_id);
      if (!ev || ev.borrado_en) throw new Error("El evento original ya no existe");
      const g = await updateGoogleEvent(ev.google_event_id, datos);
      enlace = g.htmlLink;
      await actualizarEvento(ev.id, campos);
    } else {
      const g = await insertGoogleEvent(datos);
      enlace = g.htmlLink;
      try {
        await insertarEvento({ ...campos, google_event_id: g.id, creado_por: ctx.from?.first_name ?? "Familiar" });
      } catch (dbErr) {
        console.error("Evento creado en Google pero no registrado en BD:", dbErr);
      }
    }
    await marcarBorrador(id, "confirmado");

    const quien = escapeHtml(ctx.from?.first_name ?? "un familiar");
    const rep = d.recurrencia ? " 🔁" : "";
    let card = `<b>${d.evento_id ? "✏️ Evento actualizado" : "✅ Añadido a Google Calendar"}</b>${rep}\n\n` +
      `<b>📌</b> ${escapeHtml(d.titulo)}\n<b>📅</b> ${formatCuando(d.fecha_inicio, d.fecha_fin, d.todo_el_dia)}\n`;
    if (d.ubicacion) card += `<b>📍</b> ${escapeHtml(d.ubicacion)}\n`;
    if (enlace) card += `<a href="${escapeHtml(enlace)}">Abrir en Google Calendar</a>\n`;
    card += `\n<i>Confirmado por ${quien}.</i>`;
    await ctx.editMessageText(card, HTML);
  } catch (err) {
    console.error("confirmar:", err);
    await marcarBorrador(id, "pendiente").catch(() => {}); // permite reintentar
    await ctx.reply("❌ No se pudo guardar en Google Calendar. Puedes volver a pulsar el botón para reintentar.");
  }
});

bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
  const d = await reclamarBorrador(ctx.match[1]);
  await ctx.answerCallbackQuery({ text: d ? "Descartado" : "Ya gestionado" });
  if (d) await marcarBorrador(d.id, "cancelado");
  await ctx.editMessageText(d ? "❌ <i>Evento descartado.</i>" : "⚠️ Este evento ya ha sido gestionado.", HTML).catch(() => {});
});

// ------------------------------------------------------------------
// TAREAS PROGRAMADAS (las llama index.ts desde pg_cron)
// ------------------------------------------------------------------

export async function enviarResumenSemanal(): Promise<number> {
  const chats = await chatsActivos();
  if (!chats.length) return 0;
  const texto = await textoSemanal();
  for (const c of chats) {
    for (const t of trocear(texto)) {
      await bot.api.sendMessage(c.chat_id, t, HTML).catch((e) => console.error(`resumen semanal ${c.chat_id}:`, e));
    }
  }
  return chats.length;
}

export async function enviarResumenDiario(): Promise<number> {
  const chats = await chatsActivos("resumen_diario");
  if (!chats.length) return 0;
  const hoy = todayLocal();
  const [eventos, miembros] = await Promise.all([eventosDelRango(hoy, addDays(hoy, 1)), getMembers()]);
  const cumples = cumplesEnVentana(miembros, 0);
  if (!eventos.length && !cumples.length) return 0; // sin novedades, no molestamos
  let msg = `☀️ <b>Buenos días. Hoy, ${diaCorto(hoy)}</b>\n\n`;
  if (cumples.length) msg += cumples.join("\n") + "\n\n";
  msg += formatAgenda(eventos, "");
  for (const c of chats) await bot.api.sendMessage(c.chat_id, msg.trim(), HTML).catch((e) => console.error(`diario ${c.chat_id}:`, e));
  return chats.length;
}

function textoAviso(ev: EventoDB, prefijo: string): string {
  let msg = `${prefijo} <b>${escapeHtml(ev.titulo)}</b>\n📅 ${formatCuando(ev.fecha_inicio, ev.fecha_fin, ev.todo_el_dia)}`;
  if (ev.ubicacion) msg += `\n📍 ${escapeHtml(ev.ubicacion)}`;
  if (ev.llevar?.length) msg += `\n🎒 Llevar: ${escapeHtml(ev.llevar.join(", "))}`;
  return msg;
}

export async function enviarRecordatorios(): Promise<number> {
  await caducarBorradores();
  await limpiarUpdatesAntiguos();

  const eventos = await eventosParaAviso(24);
  if (!eventos.length) return 0;
  const chats = await chatsActivos("recordatorios");
  const ahora = Date.now();
  const hoy = todayLocal();
  const horaLocal = madridParts(new Date()).hour;
  let enviados = 0;

  const difundir = async (texto: string) => {
    for (const c of chats) await bot.api.sendMessage(c.chat_id, texto, HTML).catch((e) => console.error(`aviso ${c.chat_id}:`, e));
    enviados++;
  };

  for (const ev of eventos) {
    const horas = (new Date(ev.fecha_inicio).getTime() - ahora) / 3600000;
    const recienCreado = ahora - new Date(ev.created_at).getTime() < 3 * 3600000;

    if (ev.todo_el_dia) {
      // Los eventos de día completo se avisan la tarde anterior (a partir de las 18:00)
      if (!ev.aviso_dia_enviado && isoToLocalDate(ev.fecha_inicio) === addDays(hoy, 1) && horaLocal >= 18) {
        if (!recienCreado) await difundir(textoAviso(ev, "🔔 Mañana:"));
        await marcarAviso(ev.id, { aviso_dia_enviado: true, aviso_hora_enviado: true });
      }
      continue;
    }
    if (horas <= 1.25 && !ev.aviso_hora_enviado) {
      await difundir(textoAviso(ev, "⏰ En menos de una hora:"));
      await marcarAviso(ev.id, { aviso_hora_enviado: true, aviso_dia_enviado: true });
    } else if (horas <= 24 && horas > 1.25 && !ev.aviso_dia_enviado) {
      if (!recienCreado) await difundir(textoAviso(ev, horas > 12 ? "🔔 Mañana:" : "🔔 Hoy:"));
      await marcarAviso(ev.id, { aviso_dia_enviado: true });
    }
  }
  return enviados;
}
