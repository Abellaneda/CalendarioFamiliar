import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  geminiApiKey: process.env.GEMINI_API_KEY,
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID,
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  googleServiceAccountKeyPath: path.resolve(__dirname, '../service-account.json'),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  timezone: 'Europe/Madrid'
};

if (!config.telegramToken) console.warn('⚠️ TELEGRAM_BOT_TOKEN no está definido en .env');
if (!config.geminiApiKey) console.warn('⚠️ GEMINI_API_KEY no está definido en .env');
if (!config.googleCalendarId) console.warn('⚠️ GOOGLE_CALENDAR_ID no está definido en .env');
