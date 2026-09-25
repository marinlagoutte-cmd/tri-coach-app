// lib/theme.js
//
// Mode sombre : ne fait qu'ajouter/retirer la classe .dark sur <html> — TOUTE la
// palette de couleurs bascule alors automatiquement via les variables CSS définies
// dans styles/globals.css (voir tailwind.config.js). Aucun composant n'a besoin
// d'être modifié pour supporter le mode sombre.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from './storage';

const ThemeContext = createContext({ theme: 'dark', setTheme: () => {}, toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('dark');

  useEffect(() => {
    const stored = loadFromStorage(STORAGE_KEYS.theme, null);
    // Par défaut : respecte la préférence système si rien n'a encore été choisi.
    const initial = stored === 'light' || stored === 'dark'
      ? stored
      : (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    setThemeState(initial);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (next !== 'light' && next !== 'dark') return;
    setThemeState(next);
    saveToStorage(STORAGE_KEYS.theme, next);
  }, []);

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}
