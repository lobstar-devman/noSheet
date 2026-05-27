import type { CellValue } from "./expr.js";
import { Engine } from "./engine.js";

// Helper: build headers + rows from a column-keyed object for test readability.
function toRows(data: Record<string, CellValue[]>): { headers: string[]; rows: CellValue[][] } {
  const headers = Object.keys(data);
  const rowCount = headers.length > 0 ? data[headers[0]].length : 0;
  const rows: CellValue[][] = Array.from({ length: rowCount }, (_, i) =>
    headers.map((h) => data[h][i]),
  );
  return { headers, rows };
}

// Helper: read a named column back out of mutated rows.
function col(headers: string[], rows: CellValue[][], name: string): CellValue[] {
  const idx = headers.indexOf(name);
  if (idx === -1) throw new Error(`Column "${name}" not found`);
  return rows.map((row) => row[idx]);
}

describe("Engine — SPEC.md example", () => {
  const engine = new Engine<{ cost: number[]; quantity: number[] }>()
    .def("net", (row) => row.cost * row.quantity)
    .def("vat", () => 1.2)
    .def("total", (row) => row.net * row.vat);

  it("appends computed columns to each row", () => {
    const { headers, rows } = toRows({ cost: [3, 7, 8], quantity: [2, 3, 4] });
    engine.evaluate(headers, rows);

    expect(col(headers, rows, "net")).toEqual([6, 21, 32]);
    expect(col(headers, rows, "vat")).toEqual([1.2, 1.2, 1.2]);
    expect(col(headers, rows, "total")[0]).toBeCloseTo(7.2);
    expect(col(headers, rows, "total")[1]).toBeCloseTo(25.2);
    expect(col(headers, rows, "total")[2]).toBeCloseTo(38.4);
  });

  it("appends definition names to headers", () => {
    const { headers, rows } = toRows({ cost: [3], quantity: [2] });
    engine.evaluate(headers, rows);
    expect(headers).toEqual(["cost", "quantity", "net", "vat", "total"]);
  });

  it("preserves original column values in each row", () => {
    const { headers, rows } = toRows({ cost: [3, 7, 8], quantity: [2, 3, 4] });
    engine.evaluate(headers, rows);
    expect(col(headers, rows, "cost")).toEqual([3, 7, 8]);
    expect(col(headers, rows, "quantity")).toEqual([2, 3, 4]);
  });

  it("can be evaluated multiple times on different data", () => {
    const d1 = toRows({ cost: [1], quantity: [2] });
    const d2 = toRows({ cost: [10], quantity: [3] });
    engine.evaluate(d1.headers, d1.rows);
    engine.evaluate(d2.headers, d2.rows);
    expect(col(d1.headers, d1.rows, "net")).toEqual([2]);
    expect(col(d2.headers, d2.rows, "net")).toEqual([30]);
  });
});

describe("Engine — mutation", () => {
  it("mutates the rows array in-place", () => {
    const rows: CellValue[][] = [
      [3, 2],
      [7, 3],
    ];
    const headers = ["cost", "quantity"];
    new Engine<{ cost: number[]; quantity: number[] }>()
      .def("net", (row) => row.cost * row.quantity)
      .evaluate(headers, rows);

    expect(rows).toEqual([
      [3, 2, 6],
      [7, 3, 21],
    ]);
    expect(headers).toEqual(["cost", "quantity", "net"]);
  });

  it("mutates the headers array in-place", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[5]];
    new Engine<{ x: number[] }>().def("doubled", (row) => row.x * 2).evaluate(headers, rows);
    expect(headers).toEqual(["x", "doubled"]);
  });
});

