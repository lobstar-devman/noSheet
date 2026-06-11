import { describe, expect, it, jest } from "@jest/globals";
import { create, all } from "mathjs";
import type { BigNumber } from "mathjs";
import { Engine } from "./engine.js";
import type { ExprCompiler } from "./engine.js";

// Configure a mathjs instance that uses BigNumber for all numeric literals.
const math = create(all, { number: "BigNumber" });
const bn = (n: number | string) => math.bignumber(n);

// ExprCompiler that wraps a mathjs instance. The outer call compiles once;
// the returned function is invoked per row/column evaluation.
const mathCompiler: ExprCompiler<BigNumber> = (expression) => {
  const compiled = math.compile(expression);
  return (scope) => compiled.evaluate(scope) as BigNumber | BigNumber[];
};

describe("Engine — mathjs BigNumber with precompiled expressions", () => {
  it("precompiled expression uses row as scope to compute a product", () => {
    const compiled = math.compile("price * qty");
    const headers = ["price", "qty"];
    const rows: BigNumber[][] = [
      [bn(10), bn(3)],
      [bn(20), bn(2)],
    ];

    new Engine<{ price: BigNumber[]; qty: BigNumber[] }, BigNumber>()
      .def("cost", (row) => compiled.evaluate(row) as BigNumber)
      .evaluate(headers, rows);

    const idx = headers.indexOf("cost");
    expect(rows[0][idx].toNumber()).toBe(30);
    expect(rows[1][idx].toNumber()).toBe(40);
  });

  it("precompiled multi-term formula evaluates correctly per row", () => {
    const compiled = math.compile("base + rate * hours");
    const headers = ["base", "rate", "hours"];
    const rows: BigNumber[][] = [
      [bn(100), bn(10), bn(8)],
      [bn(200), bn(15), bn(4)],
    ];

    new Engine<{ base: BigNumber[]; rate: BigNumber[]; hours: BigNumber[] }, BigNumber>()
      .def("pay", (row) => compiled.evaluate(row) as BigNumber)
      .evaluate(headers, rows);

    const idx = headers.indexOf("pay");
    expect(rows[0][idx].toNumber()).toBe(180); // 100 + 10 * 8
    expect(rows[1][idx].toNumber()).toBe(260); // 200 + 15 * 4
  });

  it("second compiled expression can reference a column added by an earlier .def()", () => {
    const doubleCompiled = math.compile("x * 2");
    const tripleCompiled = math.compile("doubled + x");
    const headers = ["x"];
    const rows: BigNumber[][] = [[bn(5)], [bn(10)]];

    new Engine<{ x: BigNumber[] }, BigNumber>()
      .def("doubled", (row) => doubleCompiled.evaluate(row) as BigNumber)
      .def("tripled", (row) => tripleCompiled.evaluate(row) as BigNumber)
      .evaluate(headers, rows);

    const dIdx = headers.indexOf("doubled");
    const tIdx = headers.indexOf("tripled");
    expect(rows[0][dIdx].toNumber()).toBe(10);
    expect(rows[0][tIdx].toNumber()).toBe(15); // doubled(10) + x(5)
    expect(rows[1][dIdx].toNumber()).toBe(20);
    expect(rows[1][tIdx].toNumber()).toBe(30); // doubled(20) + x(10)
  });

  it("scalar aggregate totals a column produced by a compiled row expression", () => {
    const costCompiled = math.compile("price * qty");
    const headers = ["price", "qty"];
    const rows: BigNumber[][] = [
      [bn(10), bn(3)],
      [bn(20), bn(2)],
      [bn(5), bn(6)],
    ];

    new Engine<{ price: BigNumber[]; qty: BigNumber[] }, BigNumber>()
      .def("cost", (row) => costCompiled.evaluate(row) as BigNumber)
      .agg("totalCost", (cols) =>
        (cols.cost).reduce((acc, v) => acc.add(v), bn(0)),
      )
      .def("share", (row, aggs) => row.cost.div(aggs.totalCost))
      .evaluate(headers, rows);

    // cost = [30, 40, 30], totalCost = 100
    const shareIdx = headers.indexOf("share");
    expect(rows[0][shareIdx].toNumber()).toBeCloseTo(0.3);
    expect(rows[1][shareIdx].toNumber()).toBeCloseTo(0.4);
    expect(rows[2][shareIdx].toNumber()).toBeCloseTo(0.3);
  });
});

