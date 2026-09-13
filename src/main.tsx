import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import { AppErrorPage } from './components/AppErrorPage'
import './styles/tokens.css'
import './styles/app.css'
import './styles/mcp-connect.css'

// Hash routing keeps routes working when Electron loads file:// production builds.
createRoot(document.getElementById('root')!).render(
  <RouterProvider router={createHashRouter([{ path: '*', element: <App />, errorElement: <AppErrorPage /> }])} />,
)
