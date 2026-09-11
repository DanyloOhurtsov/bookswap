import {
  createScratchDatabaseUsing,
  scratchDatabaseName,
  type SqlExecutor,
} from './migration-scratch'

/**
 * Stage 8e-1: lifecycle tests for `createScratchDatabaseUsing` — no live
 * Postgres connection. `SqlExecutor` is a one-method interface
 * (`query(text)`), so a plain in-memory recorder stands in for `pg.Client`
 * here and proves the create/no-drop rules from SQL call order alone, the
 * same way `guard.spec.ts` proves `assertSafeScratchDatabase` with fake URLs
 * instead of a real database.
 */
class RecordingExecutor implements SqlExecutor {
  readonly calls: string[] = []

  constructor(private readonly failOn?: RegExp) {}

  query(text: string): Promise<unknown> {
    this.calls.push(text)

    if (this.failOn?.test(text) === true) {
      return Promise.reject(new Error(`simulated SQL failure for: ${text}`))
    }

    return Promise.resolve(undefined)
  }
}

function dropCalls(executor: RecordingExecutor): string[] {
  return executor.calls.filter((call) => call.startsWith('DROP DATABASE'))
}

function createCalls(executor: RecordingExecutor): string[] {
  return executor.calls.filter((call) => call.startsWith('CREATE DATABASE'))
}

describe('createScratchDatabaseUsing', () => {
  it('creates without ever issuing a DROP first — there is nothing to drop for a fresh name', async () => {
    const executor = new RecordingExecutor()

    await createScratchDatabaseUsing(executor, 'lifecycle')

    expect(executor.calls).toHaveLength(1)
    expect(createCalls(executor)).toHaveLength(1)
    expect(dropCalls(executor)).toHaveLength(0)
  })

  it('a collision (CREATE fails) never triggers a DROP', async () => {
    const executor = new RecordingExecutor(/^CREATE DATABASE/)

    await expect(createScratchDatabaseUsing(executor, 'lifecycle')).rejects.toThrow(
      /Failed to create scratch database/,
    )

    expect(createCalls(executor)).toHaveLength(1)
    expect(dropCalls(executor)).toHaveLength(0)
  })

  it('a failed CREATE returns no handle — there is nothing to call cleanup() on', async () => {
    const executor = new RecordingExecutor(/^CREATE DATABASE/)
    let handle: Awaited<ReturnType<typeof createScratchDatabaseUsing>> | undefined

    try {
      handle = await createScratchDatabaseUsing(executor, 'lifecycle')
    } catch {
      // expected — handle stays undefined
    }

    expect(handle).toBeUndefined()
    // Nothing reachable could have called cleanup(), so nothing dropped —
    // this is the same invariant as the previous test, from the caller's
    // side rather than the executor's.
    expect(dropCalls(executor)).toHaveLength(0)
  })

  it('cleanup() drops exactly the database this call created, and only once', async () => {
    const createExecutor = new RecordingExecutor()
    const handle = await createScratchDatabaseUsing(createExecutor, 'lifecycle')

    const cleanupExecutor = new RecordingExecutor()

    await handle.cleanup(cleanupExecutor)
    await handle.cleanup(cleanupExecutor) // second call — must be a no-op, not a second DROP

    expect(dropCalls(cleanupExecutor)).toEqual([
      `DROP DATABASE IF EXISTS "${handle.target.database}" WITH (FORCE)`,
    ])
  })

  it('two separate runs with the SAME key get two DIFFERENT database names', async () => {
    const first = await createScratchDatabaseUsing(new RecordingExecutor(), 'samekey')
    const second = await createScratchDatabaseUsing(new RecordingExecutor(), 'samekey')

    expect(first.target.database).not.toBe(second.target.database)
  })

  it('an explicit runId still goes through the same create/no-drop lifecycle', async () => {
    const executor = new RecordingExecutor()

    const handle = await createScratchDatabaseUsing(executor, 'lifecycle', 'fixedrunid1')

    expect(handle.target.database).toBe(scratchDatabaseName('lifecycle', 'fixedrunid1'))
    expect(createCalls(executor)).toEqual([`CREATE DATABASE "${handle.target.database}"`])
  })
})

describe('scratchDatabaseName', () => {
  it('combines key and runId into one name — same inputs, same name', () => {
    expect(scratchDatabaseName('backfill', 'abc123')).toBe(
      scratchDatabaseName('backfill', 'abc123'),
    )
  })

  it('different keys with the same runId still produce different names', () => {
    expect(scratchDatabaseName('backfill', 'abc123')).not.toBe(
      scratchDatabaseName('rollback', 'abc123'),
    )
  })

  it('different runIds with the same key still produce different names', () => {
    expect(scratchDatabaseName('backfill', 'abc123')).not.toBe(
      scratchDatabaseName('backfill', 'def456'),
    )
  })

  it('rejects a key with characters outside [a-z0-9_]', () => {
    expect(() => scratchDatabaseName('Bad-Key', 'abc123')).toThrow(/must match/)
  })

  it('rejects a runId with characters outside [a-z0-9]', () => {
    expect(() => scratchDatabaseName('backfill', 'Bad_Run')).toThrow(/must match/)
  })
})
