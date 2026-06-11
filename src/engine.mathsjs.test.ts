import { describe, expect, it } from "@jest/globals";
import { create, all } from "mathjs";
import type { BigNumber } from "mathjs";
import { Engine } from "./engine.js";

// Configure a mathjs instance that uses BigNumber for all numeric literals.
const math = create(all, { number: "BigNumber" });
const bn = (n: number | string) => math.bignumber(n) as BigNumber;

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
        (cols.cost as BigNumber[]).reduce((acc, v) => acc.add(v), bn(0)),
      )
      .def("share", (row, aggs) => row.cost.div(aggs.totalCost as BigNumber))
      .evaluate(headers, rows);

    // cost = [30, 40, 30], totalCost = 100
    const shareIdx = headers.indexOf("share");
    expect(rows[0][shareIdx].toNumber()).toBeCloseTo(0.3);
    expect(rows[1][shareIdx].toNumber()).toBeCloseTo(0.4);
    expect(rows[2][shareIdx].toNumber()).toBeCloseTo(0.3);
  });
});
