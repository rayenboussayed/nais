// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminSearch, Modal, Pagination } from './AdminBits';

describe('AdminSearch', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a labelled search box and reports each edit', () => {
    const onChange = vi.fn();
    render(
      <AdminSearch
        ariaLabel="Search translations"
        onChange={onChange}
        placeholder="Find a key"
        value="home"
      />,
    );

    const input = screen.getByRole('searchbox', { name: 'Search translations' });
    expect(input).toHaveProperty('value', 'home');
    expect(input).toHaveProperty('placeholder', 'Find a key');

    fireEvent.change(input, { target: { value: 'home.title' } });
    expect(onChange).toHaveBeenCalledWith('home.title');
  });
});

describe('Modal', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the error, default save label and wires both actions', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <Modal
        busy={false}
        formError="Could not save."
        onClose={onClose}
        onSubmit={onSubmit}
        title="Edit language"
      >
        <label htmlFor="modal-name">Name</label>
        <input id="modal-name" />
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Edit language' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Could not save.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('uses the custom submit label when provided and shows a busy label while saving', () => {
    const onSubmit = vi.fn();
    render(
      <Modal
        busy={false}
        formError={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        submitLabel="Create"
        title="New language"
      >
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    cleanup();
    render(
      <Modal
        busy
        formError={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        submitLabel="Create"
        title="New language"
      >
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true);
    expect(screen.queryByText('Create')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('Pagination', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the loading indicator and enables both directions', () => {
    const onBack = vi.fn();
    const onNext = vi.fn();
    render(<Pagination canBack hasNext isFetching onBack={onBack} onNext={onNext} />);

    expect(screen.getByText('Loading…')).toBeTruthy();
    const newer = screen.getByRole('button', { name: 'Newer' });
    const older = screen.getByRole('button', { name: 'Older' });
    expect(newer).toHaveProperty('disabled', false);
    expect(older).toHaveProperty('disabled', false);

    fireEvent.click(newer);
    fireEvent.click(older);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('hides the indicator and disables both directions at the ends', () => {
    render(
      <Pagination
        canBack={false}
        hasNext={false}
        isFetching={false}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Newer' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Older' })).toHaveProperty('disabled', true);
  });
});
