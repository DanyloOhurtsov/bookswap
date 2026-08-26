import React, { ReactNode } from 'react'

interface SectionProps {
  title: string
  count?: number
  children: ReactNode
}

const Section: React.FC<SectionProps> = ({ title, count, children }) => {
  return (
    <section className="friends-section">
      <h2>
        {title}
        {count !== undefined && count > 0 && <span className="badge">{count}</span>}
      </h2>
      {children}
    </section>
  )
}

export default Section