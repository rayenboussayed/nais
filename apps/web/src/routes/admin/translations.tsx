import { createRoute } from '@tanstack/react-router';
import { type FormEvent, useMemo, useState } from 'react';

import type { Language, Translation } from '../../lib/types';

import { AdminSearch, Modal, Pagination } from '../../components/AdminBits';
import { formatTimestamp } from '../../lib/admin';
import { ApiError, apiFetch } from '../../lib/api';
import { createTranslationSchema, updateTranslationBodySchema } from '../../lib/forms';
import { useLanguages } from '../../lib/languages';
import { useAdminList } from '../../lib/use-admin-list';
import { Route as adminRoute } from '../admin';

export const Route = createRoute({
  component: TranslationsAdmin,
  getParentRoute: () => adminRoute,
  path: '/translations',
});

const PAGE_SIZE = 20;

type Editing = null | { mode: 'create' } | { mode: 'edit'; row: Translation };

/**
 * Admin list of translations: search, keyset pagination, create/edit/soft-delete.
 * @returns the rendered admin page
 */
export function TranslationsAdmin() {
  const { data: languages = [] } = useLanguages();
  const [languageId, setLanguageId] = useState<string>('');
  const [namespace, setNamespace] = useState<string>('');
  const {
    back,
    canBack,
    deleteRow,
    hasNext,
    invalidate,
    isFetching,
    nextPage,
    resetPage,
    rows,
    search,
    setSearch,
  } = useAdminList<Translation>({
    endpoint: '/api/translations',
    extraParams: {
      ...(languageId ? { languageId } : {}),
      ...(namespace ? { namespace } : {}),
    },
    pageSize: PAGE_SIZE,
    resource: 'translations',
  });

  const [editing, setEditing] = useState<Editing>(null);
  const [formError, setFormError] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState({
    key: '',
    languageId: '',
    namespace: 'dynamic' as 'dynamic' | 'static',
    text: '',
  });

  const languageName = useMemo(
    () => new Map(languages.map((language: Language) => [language.id, language.iso6391])),
    [languages],
  );

  /**
   *
   */
  function openCreate() {
    setDraft({
      key: '',
      languageId: languages[0]?.id ?? '',
      namespace: 'dynamic',
      text: '',
    });
    setFormError(null);
    setEditing({ mode: 'create' });
  }

  /**
   * Opens the edit form for a row.
   * @param row - the translation to edit
   */
  function openEdit(row: Translation) {
    setDraft({
      key: row.key,
      languageId: row.languageId,
      namespace: row.namespace,
      text: row.text,
    });
    setFormError(null);
    setEditing({ mode: 'edit', row });
  }

  /**
   * Builds, validates and posts the create form (namespace decides the shape).
   * @returns the error message to show, or null on success
   */
  async function submitCreate(): Promise<null | string> {
    const payload =
      draft.namespace === 'dynamic'
        ? { languageId: draft.languageId, namespace: 'dynamic' as const, text: draft.text }
        : {
            key: draft.key,
            languageId: draft.languageId,
            namespace: 'static' as const,
            text: draft.text,
          };
    const parsed = createTranslationSchema.safeParse(payload);
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? 'Invalid input';
    }
    await apiFetch('/api/translations', {
      body: JSON.stringify(parsed.data),
      method: 'POST',
    });
    return null;
  }

  /**
   * Diffs the draft against the edited row, validates and patches it.
   * @param row - the translation row being edited
   * @returns the error message to show, or null on success
   */
  async function submitUpdate(row: Translation): Promise<null | string> {
    const body: Record<string, unknown> = {};
    if (draft.languageId !== row.languageId) body.languageId = draft.languageId;
    if (draft.namespace !== row.namespace) body.namespace = draft.namespace;
    if (draft.key !== row.key) body.key = draft.key;
    if (draft.text !== row.text) body.text = draft.text;

    const parsed = updateTranslationBodySchema.safeParse(body);
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? 'Invalid input';
    }
    await apiFetch(`/api/translations/${row.id}`, {
      body: JSON.stringify(parsed.data),
      method: 'PATCH',
    });
    return null;
  }

  /**
   * Submits the create/edit form.
   * @param event - the form submit event
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editing) return;
    setBusy(true);
    setFormError(null);

    try {
      const error =
        editing.mode === 'create' ? await submitCreate() : await submitUpdate(editing.row);
      if (error) {
        setFormError(error);
        return;
      }

      setEditing(null);
      await invalidate();
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

  /**
   * Soft-deletes a row after confirmation.
   * @param row - the translation to delete
   */
  async function remove(row: Translation) {
    if (!window.confirm(`Soft-delete "${row.text.slice(0, 60)}…"?`)) return;
    try {
      await deleteRow(row.id);
    } catch {
      window.alert('Could not delete the translation.');
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Translations</h1>
        <div className="row">
          <AdminSearch
            ariaLabel="Search translations"
            onChange={setSearch}
            placeholder="Search key or text…"
            value={search}
          />
          <select
            aria-label="Filter by language"
            onChange={(event) => {
              resetPage();
              setLanguageId(event.target.value);
            }}
            value={languageId}
          >
            <option value="">All languages</option>
            {languages.map((language: Language) => (
              <option key={language.id} value={language.id}>
                {language.iso6391} — {language.nativeName}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by namespace"
            onChange={(event) => {
              resetPage();
              setNamespace(event.target.value);
            }}
            value={namespace}
          >
            <option value="">All namespaces</option>
            <option value="static">static</option>
            <option value="dynamic">dynamic</option>
          </select>
          <button className="button" onClick={openCreate} type="button">
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
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <button
                      className="button button-ghost button-small"
                      onClick={() => openEdit(row)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="button button-danger button-small"
                      onClick={() => remove(row)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !isFetching && (
              <tr>
                <td className="muted" colSpan={6} style={{ padding: 32, textAlign: 'center' }}>
                  No translations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        canBack={canBack}
        hasNext={hasNext}
        isFetching={isFetching}
        onBack={back}
        onNext={nextPage}
      />

      {editing && (
        <Modal
          busy={busy}
          formError={formError}
          onClose={() => setEditing(null)}
          onSubmit={submit}
          title={editing.mode === 'create' ? 'New translation' : 'Edit translation'}
        >
          <div className="form-grid">
            <div>
              <label htmlFor="edit-language">Language</label>
              <select
                id="edit-language"
                onChange={(event) => setDraft({ ...draft, languageId: event.target.value })}
                value={draft.languageId}
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
                onChange={(event) =>
                  setDraft({ ...draft, namespace: event.target.value as 'dynamic' | 'static' })
                }
                value={draft.namespace}
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
                  onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                  placeholder="e.g. home.title"
                  type="text"
                  value={draft.key}
                />
              </div>
            )}
            <div className="full">
              <label htmlFor="edit-text">Text</label>
              <textarea
                id="edit-text"
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                rows={5}
                value={draft.text}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
