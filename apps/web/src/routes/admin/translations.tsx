import { useMemo, useState, type FormEvent } from 'react';
import { createRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createTranslationSchema,
  updateTranslationBodySchema,
  type KeysetList,
  type Language,
  type Translation,
} from '@trainslator/shared';

import { Route as adminRoute } from '../admin';
import { apiFetch, ApiError, toQueryString } from '../../lib/api';
import { useLanguages } from '../../lib/languages';
import { formatTimestamp, useCursorStack } from '../../lib/admin';

export const Route = createRoute({
  getParentRoute: () => adminRoute,
  path: '/translations',
  component: TranslationsAdmin,
});

const PAGE_SIZE = 20;

type Editing = { mode: 'create' } | { mode: 'edit'; row: Translation } | null;

export function TranslationsAdmin() {
  const queryClient = useQueryClient();
  const { data: languages = [] } = useLanguages();
  const { current, canBack, next, back, reset } = useCursorStack();

  const [q, setQ] = useState('');
  const [languageId, setLanguageId] = useState<string>('');
  const [namespace, setNamespace] = useState<string>('');
  const [editing, setEditing] = useState<Editing>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState({
    languageId: '',
    namespace: 'dynamic' as 'dynamic' | 'static',
    key: '',
    text: '',
  });

  const languageName = useMemo(
    () => new Map(languages.map((language: Language) => [language.id, language.iso6391])),
    [languages],
  );

  const params = {
    pageSize: String(PAGE_SIZE),
    ...(q ? { q } : {}),
    ...(languageId ? { languageId } : {}),
    ...(namespace ? { namespace } : {}),
    ...(current ? { lastId: current.lastId, lastCreatedAt: current.lastCreatedAt } : {}),
  };

  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'translations', params],
    queryFn: () => apiFetch<KeysetList<Translation>>(`/api/translations${toQueryString(params)}`),
    placeholderData: (previous) => previous,
  });

  const rows = data?.items ?? [];

  function openCreate() {
    setDraft({
      languageId: (languages[0]?.id as string | undefined) ?? '',
      namespace: 'dynamic',
      key: '',
      text: '',
    });
    setFormError(null);
    setEditing({ mode: 'create' });
  }

  function openEdit(row: Translation) {
    setDraft({
      languageId: row.languageId,
      namespace: row.namespace,
      key: row.key,
      text: row.text,
    });
    setFormError(null);
    setEditing({ mode: 'edit', row });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editing) return;
    setBusy(true);
    setFormError(null);

    try {
      if (editing.mode === 'create') {
        const payload =
          draft.namespace === 'dynamic'
            ? { namespace: 'dynamic' as const, languageId: draft.languageId, text: draft.text }
            : {
                namespace: 'static' as const,
                languageId: draft.languageId,
                text: draft.text,
                key: draft.key,
              };
        const parsed = createTranslationSchema.safeParse(payload);
        if (!parsed.success) {
          setFormError(parsed.error.issues[0]?.message ?? 'Invalid input');
          return;
        }
        await apiFetch('/api/translations', {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        });
      } else {
        const body: Record<string, unknown> = {};
        if (draft.languageId !== editing.row.languageId) body.languageId = draft.languageId;
        if (draft.namespace !== editing.row.namespace) body.namespace = draft.namespace;
        if (draft.key !== editing.row.key) body.key = draft.key;
        if (draft.text !== editing.row.text) body.text = draft.text;

        const parsed = updateTranslationBodySchema.safeParse(body);
        if (!parsed.success) {
          setFormError(parsed.error.issues[0]?.message ?? 'Invalid input');
          return;
        }
        await apiFetch(`/api/translations/${editing.row.id}`, {
          method: 'PATCH',
          body: JSON.stringify(parsed.data),
        });
      }

      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'translations'] });
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFormError(cause.apiMessage ?? cause.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Translation) {
    if (!window.confirm(`Soft-delete "${row.text.slice(0, 60)}…"?`)) return;
    try {
      await apiFetch(`/api/translations/${row.id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'translations'] });
    } catch {
      window.alert('Could not delete the translation.');
    }
  }

  const updateFilter =
    (setter: (value: string) => void) => (event: { target: { value: string } }) => {
      reset();
      setter(event.target.value);
    };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Translations</h1>
        <div className="row">
          <input
            type="search"
            placeholder="Search key or text…"
            value={q}
            onChange={updateFilter(setQ)}
            aria-label="Search translations"
            style={{ width: 220 }}
          />
          <select
            value={languageId}
            onChange={updateFilter(setLanguageId)}
            aria-label="Filter by language"
          >
            <option value="">All languages</option>
            {languages.map((language: Language) => (
              <option key={language.id} value={language.id}>
                {language.iso6391} — {language.nativeName}
              </option>
            ))}
          </select>
          <select
            value={namespace}
            onChange={updateFilter(setNamespace)}
            aria-label="Filter by namespace"
          >
            <option value="">All namespaces</option>
            <option value="static">static</option>
            <option value="dynamic">dynamic</option>
          </select>
          <button type="button" className="button" onClick={openCreate}>
            New translation
          </button>
        </div>
      </div>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Text</th>
              <th>Key</th>
              <th>Lang</th>
              <th>Namespace</th>
              <th>Updated</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ maxWidth: 320 }}>
                  {row.text.slice(0, 120)}
                  {row.text.length > 120 ? '…' : ''}
                </td>
                <td className="mono" style={{ maxWidth: 220, wordBreak: 'break-all' }}>
                  {row.key.slice(0, 30)}…
                </td>
                <td className="mono">{languageName.get(row.languageId) ?? '?'}</td>
                <td>
                  <span className={`badge ${row.namespace === 'dynamic' ? 'badge-warn' : ''}`}>
                    {row.namespace}
                  </span>
                </td>
                <td className="muted">{formatTimestamp(row.updatedAt)}</td>
                <td>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <button
                      type="button"
                      className="button button-ghost button-small"
                      onClick={() => openEdit(row)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button-danger button-small"
                      onClick={() => remove(row)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !isFetching && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                  No translations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        {isFetching && <span className="muted">Loading…</span>}
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={back}
          disabled={!canBack}
        >
          Newer
        </button>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => data?.next && next(data.next)}
          disabled={!data?.next}
        >
          Older
        </button>
      </div>

      {editing && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="modal stack" onSubmit={submit}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
              {editing.mode === 'create' ? 'New translation' : 'Edit translation'}
            </h2>

            {formError && (
              <div className="error-box" role="alert">
                {formError}
              </div>
            )}

            <div className="form-grid">
              <div>
                <label htmlFor="edit-language">Language</label>
                <select
                  id="edit-language"
                  value={draft.languageId}
                  onChange={(event) => setDraft({ ...draft, languageId: event.target.value })}
                >
                  {languages.map((language: Language) => (
                    <option key={language.id} value={language.id}>
                      {language.iso6391} — {language.nativeName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="edit-namespace">Namespace</label>
                <select
                  id="edit-namespace"
                  value={draft.namespace}
                  onChange={(event) =>
                    setDraft({ ...draft, namespace: event.target.value as 'dynamic' | 'static' })
                  }
                >
                  <option value="dynamic">dynamic (key derived from text)</option>
                  <option value="static">static (human-authored key)</option>
                </select>
              </div>
              {draft.namespace === 'static' && (
                <div className="full">
                  <label htmlFor="edit-key">Key</label>
                  <input
                    id="edit-key"
                    type="text"
                    value={draft.key}
                    onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                    placeholder="e.g. home.title"
                  />
                </div>
              )}
              <div className="full">
                <label htmlFor="edit-text">Text</label>
                <textarea
                  id="edit-text"
                  rows={5}
                  value={draft.text}
                  onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                />
              </div>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button type="submit" className="button" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
