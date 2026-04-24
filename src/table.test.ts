import type { Row } from "./expr.js";
import { def } from "./definition.js";
import { applyDefinitions } from "./table.js";

// applyDefinitions is the low-level untyped API — row values are CellValue.
// Arithmetic requires casting to number. Use Engine for fully-typed column access.
const baseTable = {
  cost: [3, 7, 8],
  quantity: [2, 3, 4],
};

describe("applyDefinitions — SPEC.md example", () => {
  it("computes net, vat, and total columns", () => {
    const result = applyDefinitions(baseTable, [
      def("net",   (row: Row) => (row.cost as number)  * (row.quantity as number)),
      def("vat",   () => 1.2),
      def("total", (row: Row) => (row.net as number)   * (row.vat as number)),
    ]);

    expect(result["net"]).toEqual([6, 21, 32]);
    expect(result["vat"]).toEqual([1.2, 1.2, 1.2]);
    const total = result["total"] ?? [];
    expect(total[0]).toBeCloseTo(7.2);
    expect(total[1]).toBeCloseTo(25.2);
    expect(total[2]).toBeCloseTo(38.4);
  });

  it("preserves the original columns", () => {
    const result = applyDefinitions(baseTable, [
      def("net", (row: Row) => (row.cost as number) * (row.quantity as number)),
    ]);
    expect(result["cost"]).toEqual([3, 7, 8]);
    expect(result["quantity"]).toEqual([2, 3, 4]);
  });

  it("does not mutate the input table", () => {
    const input = { cost: [3, 7, 8], quantity: [2, 3, 4] };
    applyDefinitions(input, [
      def("net", (row: Row) => (row.cost as number) * (row.quantity as number)),
    ]);
    expect(Object.keys(input)).toEqual(["cost", "quantity"]);
    expect(input.cost).toEqual([3, 7, 8]);
    expect(input.quantity).toEqual([2, 3, 4]);
  });
});

describe("applyDefinitions — operators", () => {
  const t = { a: [10, 20], b: [2, 4] };

  it("add", () => {
    const r = applyDefinitions(t, [def("r", (row: Row) => (row.a as number) + (row.b as number))]);
    expect(r["r"]).toEqual([12, 24]);
  });

  it("sub", () => {
    const r = applyDefinitions(t, [def("r", (row: Row) => (row.a as number) - (row.b as number))]);
    expect(r["r"]).toEqual([8, 16]);
  });

  it("mul", () => {
    const r = applyDefinitions(t, [def("r", (row: Row) => (row.a as number) * (row.b as number))]);
    expect(r["r"]).toEqual([20, 80]);
  });

  it("div", () => {
    const r = applyDefinitions(t, [def("r", (row: Row) => (row.a as number) / (row.b as number))]);
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
      def("doubled",    (row: Row) => (row.x as number)       * 2),
      def("quadrupled", (row: Row) => (row.doubled as number) * 2),
    ]);
    expect(result["doubled"]).toEqual([4, 8]);
    expect(result["quadrupled"]).toEqual([8, 16]);
  });

  it("evaluation order is declaration order, not dependency order", () => {
    const t = { x: [3] };
    const result = applyDefinitions(t, [
      def("a", (row: Row) => (row.x as number) * 2),
      def("b", (row: Row) => (row.a as number) * 3),
    ]);
    expect(result["b"]).toEqual([18]);
  });
});

describe("applyDefinitions — non-number column types", () => {
  it("string column", () => {
    const result = applyDefinitions(
      { cost: [3, 7, 8] },
      [def("label", (row: Row) => `cost:${String(row.cost)}`)],
    );
    expect(result["label"]).toEqual(["cost:3", "cost:7", "cost:8"]);
  });

  it("boolean column", () => {
    const result = applyDefinitions(
      { quantity: [2, 3, 4] },
      [def("active", (row: Row) => (row.quantity as number) > 2)],
    );
    expect(result["active"]).toEqual([false, true, true]);
  });

  it("bigint column", () => {
    const result = applyDefinitions(
      { cost: [3, 7, 8] },
      [def("bigCost", (row: Row) => BigInt(row.cost))],
    );
    expect(result["bigCost"]).toEqual([3n, 7n, 8n]);
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
      [def("net", (row: Row) => (row.cost as number) * (row.quantity as number))],
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
      applyDefinitions(
        { a: [1, 2], b: [1] },
        [def("r", (row: Row) => (row.a as number) + (row.b as number))],
      ),
    ).toThrow("unequal lengths");
  });
});

describe("applyDefinitions — nested expressions", () => {
  it("evaluates complex inline expressions", () => {
    const t = { a: [5], b: [3] };
    const result = applyDefinitions(t, [
      def("r", (row: Row) => {
        const a = row.a as number;
        const b = row.b as number;
        return (a + b) * (a - b); // (5+3)*(5-3) = 16
      }),
    ]);
    expect(result["r"]).toEqual([16]);
  });
});
