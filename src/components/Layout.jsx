import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Aktive ordrer', end: true },
  { to: '/historik', label: 'Historik' },
  { to: '/indstillinger', label: 'Indstillinger' },
]

export default function Layout({ children }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          SMS&nbsp;Alert
        </div>
        <nav className="nav">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="content">{children}</main>
    </div>
  )
}
