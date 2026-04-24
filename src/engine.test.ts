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

describe("Engine — non-number column types", () => {
  it("string column — typed as readonly string[]", () => {
    const result = new Engine<BaseInput>()
      .def("label", (row) => String(row.cost))
      .evaluate(baseTable);
    expect(result.label).toEqual(["3", "7", "8"]);
    void (result.label satisfies readonly string[]);
  });

  it("boolean column — typed as readonly boolean[]", () => {
    const result = new Engine<BaseInput>()
      .def("active", (row) => row.quantity > 2)
      .evaluate(baseTable);
    expect(result.active).toEqual([false, true, true]);
    void (result.active satisfies readonly boolean[]);
  });

  it("bigint column — typed as readonly bigint[]", () => {
    const result = new Engine<BaseInput>()
      .def("bigCost", (row) => BigInt(row.cost))
      .evaluate(baseTable);
    expect(result.bigCost).toEqual([3n, 7n, 8n]);
    void (result.bigCost satisfies readonly bigint[]);
  });

  it("mixed types in chain — each column retains its inferred type", () => {
    const result = new Engine<BaseInput>()
      .def("net",    (row) => row.cost * row.quantity)   // number
      .def("label",  (row) => String(row.net))           // string
      .def("active", (row) => row.quantity > 2)          // boolean
      .evaluate(baseTable);

    void (result.net    satisfies readonly number[]);
    void (result.label  satisfies readonly string[]);
    void (result.active satisfies readonly boolean[]);

    expect(result.net).toEqual([6, 21, 32]);
    expect(result.label).toEqual(["6", "21", "32"]);
    expect(result.active).toEqual([false, true, true]);
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
    const result = new Engine<{ a: number[]; b: number[] }>()
      .def("r", (row) => (row.a + row.b) * (row.a - row.b))
      .evaluate({ a: [5], b: [3] });
    expect(result.r).toEqual([16]);
  });
});

describe("Engine — non-number input columns", () => {
  it("string input column — available in expressions and preserved in output", () => {
    const result = new Engine<{ name: string[]; score: number[] }>()
      .def("greeting", (row) => `Hello, ${row.name}!`)
      .def("passed",   (row) => row.score >= 50)
      .evaluate({ name: ["Alice", "Bob"], score: [72, 45] });

    void (result.name     satisfies readonly string[]);
    void (result.greeting satisfies readonly string[]);
    void (result.passed   satisfies readonly boolean[]);

    expect(result.name).toEqual(["Alice", "Bob"]);
    expect(result.greeting).toEqual(["Hello, Alice!", "Hello, Bob!"]);
    expect(result.passed).toEqual([true, false]);
  });

  it("boolean input column — used as operand in expressions", () => {
    const result = new Engine<{ active: boolean[]; value: number[] }>()
      .def("effective", (row) => row.active ? row.value : 0)
      .evaluate({ active: [true, false, true], value: [10, 20, 30] });

    void (result.effective satisfies readonly number[]);
    expect(result.effective).toEqual([10, 0, 30]);
  });

  it("bigint input column — used in bigint arithmetic", () => {
    const result = new Engine<{ price: bigint[]; qty: bigint[] }>()
      .def("total", (row) => row.price * row.qty)
      .evaluate({ price: [100n, 200n, 300n], qty: [2n, 3n, 4n] });

    void (result.total satisfies readonly bigint[]);
    expect(result.total).toEqual([200n, 600n, 1200n]);
  });

  it("mixed input types — string, number, boolean, bigint columns together", () => {
    const result = new Engine<{
      label: string[];
      amount: number[];
      taxed: boolean[];
      id: bigint[];
    }>()
      .def("net",     (row) => row.taxed ? row.amount * 1.2 : row.amount)
      .def("summary", (row) => `${row.label}:${String(row.net)}`)
      .def("ref",     (row) => row.id * 10n)
      .evaluate({
        label:  ["a", "b", "c"],
        amount: [100, 200, 300],
        taxed:  [true, false, true],
        id:     [1n, 2n, 3n],
      });

    void (result.net     satisfies readonly number[]);
    void (result.summary satisfies readonly string[]);
    void (result.ref     satisfies readonly bigint[]);

    expect(result.net).toEqual([120, 200, 360]);
    expect(result.summary).toEqual(["a:120", "b:200", "c:360"]);
    expect(result.ref).toEqual([10n, 20n, 30n]);
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
