import { col, scalar, mul, add, sub, div } from "./expr.js";
import { def } from "./definition.js";
import { applyDefinitions } from "./table.js";

// The canonical example from SPEC.md
const baseTable = {
  cost: [3, 7, 8],
  quantity: [2, 3, 4],
};

describe("applyDefinitions — SPEC.md example", () => {
  it("computes net, vat, and total columns", () => {
    const result = applyDefinitions(baseTable, [
      def("net", mul(col("cost"), col("quantity"))),
      def("vat", scalar(1.2)),
      def("total", mul(col("net"), col("vat"))),
    ]);

    expect(result["net"]).toEqual([6, 21, 32]);
    expect(result["vat"]).toEqual([1.2, 1.2, 1.2]);
    // Use toBeCloseTo for floating-point results (6 * 1.2 = 7.199999999999999 in IEEE 754)
    const total = result["total"] ?? [];
    expect(total[0]).toBeCloseTo(7.2);
    expect(total[1]).toBeCloseTo(25.2);
    expect(total[2]).toBeCloseTo(38.4);
  });

  it("preserves the original columns", () => {
    const result = applyDefinitions(baseTable, [
      def("net", mul(col("cost"), col("quantity"))),
    ]);

    expect(result["cost"]).toEqual([3, 7, 8]);
    expect(result["quantity"]).toEqual([2, 3, 4]);
  });

  it("does not mutate the input table", () => {
    const input = { cost: [3, 7, 8], quantity: [2, 3, 4] };
    applyDefinitions(input, [def("net", mul(col("cost"), col("quantity")))]);
    expect(Object.keys(input)).toEqual(["cost", "quantity"]);
  });
});

describe("applyDefinitions — operators", () => {
  const t = { a: [10, 20], b: [2, 4] };

  it("add", () => {
    const r = applyDefinitions(t, [def("r", add(col("a"), col("b")))]);
    expect(r["r"]).toEqual([12, 24]);
  });

  it("sub", () => {
    const r = applyDefinitions(t, [def("r", sub(col("a"), col("b")))]);
    expect(r["r"]).toEqual([8, 16]);
  });

  it("mul", () => {
    const r = applyDefinitions(t, [def("r", mul(col("a"), col("b")))]);
    expect(r["r"]).toEqual([20, 80]);
  });

  it("div", () => {
    const r = applyDefinitions(t, [def("r", div(col("a"), col("b")))]);
    expect(r["r"]).toEqual([5, 5]);
  });

  it("scalar constant applied to every row", () => {
    const r = applyDefinitions(t, [def("r", scalar(99))]);
    expect(r["r"]).toEqual([99, 99]);
  });
});

describe("applyDefinitions — sequential ordering", () => {
  it("later definitions can reference earlier computed columns", () => {
    const t = { x: [2, 4] };
    const result = applyDefinitions(t, [
      def("doubled", mul(col("x"), scalar(2))),
      def("quadrupled", mul(col("doubled"), scalar(2))),
    ]);
    expect(result["doubled"]).toEqual([4, 8]);
    expect(result["quadrupled"]).toEqual([8, 16]);
  });

  it("evaluation order is declaration order, not dependency order", () => {
    // If order were reversed this would throw (col 'a' not yet defined)
    const t = { x: [3] };
    const result = applyDefinitions(t, [
      def("a", mul(col("x"), scalar(2))),
      def("b", mul(col("a"), scalar(3))),
    ]);
    expect(result["b"]).toEqual([18]);
  });
});

describe("applyDefinitions — edge cases", () => {
  it("empty definitions returns the original table unchanged", () => {
    const result = applyDefinitions(baseTable, []);
    expect(result).toEqual(baseTable);
  });

  it("empty table with no rows produces empty result columns", () => {
    const result = applyDefinitions(
      { cost: [], quantity: [] },
      [def("net", mul(col("cost"), col("quantity")))],
    );
    expect(result["net"]).toEqual([]);
  });

  it("throws when a col() reference is missing", () => {
    expect(() =>
      applyDefinitions(baseTable, [def("bad", col("nonexistent"))]),
    ).toThrow('Column "nonexistent" not found');
  });

  it("throws when table columns have unequal lengths", () => {
    expect(() =>
      applyDefinitions({ a: [1, 2], b: [1] }, [def("r", add(col("a"), col("b")))]),
    ).toThrow("unequal lengths");
  });
});

describe("applyDefinitions — nested expressions", () => {
  it("evaluates deeply nested expression trees", () => {
    // (cost + quantity) * (cost - quantity)  =>  (a+b)(a-b) = a²-b²
    const t = { a: [5], b: [3] };
    const result = applyDefinitions(t, [
      def("r", mul(add(col("a"), col("b")), sub(col("a"), col("b")))),
    ]);
    // (5+3)*(5-3) = 8*2 = 16
    expect(result["r"]).toEqual([16]);
  });
});
