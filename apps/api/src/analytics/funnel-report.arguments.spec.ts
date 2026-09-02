import { parseFunnelReportArguments } from './funnel-report.arguments'

describe('funnel report arguments', () => {
  it('parses the required range, conversion window, and JSON flag', () => {
    const result = parseFunnelReportArguments([
      '--from',
      '2026-08-17',
      '--to',
      '2026-08-23',
      '--window-days',
      '60',
      '--json',
    ])

    expect(result).toEqual({
      ok: true,
      value: {
        fromDay: '2026-08-17',
        toDay: '2026-08-23',
        from: new Date('2026-08-17T00:00:00.000Z'),
        toExclusive: new Date('2026-08-24T00:00:00.000Z'),
        windowDays: 60,
        json: true,
      },
    })
  })

  it.each([
    { name: 'missing required option', args: ['--from', '2026-08-17'] },
    {
      name: 'invalid calendar date',
      args: ['--from', '2026-02-30', '--to', '2026-08-23', '--window-days', '60'],
    },
    {
      name: 'reversed range',
      args: ['--from', '2026-08-24', '--to', '2026-08-23', '--window-days', '60'],
    },
    {
      name: 'zero window',
      args: ['--from', '2026-08-17', '--to', '2026-08-23', '--window-days', '0'],
    },
    {
      name: 'unknown option',
      args: ['--from', '2026-08-17', '--to', '2026-08-23', '--window-days', '60', '--other'],
    },
  ])('rejects $name', ({ args }) => {
    expect(parseFunnelReportArguments(args).ok).toBe(false)
  })
})
