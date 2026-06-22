import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import ActiveOrders from './pages/ActiveOrders.jsx'
import History from './pages/History.jsx'
import OrderDetail from './pages/OrderDetail.jsx'
import Settings from './pages/Settings.jsx'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ActiveOrders />} />
        <Route path="/historik" element={<History />} />
        <Route path="/ordre/:id" element={<OrderDetail />} />
        <Route path="/indstillinger" element={<Settings />} />
        <Route path="*" element={<ActiveOrders />} />
      </Routes>
    </Layout>
  )
}
