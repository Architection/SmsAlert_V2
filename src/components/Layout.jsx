import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth-context.js'
import { useInstallPrompt } from '../lib/use-install-prompt.js'

const links = [
  { to: '/', label: 'Ordre', end: true },
  { to: '/historik', label: 'Historik' },
  { to: '/kampagne', label: 'Kampagne' },
  { to: '/indstillinger', label: 'Indstillinger' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { canInstall, promptInstall } = useInstallPrompt()

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
        <div className="topbar-user">
          {canInstall && (
            <button
              type="button"
              className="btn btn-primary btn-sm install-btn"
              onClick={promptInstall}
            >
              ⬇ Installer app
            </button>
          )}
          {user && <span className="user-email">{user.email}</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Log ud
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
