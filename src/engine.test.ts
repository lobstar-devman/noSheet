import { Engine } from "./engine.js";

const baseTable = { cost: [3, 7, 8], quantity: [2, 3, 4] };
type BaseInput = { cost: number[]; quantity: number[] };

describe("Engine — SPEC.md example", () => {
  const engine = new Engine<BaseInput>()
    .def("net",   (row) => row.cost * row.quantity)
    .def("vat",   () => 1.2)
    .def("total", (row) => row.net * row.vat);

  it("computes net, vat, and total columns", () => {
    const result = engine.evaluate(baseTable);
    expect(result.net).toEqual([6, 21, 32]);
    expect(result.vat).toEqual([1.2, 1.2, 1.2]);
    expect(result.total[0]).toBeCloseTo(7.2);
    expect(result.total[1]).toBeCloseTo(25.2);
    expect(result.total[2]).toBeCloseTo(38.4);
  });

  it("preserves the original columns in the result", () => {
    const result = engine.evaluate(baseTable);
    expect(result.cost).toEqual([3, 7, 8]);
    expect(result.quantity).toEqual([2, 3, 4]);
  });

  it("can be evaluated multiple times with different data", () => {
    const r1 = engine.evaluate({ cost: [1], quantity: [2] });
    const r2 = engine.evaluate({ cost: [10], quantity: [3] });
    expect(r1.net).toEqual([2]);
    expect(r2.net).toEqual([30]);
  });
});

describe("Engine — does not mutate input", () => {
  it("does not mutate the input table object", () => {
    const input = { cost: [3, 7, 8], quantity: [2, 3, 4] };
    new Engine<BaseInput>()
      .def("net", (row) => row.cost * row.quantity)
      .evaluate(input);
    expect(Object.keys(input)).toEqual(["cost", "quantity"]);
    expect(input.cost).toEqual([3, 7, 8]);
    expect(input.quantity).toEqual([2, 3, 4]);
  });

  it("is immutable — each .def() returns a new Engine", () => {
    const e1 = new Engine<BaseInput>().def("net", (row) => row.cost * row.quantity);
    const e2 = e1.def("vat", () => 1.2);
    const r1 = e1.evaluate(baseTable);
    expect(Object.keys(r1)).not.toContain("vat");
    const r2 = e2.evaluate(baseTable);
    expect(r2.vat).toEqual([1.2, 1.2, 1.2]);
  });
});

describe("Engine — sequential ordering", () => {
  it("later definitions can reference earlier computed columns", () => {
    const result = new Engine<{ x: number[] }>()
      .def("doubled",    (row) => row.x * 2)
      .def("quadrupled", (row) => row.doubled * 2)
      .evaluate({ x: [2, 4] });

    expect(result.doubled).toEqual([4, 8]);
    expect(result.quadrupled).toEqual([8, 16]);
  });
});

describe("Engine — operators", () => {
  type AB = { a: number[]; b: number[] };
  const t = { a: [10, 20], b: [2, 4] };

  it("add", () => {
    expect(new Engine<AB>().def("r", (row) => row.a + row.b).evaluate(t).r).toEqual([12, 24]);
  });

  it("sub", () => {
    expect(new Engine<AB>().def("r", (row) => row.a - row.b).evaluate(t).r).toEqual([8, 16]);
  });

  it("mul", () => {
    expect(new Engine<AB>().def("r", (row) => row.a * row.b).evaluate(t).r).toEqual([20, 80]);
  });

  it("div", () => {
    expect(new Engine<AB>().def("r", (row) => row.a / row.b).evaluate(t).r).toEqual([5, 5]);
  });

  it("scalar constant", () => {
    expect(new Engine<AB>().def("r", () => 99).evaluate(t).r).toEqual([99, 99]);
  });

  it("complex inline expression", () => {
    // (a + b) * (a - b) = a² - b²  =>  (5+3)*(5-3) = 16
    const result = new Engine<{ a: number[]; b: number[] }>()
      .def("r", (row) => (row.a + row.b) * (row.a - row.b))
      .evaluate({ a: [5], b: [3] });
    expect(result.r).toEqual([16]);
  });
});

describe("Engine — edge cases", () => {
  it("no definitions returns the original table", () => {
    const result = new Engine<BaseInput>().evaluate(baseTable);
    expect(result.cost).toEqual([3, 7, 8]);
    expect(result.quantity).toEqual([2, 3, 4]);
  });

  it("empty rows produce empty result columns", () => {
    const result = new Engine<BaseInput>()
      .def("net", (row) => row.cost * row.quantity)
      .evaluate({ cost: [], quantity: [] });
    expect(result.net).toEqual([]);
  });

  it("throws when a definition name collides with an existing column", () => {
    expect(() =>
      new Engine<BaseInput>().def("cost", () => 0).evaluate(baseTable),
    ).toThrow('Column "cost" already exists');
  });

  it("throws when table columns have unequal lengths", () => {
    expect(() =>
      new Engine<{ a: number[]; b: number[] }>()
        .def("r", (row) => row.a + row.b)
        .evaluate({ a: [1, 2], b: [1] }),
    ).toThrow("unequal lengths");
  });
});
