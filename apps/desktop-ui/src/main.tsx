import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { WiggleProvider } from './store/useWiggleStore';
import './styles/minimal.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <WiggleProvider>
      <App />
    </WiggleProvider>
  </StrictMode>,
);
