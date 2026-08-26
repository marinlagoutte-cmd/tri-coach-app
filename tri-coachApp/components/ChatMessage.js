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

export default function ChatMessage({ text, sender }) {
  const lines = String(text || '').split('\n');
  return (
    <div className={`flex ${sender === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl p-3.5 text-xs leading-relaxed ${
          sender === 'user'
            ? 'bg-volt-500 text-white font-medium rounded-br-none shadow-md'
            : 'bg-ink-900 border border-ink-800 text-ink-200 rounded-bl-none shadow-sm'
        }`}
      >
        {lines.map((line, idx) => (
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
        ))}
      </div>
    </div>
  );
}
