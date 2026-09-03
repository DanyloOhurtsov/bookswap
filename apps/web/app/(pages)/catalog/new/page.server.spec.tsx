/** @jest-environment jsdom */

import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import NewBookPage from './page'

jest.mock('@/features/catalog/add-book/index.client', () => ({
  AddBookWizard: () => <p>Client wizard boundary</p>,
}))

it('keeps the route server-only, thin, and composed through the client entry', () => {
  const source = readFileSync(__filename.replace('page.server.spec.tsx', 'page.tsx'), 'utf8')

  expect(source).not.toContain("'use client'")
  expect(source.split('\n').length).toBeLessThanOrEqual(50)

  render(<NewBookPage />)
  expect(screen.getByText('Client wizard boundary')).toBeInTheDocument()
})
