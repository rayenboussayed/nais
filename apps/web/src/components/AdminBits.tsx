import type { ReactNode } from 'react';

/** Shared building blocks for the admin list pages. */

interface AdminSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

/** Search input that clears the keyset cursor as the user types. */
export function AdminSearch({ value, onChange, placeholder, ariaLabel }: AdminSearchProps) {
  return (
    <input
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      style={{ width: 240 }}
    />
  );
}

interface PaginationProps {
  isFetching: boolean;
  canBack: boolean;
  hasNext: boolean;
  onBack: () => void;
  onNext: () => void;
}

/** Newer/Older keyset pagination bar. */
export function Pagination({ isFetching, canBack, hasNext, onBack, onNext }: PaginationProps) {
  return (
    <div className="pagination">
      {isFetching && <span className="muted">Loading…</span>}
      <button
        type="button"
        className="button button-ghost button-small"
        onClick={onBack}
        disabled={!canBack}
      >
        Newer
      </button>
      <button
        type="button"
        className="button button-ghost button-small"
        onClick={onNext}
        disabled={!hasNext}
      >
        Older
      </button>
    </div>
  );
}

interface ModalProps {
  title: string;
  formError: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  submitLabel?: string;
}

/** Modal used by the admin edit/create forms. */
export function Modal({
  title,
  formError,
  busy,
  onClose,
  onSubmit,
  children,
  submitLabel,
}: ModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal stack" onSubmit={onSubmit}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h2>
        {formError && (
          <div className="error-box" role="alert">
            {formError}
          </div>
        )}
        {children}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Saving…' : (submitLabel ?? 'Save')}
          </button>
        </div>
      </form>
    </div>
  );
}
