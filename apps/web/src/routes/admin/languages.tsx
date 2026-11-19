import { useState, type FormEvent } from 'react';
import { createRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createLanguageSchema,
  updateLanguageBodySchema,
  type KeysetList,
  type Language,
} from '@trainslator/shared';

import { Route as adminRoute } from '../admin';
import { apiFetch, ApiError, toQueryString } from '../../lib/api';
import { formatTimestamp, useCursorStack } from '../../lib/admin';

export const Route = createRoute({
  getParentRoute: () => adminRoute,
  path: '/languages',
  component: LanguagesAdmin,
});

const PAGE_SIZE = 50;

type Editing = { mode: 'create' } | { mode: 'edit'; row: Language } | null;

function LanguagesAdmin() {
  const queryClient = useQueryClient();
  const { current, canBack, next, back, reset } = useCursorStack();

  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState({
    name: '',
    nativeName: '',
    iso6391: '',
    dir: 'ltr' as 'ltr' | 'rtl',
    isSource: false,
  });

  const params = {
    pageSize: String(PAGE_SIZE),
    ...(q ? { q } : {}),
    ...(current ? { lastId: current.lastId, lastCreatedAt: current.lastCreatedAt } : {}),
  };

  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'languages', params],
    queryFn: () => apiFetch<KeysetList<Language>>(`/api/languages${toQueryString(params)}`),
    placeholderData: (previous) => previous,
  });

  const rows = data?.items ?? [];

  function openCreate() {
    setDraft({ name: '', nativeName: '', iso6391: '', dir: 'ltr', isSource: false });
    setFormError(null);
    setEditing({ mode: 'create' });
  }

  function openEdit(row: Language) {
    setDraft({
      name: row.name,
      nativeName: row.nativeName,
      iso6391: row.iso6391,
      dir: row.dir,
      isSource: row.isSource,
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
        const parsed = createLanguageSchema.safeParse(draft);
        if (!parsed.success) {
          setFormError(parsed.error.issues[0]?.message ?? 'Invalid input');
          return;
        }
        await apiFetch('/api/languages', {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        });
      } else {
        const body: Record<string, unknown> = {};
        if (draft.name !== editing.row.name) body.name = draft.name;
        if (draft.nativeName !== editing.row.nativeName) body.nativeName = draft.nativeName;
        if (draft.iso6391 !== editing.row.iso6391) body.iso6391 = draft.iso6391;
        if (draft.dir !== editing.row.dir) body.dir = draft.dir;
        if (draft.isSource !== editing.row.isSource) body.isSource = draft.isSource;

        const parsed = updateLanguageBodySchema.safeParse(body);
        if (!parsed.success) {
          setFormError(parsed.error.issues[0]?.message ?? 'Invalid input');
          return;
        }
        await apiFetch(`/api/languages/${editing.row.id}`, {
          method: 'PATCH',
          body: JSON.stringify(parsed.data),
        });
      }

      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'languages'] });
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

  async function remove(row: Language) {
    if (!window.confirm(`Soft-delete ${row.nativeName} (${row.iso6391})?`)) return;
    try {
      await apiFetch(`/api/languages/${row.id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'languages'] });
    } catch {
      window.alert('Could not delete the language.');
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Languages</h1>
        <div className="row">
          <input
            type="search"
            placeholder="Search name…"
            value={q}
            onChange={(event) => {
              reset();
              setQ(event.target.value);
            }}
            aria-label="Search languages"
            style={{ width: 220 }}
          />
          <button type="button" className="button" onClick={openCreate}>
            New language
          </button>
        </div>
      </div>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Native</th>
              <th>ISO</th>
              <th>Dir</th>
              <th>Source</th>
              <th>Updated</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td dir={row.dir}>{row.nativeName}</td>
                <td className="mono">{row.iso6391}</td>
                <td>{row.dir}</td>
                <td>{row.isSource ? <span className="badge badge-ok">source</span> : '—'}</td>
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
                <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                  No languages found.
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
              {editing.mode === 'create' ? 'New language' : `Edit ${editing.row.nativeName}`}
            </h2>

            {formError && (
              <div className="error-box" role="alert">
                {formError}
              </div>
            )}

            <div className="form-grid">
              <div>
                <label htmlFor="edit-name">Name</label>
                <input
                  id="edit-name"
                  type="text"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="edit-native">Native name</label>
                <input
                  id="edit-native"
                  type="text"
                  dir={draft.dir}
                  value={draft.nativeName}
                  onChange={(event) => setDraft({ ...draft, nativeName: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="edit-iso">ISO 639-1</label>
                <input
                  id="edit-iso"
                  type="text"
                  maxLength={2}
                  placeholder="en"
                  value={draft.iso6391}
                  onChange={(event) =>
                    setDraft({ ...draft, iso6391: event.target.value.toLowerCase() })
                  }
                />
              </div>
              <div>
                <label htmlFor="edit-dir">Direction</label>
                <select
                  id="edit-dir"
                  value={draft.dir}
                  onChange={(event) =>
                    setDraft({ ...draft, dir: event.target.value as 'ltr' | 'rtl' })
                  }
                >
                  <option value="ltr">ltr</option>
                  <option value="rtl">rtl</option>
                </select>
              </div>
              <div className="full">
                <label className="checkbox-line" htmlFor="edit-isSource">
                  <input
                    id="edit-isSource"
                    type="checkbox"
                    checked={draft.isSource}
                    onChange={(event) => setDraft({ ...draft, isSource: event.target.checked })}
                  />
                  Source language (used as the translation source)
                </label>
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
