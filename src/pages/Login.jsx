import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context.js'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (e2) {
      setError(e2.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          SMS&nbsp;Alert
        </div>

        <form className="card" onSubmit={submit}>
          <h1 className="card-title">Log ind</h1>

          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label className="field" style={{ marginTop: '1.1rem' }}>
            <span>Adgangskode</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className="error-banner">⚠️ {error}</p>}

          <button type="submit" className="btn btn-primary btn-lg" disabled={busy} style={{ marginTop: '1.25rem' }}>
            {busy ? 'Logger ind…' : 'Log ind'}
          </button>
        </form>

        <p className="auth-alt">
          Ingen konto? <Link to="/opret-bruger">Opret bruger</Link>
        </p>
      </div>
    </div>
  )
}
