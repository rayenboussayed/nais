import type { ReactNode } from 'react';

/** Shared building blocks for the admin list pages. */

interface AdminSearchProps {
  ariaLabel: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}

interface ModalProps {
  busy: boolean;
  children: ReactNode;
  formError: null | string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  submitLabel?: string;
  title: string;
}

interface PaginationProps {
  canBack: boolean;
  hasNext: boolean;
  isFetching: boolean;
  onBack: () => void;
  onNext: () => void;
}

/**
 * Search input that clears the keyset cursor as the user types.
 * @param root0 - the component props
 * @param root0.value - the controlled input value
 * @param root0.onChange - called with the new search string on every keystroke
 * @param root0.placeholder - the input placeholder
 * @param root0.ariaLabel - the accessible label for the input
 * @returns the rendered search input
 */
export function AdminSearch({ ariaLabel, onChange, placeholder, value }: AdminSearchProps) {
  return (
    <input
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={{ width: 240 }}
      type="search"
      value={value}
    />
  );
}

/**
 * Modal used by the admin edit/create forms.
 * @param root0 - the component props
 * @param root0.title - the dialog heading text
 * @param root0.formError - the error to show inside the form, or null
 * @param root0.busy - disables the submit button while the mutation runs
 * @param root0.onClose - called when the Cancel button is clicked
 * @param root0.onSubmit - the form submit handler
 * @param root0.children - the modal body content
 * @param root0.submitLabel - the submit button label (defaults to Save)
 * @returns the rendered dialog
 */
export function Modal({
  busy,
  children,
  formError,
  onClose,
  onSubmit,
  submitLabel,
  title,
}: ModalProps) {
  return (
    <dialog aria-label="Dialog" aria-modal="true" className="modal-backdrop" open>
      <form className="modal stack" onSubmit={onSubmit}>
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>{title}</h2>
        {formError && (
          <div className="error-box" role="alert">
            {formError}
          </div>
        )}
        {children}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="button button-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button" disabled={busy} type="submit">
            {busy ? 'Saving…' : (submitLabel ?? 'Save')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Newer/Older keyset pagination bar.
 * @param root0 - the component props
 * @param root0.isFetching - shows the loading indicator when true
 * @param root0.canBack - enables the Newer button when true
 * @param root0.hasNext - enables the Older button when true
 * @param root0.onBack - jump back one page
 * @param root0.onNext - advance one page
 * @returns the rendered pagination bar
 */
export function Pagination({ canBack, hasNext, isFetching, onBack, onNext }: PaginationProps) {
  return (
    <div className="pagination">
      {isFetching && <span className="muted">Loading…</span>}
      <button
        className="button button-ghost button-small"
        disabled={!canBack}
        onClick={onBack}
        type="button"
      >
        Newer
      </button>
      <button
        className="button button-ghost button-small"
        disabled={!hasNext}
        onClick={onNext}
        type="button"
      >
        Older
      </button>
    </div>
  );
}
