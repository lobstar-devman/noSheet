# AGENTS.md

Agent guidance for the `noSheetOnaLib` repository.

## Repository Overview

`noSheetOnaLib` is a TypeScript library for applying named expressions to tabular data.

Consumers define expressions as composable TypeScript values using `col()`, `scalar()`, and
operator functions (`mul`, `add`, `sub`, `div`). Expressions are bound to result column names
via `def()`, then applied row-by-row to a table with `applyDefinitions()`. Results are
appended as new columns. Later definitions can reference columns produced by earlier ones —
evaluation follows declaration order.

No string parsing, no `eval`. Example matching SPEC.md:

```ts
applyDefinitions(
  { cost: [3, 7, 8], quantity: [2, 3, 4] },
  [
    def("net",   mul(col("cost"), col("quantity"))),  // net = cost * quantity
    def("vat",   scalar(1.2)),                        // vat = 1.2 (constant per row)
    def("total", mul(col("net"), col("vat"))),        // total = net * vat
  ],
);
// Produces: { cost, quantity, net: [6,21,32], vat: [1.2,…], total: [7.2,25.2,38.4] }
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
