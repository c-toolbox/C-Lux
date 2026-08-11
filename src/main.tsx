import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import Editor from './Editor/Editor.tsx';
import { HomePage } from './HomePage/HomePage.tsx';
import logo from './assets/C_transparent.png';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './index.css';

const theme = createTheme({
  fontFamily: "'Roboto', system-ui, 'Segoe UI', sans-serif",
  fontFamilyMonospace: 'ui-monospace, Consolas, monospace',
  headings: {
    fontFamily: "'Roboto', system-ui, 'Segoe UI', sans-serif"
  }
});

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/editor', element: <Editor /> }
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme={'auto'} theme={theme}>
      <img src={logo} alt={'C-Lux'} className={'app-logo'} />
      <Notifications />
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>
);
