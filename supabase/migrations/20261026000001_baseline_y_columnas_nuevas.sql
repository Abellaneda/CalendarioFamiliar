-- Migración aditiva: documenta el esquema existente (IF NOT EXISTS) y añade columnas/tablas nuevas.
-- No elimina ni renombra nada.

create table if not exists public.miembros (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  apodos text[] default '{}',
  color text,
  emoji text,
  cumpleanos date,
  created_at timestamptz default now()
);

create table if not exists public.chats_autorizados (
  chat_id bigint primary key,
  tipo text,
  titulo text,
  activo boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.borradores (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  mensaje_id bigint,
  titulo text not null,
  descripcion text,
  fecha_inicio timestamptz not null,
  fecha_fin timestamptz not null,
  todo_el_dia boolean default false,
  ubicacion text,
  miembros_involucrados text[] default '{}',
  origen_texto text,
  estado text default 'pendiente',
  created_at timestamptz default now(),
  imagen_url text
);

create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  google_event_id text not null unique,
  chat_id bigint not null,
  titulo text not null,
  descripcion text,
  fecha_inicio timestamptz not null,
  fecha_fin timestamptz not null,
  todo_el_dia boolean default false,
  ubicacion text,
  miembros_involucrados text[] default '{}',
  creado_por text,
  created_at timestamptz default now(),
  imagen_url text
);

-- Control de acceso y preferencias por chat
alter table public.chats_autorizados add column if not exists aprobado boolean not null default false;
alter table public.chats_autorizados add column if not exists es_admin boolean not null default false;
alter table public.chats_autorizados add column if not exists recordatorios boolean not null default true;
alter table public.chats_autorizados add column if not exists resumen_diario boolean not null default false;

-- El chat ya existente queda aprobado y como administrador
update public.chats_autorizados set aprobado = true, es_admin = true where chat_id = 123456789;

-- Eventos: borrado lógico, repetición, avisos, adjuntos privados
alter table public.eventos add column if not exists borrado_en timestamptz;
alter table public.eventos add column if not exists recurrencia text;
alter table public.eventos add column if not exists imagen_path text;
alter table public.eventos add column if not exists llevar text[] default '{}';
alter table public.eventos add column if not exists aviso_dia_enviado boolean not null default false;
alter table public.eventos add column if not exists aviso_hora_enviado boolean not null default false;

-- Borradores: repetición, edición de eventos existentes, caducidad
alter table public.borradores add column if not exists recurrencia text;
alter table public.borradores add column if not exists imagen_path text;
alter table public.borradores add column if not exists llevar text[] default '{}';
alter table public.borradores add column if not exists evento_id uuid;
alter table public.borradores add column if not exists expira_en timestamptz default (now() + interval '24 hours');

-- Evita procesar dos veces el mismo mensaje de Telegram (reintentos)
create table if not exists public.updates_procesados (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

create index if not exists borradores_chat_estado_idx on public.borradores (chat_id, estado, created_at desc);
create index if not exists eventos_inicio_idx on public.eventos (fecha_inicio) where borrado_en is null;
