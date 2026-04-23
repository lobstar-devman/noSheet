# AGENTS.md

Agent guidance for the `noSheetOnaLib` repository.

## Repository Overview

This repository is in its initial state. It contains only a dev container configuration
(`.devcontainer/devcontainer.json`) using the universal Ona/Devcontainer image. No source
code, tests, or tooling have been committed yet.

## Dev Container

- **Image**: `mcr.microsoft.com/devcontainers/universal:4.0.1-noble`
- The universal image is large (~10 GB). Once the project language is decided, switch to a
  language-specific image for faster startup.

## Conventions

_To be defined once the project language and structure are established._

## Agent Workflow

1. Read this file before starting any task.
2. Check for a `.gitignore` before installing dependencies.
3. Follow the commit style established in the first commit.
4. Do not commit or push unless explicitly asked.
