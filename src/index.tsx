// index.tsx — обновлённая версия
// Важно: StyledEngineProvider с `injectFirst` заставляет MUI/Emotion
// вставлять свои <style> раньше всех, чтобы ваши правила из index.css
// (со стабильными классами и CSS-переменными) имели приоритет по каскаду.

import React from 'react';
import ReactDOM from 'react-dom/client';

import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StyledEngineProvider } from '@mui/material/styles';

import App from './App';
import reportWebVitals from './reportWebVitals';
import './index.css';

const queryClient = new QueryClient();

const container = document.getElementById('root') as HTMLElement;
const root = ReactDOM.createRoot(container);

root.render(
  <React.StrictMode>
    <StyledEngineProvider injectFirst>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </BrowserRouter>
    </StyledEngineProvider>
  </React.StrictMode>
);

reportWebVitals();
