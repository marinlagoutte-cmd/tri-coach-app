// lib/intervalParser.js
//
// Convertit la notation compacte du "corps de séance" (champ desc, cf.
// lib/gemini.js) en une liste de blocs effort/récupération exploitable par
// le composant IntervalBars. Deux formats réels à supporter :
//
//   Course/vélo (bloc entre parenthèses) :
//     "4*(3' @85% VMA - 1' @95% VMA - 2' souple)"
//     "6*(5' @90% FTP R : 3' souple)"
//
//   Natation (notation plate, parfois avec un bloc imbriqué) :
//     "6*100 R : 15''"
//     "2*(200 all HALF R : 30'' / 4*50 PULL R : 15'')"
//
// On ne cherche que le PREMIER motif "N*(...)" ou "N*Dm ... R : xx" trouvé
// dans le texte : c'est celui du corps de séance principal, l'échauffement
// et le retour au calme restant en texte libre au-dessus/en dessous.

function isRecoverySegment(seg) {
  return /récup|recup|souple|repos|^r\s*:/i.test(seg.trim());
}

export function parseIntervalStructure(text) {
  if (!text || typeof text !== 'string') return null;

  // Forme "N*(segment - segment - ...)" — course, vélo, et natation à bloc unique.
  const parenMatch = text.match(/(\d+)\s*[x×*]\s*\(([^()]+)\)/i);
  if (parenMatch) {
    const reps = parseInt(parenMatch[1], 10);
    const segments = parenMatch[2]
      .split(/\s*[-/]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (reps > 0 && reps <= 60 && segments.length) {
      const blocks = [];
      for (let i = 0; i < reps; i++) {
        segments.forEach((seg) => {
          blocks.push({ label: seg, isRecovery: isRecoverySegment(seg) });
        });
      }
      return { reps, blocks };
    }
  }

  // Forme plate natation : "N*100 R : 15''" ou "N*50 all HALF R : 20''"
  const flatMatch = text.match(/(\d+)\s*[x×*]\s*(\d+\s*m?)\s*([^R\n]*?)\s*R\s*:\s*([\d'"\s]+)/i);
  if (flatMatch) {
    const reps = parseInt(flatMatch[1], 10);
    const effortLabel = `${flatMatch[2]}${flatMatch[3]?.trim() ? ' ' + flatMatch[3].trim() : ''}`.trim();
    const recupLabel = `R : ${flatMatch[4].trim()}`;
    if (reps > 0 && reps <= 60) {
      const blocks = [];
      for (let i = 0; i < reps; i++) {
        blocks.push({ label: effortLabel, isRecovery: false });
        blocks.push({ label: recupLabel, isRecovery: true });
      }
      return { reps, blocks };
    }
  }

  return null;
}
