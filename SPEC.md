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
[§7 Library-agnostic numeric types](#7-library-agnostic-numeric-types).

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

- **The low-level untyped API** ([§3](#3-the-low-level-api-applydefinitions)) —
  `Table`, `def()`, `applyDefinitions()`. Cell values are `CellValue` everywhere;
  callers cast as needed. No compile-time forward-reference protection.
- **The typed API** ([§4](#4-the-typed-api-engine)–[§6](#6-chaindboundengine)) —
  `Engine`, `BoundEngine`, `ChainedBoundEngine`. Column types are tracked through
  generic type parameters that grow with each declared step, giving IDE autocomplete on
  `row.<name>` and a compile error for forward references.

Both layers share the same row-level primitives, specified next.

## 2. Shared primitives

These types are used by every evaluation path in both API layers.

### 2.1 `Row` — pure data snapshot

```ts
type Row = Record<string, CellValue>;
```

A plain object mapping column names to their current cell values. **No methods.** Row
navigation (`get`, `upstream`) is intentionally separated into `RowMeta` (§2.3), so a
data column named `get` can never shadow a library intrinsic.

### 2.2 `RowGet` — sibling-row access

```ts
type RowGet = {
  (offset: number): Record<string, CellValue> | undefined;
  (filter: (row: Record<string, CellValue>) => boolean): Record<string, CellValue> | undefined;
};
```

Two overloads, dispatched on the runtime type of the argument:

- **`get(offset: number)`** — returns the row at `currentRowIndex + offset`, as a plain
  `Record<string, CellValue>` snapshot (no `.get` method of its own), or `undefined` if
  that index is out of bounds (`< 0` or `>= rowCount`).
  - **Visibility rule**: within the row loop of the step currently being evaluated, rows
    *before* the current index already have this step's freshly computed value in their
    snapshot; rows *at or after* the current index do not yet. This means `get(-1)` inside
    a `.def("cumsum", ...)` step can read the previous row's `cumsum` (already
    computed), but `get(1)` cannot read the next row's `cumsum` (not computed yet).
  - `get(0)` returns a snapshot of the current row as it exists at the point of this step.
- **`get(filter: (row) => boolean)`** — scans rows from index `0` returning the first
  snapshot for which `filter` returns `true`, or `undefined` if none match. The same
  visibility rule applies per scanned row.

Snapshots returned by `RowGet` are plain objects — they do not carry a `.get` method
themselves, so callers cannot chain `get(0).get(0)`.

### 2.3 `RowMeta` — per-step row intrinsics

Some facts about the current evaluation step are not derivable from `row` or `aggs`
alone, and must never collide with a column name. They are passed as a **third argument**
to every row-expression function, never mixed into `row`:

```ts
type RowMeta = {
  rowIndex:   number;  // 0-based index of the current row
  rowCount:   number;  // total rows in the table being evaluated
  defOffset:  number;  // 0-based position of the current row-expression step
                        // counting row-expression steps only (agg/cardinal steps don't advance it)
  colIndex:   number;  // 0-based header index this step's column will occupy
                        // (= headers.length before this step's column is appended)
  tableIndex: number;  // 0-based position of the current table in multi-table mode
                        // (always 0 for single-table engines)
  tableCount: number;  // total number of tables in multi-table mode (always 1 for single-table)
  get:      RowGet;                                                             // sibling-row access (§2.2)
  upstream: (filter?: (row: Record<string, CellValue>) => boolean) => UpstreamRows;
                        // returns column arrays for all rows before the current one
};
```

`upstream(filter?)` returns a `Record<string, CellValue[]>` where each key is a column
name and the value is an array of that column's values for all rows with
`rowIndex < currentRowIndex`, optionally filtered. If the current row is the first
(`rowIndex === 0`), the result is an empty object.

### 2.4 `AggMeta` — per-step aggregate intrinsics

An analogue of `RowMeta` for `.agg()` steps: provides position within the multi-table
evaluation and access to other tables' aggregate objects.

```ts
type AggMetaGet = (
  indexOrFilter:
    | number
    | ((aggs: Record<string, CellValue | CellValue[]>) => boolean),
) => Record<string, CellValue | CellValue[]> | undefined;

type AggMeta = {
  tableIndex: number;    // 0-based position of the current table (always 0 in single-table mode)
  tableCount: number;    // total tables (always 1 in single-table mode)
  get: AggMetaGet;       // access another table's aggregate object by offset or filter
  upstream: (filter?: (aggs: Record<string, CellValue | CellValue[]>) => boolean) => UpstreamAggs;
                         // aggregate arrays for all tables before tableIndex
};
```

- **`aggMeta.get(offset: number)`** — returns the aggs object at `tableIndex + offset`,
  or `undefined` if out of bounds.
- **`aggMeta.get(filter)`** — returns the first aggs object for which `filter` is `true`.
- **`aggMeta.upstream(filter?)`** — returns a `Record<string, CellValue[]>` where each
  key maps to an array of that aggregate's values from all tables with
  `tableIndex < currentTableIndex` (optionally filtered). In single-table mode this is
  always `{}`.

### 2.5 `UpstreamRows` and `UpstreamAggs`

```ts
type UpstreamRows = Record<string, CellValue[]>;   // column arrays from prior rows
type UpstreamAggs = Record<string, CellValue[]>;   // aggregate arrays from prior tables
```

Returned by `RowMeta.upstream()` and `AggMeta.upstream()` respectively.

### 2.6 Expression function shapes

```ts
type ExprFn = (
  row: Row,
  aggs: Record<string, CellValue | CellValue[]>,
  meta: RowMeta,
) => CellValue;

type AggFn = (
  cols: Record<string, CellValue[]>,
  aggs: Record<string, CellValue | CellValue[]>,
  aggMeta: AggMeta,
) => CellValue;

type CardinalFn = (
  cols: Record<string, CellValue[]>,
  aggs: Record<string, CellValue[]>,
  cards: Record<string, CellValue>,
) => CellValue;
```

- **`ExprFn`** — a row expression. Called once per row. `row` is a pure data snapshot of
  all columns available at this step; `aggs` holds every aggregate (and cardinal) computed
  before this step; `meta` is `RowMeta`.
- **`AggFn`** — a scalar aggregate. Called once per table. `cols` is every column available
  so far as a full array (input columns plus every earlier `.def()` column); `aggs` holds
  aggregates/cardinals computed before this step; `aggMeta` is `AggMeta`.
- **`CardinalFn`** — a cross-table aggregate. Called once across all tables. `cols` is all
  columns from all tables concatenated; `aggs` is a per-key *array* of scalar values
  collected from each table's donor aggregates (one value per table per key); `cards` holds
  cardinal results computed by earlier `.cardinal()` steps in declaration order.

Because a function with fewer parameters is structurally assignable to a function type
with more, callers may omit trailing arguments (`(row) => row.x * 2` is a valid `ExprFn`).

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
   disagree, throw
   `Error("Table columns have unequal lengths: expected <first>, found <len>.")`.
   An empty table (no columns) has row count `0`.
2. Shallow-copy the input table's columns into a working `columns` record. **The input
   table is never mutated.**
3. For each definition, in array order:
   a. If `name` already exists as a key in `columns`, throw
      `Error('Column "<name>" already exists in the table.')` — checked per-definition,
      immediately before that definition runs (not all upfront).
   b. Build a fresh result array of length `rowCount`. For each row index `i` from `0`
      to `rowCount - 1`:
      - Build a row snapshot: a plain `Row` object with one entry per *current* `columns`
        key, value = that column's value at index `i`.
      - Build `RowMeta` for this row: `rowIndex = i`, `rowCount`, `defOffset` (the count
        of definitions already finished), `colIndex = Object.keys(columns).length` (before
        this definition's column is appended), `tableIndex = 0`, `tableCount = 1`, plus a
        `get` closure and an `upstream` function both scoped to the live `columns` record.
        The `get` closure implements §2.2's visibility rule: row snapshots from this
        definition's own in-progress array are **not** visible (the column is only merged
        into `columns` after the entire row loop completes).
      - Call `fn(row, {}, meta)` — `aggs` is always `{}` at this layer. Push the result
        into the result array.
   c. Assign `columns[name] = resultArray`; increment `defOffset`.
4. Return `columns` as the new `Table`.

This layer has no aggregate concept and no type-level column tracking — it exists for
callers who want to build and compose `Definition` values without the generic-heavy
`Engine` API.

## 4. The typed API: `Engine`

`Engine` is an **immutable builder**. Each `.def()` / `.agg()` / `.cardinal()` call
returns a *new* `Engine` instance with one more internal step and an extended generic
type parameter — it never mutates `this`.

### 4.1 Type parameters

```ts
class Engine<
  Input    extends Record<string, CellValue[]>,
  InputAggs extends Record<string, CellValue | CellValue[]> = Record<never, never>,
  Val      extends CellValue = CellValue,
  Cols     extends { [K in keyof Input]: Input[K][number] } = TableToRow<Input>,
  Aggs     extends Record<string, Val | Val[]> = Record<never, never>,
  Cards    extends Record<string, Val> = Record<never, never>,
> { /* ... */ }

type TableToRow<T extends Record<string, CellValue[]>> = {
  [K in keyof T]: T[K][number];
};
```

- **`Input`** — the input table's shape as column-array types, e.g.
  `{ cost: number[]; qty: number[] }`. Supplied explicitly by the caller.
- **`InputAggs`** — the *upstream aggregate contract*: per-table scalar aggregates produced
  by the engine this one chains onto (via `.bindX()`). Declared values become available as
  typed keys on the `aggs` parameter in `.def()`, `.agg()`, and `.cardinal()` callbacks
  without any cast. Defaults to `Record<never, never>` (no upstream aggs).
- **`Val`** — the cell value type used throughout this engine instance. Defaults to
  `CellValue`; pass a narrower type (e.g. a mathjs `BigNumber`) to receive and return
  that type directly without casts (see §7).
- **`Cols`** — the accumulated **row type**: scalar (non-array) column types, starting as
  `TableToRow<Input>` and gaining one key per `.def()` call. Drives IDE autocomplete on
  `row.<name>` and makes forward references a compile error.
- **`Aggs`** — the accumulated **per-table aggregate type**, starting empty and gaining
  one key per `.agg()` call. Distinct from `Cards` (§4.5).
- **`Cards`** — the accumulated **cross-table cardinal type**, starting empty and gaining
  one key per `.cardinal()` call. Cardinals are visible in subsequent `.def()` and
  `.agg()` callbacks via `InputAggs & Aggs & Cards`.

### 4.2 Constructor

```ts
constructor(compiler?: ExprCompiler<Val>)
```

Public construction takes only an optional string-expression compiler (§4.6). An
internal overload `constructor(steps: Step[], compiler?)` is used by each builder method
to produce the next immutable instance in the chain; it is not part of the public
surface but the behavior it produces is normative.

### 4.3 `.def(name, fn)` — row expression

```ts
def<Name extends string, V extends Val>(
  name: Name,
  fn: (
    row: Cols & { [K in keyof Input]: Input[K][number] },
    aggs: InputAggs & Aggs & Cards,
    meta: RowMeta,
  ) => V,
): Engine<Input, InputAggs, Val, Cols & Record<Name, V>, Aggs, Cards>

// String-expression overload (requires a compiler; only when Input matches Val[]):
def<Name extends string>(
  name: Name,
  expression: [Input] extends [Record<string, Val[]>] ? string : never,
): Engine<Input, InputAggs, Val, Cols & Record<Name, Val>, Aggs, Cards>
```

Appends a row-expression step. At evaluation time it runs once per row, pushing its
result onto each row and appending `name` to the header list. The returned `Engine`'s
`Cols` is `Cols & Record<Name, V>` — so a *subsequent* `.def()` can read `row.<name>`,
but `fn` itself (typed against the current `Cols`) cannot — this is the forward-reference
guard:

```ts
new Engine<{ x: number[] }>()
  .def("result2", (row) => row.result1 + 3)  // compile error: 'result1' not on row yet
  .def("result1", () => 1 + 2);
```

`aggs` is typed as `InputAggs & Aggs & Cards` — so callers see all three categories of
previously computed scalar results without any cast when those categories are declared.

### 4.4 `.agg(name, fn)` — scalar aggregate

```ts
agg<Name extends string, V extends Val>(
  name: Name,
  fn: (
    cols: Input & { [K in keyof Cols]: Cols[K][] },
    aggs: InputAggs & Aggs & Cards,
    aggMeta: AggMeta,
  ) => V,
): Engine<Input, InputAggs, Val, Cols, Aggs & Record<Name, V>, Cards>

// String-expression overload:
agg<Name extends string>(
  name: Name,
  expression: [Input] extends [Record<string, Val[]>] ? string : never,
): Engine<Input, InputAggs, Val, Cols, Aggs & Record<Name, Val>, Cards>
```

Appends an aggregate step. Runs once per table (once in single-table mode, once *per
upstream table* when running via `ChainedBoundEngine`). Its result is stored under
`aggs.<name>` on the relevant table's aggregate object — never added to headers or rows.

`cols` type: the input columns at their native array types, plus every key already in
`Cols` re-typed as its specific array form (`Cols[K][]`, not just `Val[]`), so e.g. a
column defined as returning `number` has `cols.<name>: number[]` — no cast needed for
`sum()` or similar typed functions.

`aggs` is `InputAggs & Aggs & Cards` — the same union as in `.def()`.

A string-expression overload exists, symmetric to `.def()`'s.

### 4.5 `.cardinal(name, fn)` — cross-table aggregate

```ts
cardinal<Name extends string, V extends Val>(
  name: Name,
  fn: (
    cols: (Input & { [K in keyof Cols]: Cols[K][] }) & Record<string, CellValue[]>,
    aggs: { [K in keyof (InputAggs & Aggs)]: Array<(InputAggs & Aggs)[K]> } & Record<string, CellValue[]>,
    cards: Cards & Record<string, CellValue>,
  ) => V,
): Engine<Input, InputAggs, Val, Cols, Aggs, Cards & Record<Name, V>>

// String-expression overload:
cardinal<Name extends string>(
  name: Name,
  expression: [Input] extends [Record<string, Val[]>] ? string : never,
): Engine<Input, InputAggs, Val, Cols, Aggs, Cards & Record<Name, Val>>
```

Appends a cardinal step — a cross-table aggregate evaluated **once** across all tables.

**Callback parameter types:**

- **`cols`** — typed input and def columns as arrays, the same as `.agg()`'s `cols` but
  merged across all upstream tables. For declared `Input`/`Cols` keys, element types are
  preserved (`cols.qty: number[]`). Undeclared keys fall back to `CellValue[]` via the
  `& Record<string, CellValue[]>` intersection.
- **`aggs`** — the *collected* form of per-table scalar aggregates. Each key from
  `InputAggs & Aggs` maps to an array of that scalar's value from each upstream table
  (e.g. `aggs.total_cost: number[]` if `total_cost` is declared as `number` in
  `InputAggs`). The `& Record<string, CellValue[]>` fallback preserves access to
  undeclared keys as `CellValue[]`.
- **`cards`** — only the cardinals computed by earlier `.cardinal()` steps in this engine,
  in declaration order. Typed via `Cards`; unknown keys fall back to `CellValue` via
  `& Record<string, CellValue>`.

**Return type change**: only `Cards` grows (not `Aggs`). Subsequent `.def()` and `.agg()`
callbacks see the cardinal result via `Cards` (through the `InputAggs & Aggs & Cards`
union in their `aggs` parameter).

**Single-table mode**: when run via `BoundEngine.evaluate()`, the cardinal runs once on
the single table's own columns and aggregates. The `aggs` argument is the single table's
agg object with each value wrapped in a 1-element array (`wrapAggsAsArrays`). The result
is stored in `aggs[name]` *and* in an internal `cards` accumulator (so subsequent
cardinals in the same engine can read it via their `cards` argument). The result does
**not** appear as a column in the table.

### 4.6 `ExprCompiler` — string-expression support

```ts
type ExprCompiler<V extends CellValue = CellValue> =
  (expression: string) => (scope: Record<string, unknown>) => V | V[];
```

A compiler is a two-stage function: the outer call compiles a string expression once;
the returned function evaluates it against a scope object once per row/column evaluation.
If a string expression is passed to `.def()`, `.agg()`, or `.cardinal()` without a
compiler having been supplied to the constructor, throw:

```
Expression "<expression>" requires a compiler. Pass one to the Engine constructor: new Engine(compiler).
```

When a compiler is in play, each step type wraps the compiled evaluator differently:

- **`.def()` string** — `(row, aggs) => evaluate({ ...row, ...aggs })`
- **`.agg()` string** — `(cols, aggs) => evaluate({ ...cols, ...aggs })`
- **`.cardinal()` string** — `(cols, aggs, cards) => evaluate({ ...cols, ...aggs, ...cards })`

### 4.7 `.evaluate(...)` — three call shapes

`evaluate` is overloaded on its arguments; the runtime picks a code path based on what
was passed. All three paths execute the same conceptual step loop and the same per-step
semantics (§4.7.4); they differ in how the table is stored and mutated.

```ts
evaluate(headers: string[], rows: Val[][]): void;
evaluate(headers: string[], rows: Array<Record<string, Val>>): void;
evaluate(rows: Array<Record<string, Val>>): void;
```

#### 4.7.1 Array-row path: `evaluate(headers, rows: Val[][])`

The primary, most efficient path. `rows` is a 2D array; `headers[i]` names column `i`.

1. **Validate row lengths**: every row's `.length` must equal `headers.length`, else throw
   `Error("Row length <row.length> does not match headers length <headers.length>.")`.
2. **Validate names upfront, atomically**: walk all steps; for every `.def()` step, check
   its name is not already in a running copy of the header set (seeded from `headers`),
   else throw `Error('Column "<name>" already exists in headers.')`; add it to the set as
   it's "claimed" so two steps cannot collide with each other either. This check completes
   before any row is touched.
3. Maintain one mutable snapshot object reused across the evaluation, refreshed before
   each row of each `.def()` step. Maintain a `RowMeta` object, reused the same way.
   Maintain `get`/`upstream` closures scoped to a mutable "current row index" variable.
4. Walk steps in declaration order — see §4.7.4.

#### 4.7.2 With-headers object-row path: `evaluate(headers, rows: Array<Record<string, Val>>)`

Mechanically identical to §4.7.1 except: no row-length validation (plain objects have no
fixed width); a fresh row snapshot (`{ ...row }`) is built per row per `.def()` step; a
step's result is assigned directly onto the original object (`objectRow[step.name] = value`);
`headers` is still pushed to for column-order bookkeeping.

#### 4.7.3 Headerless object-row path: `evaluate(rows: Array<Record<string, Val>>)`

Identical to §4.7.2 except there is no `headers` array: the initial column set is
derived from `Object.keys(rows[0])` (or empty if `rows.length === 0`), and `colIndex`
and duplicate-name validation are seeded from that key set. Nothing is pushed to any
externally visible header list.

#### 4.7.4 Shared per-step contract (all three paths)

Steps run in **declaration order**, full stop. No dependency-based reordering.

For each step:

- **`.agg()` step**: if the `cols` cache is stale, rebuild it (one array per current
  header from the current rows). Call `fn(cols, aggs, aggMeta)` with
  `aggMeta = makeAggMeta(0, 1, [aggs])` (single-table: `tableIndex = 0`,
  `tableCount = 1`). Store the result at `aggs[step.name]`. The `cols` cache is not
  invalidated by this step.
- **`.cardinal()` step**: if the `cols` cache is stale, rebuild it. Call
  `fn(cols, wrapAggsAsArrays(aggs), cards)` where `wrapAggsAsArrays` converts each
  scalar value in `aggs` to a 1-element array. Store the result at `aggs[step.name]` and
  at `cards[step.name]`. The `cards` object accumulates across all cardinal steps in this
  evaluation. The `cols` cache is not invalidated by this step.
- **`.def()` step**: invalidate the `cols` cache. Set `meta.defOffset` and
  `meta.colIndex`. For each row index from `0` to `rowCount - 1`: refresh the snapshot
  from the current header list and this row's values; set `meta.rowIndex`; call
  `fn(snapshot, aggs, meta)`; push the result onto the row (array path) or assign it to
  the object (object paths). After all rows: append `name` to headers; increment
  `defOffset`.

An aggregate step's `cols` reflects every column that exists *at that point in
declaration order* — columns from `.def()` steps declared earlier but not from ones
declared later.

`aggs` accumulates across the entire step loop — later steps can always read results from
earlier steps, whether `.agg()`, `.cardinal()`, or `.def()` (for `.def()` callbacks,
`aggs` gives the scalar cardinal/aggregate values, not row-by-row arrays).

### 4.8 `.bind(headers, rows, aggs?)` → `BoundEngine`

```ts
bind(
  headers: string[],
  rows: Val[][],
  aggs?: Record<string, CellValue | CellValue[]>,
): BoundEngine
```

Performs all of §4.7.1's upfront validation **once**, and returns a `BoundEngine`
(§5) that can `evaluate()` repeatedly against the same table without re-validating. The
optional `aggs` argument lets multiple `BoundEngine`s write their aggregate results into
separate caller-supplied objects — each object is returned verbatim by that engine's
`.aggs` getter.

### 4.9 `.bindX(upstream, cardinals?)` → `ChainedBoundEngine`

```ts
bindX(
  upstream: BoundEngine | BoundEngine[],
  cardinals?: Record<string, CellValue>,
): ChainedBoundEngine
```

Chains this engine onto one or more already-bound upstream `BoundEngine`s. Returns a
`ChainedBoundEngine` (§6). Derives headers, rows, and donor aggregates directly from the
upstream engines — no headers array is needed.

- **Single-table chaining** (one `BoundEngine`): useful for composing engine definitions
  from separate modules; the chained engine's `.def()` steps append columns to the single
  upstream table.
- **Multi-table mode** (array of `BoundEngine`s): `.cardinal()` steps run once across all
  tables; `.agg()` and `.def()` steps run once *per table* in table order.

The optional `cardinals` object is stored by reference and written into by each cardinal
step — it is what `ChainedBoundEngine.aggs` returns.

## 5. `BoundEngine`

A computation engine pre-bound to one specific array-row table (`headers: string[]`,
`rows: CellValue[][]`), held by reference — never copied.

### 5.1 Construction (via `Engine.bind`, not directly)

```ts
constructor(
  steps: Step[],
  headers: string[],
  rows: CellValue[][],
  aggsTarget?: Record<string, CellValue | CellValue[]>,
)
```

- Validate every row's length equals `headers.length` (same error as §4.7.1).
- Validate no `.def()` step's name collides with `headers` (same atomic, upfront check
  and error as §4.7.1).
- Store `steps`, `headers`, `rows` by reference. Store `inputColCount = headers.length`
  (the width to truncate back to on every `evaluate()` call). Store `aggsTarget ?? {}`
  — this is the object returned by the `.aggs` getter.
- Store `ownWidth = headers.length` — the "watermark" updated at the end of each
  `evaluate()` call; used by `resetGroupColumns()` to trim any cross-engine columns
  appended by a `ChainedBoundEngine`.
- Build persistent `get`/`upstream` closures that close over the mutable `#rowIndex`
  field — a single closure is created once at construction time, not recreated per row.

### 5.2 `.aggs` getter

Returns the `aggsTarget` object by reference (not a copy). Empty `{}` before the first
`evaluate()` call unless the caller supplied a pre-populated object.

### 5.3 `.cols` getter

Computed fresh on every access from the current `headers`/`rows`: one array per header,
mapped from row index to that column's value.

### 5.4 `.rowCount` getter

Returns `rows.length`.

### 5.5 `.evaluate(_mode?)`

```ts
evaluate(_mode?: "cascade" | "manual"): void
```

The `mode` argument is accepted (for API compatibility with `ChainedBoundEngine`) but
ignored — a `BoundEngine` always evaluates its own steps and never triggers upstream
evaluation.

1. **Truncate**: set `headers.length = inputColCount`, and for every row set
   `row.length = inputColCount` — discards any columns appended by a previous call or by
   a `ChainedBoundEngine.appendColumn`.
2. Run every step exactly as in §4.7.4, reusing the persistent snapshot and `RowMeta`
   objects (fields are overwritten each call, not recreated).
3. After the step loop finishes, set `ownWidth = headers.length`.

Calling `.evaluate()` again after mutating a cell in `rows` recomputes everything
correctly:

```ts
const ctx = engine.bind(["seed"], rows);
ctx.evaluate();   // rows now have [seed, doubled]
rows[0][0] = 0.99;
ctx.evaluate();   // resets to [seed], recomputes — reflects the new value
```

### 5.6 `.resetGroupColumns()`

```ts
resetGroupColumns(): void
```

If `headers.length > ownWidth`, truncate `headers` and every row back to `ownWidth`.
A no-op otherwise. Idempotent. Called by `ChainedBoundEngine.evaluate()` at the start of
each evaluation to remove columns appended by a previous `ChainedBoundEngine` pass.

### 5.7 `.appendColumn(name, computeValue, chainCtx?)`

```ts
appendColumn(
  name: string,
  computeValue: (row: Row, meta: RowMeta) => CellValue,
  chainCtx?: { tableIndex: number; tableCount: number; defOffset: number },
): void
```

Used by `ChainedBoundEngine` to implement its `.def()` step. Appends exactly one column
to whatever `headers`/`rows` currently hold (does **not** call `resetGroupColumns` — the
`ChainedBoundEngine` does that once before its step loop begins):

1. If `name` is already in `headers`, throw
   `Error('Column "<name>" already exists in headers.')`.
2. Build a `RowMeta` with `colIndex = headers.length`, `rowCount = rows.length`,
   `tableIndex`/`tableCount`/`defOffset` from `chainCtx` (or `0`, `1`, `0` if absent),
   plus `get`/`upstream` closures that reuse the same snapshot machinery as
   `.evaluate()`.
3. For each row index from `0` to `rowCount - 1`: refresh the snapshot from current
   headers/row values; set `meta.rowIndex`; call `computeValue(snapshot, meta)`; push
   the result onto the row.
4. `headers.push(name)`.

## 6. `ChainedBoundEngine`

A computation engine chained onto one or more upstream `BoundEngine`s. Obtained via
`Engine.bindX` (§4.9), never constructed directly.

### 6.1 Construction (via `Engine.bindX`, not directly)

```ts
constructor(
  steps: Step[],
  upstreams: BoundEngine[],
  compiler?: ExprCompiler<CellValue>,
  cardinalsTarget?: Record<string, CellValue>,
)
```

Stores `steps`, `upstreams`, `compiler`, and `cardinalsTarget ?? {}` by reference.

### 6.2 `.aggs` getter

Returns the `cardinalsTarget` object by reference. This object receives cardinal results
only — per-table agg results are written directly into each upstream's own `.aggs` (not
into `cardinalsTarget`).

### 6.3 `.cols` getter

Returns a merged column record: for each column name present in any upstream, the values
from all upstreams are concatenated in upstream order. Computed fresh on every access.

### 6.4 `.rowCount` getter

Returns the sum of all upstreams' `rowCount` values.

### 6.5 `.evaluate(mode?)`

```ts
evaluate(mode: "cascade" | "manual" = "cascade"): void
```

- **`cascade`** (default): calls `upstream.evaluate()` on every upstream before running
  this engine's own steps. Use when the upstream's own rows may have changed.
- **`manual`**: skips upstream evaluation. Use when the caller has already called each
  upstream's `.evaluate()` and only wants to re-run the cross-table steps.

**Algorithm:**

1. If `mode === "cascade"`, call `.evaluate()` on every upstream in order.
2. Call `resetGroupColumns()` on every upstream (unconditionally — cheap no-op if nothing
   was appended last time).
3. Clear all keys from `cardinalsTarget`.
4. Initialize a local `cards` accumulator `{}` and `defOffset = 0`.
5. Walk steps in declaration order:
   - **`.cardinal()` step**: build `mergedCols` (§6.3 logic) and `collectedAggs`
     (per-key arrays of each upstream's scalar agg values); call
     `fn(mergedCols, collectedAggs, cards)`; store the result in `cards[name]`,
     `cardinalsTarget[name]`, and write it back to **every** upstream's `aggs[name]` —
     this write-back is what allows subsequent `.agg()` steps on the same engine to read
     the cardinal as a scalar.
   - **`.agg()` step**: for each upstream (table) in order, build an `AggMeta` with that
     table's `tableIndex` and all upstreams' agg objects; call
     `fn(upstream.cols, upstream.aggs, aggMeta)`; write the result into `upstream.aggs[name]`.
   - **`.def()` step**: call `upstream.appendColumn(name, computeRow, chainCtx)` on every
     upstream in order (where `computeRow` wraps the step's `fn` against that upstream's
     own `.aggs`); increment `defOffset` once per `.def()` step.

### 6.6 Step-ordering guarantee

Steps run in strict **declaration order**. For each step, **all upstream tables are
processed before the next step begins**:

```
Step 1 (cardinal) → runs once across all tables
Step 2 (agg)      → upstream[0], upstream[1], …
Step 3 (def)      → upstream[0], upstream[1], …
Step 4 (agg)      → upstream[0], upstream[1], …
```

Because cardinals are written back to each upstream's `.aggs` immediately after they
run, a later `.agg()` step in declaration order can reference a cardinal result as a
scalar through its `aggs` parameter even if it was declared *before* the cardinal in the
source file — it will see it as long as it is declared *after* the cardinal in the step
sequence.

## 7. Library-agnostic numeric types

`Engine`'s `Val` parameter defaults to `CellValue` but can be narrowed to any class
implementing the arithmetic a caller's expressions need. When narrowed:

- Row-expression and aggregate functions receive and must return that exact type — no
  casts needed at call sites.
- `Input`'s column array types must use `Val[]` consistently.

```ts
class Decimal {
  constructor(readonly value: number) {}
  add(other: Decimal): Decimal { return new Decimal(this.value + other.value); }
  mul(other: Decimal): Decimal { return new Decimal(this.value * other.value); }
}

new Engine<{ price: Decimal[]; qty: Decimal[] }, Record<never,never>, Decimal>()
  .def("total", (row) => row.price.mul(row.qty))
  .evaluate(headers, rows);
```

This works because `CellValue`'s `object` branch accepts any class instance, and every
generic signature in §4 threads `Val` consistently rather than hard-coding `CellValue`.

## 8. Error reference

| Condition | Message |
|---|---|
| `applyDefinitions`: a definition's name already exists in the table | `Column "<name>" already exists in the table.` |
| `applyDefinitions`: input columns have unequal lengths | `Table columns have unequal lengths: expected <first>, found <len>.` |
| `Engine.evaluate` (headerless object-row path): a `.def()` name already exists | `Column "<name>" already exists.` |
| `Engine.evaluate` (with-headers / array-row paths), `BoundEngine` construction: a `.def()` name already exists in headers | `Column "<name>" already exists in headers.` |
| `Engine.evaluate` (array-row path), `BoundEngine` construction: a row's length doesn't match `headers.length` | `Row length <row.length> does not match headers length <headers.length>.` |
| `BoundEngine.appendColumn`: name already exists in headers | `Column "<name>" already exists in headers.` |
| `Engine`: a string expression was passed without a compiler | `Expression "<expression>" requires a compiler. Pass one to the Engine constructor: new Engine(compiler).` |

Every name-collision check is **atomic**: it walks the full set of steps before any
mutation, rather than failing partway through.

## 9. Module layout

Not normative, but mirrors a clean separation of concerns:

- `expr.ts` — `CellValue`, `Row`, `RowGet`, `RowMeta`, `UpstreamRows`, `UpstreamAggs`,
  `AggMetaGet`, `AggMeta`, `ExprFn`, `AggFn`, `CardinalFn` (§2).
- `definition.ts` — `Definition`, `def()` (§3).
- `table.ts` — `Table`, `applyDefinitions()` (§3).
- `engine.ts` — `ExprCompiler`, `TableToRow`, the internal `Step` discriminated union
  (`DefStep`, `AggStep`, `CardinalStep`), `Engine`, `BoundEngine`, `ChainedBoundEngine` —
  §4–§6.
- `index.ts` — re-exports the public surface of all of the above.

## 10. Worked example — multi-invoice analysis

End-to-end example exercising every feature in this spec.

```ts
import { Engine } from "nosheet";
import { sum } from "mathjs";

type InvoiceInput = {
  name:  string[];
  cost:  number[];
  qty:   number[];
  offer: number[];
};

// Per-invoice computation. Bind each invoice with .bind(), then evaluate.
const invoiceEngine = new Engine<InvoiceInput>()
  .def("line_cost",        row => row.cost * row.qty)
  .agg("total_cost",       cols => sum(cols.line_cost))   // cols.line_cost: number[]
  .agg("total_offer",      cols => sum(cols.offer))
  .def("gross_margin",     row => 1 - row.line_cost / row.offer)
  .def("weighted_margin",  (row, aggs) => row.line_cost / aggs.total_cost)
  .agg("total_mw",         cols => sum(cols.weighted_margin))
  .def("margin_score",     row => row.gross_margin < 0.3 ? "👎" : "👍");

// All columns the cross-invoice engine can see.
type InvoiceRow = InvoiceInput & {
  line_cost: number[];
  gross_margin: number[];
  weighted_margin: number[];
  margin_score: string[];
};

// Upstream agg contract: what invoiceEngine produces.
type InvoiceAggs = {
  total_cost:  number;
  total_offer: number;
  total_mw:    number;
};

// Cross-invoice analytics. Use .bindX(boundEngines, cardinalsTarget).
const invoiceGroupEngine = new Engine<InvoiceRow, InvoiceAggs>()
  // Per-table agg: each invoice's gross margin
  .agg("invoice_gross_margin",
    (_cols, aggs) => 1 - aggs.total_cost / aggs.total_offer)
  // Cardinals: aggregates across all invoices
  .cardinal("grand_qty",    cols => cols.qty.reduce((a, b) => a + b, 0))
  .cardinal("grand_cost",   (_cols, aggs) => aggs.total_cost.reduce((a, b) => a + b, 0))
  .cardinal("grand_offer",  (_cols, aggs) => aggs.total_offer.reduce((a, b) => a + b, 0))
  .cardinal("grand_margin", (_cols, _aggs, cards) => 1 - cards.grand_cost / cards.grand_offer)
  // Per-table agg reading a cardinal (grand_cost was written back to each upstream.aggs)
  .agg("invoice_weighted_margin",
    (_cols, aggs) => aggs.total_cost / aggs.grand_cost);

// Bind and evaluate three invoices
const samples = [invoice1Rows, invoice2Rows, invoice3Rows].map((inputRows, idx) => {
  const rows  = inputRows.map(r => [...r]);
  const aggs  = {};
  const bound = invoiceEngine.bind(["name", "cost", "qty", "offer"], rows, aggs);
  bound.evaluate();
  return { rows, aggs, bound };
});

// Chain the group engine; cardinals land in groupAggs
const groupAggs = {};
const chain = invoiceGroupEngine.bindX(samples.map(s => s.bound), groupAggs);
chain.evaluate("manual");  // upstreams already evaluated above

// groupAggs.grand_cost   — total cost across all invoices
// groupAggs.grand_margin — overall gross margin
// samples[0].aggs.invoice_gross_margin   — per-invoice gross margin
// samples[0].aggs.invoice_weighted_margin — per-invoice weight relative to grand total
```
