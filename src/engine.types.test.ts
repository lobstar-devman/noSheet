/**
 * Compile-time type tests for Engine.
 *
 * These tests use @ts-expect-error to assert that certain expressions are type errors.
 * If the type system becomes too permissive, the @ts-expect-error directive itself
 * becomes an error, causing the test suite to fail.
 */
import { Engine } from "./engine.js";

// ── Forward reference must be a compile-time error ────────────────────────────

// result2 references result1 before result1 is defined.
// At the point result2 is declared, Cols = { x: number } — result1 does not exist.
void Engine
  .from({ x: [1] })
  .def("result2", (row) =>
    // @ts-expect-error: 'result1' does not exist on type '{ x: number }'
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-unsafe-return
    row.result1 + 3,
  )
  .def("result1", () => 1 + 2);

// ── Referencing a column that never exists must be a compile-time error ───────

void Engine
  .from({ a: [1] })
  .def("r", (row) =>
    // @ts-expect-error: 'nonexistent' does not exist on type '{ a: number }'
    row.nonexistent * 2,
  );

// ── Columns defined earlier ARE available (must compile without errors) ───────

void Engine
  .from({ cost: [3], quantity: [2] })
  .def("net",   (row) => row.cost * row.quantity)
  .def("vat",   () => 1.2)
  .def("total", (row) => row.net * row.vat)
  .evaluate();

// ── evaluate() return type is fully typed ─────────────────────────────────────

const result = Engine
  .from({ a: [1, 2], b: [3, 4] })
  .def("sum", (row) => row.a + row.b)
  .evaluate();

// Accessing defined columns must be typed as readonly number[].
void (result.a satisfies readonly number[]);
void (result.b satisfies readonly number[]);
void (result.sum satisfies readonly number[]);

// Accessing a column that was never defined must be a compile-time error.
// @ts-expect-error: 'missing' does not exist on the result type
void result.missing;

// Jest requires at least one test block per file.
// The real assertions here are the @ts-expect-error directives above —
// if the type system becomes too permissive they become unused-directive errors,
// failing the typecheck step.
it("compile-time type constraints are enforced (see @ts-expect-error directives above)", () => {
  expect(true).toBe(true);
});

export {};
