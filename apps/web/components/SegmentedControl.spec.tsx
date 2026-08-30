/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { SegmentedControl } from './SegmentedControl'

it('exposes a single-choice group and reports the selected value', async () => {
  const onValueChange = jest.fn()

  render(
    <SegmentedControl
      label="Вигляд"
      value="all"
      options={[
        { value: 'all', label: 'Усі' },
        { value: 'unread', label: 'Непрочитані' },
      ]}
      onValueChange={onValueChange}
    />,
  )

  expect(screen.getByRole('group', { name: 'Вигляд' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Усі' })).toHaveAttribute('aria-pressed', 'true')

  await userEvent.click(screen.getByRole('button', { name: 'Непрочитані' }))

  expect(onValueChange).toHaveBeenCalledWith('unread')
})
