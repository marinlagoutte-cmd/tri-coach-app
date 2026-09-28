// components/ProfileIdentityCard.js — en tête de l'onglet Profil : photo, prénom, gestion de
// la photo (téléphone, Strava, retrait).
import { useRef, useState } from 'react';
import ProfileAvatar from './ProfileAvatar';
import { resizePhoto } from '../lib/avatar';

export default function ProfileIdentityCard({ profile, email, stravaPhotoUrl, onPhotoChange, onOpenSettings }) {
  const fileRef = useRef(null);
  const [error, setError] = useState('');
  const name = profile?.firstName || email || '';

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      onPhotoChange(await resizePhoto(file), 'upload');
    } catch (err) {
      setError(err.message || 'Photo impossible à lire.');
    }
  };

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3.5 flex items-center gap-3.5">
      <button type="button" onClick={() => fileRef.current?.click()} aria-label="Changer la photo de profil" className="shrink-0">
        <ProfileAvatar photo={profile?.photo} name={name} size={64} />
      </button>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-base font-black text-ink-50 truncate">{profile?.firstName || 'Mon profil'}</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => fileRef.current?.click()} className="min-h-[34px] px-2.5 rounded-lg border border-ink-700 text-xs font-bold text-ink-200">
            {profile?.photo ? 'Changer la photo' : 'Ajouter une photo'}
          </button>
          {stravaPhotoUrl && profile?.photo !== stravaPhotoUrl && (
            <button type="button" onClick={() => onPhotoChange(stravaPhotoUrl, 'strava')} className="min-h-[34px] px-2.5 rounded-lg border border-orange-600/60 text-xs font-bold text-orange-500">
              Photo Strava
            </button>
          )}
          {profile?.photo && (
            <button type="button" onClick={() => onPhotoChange(null, 'none')} className="min-h-[34px] px-2.5 rounded-lg border border-ink-800 text-xs font-bold text-ink-400">
              Retirer
            </button>
          )}
          <button type="button" onClick={onOpenSettings} className="min-h-[34px] px-2.5 rounded-lg border border-ink-800 text-xs font-bold text-ink-400">
            Réglages
          </button>
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={pick} className="hidden" aria-hidden="true" tabIndex={-1} />
    </div>
  );
}
