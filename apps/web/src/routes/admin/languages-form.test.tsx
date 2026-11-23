// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type FormEvent, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Language } from '../../lib/types';

import { type Draft, type LanguageEditing, LanguagesForm } from './languages-form';

const english: Language = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  dir: 'ltr',
  id: '10000000-0000-4000-8000-000000000001',
  iso6391: 'en',
  isSource: true,
  name: 'English',
  nativeName: 'English',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

const arabic: Language = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  dir: 'rtl',
  id: '10000000-0000-4000-8000-000000000002',
  iso6391: 'ar',
  isSource: false,
  name: 'Arabic',
  nativeName: 'العربية',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

const emptyDraft: Draft = {
  dir: 'ltr',
  iso6391: '',
  isSource: false,
  name: '',
  nativeName: '',
};

interface HarnessProps {
  busy?: boolean;
  draft?: Draft;
  editing: NonNullable<LanguageEditing>;
  formError?: null | string;
  onClose?: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * Builds a draft seeded from a language row, as openEdit does in the route.
 * @param row - the language row to copy
 * @returns the seeded draft
 */
function draftFor(row: Language): Draft {
  return {
    dir: row.dir,
    iso6391: row.iso6391,
    isSource: row.isSource,
    name: row.name,
    nativeName: row.nativeName,
  };
}

/**
 * Renders the presentational form with its draft state owned locally, as the
 * route does in production.
 * @param root0 - the harness props
 * @param root0.busy - whether the submit button is disabled
 * @param root0.draft - initial field values held by the harness
 * @param root0.editing - create or edit mode passed to the form
 * @param root0.formError - error message shown inside the form
 * @param root0.onClose - close callback passed to the form
 * @param root0.onSubmit - submit callback passed to the form
 * @returns the rendered form
 */
function Harness({
  busy = false,
  draft: initialDraft = emptyDraft,
  editing,
  formError = null,
  onClose = () => undefined,
  onSubmit = () => undefined,
}: HarnessProps) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  return (
    <LanguagesForm
      busy={busy}
      draft={draft}
      editing={editing}
      formError={formError}
      onClose={onClose}
      onSubmit={onSubmit}
      setDraft={setDraft}
    />
  );
}

describe('LanguagesForm', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a blank create draft, lowercases the ISO code and edits every field', () => {
    render(<Harness editing={{ mode: 'create' }} />);

    expect(screen.getByText('New language')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Native name')).toHaveProperty('value', '');
    expect(screen.getByLabelText('ISO 639-1')).toHaveProperty('value', '');
    expect(screen.getByLabelText('ISO 639-1')).toHaveProperty('placeholder', 'en');
    expect(screen.getByLabelText('Direction')).toHaveProperty('value', 'ltr');
    expect(screen.getByLabelText(/Source language/)).toHaveProperty('checked', false);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'German' } });
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'German');
    fireEvent.change(screen.getByLabelText('Native name'), { target: { value: 'Deutsch' } });
    expect(screen.getByLabelText('Native name')).toHaveProperty('value', 'Deutsch');
    fireEvent.change(screen.getByLabelText('ISO 639-1'), { target: { value: 'FR' } });
    expect(screen.getByLabelText('ISO 639-1')).toHaveProperty('value', 'fr');
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'rtl' } });
    expect(screen.getByLabelText('Direction')).toHaveProperty('value', 'rtl');
    expect(screen.getByLabelText('Native name').getAttribute('dir')).toBe('rtl');
    fireEvent.click(screen.getByLabelText(/Source language/));
    expect(screen.getByLabelText(/Source language/)).toHaveProperty('checked', true);
  });

  it('renders the edit form seeded from the row with its dynamic title', () => {
    render(<Harness draft={draftFor(arabic)} editing={{ mode: 'edit', row: arabic }} />);

    expect(screen.getByText('Edit العربية')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toHaveProperty('value', arabic.name);
    expect(screen.getByLabelText('Native name')).toHaveProperty('value', arabic.nativeName);
    expect(screen.getByLabelText('Native name').getAttribute('dir')).toBe('rtl');
    expect(screen.getByLabelText('ISO 639-1')).toHaveProperty('value', arabic.iso6391);
    expect(screen.getByLabelText('Direction')).toHaveProperty('value', 'rtl');
    expect(screen.getByLabelText(/Source language/)).toHaveProperty('checked', false);
  });

  it('shows the form error and disables Save while busy, and closes on Cancel', () => {
    const onClose = vi.fn();
    render(
      <Harness busy editing={{ mode: 'create' }} formError="Invalid input" onClose={onClose} />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Invalid input');
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('forwards the submit handler to the modal form', () => {
    const onSubmit = vi.fn();
    render(
      <Harness
        draft={draftFor(english)}
        editing={{ mode: 'edit', row: english }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
