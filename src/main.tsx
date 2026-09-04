import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { createTheme, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import { ConfigPage } from './Config/ConfigPage.tsx';
import { DebugPage } from './Debug/DebugPage.tsx';
import Editor from './Editor/Editor.tsx';
import { PasswordGate } from './Editor/PasswordGate.tsx';
import { HomePage } from './HomePage/HomePage.tsx';
import { RoutesPage } from './Routes/RoutesPage.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';

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
  {
    path: '/editor',
    element: (
      <PasswordGate>
        <Editor />
      </PasswordGate>
    )
  },
  // Deliberately unlinked: reachable only by typing the URL, and behind the same password
  // as the editor.
  {
    path: '/debug',
    element: (
      <PasswordGate>
        <DebugPage />
      </PasswordGate>
    )
  },
  {
    path: '/config',
    element: (
      <PasswordGate>
        <ConfigPage />
      </PasswordGate>
    )
  },
  // Gated as well: it lists the pages that are otherwise only reachable by typing the URL.
  {
    path: '/routes',
    element: (
      <PasswordGate>
        <RoutesPage />
      </PasswordGate>
    )
  }
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider forceColorScheme={'dark'} theme={theme}>
      <Notifications />
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </MantineProvider>
  </StrictMode>
);
