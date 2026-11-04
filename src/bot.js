import { Bot, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import {
  getFamilyMembers,
  saveDraft,
  getDraft,
  updateDraftStatus,
  recordConfirmedEvent,
  registerAuthorizedChat,
  uploadEventImage
} from './supabase.js';
import { parseEventFromMessage } from './gemini.js';
import { createCalendarEvent, listUpcomingEvents } from './calendar.js';

const bot = new Bot(config.telegramToken);

// Caché de miembros de la familia
let familyMembersCache = [];

async function loadMembers() {
  familyMembersCache = await getFamilyMembers();
  console.log(`👨‍👩‍👧‍👦 Miembros cargados: ${familyMembersCache.map(m => m.nombre).join(', ')}`);
}

// ----------------------------------------------------
// COMANDOS
// ----------------------------------------------------

bot.command('start', async (ctx) => {
  const chatId = ctx.chat.id;
  const tipo = ctx.chat.type;
  const titulo = ctx.chat.title || ctx.chat.first_name || 'Privado';

  await registerAuthorizedChat(chatId, tipo, titulo);

  await ctx.reply(
    `👋 ¡Hola! Soy el asistente del **Calendario Familiar**.\n\n` +
    `📅 Puedes enviarme directamente:\n` +
    `• **Mensajes de texto:** *"Pediatra de NombreHija2 el martes a las 17:30"*\n` +
    `• **Fotos:** Fotos de invitaciones de cumpleaños, circulares del cole, recetas, etc.\n\n` +
    `Yo interpretaré la información, te mostraré el borrador y podrás añadirlo a Google Calendar con un solo toque.\n\n` +
    `Comandos disponibles:\n` +
    `• /semana - Eventos de los próximos 7 días\n` +
    `• /hoy - Eventos de hoy\n` +
    `• /cumples - Cumpleaños de la familia\n` +
    `• /ayuda - Ver instrucciones`
  );
});

bot.command('ayuda', async (ctx) => {
  await ctx.reply(
    `ℹ️ **Instrucciones de uso:**\n\n` +
    `1. **Crear evento:** Escribe el plan o envía una foto (ej: invitación de cumple).\n` +
    `2. **Confirmar:** Pulsa el botón [✅ Crear evento] para guardarlo en el calendario compartido.\n` +
    `3. **Descartar:** Pulsa [❌ Descartar] si no quieres guardarlo.\n\n` +
    `Comandos:\n` +
    `• /semana: Ver la agenda de la semana\n` +
    `• /hoy: Ver qué hay programado para hoy\n` +
    `• /cumples: Cumpleaños familiares\n`
  );
});

bot.command('cumples', async (ctx) => {
  const membersWithBday = familyMembersCache.filter(m => m.cumpleanos);
  if (membersWithBday.length === 0) {
    return ctx.reply('No hay cumpleaños registrados.');
  }

  const list = membersWithBday.map(m => {
    const [year, month, day] = m.cumpleanos.split('-');
    const fechaObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const fechaStr = fechaObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
    const edad = new Date().getFullYear() - parseInt(year);
    return `• ${m.emoji || '🎂'} **${m.nombre}:** ${fechaStr} (${edad} años)`;
  }).join('\n');

  await ctx.reply(`🎂 **Cumpleaños de la familia:**\n\n${list}`);
});

bot.command('hoy', async (ctx) => {
  try {
    const events = await listUpcomingEvents(1);
    if (events.length === 0) {
      return ctx.reply('☀️ Hoy no hay eventos programados en el calendario.');
    }

    const lines = events.map(e => formatEventLine(e)).join('\n');
    await ctx.reply(`📅 **Eventos para hoy:**\n\n${lines}`);
  } catch (err) {
    console.error('Error al consultar eventos de hoy:', err);
    await ctx.reply('⚠️ No pude consultar los eventos de hoy.');
  }
});

bot.command('semana', async (ctx) => {
  try {
    const events = await listUpcomingEvents(7);
    if (events.length === 0) {
      return ctx.reply('📅 No hay eventos programados para los próximos 7 días.');
    }

    const lines = events.map(e => formatEventLine(e)).join('\n');
    await ctx.reply(`📅 **Próximos 7 días:**\n\n${lines}`);
  } catch (err) {
    console.error('Error al consultar eventos de la semana:', err);
    await ctx.reply('⚠️ No pude consultar los eventos de la semana.');
  }
});

// ----------------------------------------------------
// PROCESAMIENTO DE FOTOS Y TEXTOS
// ----------------------------------------------------

async function processIncomingContent(ctx, { text, imageBuffer, mimeType }) {
  const statusMsg = await ctx.reply('🔍 Analizando evento con IA...');

  try {
    const result = await parseEventFromMessage({
      text,
      imageBuffer,
      mimeType,
      members: familyMembersCache
    });

    if (!result.eventos || result.eventos.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        '🤔 No encontré fechas ni eventos en ese mensaje. Si era un evento, intenta especificar día u hora.'
      );
      return;
    }

    // Borramos el mensaje de "Analizando..."
    await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

    // Si hay imagen, la subimos a Supabase Storage para guardarla como adjunto permanente
    let imagenUrl = null;
    if (imageBuffer) {
      imagenUrl = await uploadEventImage(imageBuffer, mimeType);
    }

    // Por cada evento detectado, creamos un borrador y enviamos tarjeta con botones
    for (const evento of result.eventos) {
      const draft = await saveDraft({
        chatId: ctx.chat.id,
        messageId: ctx.message?.message_id,
        titulo: evento.titulo,
        descripcion: evento.notas,
        fechaInicio: evento.fechaInicio,
        fechaFin: evento.fechaFin,
        todoElDia: evento.todoElDia,
        ubicacion: evento.ubicacion,
        miembrosInvolucrados: evento.miembrosInvolucrados,
        origenTexto: text || 'Imagen recibida',
        imagenUrl: imagenUrl
      });

      const keyboard = new InlineKeyboard()
        .text('✅ Crear evento', `confirm:${draft.id}`)
        .text('❌ Descartar', `cancel:${draft.id}`);

      const formattedCard = formatDraftCard(evento);
      await ctx.reply(formattedCard, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('Error procesando contenido:', err);
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      '❌ Ocurrió un error al analizar la información. Por favor, inténtalo de nuevo.'
    ).catch(() => {});
  }
}

// Mensajes de texto
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return; // Ignorar comandos no reconocidos
  await processIncomingContent(ctx, { text });
});

