#!/usr/bin/env bash
set -e
pnpm format
pnpm format:check
pnpm turbo run lint typecheck --force
pnpm turbo run test build --force
pnpm db:up && pnpm db:deploy && pnpm db:seed && pnpm db:seed
pnpm test:db
git diff --check
git diff --exit-code -- docs/specification.md
git status --short --branch