describe("Engine — expression strings with mathjs ExprCompiler", () => {
  it(".def() with string expression precompiles once and evaluates per row", () => {
    const innerSpy = jest.fn((scope: Record<string, unknown>) => scope);
    const compiler: ExprCompiler<BigNumber> = (expression) => {
      const compiled = math.compile(expression);
      return (scope) => {
        innerSpy(scope);
        return compiled.evaluate(scope) as BigNumber | BigNumber[];
      };
    };

    const headers = ["price", "qty"];
    const rows: BigNumber[][] = [
      [bn(10), bn(3)],
      [bn(20), bn(2)],
    ];

    new Engine<{ price: BigNumber[]; qty: BigNumber[] }, BigNumber>(compiler)
      .def("cost", "price * qty")
      .evaluate(headers, rows);

    // inner evaluator called once per row, not once per compile
    expect(innerSpy).toHaveBeenCalledTimes(2);
    const idx = headers.indexOf("cost");
    expect(rows[0][idx].toNumber()).toBe(30);
    expect(rows[1][idx].toNumber()).toBe(40);
  });

  it(".agg() with string expression uses mathjs aggregate functions over a column", () => {
    const headers = ["price", "qty"];
    const rows: BigNumber[][] = [
      [bn(10), bn(3)],
      [bn(20), bn(2)],
      [bn(5), bn(6)],
    ];

    new Engine<{ price: BigNumber[]; qty: BigNumber[] }, BigNumber>(mathCompiler)
      .def("cost", "price * qty")
      .agg("totalCost", "sum(cost)")
      .def("share", "cost / totalCost")
      .evaluate(headers, rows);

    // cost = [30, 40, 30], totalCost = 100
    const shareIdx = headers.indexOf("share");
    expect(rows[0][shareIdx].toNumber()).toBeCloseTo(0.3);
    expect(rows[1][shareIdx].toNumber()).toBeCloseTo(0.4);
    expect(rows[2][shareIdx].toNumber()).toBeCloseTo(0.3);
  });

  it(".aggRow() with string expression computes a per-row array over columns", () => {
    const headers = ["cost"];
    const rows: BigNumber[][] = [[bn(30)], [bn(40)], [bn(30)]];
    let i = 0;

    new Engine<{ cost: BigNumber[] }, BigNumber>(mathCompiler)
      .aggRow("shares", "dotDivide(cost, sum(cost))")
      .def("share", (_row, aggs) => aggs.shares[i++])
      .evaluate(headers, rows);

    // totalCost = 100; shares = [0.3, 0.4, 0.3]
    const shareIdx = headers.indexOf("share");
    expect(rows[0][shareIdx].toNumber()).toBeCloseTo(0.3);
    expect(rows[1][shareIdx].toNumber()).toBeCloseTo(0.4);
    expect(rows[2][shareIdx].toNumber()).toBeCloseTo(0.3);
  });

  it("throws when a string expression is used without a compiler", () => {
    expect(() => {
      new Engine<{ x: BigNumber[] }, BigNumber>().def("doubled", "x * 2");
    }).toThrow(/requires a compiler/);
  });

  it("compiler outer function is called once per expression, not once per row", () => {
    const outerSpy: ExprCompiler<BigNumber> = jest.fn((expression: string) => {
      const compiled = math.compile(expression);
      return (scope: Record<string, unknown>) => compiled.evaluate(scope) as BigNumber | BigNumber[];
    });

    const headers = ["x"];
    const rows: BigNumber[][] = [[bn(1)], [bn(2)], [bn(3)], [bn(4)], [bn(5)]];

    new Engine<{ x: BigNumber[] }, BigNumber>(outerSpy)
      .def("doubled", "x * 2")
      .evaluate(headers, rows);

    // compile called once for "x * 2", not once per row
    expect(outerSpy).toHaveBeenCalledTimes(1);
    expect(outerSpy).toHaveBeenCalledWith("x * 2");
  });
});

// ── Type-enforcement tests ────────────────────────────────────────────────────
//
// These tests verify TypeScript's compile-time enforcement of ExprCompiler<V>.
// The @ts-expect-error annotations are validated by `npm run typecheck` (tsc
// --noEmit): if a line no longer produces an error, tsc itself will error on
// the @ts-expect-error comment, alerting you that enforcement has been lost.
//
describe("Engine — ExprCompiler<V> type enforcement", () => {
  it("ExprCompiler<BigNumber> cannot be passed to an Engine typed for number", () => {
    // @ts-expect-error ExprCompiler<BigNumber> is not assignable to ExprCompiler<number>
    const engine = new Engine<{ x: number[] }, number>(mathCompiler);
    expect(engine).toBeDefined(); // type error is compile-time only; runtime still runs
  });

  it("a column produced by a string .def() is typed as Val (BigNumber), enabling BigNumber methods", () => {
    const headers = ["x"];
    const rows: BigNumber[][] = [[bn(2)], [bn(4)]];

    new Engine<{ x: BigNumber[] }, BigNumber>(mathCompiler)
      .def("doubled", "x * 2")
      // row.doubled is BigNumber — .add() is valid
      .def("plusOne", (row) => row.doubled.add(bn(1)))
      .evaluate(headers, rows);

    expect(rows[0][headers.indexOf("plusOne")].toNumber()).toBe(5);
    expect(rows[1][headers.indexOf("plusOne")].toNumber()).toBe(9);
  });

  it("TypeScript rejects treating a string-def column as a plain number", () => {
    new Engine<{ x: BigNumber[] }, BigNumber>(mathCompiler)
      .def("doubled", "x * 2")
      // @ts-expect-error row.doubled is BigNumber — the * operator is not defined on it
      .def("bad", (row) => row.doubled * 2);
  });
});
