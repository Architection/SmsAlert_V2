import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth-context.js'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import ActiveOrders from './pages/ActiveOrders.jsx'
import History from './pages/History.jsx'
import OrderDetail from './pages/OrderDetail.jsx'
import Settings from './pages/Settings.jsx'

function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="auth-loading">Indlæser…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/opret-bruger" element={<Register />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<ActiveOrders />} />
          <Route path="/historik" element={<History />} />
          <Route path="/ordre/:id" element={<OrderDetail />} />
          <Route path="/indstillinger" element={<Settings />} />
          <Route path="*" element={<ActiveOrders />} />
        </Route>
      </Route>
    </Routes>
  )
}
