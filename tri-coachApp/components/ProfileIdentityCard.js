// components/ProfileIdentityCard.js — en tête de l'onglet Profil : photo, prénom, et accès aux
// notifications et aux réglages (retirés de l'en-tête à la demande de l'athlète). La gestion
// de la photo se fait dans les réglages.
import ProfileAvatar from './ProfileAvatar';

export default function ProfileIdentityCard({ profile, email, notifications = null, onOpenSettings }) {
  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 flex items-center gap-3">
      <ProfileAvatar photo={profile?.photo} name={profile?.firstName || email || ''} size={48} />
      <p className="flex-1 min-w-0 text-sm font-black text-ink-50 truncate">{profile?.firstName || 'Mon profil'}</p>
      {notifications}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Réglages"
        title="Réglages"
        className="w-[36px] h-[36px] rounded-xl bg-ink-950 border border-ink-800 flex items-center justify-center text-sm shrink-0"
      >
        ⚙️
      </button>
    </div>
  );
}
