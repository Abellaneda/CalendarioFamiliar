-- Migración de Seguridad: Habilitación de RLS y Protección de Tablas y Storage
-- Proyecto: ebayoaceppcwfjqhejqp (BotCalendarioFamiliar)

-- 1. Habilitar Row Level Security (RLS) en todas las tablas del esquema public
ALTER TABLE "public"."miembros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."borradores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."eventos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."chats_autorizados" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."updates_procesados" ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar políticas públicas o anónimas residuales en tablas públicas
-- (El bot usa el role 'service_role' desde la Edge Function, el cual hace bypass de RLS automáticamente de manera segura)

-- 3. Asegurar Storage Bucket 'eventos-adjuntos': Privado
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760, -- 10 MB límite estricto
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
WHERE id = 'eventos-adjuntos';

-- 4. Limpiar políticas anónimas permisivas en storage.objects
DROP POLICY IF EXISTS "Subida anonima adjuntos" ON storage.objects;
DROP POLICY IF EXISTS "Lectura publica adjuntos" ON storage.objects;

-- 5. Crear política estricta para adjuntos firmados
CREATE POLICY "Lectura firmada o autenticada adjuntos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'eventos-adjuntos');
