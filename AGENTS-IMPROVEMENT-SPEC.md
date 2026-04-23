# AGENTS Improvement Spec

Audit date: 2026-04-23  
Repository state: initial commit, no source code.

---

## What's Good

| Item | Notes |
|---|---|
| Dev container present | `.devcontainer/devcontainer.json` exists and is valid. |
| AGENTS.md created | Baseline file now exists (created during this audit). |

---

## What's Missing

### 1. Project identity
AGENTS.md has no description of what `noSheetOnaLib` is, what language/runtime it targets,
or what problem it solves. Agents cannot make sensible decisions without this context.

**Fix**: Add a one-paragraph "Purpose" section to AGENTS.md once the project direction is
decided.

---

### 2. Language and tooling conventions
No source files, no `package.json` / `go.mod` / `pyproject.toml`, no linter or formatter
config. Agents will guess at conventions.

**Fix**: After bootstrapping the project, document in AGENTS.md:
- Language and runtime version
- Package manager and install command
- Lint command (`npm run lint`, `golangci-lint run`, `ruff check .`, etc.)
- Test command and how to run a single test
- Build/bundle command

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

### 4. Dev container image
The universal image (`mcr.microsoft.com/devcontainers/universal:4.0.1-noble`) is ~10 GB and
starts slowly. It is appropriate for exploration but not for a production dev workflow.

**Fix**: Once the project language is known, replace with a language-specific image and
document the choice in AGENTS.md. Examples:
- Node.js 24: `mcr.microsoft.com/devcontainers/javascript-node:24`
- Python 3.13: `mcr.microsoft.com/devcontainers/python:3.13`
- Go 1.24: `mcr.microsoft.com/devcontainers/go:1.24`

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

| Item | Severity | Notes |
|---|---|---|
| No `.gitignore` | High | Risk of committing `node_modules` or equivalent on first install. |
| Universal dev container image | Medium | Slow startup; should be replaced once language is chosen. |
| AGENTS.md had no content | Medium | Created during this audit with placeholder content; needs real project context. |

---

## Recommended Action Order

1. Decide project language and purpose.
2. Create `.gitignore` for that language.
3. Replace universal dev container image with a language-specific one.
4. Bootstrap project structure (source dir, entry point, test dir).
5. Fill in AGENTS.md conventions section (lint, test, build commands).
6. Add `automations.yaml` for `onStart` dependency install.
7. Add a CI workflow.
8. Add `.ona/skills/` entries for recurring agent workflows.
