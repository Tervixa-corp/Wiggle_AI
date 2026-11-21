import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/minimal.css';
import './styles/shell.css';
import './styles/theme.css';
import './styles/opencode.css';
import './styles/freebuff.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
