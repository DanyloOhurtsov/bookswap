import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import NavBar from './components/nav'

export const metadata: Metadata = {
  title: 'BookSwap',
  description: 'Сервіс обміну фізичними книжками',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  )
}
