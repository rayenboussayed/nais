import { type FormEvent, useState } from 'react';

import type { Language, Translation } from '../../lib/types';

import { Modal } from '../../components/AdminBits';
import { ApiError, apiFetch } from '../../lib/api';
import { createTranslationSchema, updateTranslationBodySchema } from '../../lib/forms';

/** Which form the translations modal shows, or null when the modal is closed. */
export type TranslationEditing = null | { mode: 'create' } | { mode: 'edit'; row: Translation };

interface Draft {
  key: string;
  languageId: string;
  namespace: 'dynamic' | 'static';
  text: string;
}

interface TranslationsFormProps {
  /** The create or edit form being shown while the modal is open. */
  editing: NonNullable<TranslationEditing>;
  /** Languages offered by the language picker. */
  languages: Language[];
  /** Dismisses the modal. */
  onClose: () => void;
  /** Refreshes the list after a successful save. */
  onSaved: () => Promise<void>;
}

/**
 * Create/edit form for one translation, rendered inside the shared admin modal.
 * @param root0 - the component props
 * @param root0.editing - create or edit mode, with the row being edited in edit mode
 * @param root0.languages - languages offered by the language picker
 * @param root0.onClose - dismisses the modal
 * @param root0.onSaved - refreshes the list after a successful save
 * @returns the rendered modal form
 */
export function TranslationsForm({ editing, languages, onClose, onSaved }: TranslationsFormProps) {
  const [draft, setDraft] = useState<Draft>(() =>
    editing.mode === 'create'
      ? {
          key: '',
          languageId: languages[0]?.id ?? '',
          namespace: 'dynamic',
          text: '',
        }
      : {
          key: editing.row.key,
          languageId: editing.row.languageId,
          namespace: editing.row.namespace,
          text: editing.row.text,
        },
  );
  const [formError, setFormError] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);

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
    if (busy) return;
    setBusy(true);
    setFormError(null);

    try {
      const error =
        editing.mode === 'create' ? await submitCreate() : await submitUpdate(editing.row);
      if (error) {
        setFormError(error);
        return;
      }

      onClose();
      await onSaved();
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

  return (
    <Modal
      busy={busy}
      formError={formError}
      onClose={onClose}
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
  );
}
