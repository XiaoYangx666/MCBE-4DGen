import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyAppearance, initialPalette, initialTheme } from './lib/theme';
import '../web/styles/theme.css';
import '../web/styles/shared.css';
import '../web/styles/workspace.css';
import './styles.css';

applyAppearance(initialTheme(), initialPalette());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
