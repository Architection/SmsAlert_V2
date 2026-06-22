async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `Fejl (${res.status})`)
  return data
}

export const api = {
  activeOrders: () => req('/api/orders?view=active'),
  historyOrders: () => req('/api/orders?view=history'),
  order: (id) => req(`/api/orders?id=${encodeURIComponent(id)}`),
  createOrder: (body) => req('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  updateOrder: (id, body) =>
    req(`/api/orders?id=${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteOrder: (id) =>
    req(`/api/orders?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  settings: () => req('/api/settings'),
  saveSettings: (body) => req('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  sendSms: (orderId) =>
    req('/api/send-sms', { method: 'POST', body: JSON.stringify({ orderId }) }),
}
