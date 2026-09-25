import { createContext, useCallback, useContext, useEffect, useState } from 'react'

// Preference is 'system' | 'light' | 'dark', persisted per browser.
// index.html applies it before first paint to avoid a flash.
const KEY = 'cf:theme'
const ThemeContext = createContext(null)

const media = () => window.matchMedia('(prefers-color-scheme: dark)')
const resolve = (pref) => (pref === 'system' ? (media().matches ? 'dark' : 'light') : pref)

function read() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPref] = useState(read)
  const [theme, setTheme] = useState(() => resolve(read()))

  useEffect(() => {
    const apply = () => {
      const t = resolve(preference)
      setTheme(t)
      document.documentElement.dataset.theme = t
      document.documentElement.style.colorScheme = t
    }
    apply()
    if (preference !== 'system') return
    const mq = media()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [preference])

  const setPreference = useCallback((p) => {
    setPref(p)
    try {
      if (p === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, p)
    } catch {
      /* storage blocked: preference lasts for this tab */
    }
  }, [])

  return <ThemeContext.Provider value={{ preference, theme, setPreference }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
