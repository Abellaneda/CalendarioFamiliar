import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.ts";

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
const bot = new Bot(config.telegramToken);

// ------------------------------------------------------------------
// GOOGLE CALENDAR VIA WEB CRYPTO & REST API
// ------------------------------------------------------------------

function pemToBinary(pem: string): ArrayBuffer {
  const lines = pem.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("---"));
  const b64 = lines.join("");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function base64url(input: string | Uint8Array): string {
  if (typeof input === "string") {
    return btoa(input).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }
  let binary = "";
  for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

let cachedGoogleToken: { token: string; exp: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && cachedGoogleToken.exp > now + 60) {
    return cachedGoogleToken.token;
  }

  const binaryKey = pemToBinary(config.googlePrivateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: config.googleClientEmail,
      scope: "https://www.googleapis.com/auth/calendar",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    })
  );

  const dataToSign = new TextEncoder().encode(`${header}.${claim}`);
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, dataToSign);
  const sig = base64url(new Uint8Array(sigBuf));
  const jwt = `${header}.${claim}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Google Auth error: ${JSON.stringify(data)}`);
  }

  cachedGoogleToken = { token: data.access_token, exp: now + 3500 };
  return data.access_token;
}

async function insertGoogleCalendarEvent(eventData: any) {
  const token = await getGoogleAccessToken();
  const startObj = eventData.todoElDia
    ? { date: eventData.fechaInicio.split("T")[0] }
    : { dateTime: eventData.fechaInicio, timeZone: config.timezone };
  const endObj = eventData.todoElDia
    ? { date: eventData.fechaFin.split("T")[0] }
    : { dateTime: eventData.fechaFin, timeZone: config.timezone };

  const body = {
    summary: eventData.titulo,
    description: eventData.descripcion || "",
    location: eventData.ubicacion || "",
    start: startObj,
    end: endObj,
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 24 * 60 },
        { method: "popup", minutes: 60 }
      ]
    }
  };

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    config.googleCalendarId
  )}/events`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Error insertando en Calendar (${res.status}): ${await res.text()}`);
  }

  return await res.json();
}

async function deleteGoogleCalendarEvent(eventId: string) {
  const token = await getGoogleAccessToken();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    config.googleCalendarId
  )}/events/${encodeURIComponent(eventId)}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Error borrando en Calendar: ${await res.text()}`);
  }
}

async function listUpcomingEvents(days = 7) {
  const token = await getGoogleAccessToken();
  const now = new Date();
  const timeMin = now.toISOString();

  const future = new Date();
  future.setDate(now.getDate() + days);
  future.setHours(23, 59, 59, 999);
  const timeMax = future.toISOString();

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    config.googleCalendarId
  )}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(
    timeMax
  )}&singleEvents=true&orderBy=startTime`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Error al consultar Calendar: ${await res.text()}`);
  }

  const data = await res.json();
  return data.items || [];
}

// ------------------------------------------------------------------
// RESUMEN SEMANAL Y ALERTAS
// ------------------------------------------------------------------

async function generateWeeklySummaryText(): Promise<string> {
  const members = await getMembers();
  const events = await listUpcomingEvents(7);

  const now = new Date();
  const endWeek = new Date();
  endWeek.setDate(now.getDate() + 7);

  const opcionesHeader: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: config.timezone };
  const r1 = now.toLocaleDateString("es-ES", opcionesHeader);
  const r2 = endWeek.toLocaleDateString("es-ES", opcionesHeader);

  let msg = `📅 <b>Agenda Semanal Familiar (${r1} - ${r2})</b>\n\n`;

  // Comprobar cumpleaños familiares en los próximos 7 días
  const cumpleanosProximos = [];
  for (const m of members) {
    if (!m.cumpleanos) continue;
    const [year, month, day] = m.cumpleanos.split("-").map(Number);
    const cumpleEsteAno = new Date(now.getFullYear(), month - 1, day);
    if (cumpleEsteAno < now && Math.floor((now.getTime() - cumpleEsteAno.getTime()) / 86400000) > 0) {
      cumpleEsteAno.setFullYear(now.getFullYear() + 1);
    }
    const diffDays = Math.ceil((cumpleEsteAno.getTime() - now.getTime()) / 86400000);
    if (diffDays >= 0 && diffDays <= 7) {
      const edad = cumpleEsteAno.getFullYear() - year;
      const diaSemana = cumpleEsteAno.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
      cumpleanosProximos.push(`🎉 <b>¡Cumpleaños de ${m.nombre}!</b> El ${diaSemana} (cumple ${edad} años) ${m.emoji || "🎂"}`);
    }
  }

  if (cumpleanosProximos.length) {
    msg += `🎂 <b>CUMPLEAÑOS FAMILIARES ESTA SEMANA:</b>\n${cumpleanosProximos.join("\n")}\n\n`;
  }

  if (!events.length) {
    msg += `<i>☀️ No hay eventos programados en el calendario para esta semana.</i>`;
  } else {
    msg += `<b>Eventos programados:</b>\n` + events.map(e => formatEventLine(e)).join("\n");
  }

  return msg;
}

async function broadcastWeeklySummary() {
  const { data: chats } = await supabase.from("chats_autorizados").select("chat_id").eq("activo", true);
  if (!chats || !chats.length) return;

  const summary = await generateWeeklySummaryText();
  for (const c of chats) {
    try {
      await bot.api.sendMessage(c.chat_id, summary, { parse_mode: "HTML" });
    } catch (e) {
      console.error(`Error enviando resumen semanal a chat ${c.chat_id}:`, e);
    }
  }
}

// ------------------------------------------------------------------
// GEMINI IA REST API
// ------------------------------------------------------------------

async function parseEventWithGemini({ text, base64Image, mimeType, members, previousDraft }: any) {
  const membersList = members
    .map((m: any) => {
      const apodos = m.apodos && m.apodos.length ? ` (apodos: ${m.apodos.join(", ")})` : "";
      const cumple = m.cumpleanos ? ` [Cumpleaños: ${m.cumpleanos}]` : "";
      return `- ${m.nombre} ${m.emoji || ""}${apodos}${cumple}`;
    })
    .join("\n");

  const now = new Date();
  const fechaHoyStr = now.toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: config.timezone
  });

  let contextoBorrador = "";
  if (previousDraft) {
    contextoBorrador = `\nESTÁS MODIFICANDO UN BORRADOR PREVIO:
