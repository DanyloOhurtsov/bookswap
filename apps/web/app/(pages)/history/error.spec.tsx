/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import HistoryError from './error'

it('показує route error і справжня retry-кнопка викликає reset', async () => {
  const reset = jest.fn()

  render(<HistoryError error={new Error('Історію не вдалося завантажити')} reset={reset} />)

  expect(screen.getByRole('alert')).toHaveTextContent('Історію не вдалося завантажити')

  const retry = screen.getByRole('button', { name: 'Спробувати ще раз' })

  expect(retry.tagName).toBe('BUTTON')
  await userEvent.click(retry)
  expect(reset).toHaveBeenCalledTimes(1)
})
