import { createRoot } from 'react-dom/client';
import { App } from './App';
import { InferenceProvider } from './InferenceProvider';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <InferenceProvider>
    <App />
  </InferenceProvider>,
);
