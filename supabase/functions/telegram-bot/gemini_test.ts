import { assertEquals } from "jsr:@std/assert@1";
import { buildSystemPrompt, validarResultado } from "./gemini.ts";

Deno.test("validarResultado: descarta fechas inválidas y normaliza", () => {
  const r = validarResultado({
    accion: "nuevo",
    eventos: [
      { titulo: "  Pediatra ", fechaInicio: "2026-10-28T17:30:00", fechaFin: "", todoElDia: false, miembrosInvolucrados: ["NombreHijo1"] },
      { titulo: "Roto", fechaInicio: "no es fecha", fechaFin: "x", todoElDia: false, miembrosInvolucrados: [] }
    ]
  });
  assertEquals(r.eventos.length, 1);
  assertEquals(r.eventos[0].titulo, "Pediatra");
  assertEquals(r.eventos[0].fechaFin, "2026-10-28T18:30:00"); // 1 hora por defecto
  assertEquals(r.accion, "nuevo");
});

Deno.test("validarResultado: día completo y fin anterior al inicio", () => {
  const r = validarResultado({
    accion: "corregir",
    eventos: [{ titulo: "No hay cole", fechaInicio: "2026-11-03T09:00:00", fechaFin: "2026-11-02", todoElDia: true, miembrosInvolucrados: ["NombreHija2"] }]
  });
  assertEquals(r.accion, "corregir");
  assertEquals(r.eventos[0].fechaInicio, "2026-11-03T00:00:00");
  assertEquals(r.eventos[0].fechaFin, "2026-11-03T23:59:59");
});

Deno.test("validarResultado: basura no rompe", () => {
  assertEquals(validarResultado(null).eventos, []);
  assertEquals(validarResultado({ eventos: "x" }).eventos, []);
});

Deno.test("prompt incluye calendario de referencia y borrador activo", () => {
  const p = buildSystemPrompt(
    [{ id: "1", nombre: "NombreHija2", apodos: ["Hija2"], color: null, emoji: "👧", cumpleanos: null }],
    { titulo: "x", fechaInicio: "2026-10-28T17:00:00", fechaFin: "2026-10-28T18:00:00", todoElDia: false, ubicacion: null, miembrosInvolucrados: [], notas: null, llevar: [], confirmarAntes: null, repeticion: null },
    true,
    new Date("2026-10-26T20:00:00Z")
  );
  assertEquals(p.includes("HOY lunes 2026-10-26"), true);
  assertEquals(p.includes("BORRADOR ACTIVO"), true);
  assertEquals(p.includes('DEBE ser "corregir"'), true);
});
