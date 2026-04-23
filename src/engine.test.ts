import { Engine } from "./engine.js";

const baseTable = { cost: [3, 7, 8], quantity: [2, 3, 4] };

describe("Engine — SPEC.md example", () => {
  it("computes net, vat, and total columns", () => {
    const result = Engine
      .from(baseTable)
      .def("net",   (row) => row.cost * row.quantity)
      .def("vat",   () => 1.2)
      .def("total", (row) => row.net * row.vat)
      .evaluate();

    expect(result.net).toEqual([6, 21, 32]);
    expect(result.vat).toEqual([1.2, 1.2, 1.2]);
    const total = result.total;
    expect(total[0]).toBeCloseTo(7.2);
    expect(total[1]).toBeCloseTo(25.2);
    expect(total[2]).toBeCloseTo(38.4);
  });

  it("preserves the original columns in the result", () => {
    const result = Engine
      .from(baseTable)
      .def("net", (row) => row.cost * row.quantity)
      .evaluate();

    expect(result.cost).toEqual([3, 7, 8]);
    expect(result.quantity).toEqual([2, 3, 4]);
  });
});

describe("Engine — does not mutate input", () => {
  it("does not mutate the input table object", () => {
    const input = { cost: [3, 7, 8], quantity: [2, 3, 4] };
    Engine.from(input).def("net", (row) => row.cost * row.quantity).evaluate();
    expect(Object.keys(input)).toEqual(["cost", "quantity"]);
    expect(input.cost).toEqual([3, 7, 8]);
    expect(input.quantity).toEqual([2, 3, 4]);
  });

  it("is immutable — each .def() returns a new Engine", () => {
    const e1 = Engine.from(baseTable).def("net", (row) => row.cost * row.quantity);
    const e2 = e1.def("vat", () => 1.2);
    // e1 should not have vat
    const r1 = e1.evaluate();
    expect(Object.keys(r1)).not.toContain("vat");
    // e2 should have vat
    const r2 = e2.evaluate();
    expect(r2.vat).toEqual([1.2, 1.2, 1.2]);
  });
});

describe("Engine — sequential ordering", () => {
  it("later definitions can reference earlier computed columns", () => {
    const result = Engine
      .from({ x: [2, 4] })
      .def("doubled",    (row) => row.x * 2)
      .def("quadrupled", (row) => row.doubled * 2)
      .evaluate();

    expect(result.doubled).toEqual([4, 8]);
    expect(result.quadrupled).toEqual([8, 16]);
  });
});

describe("Engine — operators", () => {
  const t = { a: [10, 20], b: [2, 4] };

  it("add", () => {
    expect(Engine.from(t).def("r", (row) => row.a + row.b).evaluate().r).toEqual([12, 24]);
  });

  it("sub", () => {
    expect(Engine.from(t).def("r", (row) => row.a - row.b).evaluate().r).toEqual([8, 16]);
  });

  it("mul", () => {
    expect(Engine.from(t).def("r", (row) => row.a * row.b).evaluate().r).toEqual([20, 80]);
  });

  it("div", () => {
    expect(Engine.from(t).def("r", (row) => row.a / row.b).evaluate().r).toEqual([5, 5]);
  });

  it("scalar constant", () => {
    expect(Engine.from(t).def("r", () => 99).evaluate().r).toEqual([99, 99]);
  });

  it("complex inline expression", () => {
    // (a + b) * (a - b) = a² - b²  =>  (5+3)*(5-3) = 16
    const result = Engine
      .from({ a: [5], b: [3] })
      .def("r", (row) => (row.a + row.b) * (row.a - row.b))
      .evaluate();
    expect(result.r).toEqual([16]);
  });
});

describe("Engine — edge cases", () => {
  it("no definitions returns the original table", () => {
    const result = Engine.from(baseTable).evaluate();
    expect(result.cost).toEqual([3, 7, 8]);
    expect(result.quantity).toEqual([2, 3, 4]);
  });

  it("empty rows produce empty result columns", () => {
    const result = Engine
      .from({ cost: [], quantity: [] })
      .def("net", (row) => row.cost * row.quantity)
      .evaluate();
    expect(result.net).toEqual([]);
  });

  it("throws when a definition name collides with an existing column", () => {
    expect(() =>
      Engine.from(baseTable).def("cost", () => 0).evaluate(),
    ).toThrow('Column "cost" already exists');
  });

  it("throws when table columns have unequal lengths", () => {
    expect(() =>
      Engine.from({ a: [1, 2], b: [1] }).def("r", (row) => row.a + row.b).evaluate(),
    ).toThrow("unequal lengths");
  });
});
