import Link from 'next/link'

export const NavBarLogo = () => {
  return (
    <Link
      href="/"
      className="group inline-flex shrink-0 items-center gap-2 text-(--fg) no-underline"
      aria-label="BookSwap — на головну"
    >
      <svg
        viewBox="0 0 40 40"
        className="size-9 text-(--bookswap-accent) transition-transform group-hover:-rotate-2"
        aria-hidden="true"
      >
        <rect x="1" y="1" width="38" height="38" rx="11" fill="currentColor" />

        <path
          d="M7.5 10.8c4.7-1.3 8.5-.4 11.5 2.2v16.2c-3-2.6-6.8-3.5-11.5-2.2V10.8Z"
          fill="var(--bg)"
        />
        <path
          d="M32.5 10.8c-4.7-1.3-8.5-.4-11.5 2.2v16.2c3-2.6 6.8-3.5 11.5-2.2V10.8Z"
          fill="var(--bg)"
        />

        <path
          d="M12 17h14m0 0-3-2.6m3 2.6-3 2.6M28 23H14m0 0 3-2.6M14 23l3 2.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <span className="hidden items-baseline text-lg font-bold tracking-tight sm:inline-flex">
        <span>Book</span>
        <span className="text-(--bookswap-accent)">Swap</span>
      </span>
    </Link>
  )
}