- Título actual: "${previousDraft.titulo}"
- Inicio actual: "${previousDraft.fecha_inicio}"
- Fin actual: "${previousDraft.fecha_fin}"
- Ubicación actual: "${previousDraft.ubicacion || 'ninguna'}"
- Miembros actuales: ${JSON.stringify(previousDraft.miembros_involucrados || [])}
- Notas actuales: "${previousDraft.descripcion || ''}"

El usuario ha escrito esta modificación: "${text}".
DEBES APLICAR EL CAMBIO SOLICITADO (por ejemplo cambiar la hora o el día o el lugar) MANTENIENDO EL TÍTULO ORIGINAL Y TODO LO DEMÁS INTACTO.\n`;
  }

  const systemPrompt = `Eres el asistente inteligente del calendario familiar.
Analiza la entrada y extrae eventos o procesa correcciones.

INFORMACIÓN TEMPORAL:
- Fecha actual: ${fechaHoyStr}
- Zona horaria: Europe/Madrid

MIEMBROS DE LA FAMILIA:
${membersList}
${contextoBorrador}

REGLAS:
1. Identifica para quién es el evento (ej: ["NombreHija2"], ["NombrePapa"], o ["Familia"]).
2. Si es cumpleaños de un amigo/compañero, usa emoji 🎂 en el título.
3. Si es cita médica, usa 🩺 o 🦷. Del colegio, 🎒.
4. Duración por defecto si no se indica fin: 1 hora.
5. Formato de fecha ISO local con zona (ej: "2026-10-28T17:00:00").
6. Incluye en "notas" detalles importantes (qué llevar, teléfono, etc.).
7. Devuelve un array de "eventos".

