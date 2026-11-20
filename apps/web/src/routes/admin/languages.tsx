import { createRoute } from '@tanstack/react-router';
import { createLanguageSchema, type Language, updateLanguageBodySchema } from '@trainslator/shared';
import { type FormEvent, useState } from 'react';

import { AdminSearch, Modal, Pagination } from '../../components/AdminBits';
import { formatTimestamp } from '../../lib/admin';
import { ApiError, apiFetch } from '../../lib/api';
import { useAdminList } from '../../lib/use-admin-list';
import { Route as adminRoute } from '../admin';

export const Route = createRoute({
  component: LanguagesAdmin,
  getParentRoute: () => adminRoute,
  path: '/languages',
});

const PAGE_SIZE = 50;

type Editing = null | { mode: 'create' } | { mode: 'edit'; row: Language };

const emptyDraft = {
  dir: 'ltr' as 'ltr' | 'rtl',
  iso6391: '',
  isSource: false,
  name: '',
  nativeName: '',
};

/**
 * Admin list of languages: search, keyset pagination, create/edit/soft-delete.
 * @returns the rendered admin page
 */
function LanguagesAdmin() {
  const {
    back,
    canBack,
    deleteRow,
    hasNext,
    invalidate,
    isFetching,
    nextPage,
    rows,
    search,
    setSearch,
  } = useAdminList<Language>({
    endpoint: '/api/languages',
    pageSize: PAGE_SIZE,
    resource: 'languages',
  });

  const [editing, setEditing] = useState<Editing>(null);
  const [formError, setFormError] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  /**
   *
   */
  function openCreate() {
    setDraft(emptyDraft);
    setFormError(null);
    setEditing({ mode: 'create' });
  }

  /**
   * Opens the edit form for a row.
   * @param row - the language to edit
   */
  function openEdit(row: Language) {
    setDraft({
      dir: row.dir,
      iso6391: row.iso6391,
      isSource: row.isSource,
      name: row.name,
      nativeName: row.nativeName,
    });
    setFormError(null);
    setEditing({ mode: 'edit', row });
  }

  /**
   * Validates and posts the create form.
   * @returns the error message to show, or null on success
   */
  async function submitCreate(): Promise<null | string> {
    const parsed = createLanguageSchema.safeParse(draft);
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? 'Invalid input';
    }
    await apiFetch('/api/languages', {
      body: JSON.stringify(parsed.data),
      method: 'POST',
    });
    return null;
  }

  /**
   * Diffs the draft against the edited row, validates and patches it.
   * @param row - the language row being edited
   * @returns the error message to show, or null on success
   */
  async function submitUpdate(row: Language): Promise<null | string> {
    const body: Record<string, unknown> = {};
    if (draft.name !== row.name) body.name = draft.name;
    if (draft.nativeName !== row.nativeName) body.nativeName = draft.nativeName;
    if (draft.iso6391 !== row.iso6391) body.iso6391 = draft.iso6391;
    if (draft.dir !== row.dir) body.dir = draft.dir;
    if (draft.isSource !== row.isSource) body.isSource = draft.isSource;

    const parsed = updateLanguageBodySchema.safeParse(body);
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? 'Invalid input';
    }
    await apiFetch(`/api/languages/${row.id}`, {
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
   * @param row - the language to delete
   */
  async function remove(row: Language) {
    if (!window.confirm(`Soft-delete ${row.nativeName} (${row.iso6391})?`)) return;
    try {
      await deleteRow(row.id);
    } catch {
      window.alert('Could not delete the language.');
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Languages</h1>
        <div className="row">
          <AdminSearch
            ariaLabel="Search languages"
            onChange={setSearch}
            placeholder="Search name…"
            value={search}
          />
          <button className="button" onClick={openCreate} type="button">
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
                <td className="muted" colSpan={7} style={{ padding: 32, textAlign: 'center' }}>
                  No languages found.
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
          title={editing.mode === 'create' ? 'New language' : `Edit ${editing.row.nativeName}`}
        >
          <div className="form-grid">
            <div>
              <label htmlFor="edit-name">Name</label>
              <input
                id="edit-name"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                type="text"
                value={draft.name}
              />
            </div>
            <div>
              <label htmlFor="edit-native">Native name</label>
              <input
                dir={draft.dir}
                id="edit-native"
                onChange={(event) => setDraft({ ...draft, nativeName: event.target.value })}
                type="text"
                value={draft.nativeName}
              />
            </div>
            <div>
              <label htmlFor="edit-iso">ISO 639-1</label>
              <input
                id="edit-iso"
                maxLength={2}
                onChange={(event) =>
                  setDraft({ ...draft, iso6391: event.target.value.toLowerCase() })
                }
                placeholder="en"
                type="text"
                value={draft.iso6391}
              />
            </div>
            <div>
              <label htmlFor="edit-dir">Direction</label>
              <select
                id="edit-dir"
                onChange={(event) =>
                  setDraft({ ...draft, dir: event.target.value as 'ltr' | 'rtl' })
                }
                value={draft.dir}
              >
                <option value="ltr">ltr</option>
                <option value="rtl">rtl</option>
              </select>
            </div>
            <div className="full">
              <label className="checkbox-line" htmlFor="edit-isSource">
                <input
                  checked={draft.isSource}
                  id="edit-isSource"
                  onChange={(event) => setDraft({ ...draft, isSource: event.target.checked })}
                  type="checkbox"
                />
                Source language (used as the translation source)
              </label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
