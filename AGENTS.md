# AGENTS.md

Agent guidance for the `nosheet` repository.

## Repository Overview

`nosheet` is a TypeScript library for applying named row expressions and aggregates to
tabular data. Expressions are plain arrow functions, not string formulas — no parsing, no
`eval`. Two API layers:

- **Low-level (untyped)**: `def(name, fn)` binds an arrow-function expression to a result
  column name; `applyDefinitions(table, definitions)` applies a list of them row-by-row to
  a table, appending each result as a new column. Later definitions can reference columns
  produced by earlier ones — evaluation follows declaration order. Cell values are typed as
  the generic `CellValue` (`number | string | bigint | boolean | object`); callers cast as
  needed.
- **Typed (high-level)**: `Engine` is a chainable, fully-typed builder — `.def()` for row
  expressions, `.agg()`/`.aggRow()` for aggregates. Each chained call returns a new `Engine`
  whose row type has grown by one column, which is what gives IDE completion on
  `row.<column>` and a compile error for forward references. `.bind()` produces a
  `BoundEngine` for repeated re-evaluation against one table without re-validating.
  `EngineGroup` aggregates and cross-references a set of `BoundEngine`s (e.g. summing
  per-invoice totals into a grand total, or reading one invoice's data from another's
  row expression). An optional `ExprCompiler` can be supplied to `Engine` for callers who
  want string expressions (e.g. via mathjs) instead of arrow functions.

Example matching SPEC.md §3 (low-level layer):

```ts
applyDefinitions(
  { cost: [3, 7, 8], quantity: [2, 3, 4] },
  [
    def("net",   (row) => (row.cost as number) * (row.quantity as number)),
    def("vat",   () => 1.2),
    def("total", (row) => (row.net as number) * (row.vat as number)),
  ],
);
// Produces: { cost, quantity, net: [6,21,32], vat: [1.2,…], total: [7.2,25.2,38.4] }
```

Example matching SPEC.md §4 (typed layer — equivalent result, with IDE completion and
forward-reference protection on `row.<column>`):

```ts
new Engine<{ cost: number[]; quantity: number[] }>()
  .def("net",   (row) => row.cost * row.quantity)
  .def("vat",   () => 1.2)
  .def("total", (row) => row.net * row.vat)
  .evaluate(["cost", "quantity"], [[3, 2], [7, 3], [8, 4]]);
```

## In-Depth Specification

@SPEC.md

## Language & Runtime

- **Language**: TypeScript
- **Runtime**: Node.js 24
- **Package manager**: npm

## Dev Container

- **Image**: `mcr.microsoft.com/devcontainers/javascript-node:24`
- Switched from the universal image to keep startup fast.

## Conventions

### Commands

| Purpose | Command |
|---|---|
| Install dependencies | `npm install` |
| Build (compile TS) | `npm run build` |
| Lint | `npm run lint` |
| Format | `npm run format` |
| Type-check | `npm run typecheck` |
| Run all tests | `npm test` |
| Run a single test file | `npx jest <path/to/file.test.ts>` |

### Code style

- ESLint + Prettier enforce style. Run `npm run lint` and `npm run format` before committing.
- All public API surface must be typed; avoid `any`.
- Source lives in `src/`, compiled output in `dist/` (gitignored).
- Test files colocate with source as `*.test.ts` or live under `src/__tests__/`.

### Commit style

- Imperative mood, lowercase subject line, no trailing period.
- Example: `add topological sort for dependency resolution`

## Agent Workflow

1. Read this file before starting any task.
2. Check for `.gitignore` before installing dependencies.
3. Run `npm run lint` and `npm test` after any non-trivial change.
4. Do not commit or push unless explicitly asked.
5. Do not add `any` types to satisfy the compiler — fix the type properly.
