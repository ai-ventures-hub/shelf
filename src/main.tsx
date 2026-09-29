import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import { AppErrorPage } from './components/AppErrorPage'
import { ConfirmProvider } from './components/feedback/ConfirmDialog'
import { ToastHost } from './components/feedback/Toasts'
import { RouteFocus } from './components/RouteFocus'
import './styles/tokens.css'
import './styles/app.css'
import './styles/mcp-connect.css'

// Hash routing keeps routes working when Electron loads file:// production builds.
// Confirmations, toasts, and route focus/title handling are app-wide.
createRoot(document.getElementById('root')!).render(
  <RouterProvider
    router={createHashRouter([
      {
        path: '*',
        element: (
          <ConfirmProvider>
            <App />
            <RouteFocus />
            <ToastHost />
          </ConfirmProvider>
        ),
        errorElement: <AppErrorPage />,
      },
    ])}
  />,
)
