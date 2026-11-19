import { createRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';

import { Route as rootRoute } from './__root';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminLayout,
});

function AdminLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="stack">
      <nav className="admin-nav" aria-label="Admin sections">
        <Link to="/admin/translations" className={pathname.startsWith('/admin/translations') ? 'active' : ''}>
          Translations
        </Link>
        <Link to="/admin/languages" className={pathname.startsWith('/admin/languages') ? 'active' : ''}>
          Languages
        </Link>
        <Link to="/admin/ai-messages" className={pathname.startsWith('/admin/ai-messages') ? 'active' : ''}>
          AI messages
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
