import { useState } from 'react';

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-ink-50">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function renderLine(line, idx) {
  return (
    <p key={idx} className={idx > 0 ? 'mt-1.5' : ''}>
      {line.startsWith('- ') ? (
        <span>
          <span className="text-volt-400 mr-1">•</span>
          {renderInline(line.slice(2))}
        </span>
      ) : (
        renderInline(line)
      )}
    </p>
  );
}

// Repère le premier bloc de puces contiguës ("- ...") dans le message, pour pouvoir le
// replier par défaut. Les messages auto-générés du coach (ajustements automatiques,
// points de vigilance) empilent souvent 3+ puces techniques d'un coup — utile à garder
// pour la traçabilité, mais ça noie le fil de discussion si c'est affiché en clair à
// chaque fois. On garde donc le contexte (titre + texte avant/après) toujours visible et
// on replie uniquement la liste elle-même derrière un bouton, dès qu'elle atteint 3 puces.
function findBulletBlock(lines) {
  const start = lines.findIndex((l) => l.startsWith('- '));
  if (start === -1) return null;
  let end = start;
  while (end < lines.length && lines[end].startsWith('- ')) end += 1;
  const count = end - start;
  if (count < 3) return null;
  return { before: lines.slice(0, start), bullets: lines.slice(start, end), after: lines.slice(end) };
}

export default function ChatMessage({ text, sender, collapsedLabel = 'Voir le détail', expandedLabel = 'Masquer' }) {
  const [expanded, setExpanded] = useState(false);
  const lines = String(text || '').split('\n');
  const block = sender === 'coach' ? findBulletBlock(lines) : null;

  return (
    <div className={`flex ${sender === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl p-3.5 text-xs leading-relaxed ${
          sender === 'user'
            ? 'bg-volt-500 text-white font-medium rounded-br-none shadow-md'
            : 'bg-ink-900 border border-ink-800 text-ink-200 rounded-bl-none shadow-sm'
        }`}
      >
        {block ? (
          <>
            {block.before.map(renderLine)}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 text-[10px] font-bold text-volt-400 hover:text-volt-300 inline-flex items-center gap-1"
            >
              <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
              {expanded ? expandedLabel : `${collapsedLabel} (${block.bullets.length})`}
            </button>
            {expanded && (
              <div className="mt-1">{block.bullets.map((l, i) => renderLine(l, i))}</div>
            )}
            {block.after.filter((l) => l !== '').map((l, i) => (
              <p key={i} className="mt-1.5">
                {renderInline(l)}
              </p>
            ))}
          </>
        ) : (
          lines.map(renderLine)
        )}
      </div>
    </div>
  );
}