describe("Engine — non-number input columns", () => {
  it("string input column", () => {
    const headers = ["name", "score"];
    const rows: CellValue[][] = [
      ["Alice", 72],
      ["Bob", 45],
    ];
    new Engine<{ name: string[]; score: number[] }>()
      .def("greeting", (row) => `Hello, ${row.name}!`)
      .def("passed", (row) => row.score >= 50)
      .evaluate(headers, rows);

    expect(col(headers, rows, "greeting")).toEqual(["Hello, Alice!", "Hello, Bob!"]);
    expect(col(headers, rows, "passed")).toEqual([true, false]);
  });

  it("boolean input column", () => {
    const headers = ["active", "value"];
    const rows: CellValue[][] = [
      [true, 10],
      [false, 20],
      [true, 30],
    ];
    new Engine<{ active: boolean[]; value: number[] }>()
      .def("effective", (row) => (row.active ? row.value : 0))
      .evaluate(headers, rows);

    expect(col(headers, rows, "effective")).toEqual([10, 0, 30]);
  });

  it("bigint input column", () => {
    const headers = ["price", "qty"];
    const rows: CellValue[][] = [
      [100n, 2n],
      [200n, 3n],
      [300n, 4n],
    ];
    new Engine<{ price: bigint[]; qty: bigint[] }>()
      .def("total", (row) => row.price * row.qty)
      .evaluate(headers, rows);

    expect(col(headers, rows, "total")).toEqual([200n, 600n, 1200n]);
  });

  it("mixed input types — string, number, boolean, bigint", () => {
    const headers = ["label", "amount", "taxed", "id"];
    const rows: CellValue[][] = [
      ["a", 100, true, 1n],
      ["b", 200, false, 2n],
      ["c", 300, true, 3n],
    ];
    new Engine<{ label: string[]; amount: number[]; taxed: boolean[]; id: bigint[] }>()
      .def("net", (row) => (row.taxed ? row.amount * 1.2 : row.amount))
      .def("summary", (row) => `${row.label}:${String(row.net)}`)
      .def("ref", (row) => row.id * 10n)
      .evaluate(headers, rows);

    expect(col(headers, rows, "net")).toEqual([120, 200, 360]);
    expect(col(headers, rows, "summary")).toEqual(["a:120", "b:200", "c:360"]);
    expect(col(headers, rows, "ref")).toEqual([10n, 20n, 30n]);
  });
});

describe("Engine — sequential ordering", () => {
  it("later definitions can reference earlier computed columns", () => {
    const headers = ["x"];
    const rows: CellValue[][] = [[2], [4]];
    new Engine<{ x: number[] }>()
      .def("doubled", (row) => row.x * 2)
      .def("quadrupled", (row) => row.doubled * 2)
      .evaluate(headers, rows);

    expect(col(headers, rows, "doubled")).toEqual([4, 8]);
    expect(col(headers, rows, "quadrupled")).toEqual([8, 16]);
  });
});

describe("Engine — operators", () => {
  type AB = { a: number[]; b: number[] };

  function run(fn: (row: { a: number; b: number }) => CellValue): CellValue[] {
    const headers = ["a", "b"];
    const rows: CellValue[][] = [
      [10, 2],
      [20, 4],
    ];
    new Engine<AB>().def("r", fn).evaluate(headers, rows);
    return col(headers, rows, "r");
  }

  it("add", () => {
    expect(run((row) => row.a + row.b)).toEqual([12, 24]);
  });
  it("sub", () => {
    expect(run((row) => row.a - row.b)).toEqual([8, 16]);
  });
  it("mul", () => {
    expect(run((row) => row.a * row.b)).toEqual([20, 80]);
  });
  it("div", () => {
    expect(run((row) => row.a / row.b)).toEqual([5, 5]);
  });
  it("scalar constant", () => {
    expect(run(() => 99)).toEqual([99, 99]);
  });

  it("complex inline expression", () => {
    const headers = ["a", "b"];
    const rows: CellValue[][] = [[5, 3]];
    new Engine<{ a: number[]; b: number[] }>()
      .def("r", (row) => (row.a + row.b) * (row.a - row.b))
      .evaluate(headers, rows);
    expect(col(headers, rows, "r")).toEqual([16]);
  });
});

describe("Engine — edge cases", () => {
  it("no definitions leaves headers and rows unchanged", () => {
    const headers = ["cost", "quantity"];
    const rows: CellValue[][] = [
      [3, 2],
      [7, 3],
    ];
    const engine = new Engine<{ cost: number[]; quantity: number[] }>();
    engine.evaluate(headers, rows);
    expect(headers).toEqual(["cost", "quantity"]);
    expect(rows).toEqual([
      [3, 2],
      [7, 3],
    ]);
  });

  it("empty rows array produces no mutations beyond headers", () => {
    const headers = ["cost", "quantity"];
    const rows: CellValue[][] = [];
    new Engine<{ cost: number[]; quantity: number[] }>()
      .def("net", (row) => row.cost * row.quantity)
      .evaluate(headers, rows);
    expect(headers).toEqual(["cost", "quantity", "net"]);
    expect(rows).toEqual([]);
  });

  it("throws when a definition name already exists in headers", () => {
    const headers = ["cost", "quantity"];
    const rows: CellValue[][] = [[3, 2]];
    expect(() => {
      new Engine<{ cost: number[]; quantity: number[] }>()
        .def("cost", () => 0)
        .evaluate(headers, rows);
    }).toThrow('Column "cost" already exists');
  });

  it("throws when a row length does not match headers length", () => {
    const headers = ["a", "b"];
    const rows: CellValue[][] = [[1, 2], [3]]; // second row too short
    expect(() => {
      new Engine<{ a: number[]; b: number[] }>()
        .def("r", (row) => row.a + row.b)
        .evaluate(headers, rows);
    }).toThrow("does not match headers length");
  });
});