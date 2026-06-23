import { useCallback, useEffect, useState } from 'react'

// Er appen allerede åbnet som installeret PWA?
function isInstalled() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true
  )
}

// Eksponerer browserens install-prompt til React. Selve `beforeinstallprompt`
// fanges globalt i index.html (så den ikke går tabt på login-skærmen) og
// gemmes på window.__deferredInstallPrompt. Knappen der bruger denne hook
// lever inde i det beskyttede layout, så install først tilbydes efter login.
export function useInstallPrompt() {
  const [available, setAvailable] = useState(() => !!window.__deferredInstallPrompt)
  const [installed, setInstalled] = useState(isInstalled)

  useEffect(() => {
    const onAvailable = () => setAvailable(!!window.__deferredInstallPrompt)
    const onInstalled = () => {
      setInstalled(true)
      setAvailable(false)
    }
    window.addEventListener('pwa-installable', onAvailable)
    window.addEventListener('pwa-installed', onInstalled)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('pwa-installable', onAvailable)
      window.removeEventListener('pwa-installed', onInstalled)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    const e = window.__deferredInstallPrompt
    if (!e) return
    e.prompt()
    try {
      await e.userChoice
    } finally {
      window.__deferredInstallPrompt = null
      setAvailable(false)
    }
  }, [])

  return { canInstall: available && !installed, installed, promptInstall }
}
