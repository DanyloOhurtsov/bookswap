import { parseArgs } from 'node:util'
import { z } from 'zod'
import type { FunnelReportQuery } from './funnel-report'

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

const isoDaySchema = z
  .string()
  .regex(ISO_DAY_PATTERN, 'dates must use YYYY-MM-DD')
  .refine(
    (day) => {
      const timestamp = Date.parse(`${day}T00:00:00.000Z`)

      return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day
    },
    { message: 'date must exist in the Gregorian calendar' },
  )

const argumentsSchema = z
  .strictObject({
    from: isoDaySchema,
    to: isoDaySchema,
    windowDays: z
      .string()
      .regex(/^[1-9]\d*$/, 'window-days must be a positive integer')
      .transform(Number)
      .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
    json: z.boolean(),
  })
  .refine((value) => value.from <= value.to, {
    message: '--from must not be later than --to',
    path: ['from'],
  })

export interface FunnelReportArguments extends FunnelReportQuery {
  json: boolean
}

export type FunnelArgumentResult =
  { ok: true; value: FunnelReportArguments } | { ok: false; error: string }

function startOfDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

export function parseFunnelReportArguments(args: string[]): FunnelArgumentResult {
  let values: { from?: string; to?: string; 'window-days'?: string; json?: boolean }

  try {
    ;({ values } = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        from: { type: 'string' },
        to: { type: 'string' },
        'window-days': { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    }))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const parsed = argumentsSchema.safeParse({
    from: values.from,
    to: values.to,
    windowDays: values['window-days'],
    json: values.json,
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid arguments' }
  }

  const from = startOfDay(parsed.data.from)
  const to = startOfDay(parsed.data.to)

  return {
    ok: true,
    value: {
      fromDay: parsed.data.from,
      toDay: parsed.data.to,
      from,
      toExclusive: new Date(to.getTime() + DAY_MS),
      windowDays: parsed.data.windowDays,
      json: parsed.data.json,
    },
  }
}
