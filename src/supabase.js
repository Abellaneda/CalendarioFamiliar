import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

/**
 * Obtiene la lista de miembros de la familia con sus apodos y cumpleaños
 */
export async function getFamilyMembers() {
  const { data, error } = await supabase
    .from('miembros')
    .select('*')
    .order('nombre');

  if (error) {
    console.error('Error al obtener miembros:', error);
    return [];
  }
  return data || [];
}

/**
 * Sube una imagen a Supabase Storage y devuelve la URL pública
 */
export async function uploadEventImage(imageBuffer, mimeType = 'image/jpeg') {
  try {
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const fileName = `invitacion_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const { data, error } = await supabase.storage
      .from('eventos-adjuntos')
      .upload(fileName, imageBuffer, {
        contentType: mimeType,
        upsert: false
      });

    if (error) {
      console.error('Error al subir imagen a Supabase Storage:', error);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from('eventos-adjuntos')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('Excepción al subir imagen:', err);
    return null;
  }
}

/**
 * Guarda un borrador de evento pendiente de confirmación
 */
export async function saveDraft(draft) {
  const { data, error } = await supabase
    .from('borradores')
    .insert([
      {
        chat_id: draft.chatId,
        mensaje_id: draft.messageId,
        titulo: draft.titulo,
        descripcion: draft.descripcion || null,
        fecha_inicio: draft.fechaInicio,
        fecha_fin: draft.fechaFin,
        todo_el_dia: draft.todoElDia || false,
        ubicacion: draft.ubicacion || null,
        miembros_involucrados: draft.miembrosInvolucrados || [],
        origen_texto: draft.origenTexto || null,
        imagen_url: draft.imagenUrl || null,
        estado: 'pendiente'
      }
    ])
    .select()
    .single();

  if (error) {
    console.error('Error al guardar borrador:', error);
    throw error;
  }
  return data;
}

/**
 * Obtiene un borrador por su ID
 */
export async function getDraft(id) {
  const { data, error } = await supabase
    .from('borradores')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error al recuperar borrador:', error);
    return null;
  }
  return data;
}

/**
 * Actualiza el estado de un borrador ('confirmado' o 'cancelado')
 */
export async function updateDraftStatus(id, estado) {
  const { error } = await supabase
    .from('borradores')
    .update({ estado })
    .eq('id', id);

  if (error) {
    console.error('Error al actualizar estado del borrador:', error);
  }
}

/**
 * Registra un evento confirmado en la base de datos
 */
export async function recordConfirmedEvent(eventData) {
  const { data, error } = await supabase
    .from('eventos')
    .insert([
      {
        google_event_id: eventData.googleEventId,
        chat_id: eventData.chatId,
        titulo: eventData.titulo,
        descripcion: eventData.descripcion || null,
        fecha_inicio: eventData.fechaInicio,
        fecha_fin: eventData.fechaFin,
        todo_el_dia: eventData.todoElDia || false,
        ubicacion: eventData.ubicacion || null,
        miembros_involucrados: eventData.miembrosInvolucrados || [],
        imagen_url: eventData.imagenUrl || null,
        creado_por: eventData.creadoPor || null
      }
    ])
    .select()
    .single();

  if (error) {
    console.error('Error al registrar evento confirmado:', error);
  }
  return data;
}

/**
 * Registra o autoriza un chat/grupo
 */
export async function registerAuthorizedChat(chatId, tipo, titulo) {
  const { error } = await supabase
    .from('chats_autorizados')
    .upsert({ chat_id: chatId, tipo, titulo, activo: true });

  if (error) {
    console.error('Error al autorizar chat:', error);
  }
}
