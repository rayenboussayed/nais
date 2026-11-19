import { createRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';

import { Route as rootRoute } from './__root';

export const Route = createRoute({
  component: AdminLayout,
  getParentRoute: () => rootRoute,
  path: '/admin',
});

/**
 * Admin layout: the shared shell around the admin routes.
 * @returns the rendered layout
 */
function AdminLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="stack">
      <nav aria-label="Admin sections" className="admin-nav">
        <Link
          className={pathname.startsWith('/admin/translations') ? 'active' : ''}
          to="/admin/translations"
        >
          Translations
        </Link>
        <Link
          className={pathname.startsWith('/admin/languages') ? 'active' : ''}
          to="/admin/languages"
        >
          Languages
        </Link>
        <Link
          className={pathname.startsWith('/admin/ai-messages') ? 'active' : ''}
          to="/admin/ai-messages"
        >
          AI messages
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
