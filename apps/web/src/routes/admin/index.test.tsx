// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((options: { to: string }) => ({ isRedirect: true as const, to: options.to })),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...original, redirect };
});

import { Route as adminRoute } from '../admin';
import { Route } from './index';

describe('admin index route', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('redirects to the translations list', () => {
    const beforeLoad = Route.options.beforeLoad;
    if (!beforeLoad) throw new Error('admin index route has no beforeLoad');

    let caught: unknown;
    try {
      beforeLoad({} as never);
    } catch (error) {
      caught = error;
    }

    expect(redirect).toHaveBeenCalledWith({ to: '/admin/translations' });
    expect(caught).toEqual({ isRedirect: true, to: '/admin/translations' });
  });

  it('renders nothing while the redirect resolves', () => {
    const Component = Route.options.component;
    if (!Component) throw new Error('admin index route has no component');

    const { container } = render(<Component />);

    expect(container.firstChild).toBeNull();
  });

  it('hangs off the admin route', () => {
    expect(Route.options.getParentRoute()).toBe(adminRoute);
  });
});
