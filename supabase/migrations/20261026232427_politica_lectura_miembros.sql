-- Migración: Lectura pública de miembros
CREATE POLICY "Lectura publica de miembros"
ON "public"."miembros"
FOR SELECT
TO anon, authenticated
USING (true);
