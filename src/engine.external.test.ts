import { describe, expect, it } from "@jest/globals";
import { Engine } from "./engine.js";

// Minimal stand-in for an external numeric library type (e.g. decimal.js Decimal).
// The key property being tested is that Engine<Input, Decimal> lets lambdas receive
// and return Decimal directly — no `as Decimal` casts required at the call sites.
class Decimal {
  constructor(readonly value: number) {}
  add(other: Decimal): Decimal { return new Decimal(this.value + other.value); }
  mul(other: Decimal): Decimal { return new Decimal(this.value * other.value); }
}

const d = (n: number) => new Decimal(n);

describe("Engine — external library type (Decimal)", () => {
  it("row expression receives typed Decimal columns without casting", () => {
    const headers = ["price", "qty"];
    const rows: Decimal[][] = [[d(10), d(3)], [d(20), d(2)]];

    new Engine<{ price: Decimal[]; qty: Decimal[] }, Decimal>()
      .def("total", (row) => row.price.mul(row.qty))
      .evaluate(headers, rows);

    const idx = headers.indexOf("total");
    expect(rows[0][idx].value).toBe(30);
    expect(rows[1][idx].value).toBe(40);
  });

  it("scalar aggregate accumulates typed values without casting", () => {
    const headers = ["amount"];
    const rows: Decimal[][] = [[d(10)], [d(20)], [d(30)]];

    new Engine<{ amount: Decimal[] }, Decimal>()
      .agg("sum", (cols) => cols.amount.reduce((acc, v) => acc.add(v), d(0)))
      .def("share", (row, aggs) => row.amount.mul(d(1 / aggs.sum.value)))
      .evaluate(headers, rows);

    const idx = headers.indexOf("share");
    expect(rows[0][idx].value).toBeCloseTo(10 / 60);
    expect(rows[1][idx].value).toBeCloseTo(20 / 60);
    expect(rows[2][idx].value).toBeCloseTo(30 / 60);
  });
});
