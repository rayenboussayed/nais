import type { Dispatch, FormEvent, SetStateAction } from 'react';

import type { Language } from '../../lib/types';

import { Modal } from '../../components/AdminBits';

/** Editable fields of the language create/edit form. */
export interface Draft {
  dir: 'ltr' | 'rtl';
  iso6391: string;
  isSource: boolean;
  name: string;
  nativeName: string;
}

/** Which form the languages modal shows, or null when the modal is closed. */
export type LanguageEditing = null | { mode: 'create' } | { mode: 'edit'; row: Language };

/** Props for {@link LanguagesForm}. */
interface LanguagesFormProps {
  /** Disables the submit button while the mutation runs. */
  busy: boolean;
  /** Current field values rendered by the form. */
  draft: Draft;
  /** The create or edit form being shown while the modal is open. */
  editing: NonNullable<LanguageEditing>;
  /** Error to show inside the form, or null when there is none. */
  formError: null | string;
  /** Dismisses the modal. */
  onClose: () => void;
  /** Submits the form. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Replaces the field values as the user edits them. */
  setDraft: Dispatch<SetStateAction<Draft>>;
}

/**
 * Presentational create/edit form for one language, rendered inside the shared
 * admin modal. All state and submit logic stay in the languages list route.
 * @param root0 - the component props
 * @param root0.busy - disables the submit button while the mutation runs
 * @param root0.draft - current field values rendered by the form
 * @param root0.editing - create or edit mode, with the row being edited in edit mode
 * @param root0.formError - error to show inside the form, or null
 * @param root0.onClose - dismisses the modal
 * @param root0.onSubmit - submits the form
 * @param root0.setDraft - replaces the field values as the user edits them
 * @returns the rendered modal form
 */
export function LanguagesForm({
  busy,
  draft,
  editing,
  formError,
  onClose,
  onSubmit,
  setDraft,
}: LanguagesFormProps) {
  return (
    <Modal
      busy={busy}
      formError={formError}
      onClose={onClose}
      onSubmit={onSubmit}
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
            onChange={(event) => setDraft({ ...draft, iso6391: event.target.value.toLowerCase() })}
            placeholder="en"
            type="text"
            value={draft.iso6391}
          />
        </div>
        <div>
          <label htmlFor="edit-dir">Direction</label>
          <select
            id="edit-dir"
            onChange={(event) => setDraft({ ...draft, dir: event.target.value as 'ltr' | 'rtl' })}
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
  );
}
