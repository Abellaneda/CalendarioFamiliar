import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/**
 * Prompt del sistema con las directrices de la familia y el formato esperado
 */
function buildSystemInstruction(members) {
  const membersList = members.map(m => {
    const apodos = m.apodos && m.apodos.length ? ` (apodos: ${m.apodos.join(', ')})` : '';
    const cumple = m.cumpleanos ? ` [Cumpleaños: ${m.cumpleanos}]` : '';
    return `- ${m.nombre} ${m.emoji || ''}${apodos}${cumple}`;
  }).join('\n');

  const now = new Date();
  const fechaHoyStr = now.toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: config.timezone
  });
  const horaActualStr = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: config.timezone
  });

  return `Eres el asistente inteligente del calendario familiar.
Tu tarea es analizar el texto o la imagen que te envía un miembro de la familia (invitaciones a cumpleaños, circulares del colegio, citas médicas, actividades extraescolares, etc.) y extraer los eventos en formato estructurado.

INFORMACIÓN TEMPORAL DE REFERENCIA:
- Fecha actual: ${fechaHoyStr}
- Hora actual: ${horaActualStr}
- Zona horaria: Europe/Madrid

MIEMBROS DE LA FAMILIA:
${membersList}

REGLAS DE INTERPRETACIÓN:
1. Identifica para quién es el evento basándote en el texto/imagen y en los miembros de la familia. Si no se especifica o afecta a todos, indícalo como ["Familia"].
2. Si es una invitación de cumpleaños de un amigo/compañero (ej. "Cumpleaños de Mario"), pon un emoji representativo (🎂), e indica en la descripción el cumpleañero.
3. Si es una cita médica o dentista, usa emojis como 🩺 o 🦷. Si es del colegio, 🎒.
4. Si no se especifica la hora de finalización, asume una duración de 1 HORA por defecto.
5. Si no se especifica ninguna hora pero sí un día (ej. "el martes no hay cole"), marca todoElDia como true.
6. Fechas en formato ISO local con zona horaria (ej: "2026-11-03T17:30:00").
7. Extrae detalles clave en "notas": si hay que llevar algo (disfraz, toalla, comida), si hay que confirmar asistencia (RSVP), teléfono de contacto, etc.
8. Si el texto o circular contiene VARIOS eventos (por ejemplo, calendario de excursiones del trimestre), devuelve una lista con todos ellos.

DEBES RESPONDER EXCLUSIVAMENTE CON UN OBJETO JSON que tenga la propiedad "eventos", que es un array de objetos con esta estructura:
{
  "eventos": [
    {
      "titulo": "[Nombre] Título breve con emoji (ej: [NombreHijo1] 🎂 Cumple de Mario)",
      "fechaInicio": "YYYY-MM-DDTHH:mm:ss",
      "fechaFin": "YYYY-MM-DDTHH:mm:ss",
      "todoElDia": false,
      "ubicacion": "Lugar o dirección si existe (o null)",
      "miembrosInvolucrados": ["NombreHijo1"],
      "notas": "Detalles adicionales como llevar toalla, pagar 5€, etc.",
      "confianza": "alta"
    }
  ],
  "mensajeResumen": "Breve frase cordial explicando qué has detectado (en español)"
}`;
}

/**
 * Analiza un mensaje de texto o una imagen para extraer eventos
 * @param {Object} options
 * @param {string} [options.text] Texto del mensaje
 * @param {Buffer} [options.imageBuffer] Buffer de la imagen
 * @param {string} [options.mimeType] Tipo MIME de la imagen (ej: 'image/jpeg')
 * @param {Array} options.members Lista de miembros de la familia
 */
export async function parseEventFromMessage({ text, imageBuffer, mimeType, members }) {
  const systemInstruction = buildSystemInstruction(members);

  const contents = [];

  if (imageBuffer && mimeType) {
    contents.push({
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: mimeType
      }
    });
  }

  if (text) {
    contents.push({ text });
  } else if (imageBuffer) {
    contents.push({ text: 'Por favor, lee esta imagen y extrae todos los datos del evento o eventos que encuentres.' });
  }

  const candidateModels = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let lastError = null;

  for (const model of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: 'application/json'
        }
      });

      const rawText = response.text;
      const parsed = JSON.parse(rawText);
      return parsed;
    } catch (error) {
      lastError = error;
      console.warn(`Aviso: fallo con modelo ${model}, intentando siguiente...`, error.status || error.message);
    }
  }

  console.error('Error al analizar con Gemini tras intentar todos los modelos:', lastError);
  throw lastError;
}
