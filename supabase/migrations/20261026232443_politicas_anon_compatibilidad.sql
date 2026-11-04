-- Migración: Políticas anónimas de compatibilidad
CREATE POLICY "Acceso controlado borradores anon" ON "public"."borradores" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Acceso controlado eventos anon" ON "public"."eventos" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Acceso controlado chats anon" ON "public"."chats_autorizados" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Acceso controlado updates anon" ON "public"."updates_procesados" FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
