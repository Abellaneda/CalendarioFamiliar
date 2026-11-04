# 📅 BotCalendarioFamiliar con IA (Telegram & Google Calendar)

[![Deno](https://img.shields.io/badge/Deno-2.x-black.svg)](https://deno.land/)
[![Supabase](https://img.shields.io/badge/Supabase-Edge%20Functions-green.svg)](https://supabase.com/)
[![Gemini](https://img.shields.io/badge/AI-Google%20Gemini-blue.svg)](https://ai.google.dev/)
[![Telegram](https://img.shields.io/badge/Bot-Telegram%20API-informational.svg)](https://telegram.org/)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)

> **Language / Idioma:** [🇪🇸 Español](#-versión-en-español) | [🇬🇧 English](#-english-version)

---

## 🇪🇸 Versión en Español

Asistente inteligente para la gestión de eventos familiares a través de **Telegram** y **Google Calendar** (`BotCalendarioFamiliar`), potenciado por **Google Gemini** y **Supabase Edge Functions**.

---

### 🚀 Características Principales

- **Multimodal Inteligente:** Interpreta mensajes de texto libre, fotografías de invitaciones escolares, citas médicas en PDF y notas de voz (`.ogg` / `.m4a`) mediante Google Gemini con esquema JSON estructurado.
- **Zona Horaria Estricta (`Europe/Madrid`):** Conversión y preservación exacta de fechas y horas locales tanto en horario estándar como de verano.
- **Control de Acceso y Privacidad:** Solo los chats aprobados pueden interactuar con el bot. Solicitudes de nuevos usuarios notifican con botones de autorización al administrador.
- **Seguridad en Base de Datos (RLS):** Row Level Security habilitado en todas las tablas (`miembros`, `borradores`, `eventos`, `chats_autorizados`, `updates_procesados`).
- **Storage Privado:** Bucket `eventos-adjuntos` privado con generación de URLs firmadas temporales para previsualización segura de invitaciones.
- **Gestión Completa de Eventos:** Crear, previsualizar en tarjetas interactivas, modificar hora/día con un toque (`☀️ Todo el día`), corregir por lenguaje natural, editar eventos ya creados (`/editar`) y borrado seguro con confirmación (`/borrar`).
- **Detección de Conflictos y Duplicados:** Alerta preventiva en la tarjeta si ya existe un evento similar en el mismo día.
- **Soporte de Repetición (RRULE):** Detección de eventos recurrentes (ej. *"todos los martes a las 17:30 hasta junio"*).
- **Lista de Cosas a Llevar & RSVP:** Identifica requisitos ("llevar toalla", "pagar 5€", "confirmar antes del día X").
- **Automatización vía pg_cron:**
  - Resumen semanal los domingos a las 20:00 hora peninsular.
  - Resumen matutino diario a las 8:00 (configurable por chat con `/diario on|off`).
  - Recordatorios automáticos en Telegram 24h antes y 1h antes del evento (conmutables con `/avisos on|off`).

---

### 👨‍👩‍👧‍👦 Miembros de la Familia (Ejemplo de Configuración)

El sistema soporta miembros familiares configurables en la tabla `miembros`:

- **NombreMama** (mamá) - 01/01/1987 👩
- **NombrePapa** (papá) - 01/01/1985 👨 (Administrador)
- **NombreHijo1** - 01/01/2020 👦
- **NombreHija2** - 01/01/2023 👧

---

### 💬 Comandos Disponibles

| Comando | Descripción |
|---|---|
| `/hoy` | Consulta los eventos programados para hoy |
| `/manana` | Consulta los eventos programados para mañana |
| `/semana` | Agenda semanal agrupada por días |
| `/agenda [Nombre]` | Muestra los eventos de los próximos 14 días para una persona |
| `/cumples` | Próximos cumpleaños familiares ordenados cronológicamente con edad |
| `/editar` | Menú interactivo para modificar fecha u hora de un evento existente |
| `/borrar` | Menú interactivo para eliminar un evento de Google Calendar |
| `/miembros` | Lista personas registradas, apodos y colores asignados |
| `/apodo [Nombre] [apodo]` | Asocia un apodo a un miembro (ej: `/apodo NombreHijo1 ApodoHijo1`) |
| `/color [Nombre] [1-11]` | Define color de Google Calendar para los eventos de esa persona |
| `/avisos [on\|off]` | Activa o desactiva alertas en el chat (día antes y 1h antes) |
| `/diario [on\|off]` | Activa o desactiva el resumen matutino de las 8:00 |
| `/ayuda` | Guía de uso rápido del bot |

---

### 🛠️ Arquitectura y Tecnologías

- **Runtime:** Deno (Supabase Edge Functions 24/7 sin servidor propio).
- **Telegram Bot API:** grammY con deduplicación de updates para evitar eventos repetidos.
- **Inteligencia Artificial:** Google Gemini (v1beta API REST con `gemini-3.5-flash` y fallback a `gemini-3.1-flash-lite` / `gemini-3.8-flash`).
- **Base de Datos:** PostgreSQL en Supabase con Row Level Security activado y extensiones `pg_cron` y `pg_net`.
- **Calendario:** Google Calendar REST API v3 mediante cuenta de servicio con tokens JWT firmados vía Web Crypto nativo (`RSASSA-PKCS1-v1_5`).

---

### 🧪 Pruebas Unitarias

Para ejecutar la suite de pruebas automatizadas:

```bash
deno test --allow-env supabase/functions/telegram-bot/core_test.ts supabase/functions/telegram-bot/gemini_test.ts
```

---

### 📄 Licencia

Este proyecto está bajo la Licencia **Creative Commons Atribución-NoComercial-CompartirIgual 4.0 Internacional (`CC BY-NC-SA 4.0`)**.
- **Permitido:** Uso personal, estudio, aprendizaje y distribución no comercial.
- **Obligatorio:** Atribución de autoría a Luis Abellaneda y compartir cualquier derivado bajo esta misma licencia.
- **Prohibido:** Cualquier venta, explotación comercial o lucro sin autorización expresa.
Consulta el archivo [`LICENSE`](LICENSE) para más detalles.

---

## 🇬🇧 English Version

Intelligent family calendar assistant operated via **Telegram** and **Google Calendar** (`BotCalendarioFamiliar`), powered by **Google Gemini** multimodal AI and **Supabase Edge Functions**.

---

### 🚀 Key Features

- **Multimodal AI Understanding:** Parses freeform text, invitation snapshots, school flyers, medical appointment PDFs, and voice notes (`.ogg` / `.m4a`) using Google Gemini structured JSON output.
- **Strict Timezone Handling (`Europe/Madrid`):** Accurate conversion and persistence of local dates and daylight saving shifts.
- **Access Control & Privacy:** Only approved chats can query or create events. Unrecognized users trigger admin authorization alerts with inline approval buttons.
- **Database Security (RLS):** Row Level Security enabled across all tables (`miembros`, `borradores`, `eventos`, `chats_autorizados`, `updates_procesados`).
- **Private Attachment Storage:** Private Supabase Storage bucket (`eventos-adjuntos`) with short-lived signed URLs for temporary previews.
- **Interactive Event Lifecycle:** Create, preview via Telegram cards, one-tap duration toggle (`☀️ All Day`), natural language edits, update existing events (`/editar`), and deletion with confirmation (`/borrar`).
- **Collision & Duplicate Detection:** Preemptive card alerts when similar events already exist on the target date.
- **Recurrence Support (RRULE):** Parses recurring patterns (e.g., *"every Tuesday at 17:30 until June"*).
- **Checklist & RSVP Extraction:** Extracts required items ("bring towel", "bring 5€", "confirm attendance before date X").
- **Automated Scheduling via pg_cron:**
  - Weekly digest every Sunday at 20:00 (local time).
  - Daily morning summary at 08:00 (toggleable per chat with `/diario on|off`).
  - Automated event reminders 24h and 1h ahead (toggleable with `/avisos on|off`).

---

### 👨‍👩‍👧‍👦 Family Members (Configuration Example)

Family members are fully customizable in the `miembros` table:

- **NombreMama** (Mom) - 01/01/1987 👩
- **NombrePapa** (Dad) - 01/01/1985 👨 (Administrator)
- **NombreHijo1** - 01/01/2020 👦
- **NombreHija2** - 01/01/2023 👧

---

### 💬 Available Commands

| Command | Description |
|---|---|
| `/hoy` | List events scheduled for today |
| `/manana` | List events scheduled for tomorrow |
| `/semana` | Weekly calendar view grouped by day |
| `/agenda [Name]` | Display upcoming 14 days of events for a specific family member |
| `/cumples` | Upcoming family birthdays sorted chronologically with age |
| `/editar` | Interactive menu to modify date or time of an existing event |
| `/borrar` | Interactive menu to delete an event from Google Calendar |
| `/miembros` | List registered members, nicknames, and assigned colors |
| `/apodo [Name] [nickname]` | Associate an alias with a member (e.g. `/apodo NombreHijo1 Alias1`) |
| `/color [Name] [1-11]` | Set Google Calendar event color for a member |
| `/avisos [on\|off]` | Toggle chat alerts (day before and 1h before event) |
| `/diario [on\|off]` | Toggle daily morning 08:00 summary |
| `/ayuda` | Quick user guide and command help |

---

### 🛠️ Architecture & Tech Stack

- **Runtime:** Deno (Supabase Edge Functions 24/7 serverless execution).
- **Telegram Bot API:** grammY with atomic update deduplication.
- **Artificial Intelligence:** Google Gemini REST API (`gemini-3.5-flash` with fallbacks).
- **Database:** PostgreSQL on Supabase with Row Level Security, `pg_cron`, and `pg_net`.
- **Calendar Integration:** Google Calendar REST API v3 using Service Account authentication signed via native Web Crypto (`RSASSA-PKCS1-v1_5`).

---

### 🧪 Automated Testing

To run the unit test suite:

```bash
deno test --allow-env supabase/functions/telegram-bot/core_test.ts supabase/functions/telegram-bot/gemini_test.ts
```

---

### 📄 License

This project is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (`CC BY-NC-SA 4.0`)**.
- **Permitted:** Personal use, educational exploration, and non-commercial sharing.
- **Required:** Proper attribution to Luis Abellaneda and sharing any derivative works under the identical license.
- **Restricted:** Any commercial exploitation, redistribution for profit, or commercial SaaS usage is strictly prohibited without explicit written permission.
See the [`LICENSE`](LICENSE) file for complete legal terms.
