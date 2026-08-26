import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { THEME_INITIALIZER_SCRIPT } from '@/app/lib/theme'
import { NavBar } from '@/components/NavBar/NavBar'

export const metadata: Metadata = {
  title: 'BookSwap',
  description: 'Сервіс обміну фізичними книжками',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INITIALIZER_SCRIPT }} />
      </head>
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  )
}
