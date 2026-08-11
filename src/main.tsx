import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import App from './App.tsx';
import { HomePage } from './HomePage/HomePage.tsx';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './index.css';

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/editor', element: <App /> }
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme={'auto'}>
      <Notifications />
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>
);