RESPONDE EXCLUSIVAMENTE CON UN OBJETO JSON:
{
  "eventos": [
    {
      "titulo": "[Nombre] Título con emoji",
      "fechaInicio": "YYYY-MM-DDTHH:mm:ss",
      "fechaFin": "YYYY-MM-DDTHH:mm:ss",
      "todoElDia": false,
      "ubicacion": "Lugar o dirección",
      "miembrosInvolucrados": ["Nombre"],
      "notas": "Detalles adicionales",
      "confianza": "alta"
    }
  ]
}`;

  const parts: any[] = [];
  if (base64Image && mimeType) {
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: base64Image
      }
    });
  }
  if (text) {
    parts.push({ text });
  } else {
    parts.push({ text: "Analiza esta imagen y extrae todos los datos del evento." });
  }

  const candidateModels = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
  let lastError: any = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (!res.ok) throw new Error(`Gemini status ${res.status}: ${await res.text()}`);

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("Respuesta vacía de Gemini");
      return JSON.parse(rawText);
    } catch (err) {
      lastError = err;
      console.warn(`Reintento en ${model}:`, err);
    }
  }

  throw lastError;
}

// ------------------------------------------------------------------
// LOGICA DE TELEGRAM
// ------------------------------------------------------------------

async function getMembers() {
  const { data } = await supabase.from("miembros").select("*").order("nombre");
  return data || [];
}

async function uploadImageToStorage(bytes: Uint8Array, mimeType: string): Promise<string | null> {
  try {
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const fileName = `invitacion_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const { error } = await supabase.storage.from("eventos-adjuntos").upload(fileName, bytes, {
      contentType: mimeType,
      upsert: false
    });

    if (error) return null;
    const { data } = supabase.storage.from("eventos-adjuntos").getPublicUrl(fileName);
    return data.publicUrl;
  } catch (e) {
    console.error("Upload error:", e);
    return null;
  }
}

bot.command("start", async (ctx) => {
  await supabase.from("chats_autorizados").upsert({
    chat_id: ctx.chat.id,
    tipo: ctx.chat.type,
    titulo: ctx.chat.title || ctx.chat.first_name || "Privado",
    activo: true
  });

  await ctx.reply(
    `👋 ¡Hola! Soy el asistente del **Calendario Familiar** en la nube (activo 24/7).\n\n` +
      `📅 Puedes enviarme directamente:\n` +
      `• **Texto:** *"Pediatra de NombreHija2 el martes a las 17:30"*\n` +
      `• **Fotos:** Invitaciones de cumpleaños, circulares escolares, citas médicas...\n\n` +
      `Comandos:\n` +
      `• /agenda - Ver eventos de una persona (ej: /agenda NombreHija2)\n` +
      `• /semana o /resumen - Agenda semanal completa\n` +
      `• /hoy - Eventos de hoy\n` +
      `• /cumples - Cumpleaños familiares\n` +
      `• /borrar - Cancelar o borrar eventos\n` +
      `• /ayuda - Instrucciones`
  );
});

bot.command("ayuda", async (ctx) => {
  await ctx.reply(
    `ℹ️ **Instrucciones:**\n\n` +
      `• **Crear evento:** Envía una foto o escribe en lenguaje natural.\n` +
      `• **Botones:** Usa [✅ Crear], [✏️ Corregir] o [❌ Descartar].\n` +
      `• **Filtrar por persona:** Escribe /agenda NombreHija2 o pulsa /agenda para ver la lista.\n` +
      `• **Borrar evento:** Escribe /borrar para ver los últimos eventos y eliminarlos.\n` +
      `• **Alerta semanal:** Se envía automáticamente cada domingo a las 20:00.`
  );
});

// COMANDO AGENDA POR PERSONA
bot.command("agenda", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim().toLowerCase();

  const members = await getMembers();

  if (!args) {
    const keyboard = new InlineKeyboard();
    members.forEach((m: any, idx: number) => {
      keyboard.text(`${m.emoji || "👤"} ${m.nombre}`, `agenda_filter:${m.nombre}`);
      if (idx % 2 === 1) keyboard.row();
    });
    return ctx.reply("👥 ¿De quién quieres consultar la agenda?", { reply_markup: keyboard });
  }

  await showMemberAgenda(ctx, args);
});

async function showMemberAgenda(ctx: any, memberName: string) {
  const events = await listUpcomingEvents(14);
  const filtered = events.filter((e: any) => {
    const summary = (e.summary || "").toLowerCase();
    const desc = (e.description || "").toLowerCase();
    const target = memberName.toLowerCase();
    return summary.includes(target) || desc.includes(target);
  });

  const memberNameClean = memberName.charAt(0).toUpperCase() + memberName.slice(1);

  if (!filtered.length) {
    const text = `📅 No hay eventos programados en los próximos 14 días para <b>${memberNameClean}</b>.`;
    if (ctx.callbackQuery) {
      return ctx.editMessageText(text, { parse_mode: "HTML" });
    }
    return ctx.reply(text, { parse_mode: "HTML" });
  }

  const lines = filtered.map(e => formatEventLine(e)).join("\n");
  const text = `📅 <b>Próximos eventos para ${memberNameClean}:</b>\n\n${lines}`;

  if (ctx.callbackQuery) {
    return ctx.editMessageText(text, { parse_mode: "HTML" });
  }
  return ctx.reply(text, { parse_mode: "HTML" });
}

