import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { FunnelReportService } from '../analytics/funnel-report.service'
import { parseFunnelReportArguments } from '../analytics/funnel-report.arguments'
import {
  formatFunnelReportJson,
  formatFunnelReportText,
} from '../analytics/funnel-report.presenter'
import { AnalyticsCliModule } from './analytics-cli.module'

const USAGE =
  'Usage: funnel-report --from YYYY-MM-DD --to YYYY-MM-DD --window-days <positive integer> [--json]'

function out(value: string): void {
  process.stdout.write(`${value}\n`)
}

function fail(value: string): void {
  process.stderr.write(`${value}\n`)
}

async function main(): Promise<void> {
  const parsed = parseFunnelReportArguments(process.argv.slice(2))

  if (!parsed.ok) {
    fail(parsed.error)
    fail(USAGE)
    process.exitCode = 2

    return
  }

  const app = await NestFactory.createApplicationContext(AnalyticsCliModule, { logger: false })

  try {
    const report = await app.get(FunnelReportService).generate(parsed.value)

    out(parsed.value.json ? formatFunnelReportJson(report) : formatFunnelReportText(report))
  } catch (error) {
    process.exitCode = 1
    fail('The funnel report could not be generated.')
    fail(error instanceof Error ? error.message : String(error))
  } finally {
    await app.close()
  }
}

void main()
