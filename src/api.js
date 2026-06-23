async function req(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin', // send/modtag session-cookies
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(data?.error || `Fejl (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  auth: {
    me: () => req('/api/auth?action=me'),
    login: (email, password) =>
      req('/api/auth?action=login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => req('/api/auth?action=logout', { method: 'POST' }),
  },
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
  campaign: {
    summary: () => req('/api/campaign?action=summary'),
    numbers: (params = {}) => {
      const qs = new URLSearchParams({ action: 'numbers' })
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, v)
      }
      return req(`/api/campaign?${qs}`)
    },
    sync: () => req('/api/campaign', { method: 'POST' }),
  },
}
