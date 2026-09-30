// lib/avatar.js — photo de profil : initiales de repli et réduction d'une photo envoyée.

export function initialsOf(name) {
  const parts = String(name || '').trim().split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

/**
 * Réduit une photo choisie sur le téléphone à un carré de 256 px (recadrage centré), en JPEG
 * compressé : ~20-30 Ko, stockable dans le profil sans alourdir la synchronisation.
 */
export function resizePhoto(file, size = 256, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('Choisis une image.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
    img.src = url;
  });
}
