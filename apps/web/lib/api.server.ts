import 'server-only'

import { SESSION_COOKIE_NAME } from '@bookswap/shared'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ZodType } from 'zod'
import { ApiRequestError, apiRequest } from '@/app/lib/api'

async function sessionHeaders(): Promise<Record<string, string>> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value

  return token === undefined ? {} : { Cookie: `${SESSION_COOKIE_NAME}=${token}` }
}

async function fetchAuthenticated<T>(path: string, schema: ZodType<T>): Promise<T> {
  try {
    return await apiRequest(path, { schema, headers: await sessionHeaders() })
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) redirect('/login')

    throw error
  }
}

export { fetchAuthenticated }
