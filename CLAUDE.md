# BookSwap

Peer-to-peer lending of physical books between friends. pnpm workspaces + Turbo monorepo:
`apps/api` (NestJS), `apps/web` (Next.js), `packages/shared` (zod schemas, API contracts).

Requirements live in `docs/specification.md`. When code and spec disagree, the spec wins —
but don't make destructive changes without explaining them first.

## Language

- Code, identifiers, comments, docstrings, commit messages: English.
- `README.md` and `docs/`: Ukrainian.
- Talk to me in Ukrainian.

## Domain

- The catalog model is `Work → Translation → Edition → Copy`. Do not collapse or simplify it.
- Only a `Copy` is ever borrowed.
- A merged `Work` keeps `mergedIntoId` and is never deleted.

## Stack

Fixed: NestJS, Next.js, Prisma, PostgreSQL. Don't swap any of it without demonstrating an
actual incompatibility.

Do not introduce Redis, JWT, GraphQL, or microservices.

## Code

- All endpoints live under `/api/v1` and return errors with a machine-readable `code` field.
- Shared zod schemas and API contracts belong in `packages/shared`.
- Nest DTOs are runtime-validated.
- `any` requires a stated reason.
- Never suppress a TypeScript, ESLint, or test error — fix the cause.
- No speculative abstractions. Build what the current stage needs.

## Workflow

- Work on the branch named in the stage prompt. Check with `git branch --show-current`;
  if it's anything else, stop and tell me — change nothing.
- Never run `commit`, `push`, `merge`, `rebase`, or `stash`. I do those.
- Never modify `docs/specification.md`.
- Implement only the current sub-stage from `docs/plan/`. Don't start the next one.
- Verify with `./gate.sh`.

## Escalation

If the work requires designing a subsystem that appears in neither `docs/specification.md`
nor the stage plan — a queue, a cache, a shutdown/drain policy, a retry scheme — stop and
describe the options in your report. Don't build it silently.

The same applies when the stage plan leaves a real choice open. Name the choice, don't
resolve it on your own.

## Reporting

End each sub-stage with: what was implemented, key files touched, each DoD item with the
test or command that proves it, assumptions made, `./gate.sh` exit code, and confirmation
that nothing was committed or pushed.
