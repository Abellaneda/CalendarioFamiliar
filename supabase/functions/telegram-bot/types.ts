// Tipos compartidos del bot (contratos de datos).

export interface Miembro {
  id: string;
  nombre: string;
  apodos: string[] | null;
  color: string | null;
  emoji: string | null;
  cumpleanos: string | null;
}

export interface ChatAutorizado {
  chat_id: number;
  tipo: string | null;
  titulo: string | null;
  activo: boolean | null;
  aprobado: boolean;
  es_admin: boolean;
  recordatorios: boolean;
  resumen_diario: boolean;
}

export interface Repeticion {
  frecuencia: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | null;
  diasSemana?: string[] | null;
  hasta?: string | null;
  veces?: number | null;
}

/** Evento ya interpretado por la IA y validado (horas en hora local de Madrid). */
export interface EventoIA {
  titulo: string;
  fechaInicio: string; // YYYY-MM-DDTHH:mm:ss (Madrid)
  fechaFin: string;
  todoElDia: boolean;
  ubicacion: string | null;
  miembrosInvolucrados: string[];
  notas: string | null;
  llevar: string[];
  confirmarAntes: string | null;
  repeticion: Repeticion | null;
}

export type AccionIA = "nuevo" | "corregir";

export interface ResultadoIA {
  accion: AccionIA;
  eventos: EventoIA[];
}

export interface Borrador {
  id: string;
  chat_id: number;
  mensaje_id: number | null;
  titulo: string;
  descripcion: string | null;
  fecha_inicio: string; // ISO UTC
  fecha_fin: string;
  todo_el_dia: boolean;
  ubicacion: string | null;
  miembros_involucrados: string[];
  origen_texto: string | null;
  estado: string;
  created_at: string;
  imagen_url: string | null;
  imagen_path: string | null;
  recurrencia: string | null;
  llevar: string[];
  evento_id: string | null;
  expira_en: string | null;
}

export interface EventoDB {
  id: string;
  google_event_id: string;
  chat_id: number;
  titulo: string;
  descripcion: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  todo_el_dia: boolean;
  ubicacion: string | null;
  miembros_involucrados: string[];
  creado_por: string | null;
  created_at: string;
  imagen_url: string | null;
  imagen_path: string | null;
  recurrencia: string | null;
  llevar: string[];
  borrado_en: string | null;
  aviso_dia_enviado: boolean;
  aviso_hora_enviado: boolean;
}

/** Evento tal y como lo devuelve la API de Google Calendar (campos usados). */
export interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

export interface DatosEventoGoogle {
  titulo: string;
  descripcion: string;
  ubicacion: string | null;
  fechaInicio: string; // ISO UTC
  fechaFin: string;
  todoElDia: boolean;
  recurrencia: string | null;
  colorId?: string | null;
}
