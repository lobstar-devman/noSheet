# AGENTS Improvement Spec

Audit date: 2026-04-23  
Repository state: initial commit, no source code.

---

## What's Good

| Item | Notes |
|---|---|
| Dev container present | `.devcontainer/devcontainer.json` exists and is valid. |
| AGENTS.md created | Baseline file now exists (created during this audit). |
| Project language defined | TypeScript / Node.js 24, npm. ✅ resolved |
| Dev container image updated | Switched to `javascript-node:24`. ✅ resolved |
| Tooling conventions documented | Lint, format, typecheck, test, build commands in AGENTS.md. ✅ resolved |

---

## What's Missing

### 1. Project identity ✅ resolved
AGENTS.md now describes `noSheetOnaLib` as a TypeScript computation engine library with
Node.js 24 / npm, and documents all tooling commands.

---

### 2. Language and tooling conventions ✅ resolved
AGENTS.md now documents: install, build, lint, format, typecheck, test, and single-file
test commands.

---

### 3. .gitignore
No `.gitignore` exists. The first `npm install` / `pip install` / `go mod download` will
produce untracked dependency directories that could be accidentally committed.

**Fix**: Create a `.gitignore` appropriate for the chosen language before installing any
dependencies. Minimum entries depend on language:
- Node.js: `node_modules/`, `dist/`, `.env*`
- Python: `__pycache__/`, `*.pyc`, `venv/`, `.env*`
- Go: binary name, `vendor/` (if not vendoring)

---

### 4. Dev container image ✅ resolved
Replaced universal image with `mcr.microsoft.com/devcontainers/javascript-node:24`.

---

### 5. Ona automations
No `automations.yaml` or `.ona/` directory exists. Common setup tasks (install deps, start
dev server, run tests) must be run manually every time an environment starts.

**Fix**: After tooling is established, add an `automations.yaml` with at minimum:
- An `onStart` task that installs dependencies
- A service that starts the dev server (if applicable)

---

### 6. Skill files
No `.ona/skills/` or `.cursor/rules/` files exist. Project-specific agent skills cannot be
discovered.

**Fix**: Once recurring agent workflows are identified (e.g., "add a new API endpoint",
"run the test suite"), encode them as skill files under `.ona/skills/` so agents can
follow consistent, project-aware procedures.

---

### 7. CI / GitHub Actions
No `.github/workflows/` directory. There is no automated lint, test, or build gate on pull
requests.

**Fix**: Add a minimal CI workflow once the project has a test command. A single workflow
that installs deps and runs tests is sufficient to start.

---

## What's Wrong

| Item | Severity | Status |
|---|---|---|
| No `.gitignore` | High | ⚠️ Still open — create before running `npm install`. |
| Universal dev container image | Medium | ✅ Resolved — switched to `javascript-node:24`. |
| AGENTS.md had no content | Medium | ✅ Resolved — fully populated with project context and tooling. |

---

## Recommended Action Order

1. ✅ Decide project language and purpose.
2. ⚠️ Create `.gitignore` for Node.js/TypeScript — **do this before `npm install`**.
3. ✅ Replace universal dev container image with `javascript-node:24`.
4. Bootstrap project structure (`src/`, entry point, test dir, `package.json`, `tsconfig.json`).
5. ✅ Fill in AGENTS.md conventions section (lint, test, build commands).
6. Add `automations.yaml` for `onStart` dependency install.
7. Add a CI workflow (lint + test on PR).
8. Add `.ona/skills/` entries for recurring agent workflows.
