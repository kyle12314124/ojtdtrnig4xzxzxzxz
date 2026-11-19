import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { AppProviders } from './providers'
import { ErrorBoundary } from './error-boundary'

export function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  )
}
