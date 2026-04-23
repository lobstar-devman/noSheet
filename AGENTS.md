# AGENTS.md

Agent guidance for the `noSheetOnaLib` repository.

## Repository Overview

`noSheetOnaLib` is a TypeScript computation engine library. It evaluates structured,
programmatic computation graphs — not string-based mathematical expressions and not
Excel-style row/column formula definitions. Consumers define computations in code using
the library's API.

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
