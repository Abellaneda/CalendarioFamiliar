// Capa de datos (Supabase). Usa la clave de servicio: las tablas tienen RLS activado y sin acceso público.
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.ts";
import type { Borrador, ChatAutorizado, EventoDB, Miembro } from "./types.ts";
import { addDays, dayStartIso } from "./time.ts";

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const BUCKET = "eventos-adjuntos";
const MAX_BYTES = 10 * 1024 * 1024;
const EXT_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf"
};
const URL_FIRMADA_SEGUNDOS = 60 * 60 * 24 * 365;

function fail(contexto: string, error: { message: string } | null): void {
  if (error) throw new Error(`${contexto}: ${error.message}`);
}

// ---------- Miembros ----------
export async function getMembers(): Promise<Miembro[]> {
  const { data, error } = await supabase.from("miembros").select("*").order("nombre");
  fail("miembros", error);
  return (data ?? []) as Miembro[];
}

export async function addApodo(nombre: string, apodo: string): Promise<Miembro | null> {
  const miembros = await getMembers();
  const m = miembros.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
  if (!m) return null;
  const apodos = [...new Set([...(m.apodos ?? []), apodo])];
  const { error } = await supabase.from("miembros").update({ apodos }).eq("id", m.id);
  fail("apodo", error);
  return { ...m, apodos };
}

/** Asigna un color de Google Calendar (1-11) a una persona. Devuelve false si no existe. */
export async function setColor(nombre: string, color: string): Promise<boolean> {
  const m = (await getMembers()).find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
  if (!m) return false;
  const { error } = await supabase.from("miembros").update({ color }).eq("id", m.id);
  fail("color", error);
  return true;
}

// ---------- Chats ----------
export async function getChat(chatId: number): Promise<ChatAutorizado | null> {
  const { data, error } = await supabase.from("chats_autorizados").select("*").eq("chat_id", chatId).maybeSingle();
  fail("chat", error);
  return (data as ChatAutorizado | null) ?? null;
}

/** Registra un chat nuevo como NO aprobado (si ya existe no cambia su estado). */
export async function registrarChatPendiente(chatId: number, tipo: string, titulo: string): Promise<ChatAutorizado> {
  const existente = await getChat(chatId);
  if (existente) return existente;
  const { data, error } = await supabase
    .from("chats_autorizados")
    .insert({ chat_id: chatId, tipo, titulo, activo: true, aprobado: false })
    .select()
    .single();
  fail("registrar chat", error);
  return data as ChatAutorizado;
}

export async function aprobarChat(chatId: number, aprobado: boolean): Promise<void> {
  const { error } = await supabase.from("chats_autorizados").update({ aprobado, activo: aprobado }).eq("chat_id", chatId);
  fail("aprobar chat", error);
}

export async function setChatFlag(chatId: number, campo: "recordatorios" | "resumen_diario", valor: boolean): Promise<void> {
  const { error } = await supabase.from("chats_autorizados").update({ [campo]: valor }).eq("chat_id", chatId);
  fail("flag chat", error);
}

export async function chatsAdmin(): Promise<ChatAutorizado[]> {
  const { data, error } = await supabase.from("chats_autorizados").select("*").eq("es_admin", true).eq("aprobado", true);
  fail("admins", error);
  return (data ?? []) as ChatAutorizado[];
}

export async function chatsActivos(filtro?: "recordatorios" | "resumen_diario"): Promise<ChatAutorizado[]> {
  let q = supabase.from("chats_autorizados").select("*").eq("aprobado", true).eq("activo", true);
  if (filtro) q = q.eq(filtro, true);
  const { data, error } = await q;
  fail("chats", error);
  return (data ?? []) as ChatAutorizado[];
}

// ---------- Idempotencia de updates de Telegram ----------
/** Devuelve true si el update es nuevo; false si ya se había procesado. */
export async function reclamarUpdate(updateId: number): Promise<boolean> {
  const { error } = await supabase.from("updates_procesados").insert({ update_id: updateId });
  if (!error) return true;
  if (error.code === "23505") return false;
  console.error("reclamarUpdate:", error.message);
  return true; // si falla la tabla, mejor procesar que perder el mensaje
}

export async function limpiarUpdatesAntiguos(): Promise<void> {
  const limite = new Date(Date.now() - 7 * 86400000).toISOString();
  await supabase.from("updates_procesados").delete().lt("created_at", limite);
}

// ---------- Borradores ----------
export type NuevoBorrador = Omit<Borrador, "id" | "created_at" | "expira_en" | "estado">;

export async function crearBorrador(b: NuevoBorrador): Promise<Borrador> {
  const { data, error } = await supabase.from("borradores").insert({ ...b, estado: "pendiente" }).select().single();
  fail("crear borrador", error);
  return data as Borrador;
}

export async function actualizarBorrador(id: string, cambios: Partial<NuevoBorrador>): Promise<Borrador> {
  const { data, error } = await supabase
    .from("borradores")
    .update({ ...cambios, expira_en: new Date(Date.now() + 86400000).toISOString() })
    .eq("id", id)
    .eq("estado", "pendiente")
    .select()
    .single();
  fail("actualizar borrador", error);
  return data as Borrador;
}

export async function getBorrador(id: string): Promise<Borrador | null> {
  const { data, error } = await supabase.from("borradores").select("*").eq("id", id).maybeSingle();
  fail("borrador", error);
  return (data as Borrador | null) ?? null;
}

