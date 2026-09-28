import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { TransitionProvider } from './app/Transition';
import { useRoom } from './app/room';
import { Nav } from './components/Nav';
import { Grain } from './components/Grain';
import { GalleryPage } from './pages/GalleryPage';
import { DetailPage } from './pages/DetailPage';
import { AboutPage } from './pages/AboutPage';
import { AdminPage } from './admin/route';
import { projectIndex, projects } from './content/projects';

function DetailRoute() {
  const { slug = '' } = useParams();
  const i = projectIndex(slug);
  if (i < 0) return <Navigate to="/" replace />;
  // Items with their own route (the About Me disc) have no detail page.
  if (projects[i].href) return <Navigate to={projects[i].href} replace />;
  // Remount per project so every controller starts clean.
  return <DetailPage key={slug} />;
}

export function App() {
  return (
    <BrowserRouter>
      <TransitionProvider>
        <Site />
      </TransitionProvider>
    </BrowserRouter>
  );
}

function Site() {
  // The admin is a plain tool page: no site nav or grain over it.
  const admin = useLocation().pathname.startsWith('/admin');
  useRoom(!admin);
  return (
    <>
      {admin ? null : <Nav />}
      <Routes>
        <Route path="/" element={<GalleryPage />} />
        <Route path="/work/:slug" element={<DetailRoute />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/admin" element={<Suspense fallback={null}><AdminPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {admin ? null : <Grain />}
    </>
  );
}
