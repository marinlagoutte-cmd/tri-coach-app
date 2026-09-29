// components/ProfileAvatar.js — photo de profil (ou initiales). Utilisée dans l'en-tête, où un
// appui ouvre directement le Profil (demande de l'athlète : le Profil n'est plus dans la barre
// du bas), et en grand dans la carte d'identité du Profil.
import { useState } from 'react';
import { initialsOf } from '../lib/avatar';

export default function ProfileAvatar({ photo, name, size = 40, syncing = false, className = '' }) {
  const [broken, setBroken] = useState(false);
  const initials = initialsOf(name);
  return (
    <span className={`relative inline-flex items-center justify-center rounded-full overflow-hidden bg-gradient-to-tr from-volt-700 to-volt-600 text-white font-black shrink-0 ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {photo && !broken ? (
        <img src={photo} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        initials || <span aria-hidden="true">👤</span>
      )}
      {syncing && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-sky-400 border-2 border-ink-900 animate-pulse" aria-hidden="true" />}
    </span>
  );
}
