# nosheet

🌐[Github Page](https://lobstar-devman.github.io/noSheet/)

A programmatic computation engine for tabular data. Define named expressions
and aggregates in code — not as spreadsheet formulas or string DSLs — and apply
them to 2-D tables with full TypeScript type safety.

```ts
import { Engine } from "nosheet";

const headers = ["cost", "qty"];
const rows = [[10, 2], [20, 3], [5, 4]];

new Engine<{ cost: number[]; qty: number[] }>()
  .def("line_cost",  row => row.cost * row.qty)
  .def("discounted", row => row.line_cost * 0.9)
  .agg("total",      cols => cols.line_cost.reduce((a, b) => a + b, 0))
  .def("share",     (row, aggs) => row.line_cost / aggs.total)
  .evaluate(headers, rows);

// rows now:
// [10, 2, 20, 18,  20/115]
// [20, 3, 60, 54,  60/115]
// [ 5, 4, 20, 18,  20/115]
```

## Why Does noSheet Exist?

Calculations done in the front-end on so many websites are part of the domain layer and yet they exist mostly as Javascript expressions in the GUI layer.

They can, of course, be modelled as Spreadsheet formulas and implemented in one of the many Js spreadsheet libraries available - but this can create future issues when the sheet becomes larger and difficult to understand, requiring continual translation between Excel formulas and domain logic.

noSheet attempts to fix this by lifting domain layer calculations out of the GUI into a separate library of files that can be used in the front-end as well as the back end, in a more expressive type-safe way.

### Who is it for?

Front-end JavaScript and Back-end Node.js developers who need to implement complex calculations and who are starting to hit problems with existing 'Excel' spreadsheet engines [see 'Why spreadsheets are bad for programmers'](#13-why-spreadsheets-are-bad-for-programmers).

### Who is it not for?

Anyone who needs a spreadsheet UI/UX or who wants to parse, import, export or execute Excel formulas.

---

## Contents

1. [Core concepts](#1-core-concepts)
2. [Row expressions — `.def()`](#2-row-expressions----def)
3. [Aggregates — `.agg()`](#3-aggregates----agg)
4. [Row intrinsics — `RowMeta`](#4-row-intrinsics----rowmeta)
5. [Cardinals — `.cardinal()`](#5-cardinals----cardinal)
6. [Bound evaluation — `BoundEngine`](#6-bound-evaluation----boundengine)
7. [Chained engines — `ChainedBoundEngine`](#7-chained-engines----chaindboundengine)
8. [String expressions with `ExprCompiler`](#8-string-expressions-with-exprcompiler)
9. [External numeric types](#9-external-numeric-types)
10. [Type parameter reference](#10-type-parameter-reference)
11. [Low-level API — `applyDefinitions`](#11-low-level-api----applydefinitions)
12. [Invoice example — end to end](#12-invoice-example----end-to-end) 
13. [Why spreadsheets are bad for programmers](#13-why-spreadsheets-are-bad-for-programmers) 

## 🌐 Online Examples

1. [Invoice example](https://lobstar-devman.github.io/noSheet/examples/invoices.html)
13. [Stress Test](https://lobstar-devman.github.io/noSheet/examples)

---

## 1. Core concepts

**Table** — a set of named columns, each holding one value per row. All columns
have the same length. Represented as a header array plus a 2-D array of rows.

**Cell value** — `number | string | bigint | boolean | object`. The `object` branch
lets opaque numeric types (mathjs `BigNumber`, `Decimal.js`, etc.) flow through
unmodified.

**Engine** — an immutable builder. Each `.def()`, `.agg()`, or `.cardinal()` call
returns a *new* engine with one more step. The builder chain composes a computation
program; nothing runs until you call `.evaluate()`, `.bind()`, or `.bindX()`.

**Step ordering** is strict: steps execute in declaration order, full stop. A step
can only see columns and aggregates produced by earlier steps.

---

## 2. Row expressions — `.def()`

`.def(name, fn)` appends a new column to the table. `fn` is called once per row.

```ts
const headers = ["price", "qty"];
const rows = [[10, 3], [20, 2], [5, 6]];

new Engine<{ price: number[]; qty: number[] }>()
  .def("cost",    row => row.price * row.qty)     // new column: cost
  .def("vat",     () => 1.2)                      // constant column
  .def("total",   row => row.cost * row.vat)      // uses "cost" from the step above
  .def("label",   row => `${row.price} × ${row.qty}`)  // string column
  .def("onSale",  row => row.price < 10)          // boolean column
  .evaluate(headers, rows);
```

TypeScript tracks the growing row type through each `.def()` call. Trying to
reference a column before it is declared is a **compile-time error**:

```ts
new Engine<{ x: number[] }>()
  .def("b", row => row.a + 1)  // ❌ compile error: 'a' not on row yet
  .def("a", () => 1);
```

The `Input` type parameter must reflect the *input* columns as array types:

```ts
// ✅ correct
new Engine<{ price: number[]; qty: number[] }>()

// ❌ wrong — use array types, not scalar types
new Engine<{ price: number; qty: number }>()
```

---

## 3. Aggregates — `.agg()`

`.agg(name, fn)` computes a scalar across all rows. It runs **once per table**
before the next step (not once per row). The result is available as `aggs.<name>`
in all subsequent `.def()` and `.agg()` callbacks.

```ts
const headers = ["cost", "qty"];
const rows    = [[10, 2], [20, 3], [5, 4]];

new Engine<{ cost: number[]; qty: number[] }>()
  .def("line_cost",  row => row.cost * row.qty)
  .agg("total",      cols => cols.line_cost.reduce((a, b) => a + b, 0))
  .def("share",     (row, aggs) => row.line_cost / aggs.total)
  .evaluate(headers, rows);

// line_cost: [20, 60, 20]
// total:     100  (in aggs, not in the table)
// share:     [0.2, 0.6, 0.2]
```

`cols` in an `.agg()` callback has the same shape as `Input` — original input
columns plus any columns appended by earlier `.def()` steps — as typed arrays:

```ts
.agg("total", cols => {
  // cols.cost:      number[]   ← original input column
  // cols.line_cost: number[]   ← column from the .def() step above
  return cols.line_cost.reduce((a, b) => a + b, 0);
})
```

`.agg()` accepts an optional third argument — `AggMeta` — for multi-table mode.
In single-table mode you can ignore it.

---

## 4. Row intrinsics — `RowMeta`

The third argument to every `.def()` callback is `RowMeta`, a bag of per-step
intrinsics that would collide with data column names if they lived on `row`:

```ts
.def("pos", (_row, _aggs, meta) => meta.rowIndex)   // 0, 1, 2, …
.def("n",   (_row, _aggs, meta) => meta.rowCount)   // total rows
```

### `meta.get(offset)` — sibling-row access

Access a different row by offset relative to the current row:

```ts
.def("cumsum", (row, _aggs, meta) => {
  const prev = meta.get(-1);          // row above (or undefined if first)
  return (prev?.cumsum ?? 0) + row.value;
})
```

`meta.get(0)` returns a snapshot of the current row. `meta.get(1)` returns the
*next* row's snapshot — but **without** the current step's value yet (it hasn't
been computed for that row). `meta.get(-1)` *does* include the current step's
value for the previous row (already computed this pass).

### `meta.get(filter)` — search across rows

Pass a predicate to find the first matching row:

```ts
.def("refPrice", (_row, _aggs, meta) => {
  const anchor = meta.get(r => r.label === "REF");
  return anchor?.price ?? 0;
})
```

### `meta.upstream()` — all prior rows as column arrays

Returns `Record<string, CellValue[]>` containing every column's values for rows
`0` through `rowIndex - 1`:

```ts
.def("rollingAvg", (row, _aggs, meta) => {
  const up = meta.upstream();
  const all = [...(up.value ?? []), row.value] as number[];
  return all.reduce((a, b) => a + b, 0) / all.length;
})
```

Pass a filter to restrict which prior rows are included:

```ts
const up = meta.upstream(r => (r.category as string) === "A");
```

### Other `RowMeta` fields

| Field | Description |
|---|---|
| `meta.rowIndex` | 0-based index of the current row |
| `meta.rowCount` | total rows in the table |
| `meta.defOffset` | 0-based position of the current `.def()` step among `.def()` steps only |
| `meta.colIndex` | header index this step's column will occupy |
| `meta.tableIndex` | 0-based table position in multi-table mode (always `0` single-table) |
| `meta.tableCount` | total tables in multi-table mode (always `1` single-table) |

---

## 5. Cardinals — `.cardinal()`

A cardinal is a **cross-table aggregate** — computed once across *all* upstream
tables when running in multi-table mode via `ChainedBoundEngine`. In single-table
mode it behaves like a scalar `.agg()` result.

```ts
// Single-table example
new Engine<{ cost: number[] }>()
  .agg("total",    cols => cols.cost.reduce((a, b) => a + b, 0))
  .cardinal("max", cols => Math.max(...cols.cost as number[]))
  .def("pctOfMax", (row, aggs) => row.cost / aggs.max)   // max is available in aggs
  .evaluate(["cost"], [[10], [30], [20]]);
```

In multi-table mode the three callback parameters are:

| Parameter | Type | Description |
|---|---|---|
| `cols` | typed column arrays | all columns from all upstream tables, concatenated |
| `aggs` | collected per-table scalars as arrays | each key maps to an array with one value per table |
| `cards` | previously computed cardinals | scalars from earlier `.cardinal()` calls |

```ts
// Multi-table: after binding three invoices
const groupEngine = new Engine<InvoiceRow, InvoiceAggs>()
  .cardinal("grand_cost",
    (_cols, aggs) => aggs.total_cost.reduce((a, b) => a + b, 0))
    //                                ^^^^^^^^^^^^
    //  aggs.total_cost is number[] — one value per invoice

  .cardinal("grand_margin",
    (_cols, _aggs, cards) => 1 - cards.grand_cost / cards.grand_offer)
    //                               ^^^^^^^^^^^^^^^^
    //  cards.grand_cost is number — typed from the previous cardinal
```

Cardinal results are written back to each upstream table's `.aggs` object, so
a later `.agg()` step can read a cardinal result as a scalar:

```ts
new Engine<InvoiceRow, InvoiceAggs>()
  .cardinal("grand_cost", (_cols, aggs) => aggs.total_cost.reduce((a,b)=>a+b,0))
  .agg("weight", (_cols, aggs) => aggs.total_cost / aggs.grand_cost)
  //                                                     ^^^^^^^^^
  //  grand_cost was written to each upstream's .aggs by the cardinal step above
```

---

## 6. Bound evaluation — `BoundEngine`

For tables that are evaluated repeatedly (e.g. after the user edits a value),
`.bind()` pre-validates the table once and returns a `BoundEngine` that can be
re-evaluated cheaply:

```ts
const headers = ["cost", "qty"];
const rows    = [[10, 2], [20, 3]];
const aggs    = {};  // engine writes aggregate results here

const engine = new Engine<{ cost: number[]; qty: number[] }>()
  .def("line_cost", row => row.cost * row.qty)
  .agg("total",     cols => cols.line_cost.reduce((a, b) => a + b, 0));

const ctx = engine.bind(headers, rows, aggs);
ctx.evaluate();

// rows:      [[10, 2, 20], [20, 3, 60]]
// aggs.total: 80

rows[0][0] = 5;   // edit: cost of first item is now 5
ctx.evaluate();   // recomputes everything from scratch
// rows:      [[5, 2, 10], [20, 3, 60]]
// aggs.total: 70
```

### Getters

```ts
ctx.aggs      // the aggs object (same reference passed to .bind())
ctx.cols      // { cost: [...], qty: [...], line_cost: [...] } — recomputed each access
ctx.rowCount  // number of rows
```

### Supplying a pre-populated `aggs` object

Passing your own object lets you share aggregate results with Alpine.js, Vue,
React state, or any other reactive framework — the engine writes directly into it:

```ts
const state = reactive({ aggs: {} });
const ctx = engine.bind(headers, rows, state.aggs);
ctx.evaluate();
// state.aggs.total is now 80 — reactive update fires automatically
```

---

## 7. Chained engines — `ChainedBoundEngine`

`.bindX()` chains an engine onto one or more already-bound upstream engines.
This is how you compose separate computation modules and run cross-table analytics.

### Single-table chaining

Useful when building computation from modular, independently published engines:

```ts
// "core" module
const priceEngine = new Engine<{ cost: number[]; qty: number[] }>()
  .def("line_cost", row => row.cost * row.qty)
  .agg("total",     cols => cols.line_cost.reduce((a,b) => a+b, 0));

// "margin" module
const marginEngine = new Engine<{ line_cost: number[]; offer: number[] }>()
  .def("margin", row => 1 - row.line_cost / row.offer);

const headers = ["cost", "qty", "offer"];
const rows    = [[10, 2, 30], [20, 3, 80]];

const bound = priceEngine.bind(["cost", "qty"], rows);
bound.evaluate();

// Chain marginEngine onto the already-evaluated bound engine.
// It reads line_cost from bound.cols automatically — no headers needed.
marginEngine.bindX(bound).evaluate("manual");

// rows now: [[10, 2, 30, 20, 0.333…], [20, 3, 80, 60, 0.25]]
```

### Multi-table mode

Pass an array of `BoundEngine`s to analyse across a collection of tables:

```ts
const invoiceEngine = new Engine<{ cost: number[]; qty: number[] }>()
  .def("line_cost", row => row.cost * row.qty)
  .agg("total",     cols => cols.line_cost.reduce((a,b) => a+b, 0));

const inv1 = invoiceEngine.bind(["cost", "qty"], [[10,2],[20,3]]);
const inv2 = invoiceEngine.bind(["cost", "qty"], [[5,4],[15,1]]);
inv1.evaluate();   // inv1.aggs.total = 80
inv2.evaluate();   // inv2.aggs.total = 35

const cardinals: Record<string, CellValue> = {};

new Engine<{ cost: number[] }>()
  .cardinal("grand_total",
    (_cols, aggs) => (aggs.total as number[]).reduce((a,b) => a+b, 0))
  .bindX([inv1, inv2], cardinals)
  .evaluate("manual");   // "manual" = upstreams already evaluated

// cardinals.grand_total === 115
```

### `evaluate("cascade")` vs `evaluate("manual")`

| Mode | Behaviour |
|---|---|
| `"cascade"` (default) | Calls `.evaluate()` on every upstream before running its own steps. Use when upstream data may have changed. |
| `"manual"` | Skips upstream evaluation. Use when the caller has already evaluated each upstream and only the cross-table steps need re-running. |

### What `.aggs` returns

`ChainedBoundEngine.aggs` returns the **cardinals target** object — only cardinal
results. Per-table aggregate results (from `.agg()` steps on the chained engine)
are written into each individual upstream's `.aggs`, not into the shared object:

```ts
const groupAggs = {};
const chain = groupEngine.bindX([inv1, inv2], groupAggs);
chain.evaluate("manual");

// groupAggs.grand_total  ← cardinal result ✓
// inv1.aggs.total        ← inv1's own aggregate ✓
// inv1.aggs.invoice_margin ← per-table .agg() result written to inv1 ✓
```

---

## 8. String expressions with `ExprCompiler`

Pass a compiler to the `Engine` constructor to unlock string-expression overloads
on `.def()`, `.agg()`, and `.cardinal()`. The library ships no compiler — you wire
in whichever expression evaluator you prefer.

### Wiring mathjs

```ts
import { create, all } from "mathjs";
import type { ExprCompiler } from "nosheet";

const math = create(all, { number: "BigNumber" });

const mathCompiler: ExprCompiler<BigNumber> = (expression) => {
  const compiled = math.compile(expression);           // compile once
  return (scope) => compiled.evaluate(scope);          // evaluate per-row / per-agg
};
```

The outer function is called **once per expression** (pre-compilation); the returned
function is called **once per row** (for `.def()`) or **once per table** (for
`.agg()` and `.cardinal()`).

### Using string expressions

```ts
new Engine<{ price: BigNumber[]; qty: BigNumber[] }, Record<never,never>, BigNumber>(mathCompiler)
  .def("cost",      "price * qty")            // row expression
  .agg("total",     "sum(cost)")              // scalar aggregate — mathjs knows sum()
  .def("share",     "cost / total")           // reads the agg result
  .evaluate(headers, rows);
```

String and function callbacks can be freely mixed:

```ts
new Engine<{ price: BigNumber[]; qty: BigNumber[] }, Record<never,never>, BigNumber>(mathCompiler)
  .def("cost",  "price * qty")                         // string
  .agg("total", cols => cols.cost.reduce((a,b) =>      // function — fine to mix
    (a as BigNumber).add(b as BigNumber), math.bignumber(0)))
  .def("share", (row, aggs) => (row.cost as BigNumber).div(aggs.total as BigNumber))
  .evaluate(headers, rows);
```

### Cardinal string expressions

The scope for a `.cardinal()` string is `{ ...cols, ...aggs, ...cards }` — so any
column, collected agg array, or prior cardinal is directly referenceable:

```ts
new Engine<{ cost: BigNumber[] }, Record<never,never>, BigNumber>(mathCompiler)
  .cardinal("grand_total", "sum(total_cost)")   // total_cost comes from aggs
  .bindX([inv1, inv2], cardinals)
  .evaluate("manual");
```

### Scope merging rules

| Step | Scope passed to expression |
|---|---|
| `.def()` | `{ ...row, ...aggs }` — column values and scalar aggregates flat-merged |
| `.agg()` | `{ ...cols, ...aggs }` — column arrays and scalar aggregates |
| `.cardinal()` | `{ ...cols, ...aggs, ...cards }` — merged cols, collected agg arrays, prior cardinals |

Later keys win on collision (aggs win over row/cols keys on a name clash).

### Error when compiler is missing

Passing a string to `.def()`, `.agg()`, or `.cardinal()` without a compiler throws
immediately:

```
Expression "price * qty" requires a compiler. Pass one to the Engine constructor: new Engine(compiler).
```

TypeScript also enforces this at compile time: the string overload is only available
when `Input` columns are typed as `Val[]` (the compiler's numeric type), not as
mixed or differently-typed columns.

---

## 9. External numeric types

`Engine`'s third type parameter, `Val`, lets you restrict the library to a single
numeric class. When specified, row and aggregate functions receive and return that
type — no `as BigNumber` casts at call sites.

### mathjs `BigNumber`

```ts
import { create, all } from "mathjs";
import type { BigNumber } from "mathjs";
import type { ExprCompiler } from "nosheet";

const math = create(all, { number: "BigNumber" });

const mathCompiler: ExprCompiler<BigNumber> = (expression) => {
  const compiled = math.compile(expression);
  return (scope) => compiled.evaluate(scope) as BigNumber | BigNumber[];
};

const headers = ["price", "qty"];
const rows: BigNumber[][] = [
  [math.bignumber(10), math.bignumber(3)],
  [math.bignumber(20), math.bignumber(2)],
];

new Engine<
  { price: BigNumber[]; qty: BigNumber[] },
  Record<never, never>,
  BigNumber                                  // ← Val = BigNumber
>(mathCompiler)
  .def("cost",  row => row.price.mul(row.qty))         // row.price is BigNumber — .mul() available
  .agg("total", cols => math.sum(cols.cost))            // cols.cost is BigNumber[]
  .def("share", (row, aggs) => row.cost.div(aggs.total)) // aggs.total is BigNumber
  .evaluate(headers, rows);
```

### Custom `Decimal` class

Any class can be used as `Val` as long as it is assignable to `CellValue` (the
`object` branch covers class instances):

```ts
class Decimal {
  constructor(readonly v: number) {}
  add(x: Decimal) { return new Decimal(this.v + x.v); }
  mul(x: Decimal) { return new Decimal(this.v * x.v); }
  toNumber()      { return this.v; }
}

const d = (n: number) => new Decimal(n);

new Engine<
  { price: Decimal[]; qty: Decimal[] },
  Record<never, never>,
  Decimal
>()
  .def("cost",  row => row.price.mul(row.qty))     // fully typed — no casts
  .def("taxed", row => row.cost.mul(d(1.2)))
  .evaluate(headers, rows);
```

### Type enforcement

TypeScript prevents mixing compiler types:

```ts
// mathCompiler is ExprCompiler<BigNumber> — this is a compile error:
new Engine<{ x: number[] }, Record<never,never>, number>(mathCompiler)
//                                                        ^^^^^^^^^^^
// ❌ ExprCompiler<BigNumber> is not assignable to ExprCompiler<number>
```

---

## 10. Type parameter reference

```ts
class Engine<
  Input     extends Record<string, CellValue[]>,
  InputAggs extends Record<string, CellValue | CellValue[]> = Record<never, never>,
  Val       extends CellValue = CellValue,
  Cols      /* inferred — do not pass manually */,
  Aggs      /* inferred — do not pass manually */,
  Cards     /* inferred — do not pass manually */,
>
```

Only the first three are ever supplied by callers:

| Parameter | When to supply | Purpose |
|---|---|---|
| `Input` | Always | Shape of the input table: `{ cost: number[]; qty: number[] }` |
| `InputAggs` | When using `.bindX()` | Aggregate contract from the upstream engine. Gives typed `aggs` in callbacks without casts. |
| `Val` | When using a custom numeric type | The numeric class: `BigNumber`, `Decimal`, etc. |

`Cols`, `Aggs`, and `Cards` grow automatically as you chain `.def()`, `.agg()`, and
`.cardinal()` calls. Never pass them explicitly.

### `InputAggs` — typing upstream aggregates

When a second engine chains onto the output of a first, declare `InputAggs` to match
what the upstream engine computes:

```ts
type InvoiceAggs = {
  total_cost:  number;
  total_offer: number;
};

const groupEngine = new Engine<InvoiceRow, InvoiceAggs>()
  .agg("margin",
    (_cols, aggs) => 1 - aggs.total_cost / aggs.total_offer)
  //                          ^^^^^^^^^^^   ^^^^^^^^^^^
  //  typed as number — no cast needed
```

Without `InputAggs`, those keys are still accessible at runtime (the upstream engine
writes them to `.aggs` before the chained engine runs), but TypeScript cannot verify
their types and bracket-notation access returns `CellValue`.

---

## 11. Low-level API — `applyDefinitions`

For callers who want to compose reusable column formulas without the generic-heavy
`Engine` builder, a low-level untyped API is available:

```ts
import { def, applyDefinitions } from "nosheet";

const table = {
  cost:  [10, 20, 5],
  qty:   [2,  3,  4],
};

const result = applyDefinitions(table, [
  def("line_cost", row => (row.cost as number) * (row.qty as number)),
  def("label",     row => `${row.cost} × ${row.qty}`),
]);

// result.line_cost === [20, 60, 20]
// result.label     === ["10 × 2", "20 × 3", "5 × 4"]
// Original table is not mutated.
```

`applyDefinitions` returns a new `Table`; the input is never mutated. Definitions are
applied in array order. A definition can reference any column produced by an earlier
definition in the same array.

`RowMeta` (including `meta.get()` and `meta.upstream()`) is available as the third
argument to each `def` function — same semantics as the typed API.

The trade-offs versus `Engine`:

| `applyDefinitions` | `Engine` |
|---|---|
| No aggregates | `.agg()` and `.cardinal()` |
| No forward-reference guard | Compile-time error |
| Immutable input table | Mutates rows in place |
| Composable `Definition[]` arrays | Immutable builder chain |

---

## 12. Invoice example — end to end

A complete worked example showing per-invoice engines, a cross-invoice analytics
engine, and a reactive Alpine.js UI.

[🌐 Go to online example ](https://lobstar-devman.github.io/noSheet/examples/invoices.html)

### Engine definitions (`invoice-engine.ts`)

```ts
import { Engine } from "nosheet";
import { sum } from "mathjs";

type InvoiceInput = {
  name:  string[];
  cost:  number[];
  qty:   number[];
  offer: number[];
};

// Per-invoice computation. Bind each invoice with .bind(), then .evaluate().
export const invoiceEngine = new Engine<InvoiceInput>()
  .def("line_cost",       row => row.cost * row.qty)
  .agg("total_cost",      cols => sum(cols.line_cost))      // cols.line_cost: number[]
  .agg("total_offer",     cols => sum(cols.offer))
  .def("gross_margin",    row => 1 - row.line_cost / row.offer)
  .def("weighted_margin", (row, aggs) => row.line_cost / aggs.total_cost)
  .agg("total_mw",        cols => sum(cols.weighted_margin))
  .def("margin_score",    row => row.gross_margin < 0.3 ? "👎" : "👍");

// All columns the group engine can see (input + def columns).
type InvoiceRow = InvoiceInput & {
  line_cost:       number[];
  gross_margin:    number[];
  weighted_margin: number[];
  margin_score:    string[];
};

// Upstream agg contract — what invoiceEngine produces.
type InvoiceAggs = {
  total_cost:  number;
  total_offer: number;
  total_mw:    number;
};

// Cross-invoice analytics. Use .bindX(boundEngines, cardinalsTarget).
//
// Step ordering (declaration order, each step visits all tables before the next):
//  1. .agg() — per-table: writes per-invoice metrics to each upstream's .aggs
//  2. .cardinal() — once: grand totals written to cardinalsTarget AND every upstream.aggs
//  3. .agg() — per-table: reads grand_cost (written back by cardinal) to compute weight
//
export const invoiceGroupEngine = new Engine<InvoiceRow, InvoiceAggs>()
  .agg("invoice_gross_margin",
    (_cols, aggs) => 1 - aggs.total_cost / aggs.total_offer)

  .cardinal("grand_qty",    cols => sum(cols.qty))
  .cardinal("grand_cost",   (_cols, aggs) => sum(aggs.total_cost))
  .cardinal("grand_offer",  (_cols, aggs) => sum(aggs.total_offer))
  .cardinal("grand_margin", (_cols, _aggs, cards) => 1 - cards.grand_cost / cards.grand_offer)

  .agg("invoice_weighted_margin",
    (_cols, aggs) => aggs.total_cost / aggs.grand_cost);
    //                                      ^^^^^^^^^^
    //  grand_cost was written to each upstream's .aggs by the cardinal step above
```

### Wiring to the UI

```js
import { invoiceEngine, invoiceGroupEngine } from "/js/invoice-engine.js";

const boundEngines = [];
let invoiceChain;

Alpine.data("engine", (maxRows, invoiceCount) => ({
  samples: [],
  groupAggs: {},

  init() {
    // Build random invoice data and bind each invoice to the engine.
    this.samples = buildRandomSamples(invoiceCount, maxRows);
    this.samples.forEach((invoice, idx) => {
      boundEngines[idx] = invoiceEngine.bind(
        ["name", "cost", "qty", "offer"],
        invoice.rows,
        invoice.aggs,
      );
      boundEngines[idx].evaluate();
    });

    // Chain the group engine. Cardinals land in groupAggs.
    // Per-table .agg() results land in each invoice.aggs.
    invoiceChain = invoiceGroupEngine.bindX(boundEngines, this.groupAggs);
    invoiceChain.evaluate("manual");   // upstreams already evaluated above
  },

  updateLineItem(invoiceIdx, itemIdx, fieldIdx, value) {
    this.samples[invoiceIdx].rows[itemIdx][fieldIdx] = parseFloat(value) || 0;
    boundEngines[invoiceIdx].evaluate();   // re-evaluate the changed invoice
    invoiceChain.evaluate("manual");       // re-run cross-invoice steps
  },
}));
```

In the template, per-invoice metrics come from each `invoice.aggs` (written by the
chained engine's `.agg()` steps), and totals come from `groupAggs` (written by the
chained engine's `.cardinal()` steps):

```html
<!-- Per-invoice summary in the accordion header -->
GM: <span x-text="pct(invoice.aggs.invoice_gross_margin)"></span>
Weight: <span x-text="pct(invoice.aggs.invoice_weighted_margin)"></span>

<!-- Grand totals table -->
<td x-text="currency(groupAggs.grand_cost)"></td>
<td x-text="pct(groupAggs.grand_margin)"></td>
```

---

## 13 Why spreadsheets are bad for programmers

Lets consider a fairly basic table like the one below. It might be from an invoice or quote; each line item has a **cost** and a **quantity** which are multiplied to give a **total**. The **quantity** and **total** columns are also totaled and finally the average unit cost of each line item is calculated (for no good reason other than to use an Excel function other than `SUM`)

| item  | quantity | cost |  total |
|:------|:--------:|-----:|------:|
| Apple |    10    |  5   |  50   |
| Peach |    20    |  12  |  240  |
| Mango |    30    |  7   |  210  |
| Total |    50    |      |  500  |
|       |          |x̄ cost: 8|      |

This could be implemented in a spreadsheet as :

|  |   A   |     B     |   C  |   D   |
|:-|:----- |:--------: | ----:| -----:|
|1 | **item**  | **quantity**  | **cost** | **total** |
|2 | Apple |    10     |  5   | =B2*C2|
|3 | Peach |    20     |  12  | =B3*C3|
|4 | Mango |    30     |  7   | =B4*C4|
|5 | Total |=SUM(B2:B4)|      | =SUM(D2:D4)|
|6 |       |           |      |       | 
|7 |       |           |  =AVERAGE(C2:C4)| | 

Transposing this to a JavsScript spreadsheet, it might look something like this:

```javascript
const my_spreadsheet = [
    ['Apple', 10, 5, '=B2*C2'],
    ['Peach', 20, 12,'=B3*C3'],
    ['Mango', 30, 7, '=B4*C4'],
    [,'=SUM(B2:B4)',,'=SUM(D2:D4)'],
    [,,'=AVERAGE(C2:C4)']
];

const worksheet = SpreadsheetLibrary.create(my_spreadsheet);
```

Looks nice and simple doesn't it? 

But let's consider what happens when we need to insert a row for another fruit, a **Kiwi**.

Whatever we do we will have to at least change the formulas for cells B5, D5 and C7 which will become cells B6, D6 and C8.
If we want Kiwis to be at the top of our list then we will have to change the formula in every cell.

When we do this in Excel or Google Sheets the UI automatically handles the formula adjustments for us during row insertion and it all seems effortless.

But what if this is all in JavaScript? You now have to write code to adjust all the spreadsheet formulas on the fly depending on where the new row is inserted so that it looks like this (assuming that we added the new **Kiwi** row to the top of our spreadsheet).

```javascript
const my_spreadsheet = [
    ['Kiwi',  13, 7, '=B2*C2'],
    ['Apple', 10, 5, '=B3*C3'],
    ['Peach', 20, 12,'=B4*C4'],
    ['Mango', 30, 7, '=B5*C5'],
    [,'=SUM(B2:B5)',,'=SUM(D2:D5)'],
    [,,'=AVERAGE(C2:C5)']
];
```

You have essentially swapped one programming problem for another; *how to manage complex dependent calculations easily* **with** *how to manage complex formulas containing interdependent 2D array indicies easily*.

Our simple invoice logic presented as a spreadsheet is now strangely harder to read. Expressed in JavaScript we have lost column definitions so we now have to infer what the data represents; *is column B or C quantity or is it price?*

We now have a trail of cell references that we have to interperate every time we return to our spreadsheet. So, if in six months time, you return to your 33 column javascript spreadsheet (because a customer has reported a bug) and see :

```javascript
const my_very_large_spreadsheet = [
[ /* 30 previous columns omitted*/, '=IF(B1=3,(AB1/C1)*(N1/H1+D1),(AD1+A1+B1)-AVERAGE(G1:G100))', ...],
];
```

I'm sure you'll rub your hands with glee and jump right in!

Surely there must be a better way to do this I hear you say?

### noSheet, there is!

Lets rehash our simple example in noSheet terms:

```javascript
type fruitShape = {
  fruit: string[];
  cost:  number[];
  qty:   number[];
};

const fruits = [
    ['Apple', 10, 5],
    ['Peach', 20, 12],
    ['Mango', 30, 7],
];

export const fruitCalcs = new Engine<fruitShape>()
                /**
                 * Calculate the total cost of each row
                 */
              .def("total",     row => row.cost * row.qty)

                /**
                 * Calculate the total cost of all the rows in the table
                 */
              .agg("grand_total",     cols => sum(cols.total))

              /**
               * Calculate the average cost of all the row costs
               */ 
              .agg("average_cost",   cols => average(cols.cost));

const aggregates = {},
      calculator = engine.bind(['fruit', 'cost', 'qty'], fruits, aggregates);
```

Need to add another row and recalculate?

```javascript
fruits.push( [['Kiwi', 13, 7]] );
calculator.evaluate();
```