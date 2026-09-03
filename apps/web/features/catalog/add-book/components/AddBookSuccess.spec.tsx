/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { AddBookSuccess } from './AddBookSuccess'

it('offers all three post-success actions', async () => {
  const user = userEvent.setup()
  const onRepeatEdition = jest.fn()
  const onAddNext = jest.fn()
  const onScanNext = jest.fn()

  render(
    <AddBookSuccess
      title="Кобзар"
      workId="work-1"
      onRepeatEdition={onRepeatEdition}
      onAddNext={onAddNext}
      onScanNext={onScanNext}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Ще один такий примірник' }))
  await user.click(screen.getByRole('button', { name: 'Додати наступну книгу' }))
  await user.click(screen.getByRole('button', { name: 'Сканувати наступну' }))

  expect(onRepeatEdition).toHaveBeenCalledTimes(1)
  expect(onAddNext).toHaveBeenCalledTimes(1)
  expect(onScanNext).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('link', { name: 'До бібліотеки' })).toHaveAttribute('href', '/library')
  expect(screen.getByRole('link', { name: 'Сторінка твору' })).toHaveAttribute(
    'href',
    '/works/work-1',
  )
})
