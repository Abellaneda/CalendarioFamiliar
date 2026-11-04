import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { addDays, buildRRule, escapeHtml, isoToLocal, localToIso, proximoCumple } from "./time.ts";
import { buildGoogleBody } from "./google.ts";
import { normalizar, titulosParecidos, trocear } from "./format.ts";

Deno.test("hora de invierno: 17:00 Madrid = 16:00 UTC", () => {
  assertEquals(localToIso("2026-12-15T17:00:00"), "2026-12-15T16:00:00.000Z");
});

Deno.test("hora de verano: 17:00 Madrid = 15:00 UTC", () => {
  assertEquals(localToIso("2026-07-15T17:00:00"), "2026-07-15T15:00:00.000Z");
});

Deno.test("28 oct 2026 (ya en horario de invierno): 17:00 -> 16:00 UTC", () => {
  assertEquals(localToIso("2026-10-28T17:00:00"), "2026-10-28T16:00:00.000Z");
});

Deno.test("ida y vuelta local <-> ISO", () => {
  for (const l of ["2026-03-29T01:30:00", "2026-03-29T12:00:00", "2026-10-25T01:30:00", "2026-10-25T12:00:00", "2026-01-01T00:00:00"]) {
    assertEquals(isoToLocal(localToIso(l)!), l);
  }
});

Deno.test("fechas inválidas devuelven null", () => {
  assertEquals(localToIso("mañana"), null);
  assertEquals(localToIso(""), null);
});

Deno.test("addDays cruza meses y años", () => {
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
});

Deno.test("próximo cumpleaños y edad", () => {
  const hoy = new Date("2026-10-26T12:00:00Z");
  assertEquals(proximoCumple("2021-05-20", hoy), { fecha: "2027-05-20", edad: 6, dias: 206 });
  assertEquals(proximoCumple("1986-10-26", hoy).dias, 0);
  assertEquals(proximoCumple("1986-10-26", hoy).edad, 40);
});

Deno.test("RRULE semanal con fin", () => {
  assertEquals(
    buildRRule({ frecuencia: "WEEKLY", diasSemana: ["TU"], hasta: "2027-06-30" }),
    "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270630T215959Z"
  );
  assertEquals(buildRRule({ frecuencia: "DAILY", veces: 5 }), "RRULE:FREQ=DAILY;COUNT=5");
  assertEquals(buildRRule(null), null);
});

Deno.test("escapeHtml", () => {
  assertEquals(escapeHtml("a<b>&c"), "a&lt;b&gt;&amp;c");
});

Deno.test("Google: evento con hora usa hora local de Madrid", () => {
  const body = buildGoogleBody({
    titulo: "t", descripcion: "", ubicacion: null, todoElDia: false, recurrencia: null,
    fechaInicio: "2026-10-28T16:00:00.000Z", fechaFin: "2026-10-28T19:30:00.000Z"
  }) as { start: { dateTime: string }; end: { dateTime: string } };
  assertEquals(body.start.dateTime, "2026-10-28T17:00:00");
  assertEquals(body.end.dateTime, "2026-10-28T20:30:00");
});

Deno.test("Google: día completo tiene fin exclusivo (+1 día)", () => {
  const body = buildGoogleBody({
    titulo: "t", descripcion: "", ubicacion: null, todoElDia: true, recurrencia: null,
    fechaInicio: localToIso("2026-10-28T00:00:00")!, fechaFin: localToIso("2026-10-28T23:59:59")!
  }) as { start: { date: string }; end: { date: string } };
  assertEquals(body.start.date, "2026-10-28");
  assertEquals(body.end.date, "2026-10-29");
});

Deno.test("duplicados: títulos parecidos", () => {
  assertEquals(titulosParecidos("[NombreHija2] 🎂 Cumple de Amigo", "[NombreHija2] Cumpleaños de Amigo 🎂"), true);
  assertEquals(titulosParecidos("🎂 Cumple de Amigo", "🩺 Pediatra de NombreHijo1"), false);
  assertNotEquals(normalizar("Cumpleaños"), "");
});

Deno.test("trocear respeta el límite", () => {
  const largo = Array.from({ length: 200 }, (_, i) => `bloque ${i} ${"x".repeat(50)}`).join("\n\n");
  for (const t of trocear(largo, 1000)) assertEquals(t.length <= 1000, true);
});
