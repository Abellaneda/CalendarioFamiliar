// Cliente mínimo de Google Calendar (cuenta de servicio + API REST).
import { config } from "./config.ts";
import type { DatosEventoGoogle, GoogleEvent } from "./types.ts";
import { addDays, isoToLocal, isoToLocalDate, TZ } from "./time.ts";

const API = "https://www.googleapis.com/calendar/v3/calendars";
const TIMEOUT_MS = 20000;

function pemToBinary(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^\n]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function base64url(input: string | Uint8Array): string {
  let binary = "";
  if (typeof input === "string") {
    binary = String.fromCharCode(...new TextEncoder().encode(input));
  } else {
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]);
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

let cachedToken: { token: string; exp: number } | null = null;

export async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBinary(config.googlePrivateKey),
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
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const jwt = `${header}.${claim}.${base64url(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google Auth error: ${data.error ?? res.status}`);
  cachedToken = { token: data.access_token, exp: now + 3500 };
  return data.access_token;
}

const calUrl = (suffix = "") => `${API}/${encodeURIComponent(config.googleCalendarId)}/events${suffix}`;

/** Convierte nuestros datos al cuerpo que espera Google. */
export function buildGoogleBody(e: DatosEventoGoogle): Record<string, unknown> {
  let start: Record<string, string>;
  let end: Record<string, string>;
  if (e.todoElDia) {
    const d1 = isoToLocalDate(e.fechaInicio);
    let d2 = addDays(isoToLocalDate(e.fechaFin), 1); // en Google el fin de un evento de día completo es exclusivo
    if (d2 <= d1) d2 = addDays(d1, 1);
    start = { date: d1 };
    end = { date: d2 };
  } else {
    start = { dateTime: isoToLocal(e.fechaInicio), timeZone: TZ };
    end = { dateTime: isoToLocal(e.fechaFin), timeZone: TZ };
  }
  const body: Record<string, unknown> = {
    summary: e.titulo,
    description: e.descripcion,
    location: e.ubicacion ?? "",
    start,
    end,
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 24 * 60 },
        { method: "popup", minutes: 60 }
      ]
    }
  };
  if (e.recurrencia) body.recurrence = [e.recurrencia];
  if (e.colorId) body.colorId = e.colorId;
  return body;
}

async function call(url: string, init: RequestInit): Promise<Response> {
  const token = await getGoogleAccessToken();
  return await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
}

export async function insertGoogleEvent(e: DatosEventoGoogle): Promise<GoogleEvent> {
  const res = await call(calUrl(), { method: "POST", body: JSON.stringify(buildGoogleBody(e)) });
  if (!res.ok) throw new Error(`Calendar insert ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function updateGoogleEvent(eventId: string, e: DatosEventoGoogle): Promise<GoogleEvent> {
  const body = buildGoogleBody(e);
  // Al editar hay que limpiar la repetición si ya no existe
  if (!e.recurrencia) body.recurrence = null;
  const res = await call(calUrl(`/${encodeURIComponent(eventId)}`), { method: "PATCH", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Calendar update ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function deleteGoogleEvent(eventId: string): Promise<void> {
  const res = await call(calUrl(`/${encodeURIComponent(eventId)}`), { method: "DELETE" });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Calendar delete ${res.status}: ${await res.text()}`);
  }
}

/** Eventos entre dos instantes ISO (las repeticiones se expanden en ocurrencias). */
export async function listGoogleEvents(timeMinIso: string, timeMaxIso: string): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250"
  });
  const res = await call(calUrl(`?${params}`), { method: "GET" });
  if (!res.ok) throw new Error(`Calendar list ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.items ?? []) as GoogleEvent[];
}
