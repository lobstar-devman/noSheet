# Confirmed Design Decisions: Remove EngineGroup

Decisions confirmed via design interview on 2026-06-23.
Reference spec: `REMOVE-ENGINEGROUP.spec.md`

---

## Goals

1. **Remove `EngineGroup`** — collapse its functionality into `Engine` directly.
2. **Facet/library pattern** — `Engine` definitions can be packaged as reusable algorithms and composed over shared donor tables.

---

## Execution model

Steps in a multi-table engine run in **strict declaration order**. Each step iterates all tables to completion before advancing to the next step. Cardinals slot into this order in the same way.

---

## Step semantics in multi-table mode

### `.def(name, (row, aggs, meta) => V)`
- Runs per-row, per-table.
- Appends a column to each upstream table.
- `meta` carries: `rowIndex`, `rowCount`, `defOffset`, `colIndex`, `tableIndex`, `tableCount`, `meta.get(offset|filter)`, `meta.upstream(filter?)`.

### `.agg(name, (cols, aggs, aggMeta) => V)`
- Runs once per table (not once across all tables).
- `cols` = current table's columns.
- `aggs` = current table's own donor aggregate object.
- `aggMeta` carries: `tableIndex`, `tableCount`, `aggMeta.get(offset|filter)`, `aggMeta.upstream(filter?)`.
- `aggMeta.get(offset)` navigates donor aggregate objects by table-processing order (`0` = current, `-1` = previous table).
- `aggMeta.upstream(filter?)` yields prior donor aggregate objects as a key-keyed iterable.

### `.cardinal(name, (cols, aggs, cards) => V)`
- Runs once across all tables.
- `cols` = raw table columns concatenated across all tables.
- `aggs` = collected donor aggregates; `aggs.total_cost` is an array of `total_cost` from each table.
- `cards` = cardinals accumulated so far in declaration order.
- No meta parameter.
- Supports string expressions with scope `{ ...cols, ...aggs, ...cards }`.

---

## Intrinsics — moved entirely to `meta`

- `row.get()` and `row.upstream()` are **removed from `row`** (hard breaking change).
- Both move to `meta`: `meta.get(offset|filter)` and `meta.upstream(filter?)`.
- `row` is now pure data — no masking risk.
- `meta.upstream(filter?)` mirrors `row.get(filter)` — accepts an optional filter function.
- `aggMeta` is symmetric with `meta`: same method signatures, navigating donor aggregates instead of rows.

---

## API changes

### `bind` — unchanged
```ts
bind(headers: string[], rows: Val[][], aggs?: Record<string, CellValue | CellValue[]>): BoundEngine
```
Entry point for the initial binding of raw table data. No change.

### `bindX` — new
```ts
bindX(upstream: BoundEngine | BoundEngine[], cardinals?: Record<string, CellValue>): BoundEngine
```
- Chains a new engine onto one or more upstream `BoundEngine`s.
- Derives headers, rows, and donor aggregates directly from the upstream `BoundEngine`s — no headers array required.
- Returns an object with full `BoundEngine` semantics (`.evaluate()`, `.aggs`, `.cols`, `.rowCount`).
- Single `BoundEngine`: single-table chaining mode — valid use case, e.g. composing engines from separate third-party libraries.
- `BoundEngine[]` + cardinals object: multi-table mode.

### `evaluate` — gains mode parameter
```ts
evaluate(mode: 'cascade' | 'manual' = 'cascade'): void
```
- `'cascade'` (default): automatically evaluates all upstream `BoundEngine`s in dependency order before running this engine's steps.
- `'manual'`: caller is responsible for evaluating upstream engines in the correct order.

### `Engine` — gains `InputAggs` type parameter
```ts
new Engine<InputCols, InputAggs>()
```
- `InputAggs` declares the upstream aggregate contract — what aggregates the upstream engine is expected to have produced.
- `bindX` validates the actual `BoundEngine[]` satisfies `InputAggs` at compile time.
- This is the mechanism for type safety between chained engines and packaged library facets.

---

## Removals

| Removed | Replaced by |
|---|---|
| `.aggRow()` | `.def()` with `meta.upstream()` — results become real table columns |
| `EngineGroup` | Multi-table `bindX` + `.cardinal()` steps |
| `row.get()` | `meta.get()` — hard breaking change, no deprecation alias |
| `row.upstream()` | `meta.upstream()` |

---

## `aggMeta` positional metadata

Analogous to `RowMeta` for rows, `aggMeta` carries:
- `tableIndex` — 0-based index of the current table being processed
- `tableCount` — total number of tables passed to `bindX`

In single-table mode (`bind`), `aggMeta` is still present with `tableIndex = 0`, `tableCount = 1`.

---

## Workflow / composition pattern

No concrete `Workflow` class in this iteration. Composition of multiple engine facets follows conventions:

1. Bind each table with the first (base) engine using `bind`.
2. Evaluate using `evaluate('cascade')` on the final engine in the chain — cascade handles upstream evaluation automatically.
3. A packaged facet documents its input contract via its `InputCols` / `InputAggs` generic type parameters.

A concrete `Workflow` class is explicitly deferred to a future iteration.

---

## SPEC.md

`SPEC.md` will be **fully rewritten** to incorporate all of the above decisions. `REMOVE-ENGINEGROUP.spec.md` is the design document; `SPEC.md` remains the single normative source of truth once the rewrite is complete.