bot.callbackQuery(/^agenda_filter:(.+)$/, async (ctx) => {
  const memberName = ctx.match[1];
  await ctx.answerCallbackQuery();
  await showMemberAgenda(ctx, memberName);
});

// COMANDO RESUMEN Y SEMANA
bot.command(["semana", "resumen"], async (ctx) => {
  const summary = await generateWeeklySummaryText();
  await ctx.reply(summary, { parse_mode: "HTML" });
});

bot.command("hoy", async (ctx) => {
  try {
    const events = await listUpcomingEvents(1);
    if (!events.length) return ctx.reply("☀️ Hoy no hay eventos programados en el calendario.");
    const lines = events.map(e => formatEventLine(e)).join("\n");
    await ctx.reply(`📅 <b>Eventos para hoy:</b>\n\n${lines}`, { parse_mode: "HTML" });
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ Error al consultar eventos de hoy.");
  }
});

bot.command("cumples", async (ctx) => {
  const members = await getMembers();
  const list = members
    .filter((m: any) => m.cumpleanos)
    .map((m: any) => {
      const [year, month, day] = m.cumpleanos.split("-");
      const fechaObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      const fechaStr = fechaObj.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
      const edad = new Date().getFullYear() - parseInt(year);
      return `• ${m.emoji || "🎂"} <b>${m.nombre}:</b> ${fechaStr} (${edad} años)`;
    })
    .join("\n");

  await ctx.reply(`🎂 <b>Cumpleaños familiares:</b>\n\n${list}`, { parse_mode: "HTML" });
});

// COMANDO BORRAR EVENTO
bot.command("borrar", async (ctx) => {
  const { data: recentEvents } = await supabase
    .from("eventos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);

  if (!recentEvents || !recentEvents.length) {
    return ctx.reply("No hay eventos recientes registrados para borrar.");
  }

  const keyboard = new InlineKeyboard();
  for (const ev of recentEvents) {
    const startStr = formatDateNice(ev.fecha_inicio, ev.todo_el_dia);
    keyboard.text(`🗑️ ${ev.titulo} (${startStr})`, `delete_event:${ev.id}`).row();
  }
  keyboard.text("❌ Cerrar", "close_delete_menu");

  await ctx.reply("¿Qué evento deseas eliminar de Google Calendar?", { reply_markup: keyboard });
});

bot.callbackQuery(/^delete_event:(.+)$/, async (ctx) => {
  const recordId = ctx.match[1];
  await ctx.answerCallbackQuery({ text: "Eliminando evento..." });

  try {
    const { data: ev } = await supabase.from("eventos").select("*").eq("id", recordId).single();
    if (!ev) return ctx.editMessageText("⚠️ Evento no encontrado o ya eliminado.");

    await deleteGoogleCalendarEvent(ev.google_event_id);
    await supabase.from("eventos").delete().eq("id", recordId);

    await ctx.editMessageText(`🗑️ <b>Evento eliminado de Google Calendar:</b>\n<i>${ev.titulo}</i>`, {
      parse_mode: "HTML"
    });
  } catch (err) {
    console.error("Error al borrar evento:", err);
    await ctx.reply("❌ Error al borrar el evento.");
  }
});

bot.callbackQuery("close_delete_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.deleteMessage();
});

