// components/ProfileIdentityCard.js — en tête de l'onglet Profil : photo, prénom, et accès aux
// notifications et aux réglages (retirés de l'en-tête à la demande de l'athlète). La gestion
// de la photo se fait dans les réglages.
import { Settings } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';

export default function ProfileIdentityCard({ profile, email, notifications = null, onOpenSettings }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <ProfileAvatar photo={profile?.photo} name={profile?.firstName || email || ''} size={56} />
      <p className="flex-1 min-w-0 text-lg font-bold text-ink-50 truncate">{profile?.firstName || 'Mon profil'}</p>
      {notifications}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Réglages"
        title="Réglages"
        className="w-[36px] h-[36px] rounded-full bg-ink-950 border border-ink-800 flex items-center justify-center text-ink-300 shrink-0"
      >
        <Settings size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
