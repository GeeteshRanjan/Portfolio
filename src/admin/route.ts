import { lazy } from 'react';

/*
 * Lazily loaded so visitors never download the admin. Kept out of App.tsx on purpose:
 * saving content hot-reloads App.tsx, and a lazy() created there would remount the
 * admin and drop unsaved edits in other sections.
 */
export const AdminPage = lazy(() => import('./AdminPage'));