// PROCESAMIENTO DE MENSAJES Y FOTOS
async function handleContent(ctx: any, { text, bytes, mimeType, previousDraft }: any) {
  const statusMsg = await ctx.reply("🔍 Analizando evento con IA en la nube...");

  try {
    const members = await getMembers();
    let base64Image: string | undefined = undefined;
    let imagenUrl: string | null = previousDraft?.imagen_url || null;

    if (bytes) {
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      base64Image = btoa(binary);
      imagenUrl = await uploadImageToStorage(bytes, mimeType);
    }

    const result = await parseEventWithGemini({
      text,
      base64Image,
      mimeType,
      members,
      previousDraft
    });

    if (!result.eventos || !result.eventos.length) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        "🤔 No encontré fechas ni horas claras en ese mensaje."
      );
      return;
    }

    await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

    for (const evento of result.eventos) {
      let draftId: string;

      if (previousDraft) {
        const { data: updatedDraft } = await supabase
          .from("borradores")
          .update({
            titulo: evento.titulo,
            descripcion: evento.notas || null,
            fecha_inicio: evento.fechaInicio,
            fecha_fin: evento.fechaFin,
            todo_el_dia: evento.todoElDia || false,
            ubicacion: evento.ubicacion || null,
            miembros_involucrados: evento.miembrosInvolucrados || [],
            origen_texto: text
          })
          .eq("id", previousDraft.id)
          .select()
          .single();
        draftId = updatedDraft.id;
      } else {
        const { data: newDraft, error } = await supabase
          .from("borradores")
          .insert([
            {
              chat_id: ctx.chat.id,
              mensaje_id: ctx.message?.message_id,
              titulo: evento.titulo,
              descripcion: evento.notas || null,
              fecha_inicio: evento.fechaInicio,
              fecha_fin: evento.fechaFin,
              todo_el_dia: evento.todoElDia || false,
              ubicacion: evento.ubicacion || null,
              miembros_involucrados: evento.miembrosInvolucrados || [],
              origen_texto: text || "Imagen recibida",
              imagen_url: imagenUrl,
              estado: "pendiente"
            }
          ])
          .select()
          .single();

        if (error) throw error;
        draftId = newDraft.id;
      }

      const keyboard = new InlineKeyboard()
        .text("✅ Crear evento", `confirm:${draftId}`)
        .text("✏️ Corregir", `edit_draft:${draftId}`)
        .text("❌ Descartar", `cancel:${draftId}`);

      const card = formatDraftCard(evento, imagenUrl);
      await ctx.reply(card, { reply_markup: keyboard, parse_mode: "HTML" });
    }
  } catch (err) {
    console.error("Error handleContent:", err);
    await ctx.api
      .editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        "❌ Ocurrió un error al analizar la información. Por favor, reintenta."
      )
      .catch(() => {});
  }
}

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  // 1. Si es respuesta directa al mensaje de corregir
  if (ctx.message.reply_to_message) {
    const repliedText = ctx.message.reply_to_message.text || "";
    const match = repliedText.match(/borrador: ([a-f0-9-]+)/i);
    if (match) {
      const draftId = match[1];
      const { data: previousDraft } = await supabase
        .from("borradores")
        .select("*")
        .eq("id", draftId)
        .single();

      if (previousDraft && previousDraft.estado === "pendiente") {
        return await handleContent(ctx, { text, previousDraft });
      }
    }
  }

  // 2. Si no es respuesta explícita, pero hay un borrador pendiente reciente en el chat y parece una corrección
  const { data: recentDraft } = await supabase
    .from("borradores")
    .select("*")
    .eq("chat_id", ctx.chat.id)
    .eq("estado", "pendiente")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const esCorreccion = /cambia|pon|hora|fecha|lugar|dia|en vez|para/i.test(text);
  if (recentDraft && esCorreccion) {
    return await handleContent(ctx, { text, previousDraft: recentDraft });
  }

  await handleContent(ctx, { text });
});

bot.on(["message:photo", "message:document"], async (ctx) => {
  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    const caption = ctx.message.caption || "";
    const mimeType = ctx.message.photo ? "image/jpeg" : ctx.message.document?.mime_type || "image/jpeg";

    await handleContent(ctx, { text: caption, bytes, mimeType });
  } catch (e) {
    console.error("Error al procesar foto:", e);
    await ctx.reply("⚠️ No pude descargar la imagen enviada.");
  }
});

// BOTÓN CORREGIR BORRADOR
bot.callbackQuery(/^edit_draft:(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `✏️ <b>Modificar borrador:</b>\n` +
      `Responde a este mensaje indicando qué quieres cambiar (por ejemplo: <i>"cambia la hora a las 18:00"</i> o <i>"el lugar es en el parque"</i>).\n\n` +
      `<code>borrador: ${draftId}</code>`,
    { parse_mode: "HTML" }
  );
});

bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  await ctx.answerCallbackQuery({ text: "Guardando en Google Calendar..." });

  try {
    const { data: draft } = await supabase
      .from("borradores")
      .select("*")
      .eq("id", draftId)
      .single();

    if (!draft || draft.estado !== "pendiente") {
      return ctx.editMessageText("⚠️ Este evento ya ha sido gestionado o no existe.");
    }

    let fullDescription = draft.descripcion || "";
    if (draft.origen_texto && draft.origen_texto !== "Imagen recibida") {
      fullDescription += `\n\n💬 Mensaje original:\n${draft.origen_texto}`;
    }
    if (draft.imagen_url) {
      fullDescription += `\n\n🖼️ Invitación/Foto original:\n${draft.imagen_url}`;
    }

    const created = await insertGoogleCalendarEvent({
      titulo: draft.titulo,
      descripcion: fullDescription.trim(),
      ubicacion: draft.ubicacion,
      fechaInicio: draft.fecha_inicio,
      fechaFin: draft.fecha_fin,
      todoElDia: draft.todo_el_dia
    });

    await supabase.from("borradores").update({ estado: "confirmado" }).eq("id", draftId);

    await supabase.from("eventos").insert([
      {
        google_event_id: created.id,
        chat_id: draft.chat_id,
        titulo: draft.titulo,
        descripcion: fullDescription.trim(),
        fecha_inicio: draft.fecha_inicio,
        fecha_fin: draft.fecha_fin,
        todo_el_dia: draft.todo_el_dia,
        ubicacion: draft.ubicacion,
        miembros_involucrados: draft.miembros_involucrados,
        imagen_url: draft.imagen_url,
        creado_por: ctx.from?.first_name || "Familiar"
      }
    ]);

    let card = `<b>✅ Añadido a Google Calendar</b>\n\n` +
      `<b>📌 Evento:</b> ${draft.titulo}\n` +
      `<b>📅 Fecha:</b> ${formatDateNice(draft.fecha_inicio, draft.todo_el_dia)}\n`;
    if (draft.ubicacion) card += `<b>📍 Lugar:</b> ${draft.ubicacion}\n`;
    if (draft.imagen_url) card += `<b>🖼️ Imagen:</b> <a href="${draft.imagen_url}">Ver foto adjunta</a>\n`;
    card += `\n<i>Confirmado por ${ctx.from?.first_name || "un familiar"}.</i>`;

    await ctx.editMessageText(card, { parse_mode: "HTML", disable_web_page_preview: false });
  } catch (err) {
    console.error("Error confirmando evento:", err);
    await ctx.reply("❌ No se pudo guardar en Google Calendar.");
  }
});

bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  await ctx.answerCallbackQuery({ text: "Descartado" });
  await supabase.from("borradores").update({ estado: "cancelado" }).eq("id", draftId);
  await ctx.editMessageText("❌ <i>Evento descartado.</i>", { parse_mode: "HTML" });
});

function formatDraftCard(evento: any, imagenUrl: string | null) {
  let card = `<b>✨ Evento preparado</b>\n\n` +
    `<b>📌 Título:</b> ${evento.titulo}\n` +
    `<b>📅 Cuándo:</b> ${formatDateNice(evento.fechaInicio, evento.todoElDia)}\n`;
  if (evento.ubicacion) card += `<b>📍 Dónde:</b> ${evento.ubicacion}\n`;
  if (evento.miembrosInvolucrados?.length) card += `<b>👥 Para:</b> ${evento.miembrosInvolucrados.join(", ")}\n`;
  if (evento.notas) card += `<b>📝 Notas:</b> ${evento.notas}\n`;
  if (imagenUrl) card += `<b>🖼️ Imagen:</b> <a href="${imagenUrl}">Foto guardada</a>\n`;
  card += `\n¿Añadir a Google Calendar con recordatorio?`;
  return card;
}

function formatDateNice(isoStr: string, todoElDia: boolean) {
  const d = new Date(isoStr);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: config.timezone
  };
  if (!todoElDia) {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
  }
  return d.toLocaleString("es-ES", opts);
}

function formatEventLine(event: any) {
  const start = event.start.dateTime || event.start.date;
  const isAllDay = !event.start.dateTime;
  return `• <b>${formatDateNice(start, isAllDay)}</b> - ${event.summary}`;
}

// ------------------------------------------------------------------
// DENO WEBHOOK SERVER & CRON ENDPOINT
// ------------------------------------------------------------------

const handleUpdate = webhookCallback(bot, "std/http", "throw", 60000);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Health check
  if (req.method === "GET") {
    return new Response("Bot Calendario Familiar 24/7 OK", { status: 200 });
  }

  // Endpoint de cron para el resumen semanal (cada domingo a las 20:00)
  if (url.pathname.endsWith("/resumen-cron")) {
    try {
      await broadcastWeeklySummary();
      return new Response(JSON.stringify({ ok: true, message: "Resumen dominical enviado" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Error en cron resumen semanal:", err);
      return new Response("Error al enviar resumen semanal", { status: 500 });
    }
  }

  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  if (secretHeader !== config.webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
