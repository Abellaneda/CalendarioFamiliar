import { google } from 'googleapis';
import fs from 'fs';
import { config } from './config.js';

let calendarClient = null;

function getCalendarClient() {
  if (calendarClient) return calendarClient;

  if (!fs.existsSync(config.googleServiceAccountKeyPath)) {
    throw new Error(`No se encontró el archivo de clave en ${config.googleServiceAccountKeyPath}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: config.googleServiceAccountKeyPath,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });

  calendarClient = google.calendar({ version: 'v3', auth });
  return calendarClient;
}

/**
 * Añade un evento a Google Calendar
 */
export async function createCalendarEvent(event) {
  const calendar = getCalendarClient();

  const startObj = event.todoElDia
    ? { date: event.fechaInicio.split('T')[0] }
    : { dateTime: event.fechaInicio, timeZone: config.timezone };

  const endObj = event.todoElDia
    ? { date: event.fechaFin.split('T')[0] }
    : { dateTime: event.fechaFin, timeZone: config.timezone };

  const requestBody = {
    summary: event.titulo,
    description: event.descripcion || '',
    location: event.ubicacion || '',
    start: startObj,
    end: endObj,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 24 * 60 }, // 1 día antes
        { method: 'popup', minutes: 60 }       // 1 hora antes
      ]
    }
  };

  const response = await calendar.events.insert({
    calendarId: config.googleCalendarId,
    requestBody
  });

  return response.data;
}

/**
 * Obtiene los eventos para los próximos N días
 */
export async function listUpcomingEvents(days = 7) {
  const calendar = getCalendarClient();
  const now = new Date();
  const timeMin = now.toISOString();

  const future = new Date();
  future.setDate(now.getDate() + days);
  future.setHours(23, 59, 59, 999);
  const timeMax = future.toISOString();

  const response = await calendar.events.list({
    calendarId: config.googleCalendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime'
  });

  return response.data.items || [];
}

/**
 * Elimina un evento de Google Calendar
 */
export async function deleteCalendarEvent(eventId) {
  const calendar = getCalendarClient();
  await calendar.events.delete({
    calendarId: config.googleCalendarId,
    eventId
  });
}
