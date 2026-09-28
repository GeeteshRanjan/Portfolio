import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './motion/tokens';
import './styles/global.css';
import { startSmoothScroll } from './motion/SmoothScroll';
import { App } from './App';

history.scrollRestoration = 'manual';
startSmoothScroll();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
