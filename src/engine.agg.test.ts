import type { CellValue } from "./expr.js";
import { Engine } from "./engine.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function col(headers: string[], rows: CellValue[][], name: string): CellValue[] {
  const idx = headers.indexOf(name);
  if (idx === -1) throw new Error(`Column "${name}" not found in headers`);
  return rows.map((row) => row[idx]);
}

// ── Scalar aggregates (.agg) ──────────────────────────────────────────────────

describe("Engine.agg — scalar aggregate", () => {
  it("computes a sum and makes it available to subsequent .def()", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[3], [7], [8]];

    new Engine<{ x: number[] }>()
      .agg("total", (cols) => cols.x.reduce((a, b) => a + b, 0))
      .def("share", (row, aggs) => row.x / aggs.total)
      .evaluate(headers, rows);

    // total = 18; shares = 3/18, 7/18, 8/18
    expect(col(headers, rows, "share")[0]).toBeCloseTo(3 / 18);
    expect(col(headers, rows, "share")[1]).toBeCloseTo(7 / 18);
    expect(col(headers, rows, "share")[2]).toBeCloseTo(8 / 18);
  });

  it("does not add the aggregate name to headers or rows", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[1], [2]];

    new Engine<{ x: number[] }>()
      .agg("total", (cols) => cols.x.reduce((a, b) => a + b, 0))
      .evaluate(headers, rows);

    expect(headers).not.toContain("total");
    expect(rows[0]).toHaveLength(1);
    expect(rows[1]).toHaveLength(1);
  });

  it("aggregate can reference a previously defined aggregate", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[2], [4], [6]];

    new Engine<{ x: number[] }>()
      .agg("total", (cols) => cols.x.reduce((a, b) => a + b, 0))
      .agg("mean", (_cols, aggs) => aggs.total / 3)
      .def("aboveMean", (row, aggs) => row.x > aggs.mean)
      .evaluate(headers, rows);

    // total=12, mean=4; above mean: false, false, true
    expect(col(headers, rows, "aboveMean")).toEqual([false, false, true]);
  });

  it("aggregate sees columns added by earlier .def() steps", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[2], [4], [6]];

    new Engine<{ x: number[] }>()
      .def("doubled", (row) => row.x * 2)
      .agg("sumDoubled", (cols) => (cols.doubled as number[]).reduce((a, b) => a + b, 0))
      .def("share", (row, aggs) => row.doubled / aggs.sumDoubled)
      .evaluate(headers, rows);

    // doubled=[4,8,12], sumDoubled=24
    expect(col(headers, rows, "doubled")).toEqual([4, 8, 12]);
    expect(col(headers, rows, "share")[0]).toBeCloseTo(4 / 24);
    expect(col(headers, rows, "share")[1]).toBeCloseTo(8 / 24);
    expect(col(headers, rows, "share")[2]).toBeCloseTo(12 / 24);
  });

  it("aggMeta third parameter carries tableIndex=0 and tableCount=1 in single-table mode", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[10], [20]];
    let capturedIdx = -1;
    let capturedCount = -1;

    new Engine<{ x: number[] }>()
      .agg("total", (cols, _aggs, aggMeta) => {
        capturedIdx = aggMeta.tableIndex;
        capturedCount = aggMeta.tableCount;
        return cols.x.reduce((a, b) => a + b, 0);
      })
      .evaluate(headers, rows);

    expect(capturedIdx).toBe(0);
    expect(capturedCount).toBe(1);
  });

  it("aggMeta.get(0) returns the current aggs snapshot", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[1], [2], [3]];
    let seen: Record<string, unknown> | undefined;

    new Engine<{ x: number[] }>()
      .agg("sum", (cols) => cols.x.reduce((a, b) => a + b, 0))
      .agg("check", (_cols, _aggs, aggMeta) => {
        seen = aggMeta.get(0) as Record<string, unknown>;
        return 0;
      })
      .evaluate(headers, rows);

    expect(seen?.["sum"]).toBe(6);
  });
});

// ── Row expressions using aggs ────────────────────────────────────────────────

describe("Engine.def with aggs parameter", () => {
  it("row expression ignoring aggs still works (backward compatible)", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[2], [4]];

    new Engine<{ x: number[] }>().def("doubled", (row) => row.x * 2).evaluate(headers, rows);

    expect(col(headers, rows, "doubled")).toEqual([4, 8]);
  });

  it("row expression uses scalar aggregate", () => {
    const headers = ["price", "qty"];
    const rows: CellValue[][] = [
      [10, 2],
      [20, 3],
      [30, 1],
    ];

    new Engine<{ price: number[]; qty: number[] }>()
      .agg("maxQty", (cols) => Math.max(...cols.qty))
      .def("isTopQty", (row, aggs) => row.qty === aggs.maxQty)
      .evaluate(headers, rows);

    expect(col(headers, rows, "isTopQty")).toEqual([false, true, false]);
  });
});

// ── Mixed chains ──────────────────────────────────────────────────────────────

describe("Engine — mixed def / agg chains", () => {
  it("interleaves def and agg steps correctly", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[1], [2], [3], [4]];

    new Engine<{ x: number[] }>()
      .def("squared", (row) => row.x ** 2)
      .agg("sumSq", (cols) => (cols.squared as number[]).reduce((a, b) => a + b, 0))
      .agg("meanSq", (_cols, aggs) => aggs.sumSq / 4)
      .def("deviation", (row, aggs) => row.squared - aggs.meanSq)
      .evaluate(headers, rows);

    // squared=[1,4,9,16], sumSq=30, meanSq=7.5
    // deviations: -6.5, -3.5, 1.5, 8.5
    expect(col(headers, rows, "squared")).toEqual([1, 4, 9, 16]);
    expect(col(headers, rows, "deviation")).toEqual([-6.5, -3.5, 1.5, 8.5]);
  });
});
