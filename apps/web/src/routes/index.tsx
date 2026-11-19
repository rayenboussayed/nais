import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useLanguages } from '../lib/languages';
import { translateText } from '../lib/translate-socket';
import { Route as rootRoute } from './__root';

export const Route = createRoute({
  component: Playground,
  getParentRoute: () => rootRoute,
  path: '/',
});

interface HistoryItem {
  at: number;
  cached: boolean;
  id: string;
  source: string;
  targetLanguage: string;
  translation: string;
}

/**
 * Playground page: live translate form against the REST API.
 * @returns the rendered playground
 */
export function Playground() {
  const { data: languages, isLoading } = useLanguages();
  const [text, setText] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | string>(null);
  const [resultCached, setResultCached] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const selected = languages?.find((language) => language.iso6391 === targetLanguage);
  const targetDir = selected?.dir ?? 'ltr';

  /**
   * Submits the form and renders the translation.
   */
  function run() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);

    translateText(trimmed, targetLanguage, {
      onDone: ({ cached, text: translated }) => {
        setResult(translated);
        setResultCached(cached);
        setBusy(false);
        setHistory((items) =>
          [
            {
              at: Date.now(),
              cached,
              id: crypto.randomUUID(),
              source: trimmed,
              targetLanguage,
              translation: translated,
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

  /**
   * Copies the translation to the clipboard.
   */
  async function copy() {
    if (!result) return;
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- browser global, not Node's experimental navigator
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
            disabled={isLoading}
            id="target"
            onChange={(event) => setTargetLanguage(event.target.value)}
            style={{ width: 'auto' }}
            value={targetLanguage}
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
        <section aria-label="Source text" className="panel stack">
          <label htmlFor="source">Source text</label>
          <textarea
            id="source"
            onChange={(event) => setText(event.target.value)}
            placeholder="Type or paste the text to translate…"
            rows={12}
            value={text}
          />
          <button className="button" disabled={busy || !text.trim()} onClick={run} type="button">
            {busy ? 'Translating…' : 'Translate'}
          </button>
        </section>

        <section aria-label="Translation" className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">Translation</span>
            {result !== null && (
              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${resultCached ? 'badge-ok' : ''}`}>
                  {resultCached ? 'cached' : 'model'}
                </span>
                <button className="button button-ghost button-small" onClick={copy} type="button">
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
          <div aria-live="polite" className="result-area" dir={targetDir}>
            {busy && <span className="muted">Translating…</span>}
            {!busy && result === null && (
              <span className="muted">The translation will appear here.</span>
            )}
            {!busy && result !== null && result}
          </div>
        </section>
      </div>

      <section aria-label="History" className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1rem', margin: 0 }}>Session history</h2>
          <button
            className="button button-ghost button-small"
            onClick={() => setHistory([])}
            type="button"
          >
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
                className="history-item"
                key={item.id}
                onClick={() => {
                  setText(item.source);
                  setTargetLanguage(item.targetLanguage);
                  setResult(item.translation);
                  setResultCached(item.cached);
                }}
                type="button"
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
