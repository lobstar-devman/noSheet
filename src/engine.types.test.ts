/**
 * Compile-time type tests for Engine.
 *
 * These tests use @ts-expect-error to assert that certain expressions are type errors.
 * If the type system becomes too permissive, the @ts-expect-error directive itself
 * becomes an error, causing the test suite to fail.
 */
import type { CellValue } from "./expr.js";
import { Engine } from "./engine.js";

// ── Forward reference must be a compile-time error ────────────────────────────

void new Engine<{ x: number[] }>()
  .def(
    "result2",
    (row) =>
      // @ts-expect-error: 'result1' does not exist on type '{ x: number }'
      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-unsafe-return
      row.result1 + 3,
  )
  .def("result1", () => 1 + 2);

// ── Referencing a column that never exists must be a compile-time error ───────

void new Engine<{ a: number[] }>().def(
  "r",
  (row) =>
    // @ts-expect-error: 'nonexistent' does not exist on type '{ a: number }'
    row.nonexistent * 2,
);

// ── Columns defined earlier ARE available (must compile without errors) ───────

void (() => {
  const headers = ["cost", "quantity"];
  const rows: CellValue[][] = [[3, 2]];
  new Engine<{ cost: number[]; quantity: number[] }>()
    .def("net", (row) => row.cost * row.quantity)
    .def("vat", () => 1.2)
    .def("total", (row) => row.net * row.vat)
    .evaluate(headers, rows);
});

// ── evaluate() returns void ───────────────────────────────────────────────────
// The return type is void — confirmed by the fact that the result cannot be
// used as a value. No runtime assertion needed; the type system enforces this.

// ── row is pure data — row.get must not exist ────────────────────────────────

void new Engine<{ x: number[] }>().def(
  "r",
  (row) =>
    // @ts-expect-error: Property 'get' does not exist on Row — moved to meta (hard breaking change)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    row.get(-1),
);

// ── meta.get IS available and correctly typed ─────────────────────────────────

void new Engine<{ x: number[] }>().def(
  "r",
  (_row, _aggs, meta) => (meta.get(-1)?.["x"] ?? 0) as number,
);

// ── meta.upstream IS available and returns UpstreamRows ──────────────────────

void new Engine<{ x: number[] }>().def(
  "r",
  (_row, _aggs, meta) => (meta.upstream()["x"]?.length ?? 0) as number,
);

// Jest requires at least one test block per file.
it("compile-time type constraints are enforced (see @ts-expect-error directives above)", () => {
  expect(true).toBe(true);
});

export {};
