import { useState } from 'react';
import { createRoute } from '@tanstack/react-router';

import { Route as rootRoute } from './__root';
import { translateText } from '../lib/translate-socket';
import { useLanguages } from '../lib/languages';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Playground,
});

interface HistoryItem {
  id: string;
  source: string;
  targetLanguage: string;
  translation: string;
  cached: boolean;
  at: number;
}

export function Playground() {
  const { data: languages, isLoading } = useLanguages();
  const [text, setText] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultCached, setResultCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const selected = languages?.find((language) => language.iso6391 === targetLanguage);
  const targetDir = selected?.dir ?? 'ltr';

  function run() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);

    translateText(trimmed, targetLanguage, {
      onDone: ({ text: translated, cached }) => {
        setResult(translated);
        setResultCached(cached);
        setBusy(false);
        setHistory((items) =>
          [
            {
              id: crypto.randomUUID(),
              source: trimmed,
              targetLanguage,
              translation: translated,
              cached,
              at: Date.now(),
            },
            ...items,
          ].slice(0, 50),
        );
      },
      onError: (message) => {
        setError(message);
        setBusy(false);
      },
    });
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Playground</h1>
        <div className="row">
          <label htmlFor="target" style={{ margin: 0 }}>
            Translate into
          </label>
          <select
            id="target"
            value={targetLanguage}
            onChange={(event) => setTargetLanguage(event.target.value)}
            disabled={isLoading}
            style={{ width: 'auto' }}
          >
            {(languages ?? []).map((language) => (
              <option key={language.id} value={language.iso6391}>
                {language.nativeName} ({language.iso6391})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="translate-grid">
        <section className="panel stack" aria-label="Source text">
          <label htmlFor="source">Source text</label>
          <textarea
            id="source"
            rows={12}
            placeholder="Type or paste the text to translate…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="button" className="button" onClick={run} disabled={busy || !text.trim()}>
            {busy ? 'Translating…' : 'Translate'}
          </button>
        </section>

        <section className="panel stack" aria-label="Translation">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Translation</span>
            {result !== null && (
              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${resultCached ? 'badge-ok' : ''}`}>
                  {resultCached ? 'cached' : 'model'}
                </span>
                <button type="button" className="button button-ghost button-small" onClick={copy}>
                  Copy
                </button>
              </div>
            )}
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <div className="result-area" dir={targetDir} aria-live="polite">
            {busy && <span className="muted">Translating…</span>}
            {!busy && result === null && <span className="muted">The translation will appear here.</span>}
            {!busy && result !== null && result}
          </div>
        </section>
      </div>

      <section className="panel stack" aria-label="History">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Session history</h2>
          <button type="button" className="button button-ghost button-small" onClick={() => setHistory([])}>
            Clear
          </button>
        </div>
        {history.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing yet. Translations you run in this session appear here.
          </p>
        ) : (
          <div className="history-list">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                className="history-item"
                onClick={() => {
                  setText(item.source);
                  setTargetLanguage(item.targetLanguage);
                  setResult(item.translation);
                  setResultCached(item.cached);
                }}
              >
                <small>
                  {item.targetLanguage} · {item.cached ? 'cached' : 'model'} ·{' '}
                  {new Date(item.at).toLocaleTimeString()}
                </small>
                {item.source.slice(0, 80)}
                {item.source.length > 80 ? '…' : ''}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
