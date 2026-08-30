import { z } from 'zod'
import { apiRequest, apiRequestWithRedirect } from './api'

/**
 * §6.3 віддає 301 на змержений `Work`, і `fetch` іде за ним сам. Єдиний слід,
 * що перехід стався, — прапорець `redirected` на відповіді; без нього сторінка
 * показала б канонічні дані під старою адресою (DoD 7h).
 */
describe('apiRequestWithRedirect', () => {
  const schema = z.object({ id: z.string() })

  function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): jest.Mock {
    const mock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      redirected: false,
      json: () => Promise.resolve({ id: 'work-new' }),
      ...response,
    })

    global.fetch = mock

    return mock
  }

  it('позначає відповідь, що приїхала через редирект', async () => {
    stubFetch({ redirected: true })

    await expect(apiRequestWithRedirect('/works/work-old', { schema })).resolves.toEqual({
      data: { id: 'work-new' },
      redirected: true,
    })
  })

  it('звичайна відповідь редиректом не позначається', async () => {
    stubFetch({ redirected: false })

    await expect(apiRequestWithRedirect('/works/work-new', { schema })).resolves.toEqual({
      data: { id: 'work-new' },
      redirected: false,
    })
  })

  it('204 не має тіла, але ознака переміщення лишається читабельною', async () => {
    stubFetch({ status: 204, redirected: true })

    await expect(apiRequestWithRedirect('/me/wishlist/work-old')).resolves.toEqual({
      data: undefined,
      redirected: true,
    })
  })

  it('apiRequest віддає саме тіло — решті викликів прапорець не потрібен', async () => {
    stubFetch({ redirected: true })

    await expect(apiRequest('/works/work-old', { schema })).resolves.toEqual({ id: 'work-new' })
  })
})
