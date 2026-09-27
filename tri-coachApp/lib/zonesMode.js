// lib/zonesMode.js
//
// Réglage global (Réglages > Zones d'entraînement) qui détermine comment les zones
// FC/Puissance/Allure (onglet Profil > ZoneCharts.js) sont calculées :
//   - 'manual' (défaut — comportement historique) : bornes saisies/éditées à la main,
//     initialisées depuis FC max/FTP/VMA du profil (voir lib/zones.js:defaultHrZones/
//     defaultPowerZones/defaultPaceZones), puis 100% indépendantes une fois éditées.
//   - 'auto' : bornes recalculées en continu depuis les VRAIES séances Strava
//     synchronisées (protocole "test de 20 minutes", voir lib/zones.js:
//     estimateZonesFromActivities) — jamais éditables tant que ce mode est actif.
//
// Même pattern que lib/theme.js (Context React + localStorage) : un seul réglage,
// lu et modifié depuis deux endroits différents (SettingsModal.js pour le choix,
// ZoneCharts.js pour le comportement), donc un contexte partagé évite le prop-drilling
// entre ces deux composants qui n'ont pas de lien parent/enfant direct.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from './storage';

const ZonesModeContext = createContext({ zonesMode: 'manual', setZonesMode: () => {} });

export function ZonesModeProvider({ children }) {
  const [zonesMode, setZonesModeState] = useState('manual');

  useEffect(() => {
    const stored = loadFromStorage(STORAGE_KEYS.zonesMode, 'manual');
    setZonesModeState(stored === 'auto' ? 'auto' : 'manual');
  }, []);

  const setZonesMode = useCallback((next) => {
    if (next !== 'auto' && next !== 'manual') return;
    setZonesModeState(next);
    saveToStorage(STORAGE_KEYS.zonesMode, next);
  }, []);

  const value = useMemo(() => ({ zonesMode, setZonesMode }), [zonesMode, setZonesMode]);

  return React.createElement(ZonesModeContext.Provider, { value }, children);
}

export function useZonesMode() {
  return useContext(ZonesModeContext);
}
