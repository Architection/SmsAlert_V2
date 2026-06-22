import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../lib/auth-context.js'

export default function Register() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Adgangskoderne er ikke ens')
      return
    }
    if (password.length < 6) {
      setError('Adgangskoden skal være mindst 6 tegn')
      return
    }
    setBusy(true)
    try {
      const { user: newUser } = await api.auth.signup(email, password)
      setCreated(newUser?.email || email)
      setEmail('')
      setPassword('')
      setConfirm('')
    } catch (e2) {
      setError(e2.message)
    } finally {
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

        {created ? (
          <div className="card">
            <h1 className="card-title">✓ Bruger oprettet</h1>
            <p className="muted" style={{ margin: '0 0 1.25rem' }}>
              Kontoen <strong>{created}</strong> er klar til brug.
            </p>
            {user ? (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => setCreated(null)}
              >
                Opret endnu en bruger
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => navigate('/login', { replace: true })}
              >
                Gå til login
              </button>
            )}
          </div>
        ) : (
          <form className="card" onSubmit={submit}>
            <h1 className="card-title">{user ? 'Opret ny bruger' : 'Opret bruger'}</h1>

            <label className="field">
              <span>E-mail</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </label>

            <label className="field" style={{ marginTop: '1.1rem' }}>
              <span>Adgangskode (min. 6 tegn)</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            <label className="field" style={{ marginTop: '1.1rem' }}>
              <span>Gentag adgangskode</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>

            {error && <p className="error-banner">⚠️ {error}</p>}

            <button type="submit" className="btn btn-primary btn-lg" disabled={busy} style={{ marginTop: '1.25rem' }}>
              {busy ? 'Opretter…' : 'Opret bruger'}
            </button>
          </form>
        )}

        {!user && !created && (
          <p className="auth-alt">
            Har du allerede en konto? <Link to="/login">Log ind</Link>
          </p>
        )}
      </div>
    </div>
  )
}