// Fotos
bot.on(['message:photo', 'message:document'], async (ctx) => {
  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const caption = ctx.message.caption || '';
    const mimeType = ctx.message.photo ? 'image/jpeg' : (ctx.message.document?.mime_type || 'image/jpeg');

    await processIncomingContent(ctx, {
      text: caption,
      imageBuffer,
      mimeType
    });
  } catch (err) {
    console.error('Error al descargar archivo de Telegram:', err);
    await ctx.reply('⚠️ No pude procesar la imagen enviada.');
  }
});

// ----------------------------------------------------
// ACCIONES DE BOTONES
// ----------------------------------------------------

bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  await ctx.answerCallbackQuery({ text: 'Creando evento en Google Calendar...' });

  try {
    const draft = await getDraft(draftId);
    if (!draft || draft.estado !== 'pendiente') {
      return ctx.editMessageText('⚠️ Este evento ya ha sido gestionado o no existe.');
    }

    let fullDescription = draft.descripcion || '';
    if (draft.origen_texto && draft.origen_texto !== 'Imagen recibida') {
      fullDescription += `\n\n💬 Mensaje original:\n${draft.origen_texto}`;
    }
    if (draft.imagen_url) {
      fullDescription += `\n\n🖼️ Invitación/Foto original:\n${draft.imagen_url}`;
    }

    const createdEvent = await createCalendarEvent({
      titulo: draft.titulo,
      descripcion: fullDescription.trim(),
      ubicacion: draft.ubicacion,
      fechaInicio: draft.fecha_inicio,
      fechaFin: draft.fecha_fin,
      todoElDia: draft.todo_el_dia
    });

    await updateDraftStatus(draftId, 'confirmado');
    await recordConfirmedEvent({
      googleEventId: createdEvent.id,
      chatId: draft.chat_id,
      titulo: draft.titulo,
      descripcion: fullDescription.trim(),
      fechaInicio: draft.fecha_inicio,
      fechaFin: draft.fecha_fin,
      todoElDia: draft.todo_el_dia,
      ubicacion: draft.ubicacion,
      miembrosInvolucrados: draft.miembros_involucrados,
      imagenUrl: draft.imagen_url,
      creadoPor: ctx.from?.first_name || 'Familiar'
    });

    const successCard = `<b>✅ Añadido a Google Calendar</b>\n\n` +
      `<b>📌 Evento:</b> ${draft.titulo}\n` +
      `<b>📅 Fecha:</b> ${formatDateNice(draft.fecha_inicio, draft.todo_el_dia)}\n` +
      (draft.ubicacion ? `<b>📍 Lugar:</b> ${draft.ubicacion}\n` : '') +
      `<i>Confirmado por ${ctx.from?.first_name || 'un familiar'}.</i>`;

    await ctx.editMessageText(successCard, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Error al confirmar evento:', err);
    await ctx.reply('❌ No se pudo guardar en Google Calendar. Revisa los permisos.');
  }
});

bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  await ctx.answerCallbackQuery({ text: 'Descartado' });
  await updateDraftStatus(draftId, 'cancelado');
  await ctx.editMessageText('❌ <i>Evento descartado.</i>', { parse_mode: 'HTML' });
});

// ----------------------------------------------------
// UTILIDADES DE FORMATO
// ----------------------------------------------------

function formatDraftCard(evento) {
  const fechaStr = formatDateNice(evento.fechaInicio, evento.todoElDia);
  let card = `<b>✨ Nuevo evento detectado</b>\n\n` +
    `<b>📌 Título:</b> ${evento.titulo}\n` +
    `<b>📅 Cuándo:</b> ${fechaStr}\n`;

  if (evento.ubicacion) {
    card += `<b>📍 Dónde:</b> ${evento.ubicacion}\n`;
  }
  if (evento.miembrosInvolucrados && evento.miembrosInvolucrados.length) {
    card += `<b>👥 Para:</b> ${evento.miembrosInvolucrados.join(', ')}\n`;
  }
  if (evento.notas) {
    card += `<b>📝 Notas:</b> ${evento.notas}\n`;
  }

  card += `\n¿Quieres que lo añada a Google Calendar?`;
  return card;
}

function formatDateNice(isoDateStr, todoElDia) {
  const date = new Date(isoDateStr);
  const options = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: config.timezone
  };

  if (!todoElDia) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }

  return date.toLocaleString('es-ES', options);
}

function formatEventLine(event) {
  const start = event.start.dateTime || event.start.date;
  const isAllDay = !event.start.dateTime;
  const dateStr = formatDateNice(start, isAllDay);
  return `• <b>${dateStr}</b> - ${event.summary}`;
}

// ----------------------------------------------------
// INICIO
// ----------------------------------------------------

async function start() {
  console.log('🚀 Iniciando Bot de Calendario Familiar...');
  await loadMembers();
  bot.start({
    onStart: (botInfo) => {
      console.log(`🤖 Bot @${botInfo.username} en línea y escuchando mensajes.`);
    }
  });
}

start().catch(err => {
  console.error('Error fatal al iniciar bot:', err);
});
