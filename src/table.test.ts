import type { Row } from "./expr.js";
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
      def("net",   (row: Row) => row.cost     * row.quantity),
      def("vat",   () => 1.2),
      def("total", (row: Row) => row.net      * row.vat),
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
      def("net", (row: Row) => row.cost * row.quantity),
    ]);

    expect(result["cost"]).toEqual([3, 7, 8]);
    expect(result["quantity"]).toEqual([2, 3, 4]);
  });

  it("does not mutate the input table", () => {
    const input = { cost: [3, 7, 8], quantity: [2, 3, 4] };
    applyDefinitions(input, [def("net", (row: Row) => row.cost * row.quantity)]);
    expect(Object.keys(input)).toEqual(["cost", "quantity"]);
    expect(input.cost).toEqual([3, 7, 8]);
    expect(input.quantity).toEqual([2, 3, 4]);
  });
});

describe("applyDefinitions — operators", () => {
  const t = { a: [10, 20], b: [2, 4] };

  it("add", () => {
    const r = applyDefinitions(t, [def("r", (row: Row) => row.a + row.b)]);
    expect(r["r"]).toEqual([12, 24]);
  });

  it("sub", () => {
    const r = applyDefinitions(t, [def("r", (row: Row) => row.a - row.b)]);
    expect(r["r"]).toEqual([8, 16]);
  });

  it("mul", () => {
    const r = applyDefinitions(t, [def("r", (row: Row) => row.a * row.b)]);
    expect(r["r"]).toEqual([20, 80]);
  });

  it("div", () => {
    const r = applyDefinitions(t, [def("r", (row: Row) => row.a / row.b)]);
    expect(r["r"]).toEqual([5, 5]);
  });

  it("scalar constant applied to every row", () => {
    const r = applyDefinitions(t, [def("r", () => 99)]);
    expect(r["r"]).toEqual([99, 99]);
  });
});

describe("applyDefinitions — sequential ordering", () => {
  it("later definitions can reference earlier computed columns", () => {
    const t = { x: [2, 4] };
    const result = applyDefinitions(t, [
      def("doubled",    (row: Row) => row.x       * 2),
      def("quadrupled", (row: Row) => row.doubled * 2),
    ]);
    expect(result["doubled"]).toEqual([4, 8]);
    expect(result["quadrupled"]).toEqual([8, 16]);
  });

  it("evaluation order is declaration order, not dependency order", () => {
    const t = { x: [3] };
    const result = applyDefinitions(t, [
      def("a", (row: Row) => row.x * 2),
      def("b", (row: Row) => row.a * 3),
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
      [def("net", (row: Row) => row.cost * row.quantity)],
    );
    expect(result["net"]).toEqual([]);
  });

  it("throws when a definition name collides with an existing column", () => {
    expect(() =>
      applyDefinitions(baseTable, [def("cost", () => 0)]),
    ).toThrow('Column "cost" already exists');
  });

  it("throws when table columns have unequal lengths", () => {
    expect(() =>
      applyDefinitions({ a: [1, 2], b: [1] }, [def("r", (row: Row) => row.a + row.b)]),
    ).toThrow("unequal lengths");
  });
});

describe("applyDefinitions — nested expressions", () => {
  it("evaluates complex inline expressions", () => {
    // (a + b) * (a - b) = a² - b²
    const t = { a: [5], b: [3] };
    const result = applyDefinitions(t, [
      def("r", (row: Row) => (row.a + row.b) * (row.a - row.b)),
    ]);
    // (5+3)*(5-3) = 8*2 = 16
    expect(result["r"]).toEqual([16]);
  });
});
