# Library Specification

This document is the normative specification for `nosheet`, a TypeScript library that
applies named expressions and aggregates to tabular data. It is written so that the
library can be re-implemented from scratch using this file alone — every type, method,
algorithm, validation rule, and error message a from-scratch implementation needs is
described here.

## 1. Core model

Data is organized as a **table**: a set of named **columns**, each holding one **cell
value** per row. All columns in a table have the same length (one entry per row).

```
| cost     | quantity |
| -------- | -------- |
| 3        | 2        |
| 7        | 3        |
| 8        | 4        |
```

A **cell value** is one of:

```ts
type CellValue = number | string | bigint | boolean | object;
```

The `object` branch exists so that opaque values from external numeric libraries
(`Decimal`, mathjs's `BigNumber`, etc.) can flow through the library untouched — see
[§8 Library-agnostic numeric types](#8-library-agnostic-numeric-types).

An **expression** computes a new column from the columns that exist so far, evaluated
once per row:

```
net = cost * quantity;
```

Expression results are themselves columns and can be referenced by later expressions,
evaluated in declaration order:

```
vat = 1.2;
total = net * vat;
```

Applying the expressions above to the table turns it into:

```
| cost     | quantity | net | total |
| -------- | -------  | --- | ----- |
| 3        | 2        | 6   | 7.2   |
| 7        | 3        | 21  | 25.2  |
| 8        | 4        | 32  | 38.4  |
```

An expression that references a column whose expression has not yet been declared must
be impossible to write — declaring `result2 = result1 + 3` before `result1 = 1 + 2` is a
programming error, and the typed API ([§4](#4-the-typed-api-engine)) must catch it at
compile time, not at run time.

Two layers of API are specified:

- **The low-level untyped API** ([§3](#3-the-low-level-api-applydefinitions)) — `Table`,
  `def()`, `applyDefinitions()`. Cell values are `CellValue` everywhere; callers cast as
  needed. No compile-time forward-reference protection.
- **The typed API** ([§4](#4-the-typed-api-engine)–[§7](#7-enginegroup)) — `Engine`,
  `BoundEngine`, `EngineGroup`. Column types are tracked through a generic type
  parameter that grows with each declared step, giving IDE autocomplete on `row.<name>`
  and a compile error for forward references.

Both layers share the same row-level primitives, specified next.

## 2. Shared primitives

These types are used by every evaluation path in both API layers.

### 2.1 `Row` and `RowGet` — sibling-row access

```ts
type RowGet = (
  offsetOrFilter: number | ((row: Record<string, CellValue>) => boolean),
) => Record<string, CellValue> | undefined;

type Row = Record<string, CellValue> & { get: RowGet };
```

Every row snapshot passed to an expression function carries a `.get()` method in
addition to the row's own columns (as a property on the snapshot, never a real data
column — see §2.1.1 for how a same-named column always wins). `.get()` is overloaded by
the runtime type of its argument:

- **`get(offset: number)`** — returns the row at `currentRowIndex + offset`, as a plain
  object snapshot (no `.get` of its own), or `undefined` if that index is out of bounds
  (`< 0` or `>= rowCount`).
  - `get(0)` returns the current row.
  - **Visibility rule**: within the row loop of the step currently being evaluated, rows
    *before* the current index already have this step's freshly computed value appended
    to their snapshot; rows *at or after* the current index do not yet (their value for
    this step doesn't exist yet). This means `get(-1)` inside a `.def("cumsum", ...)`
    step can read the previous row's `cumsum` (already computed this pass), but
    `get(1)` cannot read the next row's `cumsum` (not computed yet).
- **`get(filter: (row) => boolean)`** — scans rows in order from index `0`, returning the
  first snapshot for which `filter` returns `true`, or `undefined` if none match. The
  same visibility rule applies per scanned row.

#### 2.1.1 Never mask a data column

Whatever mechanism attaches `.get` (and, for the typed API, the `RowMeta` third
argument — see §2.2) to a row snapshot **must never shadow a real column**. The
established technique: build the snapshot as `{ ...rowData, get: rowGetFn }` — a plain
object spread, so if the underlying row data happens to contain a key called `get` (or,
for `RowMeta`, the row-level intrinsics live in a *separate third function argument*,
never mixed into the row object at all, which makes masking structurally impossible —
see §2.2). When row data is copied from a live source object/array, copying happens
*after* attaching the intrinsic so real data always wins on conflict.

### 2.2 `RowMeta` — intrinsic per-row, per-column metadata

Some facts about the current evaluation step are not derivable from `row` or `aggs`
alone, and must never collide with a column name. They are passed as a **separate third
argument** to every row-expression function, never merged into `row`:

```ts
type RowMeta = {
  rowIndex: number;   // 0-based index of the current row
  rowCount: number;   // total number of rows in the table being evaluated
  defOffset: number;  // 0-based position of the current row-expression step,
                       // counting row-expression steps only (aggregate steps don't advance it)
  colIndex: number;   // 0-based position this step's column will occupy in the
                       // full header row (counts input columns + every earlier
                       // row-expression column, but not aggregate steps, which
                       // never appear in headers)
};
```

Construction rule: `colIndex` is read as `headers.length` (or, for a headerless table,
`Object.keys(firstRow).length` plus the count of row-expression steps already applied)
*before* the current step's column name is appended to headers. `defOffset` is a
counter that starts at `0` and increments by one after each row-expression step
finishes (aggregate steps do not touch it). `rowIndex` is updated on every iteration of
the per-row loop; `rowCount` is fixed for the duration of one `evaluate()` call.

### 2.3 Expression function shapes

```ts
type ExprFn = (
  row: Row,
  aggs: Record<string, CellValue | CellValue[]>,
  meta: RowMeta,
) => CellValue;

type AggFn = (
  cols: Record<string, CellValue[]>,
  aggs: Record<string, CellValue | CellValue[]>,
) => CellValue;

type AggRowFn = (
  cols: Record<string, CellValue[]>,
  aggs: Record<string, CellValue | CellValue[]>,
) => CellValue[];
```

- `ExprFn` — a row expression. Called once per row. `row` is the row snapshot (the
  table's columns plus every column produced by an earlier row-expression step,
  evaluated before this one); `aggs` holds every aggregate computed before this step;
  `meta` is `RowMeta`.
- `AggFn` — a scalar aggregate. Called once across all rows. `cols` is every column
  available so far as a full array (the table's input columns plus every column
  produced by an earlier row-expression step); `aggs` holds aggregates computed before
  this one. Returns a single `CellValue`.
- `AggRowFn` — a per-row aggregate. Same inputs as `AggFn`, but returns one `CellValue`
  per row (a `CellValue[]` the same length as the table). The result is stored in
  `aggs` as an array — row expressions index into it themselves (`aggs.name[meta.rowIndex]`),
  the array is *not* appended to the table.

Because a function with fewer parameters is structurally assignable to a function type
with more, callers may omit `aggs` and/or `meta` entirely (`(row) => row.x * 2` is a
valid `ExprFn`).

## 3. The low-level API: `applyDefinitions`

```ts
type Table = Readonly<Record<string, readonly CellValue[]>>;

type Definition = {
  readonly name: string;
  readonly fn: ExprFn;
};

function def(name: string, fn: ExprFn): Definition;

function applyDefinitions(table: Table, definitions: readonly Definition[]): Table;
```

`def(name, fn)` is a trivial factory: `{ name, fn }`.

`applyDefinitions(table, definitions)`:

1. Resolve the row count: every column's `.length` must be equal; if any two columns
   disagree, throw `Error("Table columns have unequal lengths: expected <first>, found <len>.")`.
   An empty table (no columns) has row count `0`.
2. Shallow-copy the input table's columns into a working `columns` record. **The input
   table is never mutated.**
3. For each definition, in array order:
   a. If `name` already exists as a key in `columns`, throw
      `Error('Column "<name>" already exists in the table.')` — checked per-definition,
      immediately before that definition runs (not all upfront, unlike the typed API).
   b. Build a fresh result array of length `rowCount`. For each row index `i` from `0`
      to `rowCount - 1`:
      - Build a row snapshot: a plain object with one entry per *current* `columns` key,
        value = that column's value at index `i`.
      - Build a `get` function exactly as specified in §2.1, scoped to this table (the
        live `columns` record, including any results already pushed for definitions
        already fully processed earlier in this loop — but not the *current*
        definition's own array until it's merged into `columns` after the row loop
        completes, i.e. `get` does not see the current definition's in-progress
        results at all from within the same definition's own row loop, only from later
        definitions).
      - Attach `get` to the snapshot (`{ ...snapshot, get }`), call `fn(rowWithGet, {})`
        — note `aggs` is always `{}` at this layer; there is no aggregate concept here.
        Push the result into the result array.
   c. Assign `columns[name] = resultArray`.
4. Return `columns` as the new `Table`.

This layer has no `RowMeta` third argument, no aggregates, and no type-level column
tracking — it exists for callers who want to build/compose `Definition` values without
the generic-heavy `Engine` API.

## 4. The typed API: `Engine`

`Engine` is an **immutable builder**. Each `.def()` / `.agg()` / `.aggRow()` call
returns a *new* `Engine` instance with one more internal step and an extended generic
type parameter — it never mutates `this`. This is required, not stylistic: the row type
seen by the next `.def()` call must include the column just declared, and TypeScript
cannot change a class instance's own generic parameterization in place.

### 4.1 Type parameters

```ts
class Engine<
  Input extends Record<string, CellValue[]>,
  Val extends CellValue = CellValue,
  Cols extends { [K in keyof Input]: Input[K][number] } = TableToRow<Input>,
  Aggs extends Record<string, Val | Val[]> = Record<never, never>,
> { /* ... */ }

type TableToRow<T extends Record<string, CellValue[]>> = {
  [K in keyof T]: T[K][number];
};
```

- `Input` — the input table's shape, as column-array types, e.g. `{ cost: number[]; qty: number[] }`.
  Supplied explicitly by the caller: `new Engine<{ cost: number[]; qty: number[] }>()`.
- `Val` — the cell value type used everywhere in this engine instance. Defaults to
  `CellValue`; pass a narrower type (e.g. a `Decimal` class) to let row/agg functions
  receive and return that type directly, with no casts at the call site (see §8).
- `Cols` — the accumulated **row type**: scalar (non-array) column types, starting as
  `TableToRow<Input>` and gaining one key per `.def()` call. This is what makes
  `row.<name>` autocomplete in an IDE and what makes referencing an undeclared column a
  compile error.
- `Aggs` — the accumulated **aggregate type**, starting empty and gaining one key per
  `.agg()` / `.aggRow()` call (an `.aggRow()` key's value type is `V[]`, an `.agg()`
  key's is `V`).

### 4.2 Constructor

```ts
constructor(compiler?: ExprCompiler<Val>)
```

Public construction takes only an optional string-expression compiler (§4.6). An
internal overload `constructor(steps, compiler?)` is used by `.def()`/`.agg()`/`.aggRow()`
to build the next instance in the chain; it is not part of the public surface other
implementations need to expose identically, but the *behavior* it produces (each
chained call returns a new instance carrying all previous steps plus one more) is
normative.

### 4.3 `.def(name, fn)` — row expression

```ts
def<Name extends string, V extends Val>(
  name: Name,
  fn: (
    row: Cols & { [K in keyof Input]: Input[K][number] } & { get: RowGet },
    aggs: Aggs,
    meta: RowMeta,
  ) => V,
): Engine<Input, Val, Cols & Record<Name, V>, Aggs>
```

Appends a row-expression step. At `evaluate()` time it runs once per row (§4.7),
pushing its result onto each row and appending `name` to the table's headers. The
returned `Engine`'s `Cols` parameter is `Cols & Record<Name, V>` — so a *subsequent*
`.def()` can read `row.<name>`, but `fn` itself, typed against the *current* `Cols`
(before this call), cannot — this is the forward-reference guard:

```ts
new Engine<{ x: number[] }>()
  .def("result2", (row) => row.result1 + 3)  // compile error: 'result1' not on row's type yet
  .def("result1", () => 1 + 2);
```

A second overload accepts a string expression instead of a function — only when `Val`
exactly matches every column's value type (`[Input] extends [Record<string, Val[]>] ? string : never`)
— and requires a compiler to have been supplied to the constructor (§4.6).

### 4.4 `.agg(name, fn)` — scalar aggregate

```ts
agg<Name extends string, V extends Val>(
  name: Name,
  fn: (cols: Input & { [K in keyof Cols]: Val[] }, aggs: Aggs) => V,
): Engine<Input, Val, Cols, Aggs & Record<Name, V>>
```

Appends an aggregate step. At `evaluate()` time it runs once across all rows, *before*
any subsequent step (§4.7), and its result is stored under `aggs.<name>` — it is never
added to headers or to any row. `cols`'s type is the input columns at their native
array types, plus every key already in `Cols` re-typed as `Val[]` (a deliberately loose
typing: `Cols` tracks scalar per-row types, but here we need the array form).

A string-expression overload exists, symmetric to `.def()`'s.

### 4.5 `.aggRow(name, fn)` — per-row aggregate

```ts
aggRow<Name extends string, V extends Val>(
  name: Name,
  fn: (cols: Input & { [K in keyof Cols]: Val[] }, aggs: Aggs) => V[],
): Engine<Input, Val, Cols, Aggs & Record<Name, V[]>>
```

Same inputs as `.agg()`, but returns one value per row; the result is stored as
`aggs.<name>: V[]`. Row expressions index into it themselves: `aggs.name[meta.rowIndex]`.
A string-expression overload exists, symmetric to `.def()`'s.

### 4.6 `ExprCompiler` — string-expression support

```ts
type ExprCompiler<V extends CellValue = CellValue> =
  (expression: string) => (scope: Record<string, unknown>) => V | V[];
```

A compiler is a two-stage function: the outer call compiles a string expression once;
the returned function evaluates it against a scope object, once per row/column
evaluation. If a string expression is passed to `.def()`/`.agg()`/`.aggRow()` without a
compiler having been supplied to the constructor, throw:

```
Expression "<expression>" requires a compiler. Pass one to the Engine constructor: new Engine(compiler).
```

When a compiler is in play:

- A `.def()` string expression is wrapped as `(row, aggs) => evaluate({ ...row, ...aggs })`
  — the compiled expression's scope is a flat merge of the row snapshot and the current
  aggregates (column names and aggregate names share one namespace; later keys in the
  merge — `aggs` — win on collision).
- A `.agg()` string expression is wrapped as `(cols, aggs) => evaluate({ ...cols, ...aggs })`.
- A `.aggRow()` string expression is wrapped the same way as `.agg()`, with the
  evaluated result treated as a `CellValue[]`.

Example (mathjs):

```ts
const math = create(all, { number: "BigNumber" });
const mathCompiler: ExprCompiler<BigNumber> = (expression) => {
  const compiled = math.compile(expression);
  return (scope) => compiled.evaluate(scope) as BigNumber | BigNumber[];
};
new Engine<{ price: BigNumber[]; qty: BigNumber[] }, BigNumber>(mathCompiler)
  .def("cost", "price * qty");
```

### 4.7 `.evaluate(...)` — three call shapes

`evaluate` is overloaded on its arguments; the runtime picks a code path based on what
was actually passed. All three paths execute the same conceptual steps loop and the
same per-step semantics (§4.7.4); they differ in how the table is stored and mutated.

```ts
evaluate(headers: string[], rows: Val[][]): void;
evaluate(headers: string[], rows: Array<Record<string, Val>>): void;
evaluate(rows: Array<Record<string, Val>>): void;
```

#### 4.7.1 Array-row path: `evaluate(headers, rows: Val[][])`

The primary, most efficient path. `rows` is a 2D array; `headers[i]` names column `i`
in every row.

1. **Validate**: every row's `.length` must equal `headers.length`, else throw
   `Error("Row length <row.length> does not match headers length <headers.length>.")`.
2. **Validate upfront, atomically**: walk all steps; for every row-expression step,
   check its name isn't already in a running copy of the header set (seeded from
   `headers`), else throw `Error('Column "<name>" already exists in headers.')`; add it
   to the running set as it's "claimed", so two new steps can't collide with each
   other either. This entire check happens *before* any row is touched.
3. Build a `cols` cache (lazily, the first time an aggregate step needs it): one array
   per header, sliced from the current `rows`.
4. Maintain one mutable row snapshot object (`Row`) reused across the whole evaluation,
   refreshed before each row of each row-expression step, plus a `RowMeta` object
   reused the same way, plus a `get` closure as specified in §2.1 (built once, closing
   over the mutable "current row index" and "current step name" variables).
5. Walk steps in declaration order:
   - **Aggregate step** (`agg`/`aggRow`): if the `cols` cache is stale (`null`), rebuild
     it. Call the step's function with `(cols, aggs)`; store the result at
     `aggs[step.name]`.
   - **Row-expression step**: invalidate the `cols` cache (`null` — the table is about
     to grow a column). Set `meta.defOffset`/`meta.colIndex` for this step (§2.2). For
     each row index from `0` to `rows.length - 1`: refresh the snapshot object's
     properties from the current header list and this row's values, set
     `meta.rowIndex`, call the step's function with `(snapshot, aggs, meta)`, and
     `.push()` the result onto the row (in place). After all rows: `headers.push(name)`;
     increment the `defOffset` counter.

#### 4.7.2 With-headers object-row path: `evaluate(headers, rows: Array<Record<string, Val>>)`

`rows[i]` is a plain object keyed by column name. Mechanically identical to §4.7.1
except: there is no fixed-width array to bounds-check (so no row-length validation
step); a fresh `rowWithGet` object (`{ ...row, get }`) is built per row per
row-expression step (so a real data property named `get` is never overwritten — see
§2.1.1); a row-expression step's result is assigned as `objectRow[step.name] = value`
directly onto the original object (no `headers.push` needed for the object itself, but
the `headers` array argument is still pushed to, since it's the caller's bookkeeping of
column order); `cols` is built by reading `Object.keys` off `headers` instead of
inspecting array positions. Duplicate-name validation works the same way, seeded from
`headers`.

#### 4.7.3 Headerless object-row path: `evaluate(rows: Array<Record<string, Val>>)`

Identical to §4.7.2, except there is no `headers` array at all: the initial column set
is derived from `Object.keys(rows[0])` (or treated as empty if `rows.length === 0`),
and `colIndex`/duplicate-name validation are seeded from that key set instead of an
explicit `headers` array. Nothing is pushed to any externally visible header list — the
caller has no `headers` variable in this call shape.

#### 4.7.4 Shared per-step contract (all three paths)

- Steps run in declaration order, full stop. There is no dependency-based reordering.
- An aggregate step's `cols` reflects every column that exists *at that point in the
  declaration order* — i.e. it sees columns from row-expression steps declared earlier,
  but not from ones declared later (even though those later steps haven't run yet
  regardless).
- A row-expression step's row snapshot for row `i` sees: every original input column,
  every column from an earlier row-expression step (already computed for this row), and
  nothing from a later row-expression step or from this same step's other rows beyond
  what `.get()`'s visibility rule (§2.1) allows.
- `aggs` accumulates across the *entire* steps array — both row-expression and
  aggregate functions read the same growing `aggs` object.

### 4.8 `.bind(headers, rows, aggs?)` → `BoundEngine`

```ts
bind(
  headers: string[],
  rows: Val[][],
  aggs?: Record<string, CellValue | CellValue[]>,
): BoundEngine
```

Performs all of §4.7.1's upfront validation **once**, and returns a `BoundEngine`
(§5) that can `evaluate()` repeatedly against the same table without re-validating or
recreating rows. The optional third argument lets multiple `BoundEngine`s (from the same
or different `Engine`s) write their aggregate results into separate caller-supplied
objects — see §6 and §7.

## 5. `BoundEngine`

A computation pre-bound to one specific array-row table (`headers: string[]`,
`rows: CellValue[][]`, held by reference — never copied).

### 5.1 Construction (via `Engine.bind`, not directly)

```ts
constructor(
  steps: Step[],
  headers: string[],
  rows: CellValue[][],
  aggsTarget?: Record<string, CellValue | CellValue[]>,
)
```

- Validate every row's length equals `headers.length` (same error message as §4.7.1).
- Validate no row-expression step's name collides with `headers` (same atomic,
  upfront check and error message as §4.7.1).
- Store `steps`, `headers`, `rows` by reference. Store `inputColCount = headers.length`
  (the width to truncate back to on every `evaluate()` call). Store `aggsTarget ?? {}`
  — this is the object returned by the `.aggs` getter, so a caller-supplied object is
  written into directly and can be read by other code holding the same reference (this
  is exactly how `EngineGroup` reads each engine's aggregates).
- Store `ownWidth = headers.length` — see §5.5; this is *separate* from
  `inputColCount` and gets updated at the end of every `evaluate()` call.

### 5.2 `.aggs` getter

Returns the `aggsTarget` object by reference (not a copy). Empty (`{}`) before the
first `evaluate()` call unless the caller supplied a pre-populated object.

### 5.3 `.cols` getter

Computed fresh on every access (not cached) from the current `headers`/`rows`: one
array per header, mapped from row index to that column's value.

### 5.4 `.rowCount` getter

Returns `rows.length`.

### 5.5 `.evaluate()`

1. Truncate: set `headers.length = inputColCount`, and for every row set
   `row.length = inputColCount` — this discards any columns from a previous call (or
   from an `EngineGroup` append, §7) unconditionally, every time.
2. Run every step exactly as in §4.7.1 step 5, reusing one persistent snapshot/`meta`
   object across calls (fields get overwritten each call, not recreated).
3. After the steps loop finishes, set `ownWidth = headers.length` — this is the
   "watermark" §5.6/§5.7 truncate back to, capturing this engine's own width with no
   group-appended columns included.

Because step 1 always resets to `inputColCount` and replays every step, calling
`.evaluate()` again after mutating a cell in `rows` recomputes everything correctly —
this is the documented re-evaluation pattern:

```ts
const ctx = new Engine<{ seed: number[] }>().def("doubled", (r) => r.seed * 2).bind(["seed"], rows);
ctx.evaluate();          // rows now have [seed, doubled]
rows[0][0] = 0.99;       // mutate a seed value
ctx.evaluate();          // resets to [seed], recomputes — reflects the new seed
```

### 5.6 `.resetGroupColumns()`

Used internally by `EngineGroup` (§7), but part of the class's public surface. If
`headers.length > ownWidth`, truncate `headers` and every row back to `ownWidth`. A
no-op otherwise. Idempotent — safe to call repeatedly with no `appendColumn` in between.

### 5.7 `.appendColumn(name, computeValue)`

```ts
appendColumn(
  name: string,
  computeValue: (row: Row, rowIndex: number, rowCount: number, colIndex: number) => CellValue,
): void
```

Used internally by `EngineGroup` (§7) to implement its own `.def()`. Appends exactly
one column on top of whatever `headers`/`rows` currently hold (does **not** call
`resetGroupColumns` itself — callers that want a clean append-from-`ownWidth` state must
call `resetGroupColumns()` themselves first, once, before a batch of `appendColumn`
calls, so that several `appendColumn` calls in a row correctly stack rather than each
one clobbering the last):

1. If `name` is already in `headers`, throw `Error('Column "<name>" already exists in headers.')`.
2. Capture `colIndex = headers.length` and `rowCount = rows.length` once, before the
   loop.
3. Reuse the same persistent snapshot object and the same `rowIndex`/`currentStepName`
   bookkeeping used by `.evaluate()` (§5.5), so `row.get()` inside `computeValue` works
   exactly like a normal row-expression step's `.get()` (§2.1's visibility rule
   included) — there is no separate "group" implementation of sibling-row access.
4. For each row index from `0` to `rowCount - 1`: refresh the snapshot from the current
   headers/row values, call `computeValue(snapshot, rowIndex, rowCount, colIndex)`,
   `.push()` the result onto the row.
5. `headers.push(name)`.

## 6. Donor terminology

`EngineGroup` (§7) operates on a collection of `BoundEngine`s. Two terms:

- **Donor table** — the table object/array passed as `rows` to a `BoundEngine` (i.e.
  what its `.cols` reflects).
- **Donor aggregate** — the aggregate object a `BoundEngine` writes into and exposes
  via `.aggs` (whether that object was caller-supplied to `.bind()`'s third argument or
  defaulted to `{}`).

## 7. `EngineGroup`

Aggregates and extends a set of `BoundEngine`s that share the same originating
`Engine` (so every donor aggregate has the same set of keys, each consistently either
scalar-shaped, from `.agg()`, or array-shaped, from `.aggRow()`, across every engine).
**The caller is responsible for calling each engine's own `.evaluate()` before calling
`engineGroup.evaluate()`** — the group never triggers a per-engine evaluation itself.

```ts
class EngineGroup {
  constructor(engines: BoundEngine[], aggs?: Record<string, CellValue | CellValue[]>)
  get aggs(): Record<string, CellValue | CellValue[]>
  def(name: string, fn: GroupDefFn): this
  agg(name: string, fn: AggFn): this
  aggRow(name: string, fn: AggRowFn): this
  groupAgg(name: string, fn: AggFn): this
  groupAggRow(name: string, fn: AggRowFn): this
  evaluate(): void
}
```

Like `BoundEngine`, the `aggs` constructor argument is stored by reference and returned
by the `.aggs` getter — empty `{}` if omitted.

Unlike `Engine`, `EngineGroup` is a **mutable** builder: `.def()`/`.agg()`/`.aggRow()`/
`.groupAgg()`/`.groupAggRow()` push onto an internal step list and return `this` (no
new-instance-per-call is required, because there is no per-call generic type growth to
preserve — `EngineGroup` is not generically typed over its accumulated columns).

### 7.1 Two kinds of row-level data a group step can see

- **Merged donor-table columns (`cols`)** — every column from every engine's `.cols`,
  concatenated in engine order, one array per column name. Used by `.agg()`/`.aggRow()`.
- **Collected donor-aggregate table (`aggCols`)** — built once per `evaluate()` call,
  from every engine's `.aggs`: for each aggregate name, **scalar** values (from
  `.agg()`) are collected into one array with one entry per engine
  (`[engine0Value, engine1Value, …]`); **array** values (from `.aggRow()`) are
  **flat-concatenated** across engines into one combined array (not kept as one
  sub-array per engine). Used by `.groupAgg()`/`.groupAggRow()`. This table is frozen
  for the whole `evaluate()` call — appending columns via `.def()` (§7.3) never changes
  it, since `.def()` only touches donor *tables*, not donor *aggregates*.

### 7.2 `.agg()` / `.aggRow()` — unchanged shape, group-wide

```ts
agg(name, fn: (cols, aggs) => CellValue): this
aggRow(name, fn: (cols, aggs) => CellValue[]): this
```

- `cols` — the merged donor-table columns (§7.1), rebuilt lazily and invalidated by any
  preceding `.def()` step in the same `evaluate()` call (mirrors §4.7.4's aggregate-step
  caching exactly, just one level up).
- `aggs` — seeded at the start of `evaluate()` with the entire collected donor-aggregate
  table (§7.1) — so e.g. `aggs.total_cost` is already an array of per-engine totals
  before any group step runs — and from then on accumulates every group step's own
  result (`.agg()`, `.aggRow()`, `.groupAgg()`, `.groupAggRow()`) under its name, in
  declaration order, so later steps can read earlier ones.
- The result is stored both in this running `aggs` map (so later steps can read it) and
  written to the `aggsTarget` object exposed by `.aggs`.

### 7.3 `.groupAgg()` / `.groupAggRow()` — additive, operate on `aggCols` only

```ts
groupAgg(name, fn: (aggCols, aggs) => CellValue): this
groupAggRow(name, fn: (aggCols, aggs) => CellValue[]): this
```

Identical wiring to §7.2, except the first argument is `aggCols` (§7.1) instead of the
merged row-level `cols` — i.e. "run an aggregate over the array of donor aggregates as
if it were itself a donor table." `aggCols` never changes within one `evaluate()` call
(no cache invalidation needed — only `.def()` mutates donor tables, and donor
aggregates are never touched mid-`evaluate()`). A `.groupAggRow()` result has one value
per *engine* (not per row) and is most naturally consumed from a later `.def()` step as
`aggs.<name>[meta.engineIndex]` (§7.4).

### 7.4 `.def(name, fn)` — append a column to every engine's own donor table

```ts
type EngineAccessor = (
  offset: number,
) => { get: AbsoluteRowGet; aggs: Record<string, CellValue | CellValue[]> } | undefined;

type AbsoluteRowGet = (
  indexOrFilter: number | ((row: Record<string, CellValue>) => boolean),
) => Record<string, CellValue> | undefined;

type GroupRow = Row & { engine: EngineAccessor };

type GroupRowMeta = RowMeta & {
  engineIndex: number;  // 0-based position of the engine currently being processed
  engineCount: number;  // total number of engines in the group
};

type GroupDefFn = (
  row: GroupRow,
  aggs: Record<string, CellValue | CellValue[]>,
  meta: GroupRowMeta,
) => CellValue;
```

For **every** engine in the group, in engine order, appends one column to that engine's
own donor table, one row at a time — mechanically, this is `engine.appendColumn(name, ...)`
(§5.7) called once per engine, run *after* each engine's own `.evaluate()` has already
fully completed (this is a separate pass; `EngineGroup` never re-runs an engine's own
steps).

- **`row`** — the usual `Row` for the row currently being processed *within the engine
  currently being processed* — same-engine `.get()` behaves exactly as it does for a
  plain `Engine`/`BoundEngine` row-expression step (§2.1, including the visibility
  rule), because it's implemented by the very same snapshot/closure machinery (§5.7
  step 3) — **plus** a new `.engine(offset)` method:
  - `offset` is relative to the *current engine's* position in the group's engine
    array (`0` = itself, `-1` = the previous engine, `1` = the next one). Returns
    `undefined` if `currentEngineIndex + offset` is out of `[0, engineCount)`.
  - On success, returns `{ get, aggs }` where `aggs` is that *other* engine's own
    donor-aggregate object (by reference — always current, even if it was just written
    by an earlier group step), and `get` is an **absolute-index** row accessor into
    that engine's *current* donor table (always current, including any earlier
    `.def()` appends already applied to that engine this `evaluate()` call):
    - `get(n: number)` — row `n` of that engine's table (n is an absolute index, `0` is
      always that engine's first row — **not** relative to the current row, since
      "current row index" has no natural meaning across two tables that may have
      different row counts), or `undefined` if `n` is out of bounds.
    - `get(filter)` — scans that engine's rows from index `0`, returns the first match,
      or `undefined`.
  - Because engines are processed strictly in order (engine 0's entire row loop for
    this step finishes before engine 1's begins), `row.engine(-1)` inside engine 1's
    loop already sees engine 0's value for *this same* `.def()` step; `row.engine(1)`
    inside engine 0's loop does not yet see engine 1's value for this step (it hasn't
    run yet). This is the engine-level analogue of the same-table visibility rule in
    §2.1, and needs no special-casing — it falls out naturally from sequential
    processing order plus `.cols`/`.aggs` always reading live state.
- **`aggs`** — the **group's own running aggregate map** (the exact same accumulator
  described in §7.2/§7.3 — whatever `.agg()`/`.aggRow()`/`.groupAgg()`/`.groupAggRow()`
  have produced so far in declaration order). It is *not* the current engine's own
  donor aggregate — reach that explicitly via `row.engine(0).aggs`. This is a
  deliberate, uniform design: there is exactly one mechanism for "read an engine's
  aggregate" (`row.engine(offset).aggs`), with no special-cased implicit self.
- **`meta`** — `RowMeta`'s fields, scoped to the row/step currently being processed for
  the current engine, plus `engineIndex`/`engineCount`.

Appending a `.def()` column invalidates the cached merged `cols` (§7.2) for any
`.agg()`/`.aggRow()` step declared after it, exactly mirroring §4.7.4's own-engine
cache-invalidation-on-row-expression-step behavior, one level up.

### 7.5 `.evaluate()` algorithm

1. Call `engine.resetGroupColumns()` (§5.6) on every engine — unconditionally, even if
   the group has no `.def()` steps at all (cheap no-op if nothing was appended last
   time). This makes repeated `evaluate()` calls idempotent without requiring the
   caller to re-run each engine's own `.evaluate()` in between.
2. Build `aggCols` (§7.1) from every engine's current `.aggs`.
3. Seed the running `aggs` map as a shallow copy of `aggCols`.
4. **Upfront, atomic validation**: for every `.def()` step in declaration order, check
   its name doesn't already exist in any engine's current header set (one running
   `Set` per engine, seeded from `Object.keys(engine.cols)`, each name added to all of
   them once validated so two `.def()` steps in the same group can't collide with each
   other either); on any collision, throw
   `Error('Column "<name>" already exists in an engine's headers.')` — **before
   mutating any engine** (this check must run to completion, or fail, prior to step 5
   starting; it must not be interleaved with appending).
5. Walk steps in declaration order:
   - `agg` / `aggRow`: lazily (re)build merged `cols` if invalidated; call
     `fn(cols, aggs)`; store the result under that name in both `aggs` and the
     `aggsTarget` exposed by `.aggs`.
   - `groupAgg` / `groupAggRow`: call `fn(aggCols, aggs)`; store the result the same way
     (`aggCols` is never rebuilt mid-call).
   - `def` (a `GroupDefStep`): invalidate the merged `cols` cache. For every engine, in
     order, call `engine.appendColumn(name, computeValue)` (§5.7) where `computeValue`
     wraps the user's `GroupDefFn` exactly as described in §7.4 (building the
     `EngineAccessor` closure, the `GroupRow`, and the `GroupRowMeta`). Increment the
     group-level `defOffset` counter once per `.def()` step (shared across all engines
     for that one step — every engine processing the *same* `.def()` step sees the same
     `defOffset`; each engine's own `colIndex` is naturally per-engine, since it's
     whatever that engine's own header length happens to be at that point).

## 8. Library-agnostic numeric types

`Engine`'s second type parameter, `Val`, defaults to `CellValue` but can be narrowed to
any class implementing the arithmetic a caller's expressions need (a decimal/bignum
library, for instance). When narrowed:

- Row-expression and aggregate functions receive and must return that exact type — no
  `as Decimal` casts are needed at call sites.
- `Input`'s column array types must use `Val[]` consistently (`{ amount: Decimal[] }`).

```ts
class Decimal {
  constructor(readonly value: number) {}
  add(other: Decimal): Decimal { return new Decimal(this.value + other.value); }
  mul(other: Decimal): Decimal { return new Decimal(this.value * other.value); }
}

new Engine<{ price: Decimal[]; qty: Decimal[] }, Decimal>()
  .def("total", (row) => row.price.mul(row.qty))
  .evaluate(headers, rows);
```

This works because `CellValue`'s `object` branch accepts any class instance, and every
generic signature in §4 threads `Val` through consistently rather than hard-coding
`CellValue` for row/agg/aggRow function parameters and return types.

## 9. Error reference

| Condition | Message |
|---|---|
| `applyDefinitions`: a definition's name already exists in the table | `Column "<name>" already exists in the table.` |
| `applyDefinitions`: input columns have unequal lengths | `Table columns have unequal lengths: expected <first>, found <len>.` |
| `Engine.evaluate` (headerless object-row path): a `.def()` name already exists | `Column "<name>" already exists.` |
| `Engine.evaluate` (with-headers / array-row paths), `BoundEngine` construction, `BoundEngine.appendColumn`: a `.def()`/group-`.def()` name already exists in headers | `Column "<name>" already exists in headers.` |
| `Engine.evaluate` (array-row path), `BoundEngine` construction: a row's length doesn't match `headers.length` | `Row length <row.length> does not match headers length <headers.length>.` |
| `Engine`: a string expression was passed without a compiler | `Expression "<expression>" requires a compiler. Pass one to the Engine constructor: new Engine(compiler).` |
| `EngineGroup.evaluate`: a `.def()` name already exists in any engine's headers | `Column "<name>" already exists in an engine's headers.` |

Every name-collision check across this whole library is **atomic**: it walks the full
set of steps/engines and throws before any mutation, rather than partially mutating and
then failing partway through.

## 10. Suggested module layout

Not normative, but mirrors a clean separation of concerns:

- `expr.ts` — `CellValue`, `Row`, `RowGet`, `RowMeta`, `ExprFn`, `AggFn`, `AggRowFn`
  (everything in §2).
- `definition.ts` — `Definition`, `def()` (§3).
- `table.ts` — `Table`, `applyDefinitions()` (§3).
- `engine.ts` — `ExprCompiler`, `TableToRow`, the internal `Step` discriminated union,
  `Engine`, `BoundEngine`, and `EngineGroup` plus its supporting types
  (`AbsoluteRowGet`, `EngineAccessor`, `GroupRow`, `GroupRowMeta`, `GroupDefFn`) — §4–§7.
- `index.ts` — re-exports the public surface of all of the above.

## 11. Worked example — multi-invoice grouping

End-to-end example exercising every feature in this spec together.

```ts
const invoiceEngine = new Engine<{ cost: number[]; qty: number[] }>()
  .def("line_cost", (row) => row.cost * row.qty)
  .agg("total_cost", (cols) => (cols.line_cost as number[]).reduce((a, b) => a + b, 0));

const aggs1: Record<string, CellValue | CellValue[]> = {};
const aggs2: Record<string, CellValue | CellValue[]> = {};
const inv1 = invoiceEngine.bind(["cost", "qty"], [[10, 2], [20, 3]], aggs1); // line_cost: 20,60; total_cost: 80
const inv2 = invoiceEngine.bind(["cost", "qty"], [[5, 4], [15, 1]], aggs2);  // line_cost: 20,15; total_cost: 35

inv1.evaluate();
inv2.evaluate();

const groupAggs: Record<string, CellValue | CellValue[]> = {};
new EngineGroup([inv1, inv2], groupAggs)
  // group-wide row-level aggregate: total quantity across both invoices' line items
  .agg("total_qty", (cols) => (cols.qty as number[]).reduce((a, b) => a + b, 0))
  // aggregate-of-aggregates: sum each invoice's own total_cost
  .groupAgg("grand_total", (aggCols) => (aggCols.total_cost as number[]).reduce((a, b) => a + b, 0))
  // one value per invoice: each invoice's share of the grand total
  .groupAggRow("share", (aggCols, aggs) =>
    (aggCols.total_cost as number[]).map((v) => v / (aggs.grand_total as number)),
  )
  // append a column to EVERY invoice's own table, reading the other invoice's total
  .def("pctOfOtherInvoice", (row, aggs, meta) => {
    const other = row.engine(meta.engineIndex === 0 ? 1 : -1);
    const myTotal = row.engine(0)!.aggs.total_cost as number;
    const otherTotal = (other?.aggs.total_cost as number) ?? 0;
    return otherTotal === 0 ? 0 : myTotal / otherTotal;
  })
  .evaluate();

// groupAggs.grand_total === 115
// groupAggs.share === [80/115, 35/115]
// groupAggs.total_qty === 10
// inv1.cols.pctOfOtherInvoice === [80/35, 80/35]  (every row of invoice 1 sees the same ratio)
// inv2.cols.pctOfOtherInvoice === [35/80, 35/80]
```