/** Pasa pendiente -> procesando de forma atómica. Devuelve null si otro proceso ya lo tomó. */
export async function reclamarBorrador(id: string): Promise<Borrador | null> {
  const { data, error } = await supabase
    .from("borradores")
    .update({ estado: "procesando" })
    .eq("id", id)
    .eq("estado", "pendiente")
    .select()
    .maybeSingle();
  fail("reclamar borrador", error);
  return (data as Borrador | null) ?? null;
}

export async function marcarBorrador(id: string, estado: "pendiente" | "confirmado" | "cancelado" | "caducado"): Promise<void> {
  const { error } = await supabase.from("borradores").update({ estado }).eq("id", id);
  fail("marcar borrador", error);
}

/** Último borrador pendiente del chat creado en los últimos `minutos`. */
export async function ultimoBorradorPendiente(chatId: number, minutos = 30): Promise<Borrador | null> {
  const desde = new Date(Date.now() - minutos * 60000).toISOString();
  const { data, error } = await supabase
    .from("borradores")
    .select("*")
    .eq("chat_id", chatId)
    .eq("estado", "pendiente")
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(1);
  fail("último borrador", error);
  return ((data ?? [])[0] as Borrador | undefined) ?? null;
}

export async function caducarBorradores(): Promise<void> {
  await supabase
    .from("borradores")
    .update({ estado: "caducado" })
    .eq("estado", "pendiente")
    .lt("expira_en", new Date().toISOString());
}

// ---------- Eventos ----------
export type NuevoEvento = Omit<
  EventoDB,
  "id" | "created_at" | "borrado_en" | "aviso_dia_enviado" | "aviso_hora_enviado"
>;

export async function insertarEvento(e: NuevoEvento): Promise<EventoDB> {
  const { data, error } = await supabase.from("eventos").insert(e).select().single();
  fail("insertar evento", error);
  return data as EventoDB;
}

export async function actualizarEvento(id: string, cambios: Partial<NuevoEvento>): Promise<void> {
  const { error } = await supabase
    .from("eventos")
    .update({ ...cambios, aviso_dia_enviado: false, aviso_hora_enviado: false })
    .eq("id", id);
  fail("actualizar evento", error);
}

export async function getEvento(id: string): Promise<EventoDB | null> {
  const { data, error } = await supabase.from("eventos").select("*").eq("id", id).maybeSingle();
  fail("evento", error);
  return (data as EventoDB | null) ?? null;
}

export async function borrarEventoLogico(id: string): Promise<void> {
  const { error } = await supabase.from("eventos").update({ borrado_en: new Date().toISOString() }).eq("id", id);
  fail("borrar evento", error);
}

/** Próximos eventos (no borrados) ordenados por fecha. */
export async function proximosEventos(limite = 8): Promise<EventoDB[]> {
  const { data, error } = await supabase
    .from("eventos")
    .select("*")
    .is("borrado_en", null)
    .gte("fecha_fin", new Date().toISOString())
    .order("fecha_inicio", { ascending: true })
    .limit(limite);
  fail("próximos eventos", error);
  return (data ?? []) as EventoDB[];
}

/** Eventos registrados (no borrados) que empiezan el día local indicado. */
export async function eventosDelDia(fechaLocal: string): Promise<EventoDB[]> {
  const { data, error } = await supabase
    .from("eventos")
    .select("*")
    .is("borrado_en", null)
    .gte("fecha_inicio", dayStartIso(fechaLocal))
    .lt("fecha_inicio", dayStartIso(addDays(fechaLocal, 1)));
  fail("eventos del día", error);
  return (data ?? []) as EventoDB[];
}

/** Eventos que empiezan en las próximas `horas` y aún tienen avisos pendientes. */
export async function eventosParaAviso(horas: number): Promise<EventoDB[]> {
  const ahora = new Date();
  const { data, error } = await supabase
    .from("eventos")
    .select("*")
    .is("borrado_en", null)
    .gt("fecha_inicio", ahora.toISOString())
    .lte("fecha_inicio", new Date(ahora.getTime() + horas * 3600000).toISOString())
    .or("aviso_dia_enviado.eq.false,aviso_hora_enviado.eq.false");
  fail("eventos para aviso", error);
  return (data ?? []) as EventoDB[];
}

export async function marcarAviso(id: string, campos: { aviso_dia_enviado?: boolean; aviso_hora_enviado?: boolean }): Promise<void> {
  const { error } = await supabase.from("eventos").update(campos).eq("id", id);
  fail("marcar aviso", error);
}

// ---------- Adjuntos (bucket privado) ----------
export interface AdjuntoGuardado {
  path: string;
  url: string;
}

export async function subirAdjunto(bytes: Uint8Array, mimeType: string): Promise<AdjuntoGuardado | null> {
  const ext = EXT_POR_MIME[mimeType];
  if (!ext || bytes.length > MAX_BYTES) return null;
  const path = `invitacion_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
  if (error) {
    console.error("subirAdjunto:", error.message);
    return null;
  }
  const url = await urlFirmada(path);
  return url ? { path, url } : null;
}

export async function urlFirmada(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, URL_FIRMADA_SEGUNDOS);
  if (error) {
    console.error("urlFirmada:", error.message);
    return null;
  }
  return data.signedUrl;
}

export const LIMITE_ADJUNTO_BYTES = MAX_BYTES;
export const MIMES_ADMITIDOS = Object.keys(EXT_POR_MIME);
