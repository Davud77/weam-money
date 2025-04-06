import React from 'react';
import ReactDOM from 'react-dom/client';

// Обязательно установите react-router-dom и @types/react-router-dom
import { BrowserRouter } from 'react-router-dom';

// Обязательно установите @tanstack/react-query (версии 4 или 5)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import reportWebVitals from './reportWebVitals';
import './index.css';

const queryClient = new QueryClient();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);

reportWebVitals();
