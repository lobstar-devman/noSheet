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

  it("TypeScript rejects string expressions when Input columns are not Val-typed", () => {
    new Engine<{ a: string[] }, BigNumber>(mathCompiler)
      // @ts-expect-error "a" is string[], but Val is BigNumber — string expressions require Input extends Record<string, Val[]>
      .def("doubled", "a * 2");
  });
});

describe("ChainedBoundEngine — mathjs string expressions via bindX", () => {
  type InvoiceInput = { cost: BigNumber[]; qty: BigNumber[] };
  const invoiceEngine = new Engine<InvoiceInput, BigNumber>(mathCompiler)
    .def("line_cost", "cost * qty")
    .agg("total_cost", "sum(line_cost)");

  it(".def() string expression appends a column to every upstream table", () => {
    const inv1 = invoiceEngine.bind(["cost", "qty"], [[bn(10), bn(2)], [bn(20), bn(3)]]);
    const inv2 = invoiceEngine.bind(["cost", "qty"], [[bn(5), bn(4)]]);
    inv1.evaluate();
    inv2.evaluate();

    new Engine<{ line_cost: BigNumber[] }, BigNumber>(mathCompiler)
      .def("doubled_cost", "line_cost * 2")
      .bindX([inv1, inv2])
      .evaluate("manual");

    const dc1 = inv1.cols["doubled_cost"] as BigNumber[];
    expect(dc1[0].toNumber()).toBe(40);  // 10*2*2
    expect(dc1[1].toNumber()).toBe(120); // 20*3*2
    const dc2 = inv2.cols["doubled_cost"] as BigNumber[];
    expect(dc2[0].toNumber()).toBe(40);  // 5*4*2
  });

  it(".cardinal() string expression computes grand total across all tables", () => {
    // inv1: line_cost=[20,60], total_cost=80
    // inv2: line_cost=[20,15], total_cost=35
    const inv1 = invoiceEngine.bind(["cost", "qty"], [[bn(10), bn(2)], [bn(20), bn(3)]]);
    const inv2 = invoiceEngine.bind(["cost", "qty"], [[bn(5), bn(4)], [bn(15), bn(1)]]);
    inv1.evaluate();
    inv2.evaluate();

    const cardinals: Record<string, BigNumber> = {};
    new Engine<{ cost: BigNumber[] }, BigNumber>(mathCompiler)
      .cardinal("grand_total", "sum(total_cost)")
      .bindX([inv1, inv2], cardinals as Record<string, import("./expr.js").CellValue>)
      .evaluate("manual");

    expect((cardinals["grand_total"] as BigNumber).toNumber()).toBe(115);
  });

  it(".agg() string expression runs per table over merged columns", () => {
    const inv1 = invoiceEngine.bind(["cost", "qty"], [[bn(10), bn(2)], [bn(20), bn(3)]]);
    const inv2 = invoiceEngine.bind(["cost", "qty"], [[bn(5), bn(4)], [bn(15), bn(1)]]);
    inv1.evaluate();
    inv2.evaluate();

    new Engine<{ cost: BigNumber[]; qty: BigNumber[] }, BigNumber>(mathCompiler)
      .agg("total_qty", "sum(qty)")
      .bindX([inv1, inv2])
      .evaluate("manual");

    // inv1: qty=[2,3] → total_qty=5; inv2: qty=[4,1] → total_qty=5
    expect((inv1.aggs["total_qty"] as BigNumber).toNumber()).toBe(5);
    expect((inv2.aggs["total_qty"] as BigNumber).toNumber()).toBe(5);
  });

  it("throws when a string expression is used without a compiler", () => {
    const inv1 = invoiceEngine.bind(["cost", "qty"], [[bn(10), bn(2)]]);
    expect(() => {
      new Engine<{ line_cost: BigNumber[] }, BigNumber>()
        .def("doubled", "line_cost * 2")
        .bindX([inv1]);
    }).toThrow(/requires a compiler/);
  });
});
