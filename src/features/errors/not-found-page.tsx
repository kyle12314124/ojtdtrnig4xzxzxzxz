import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="bg-canvas flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="bg-brand-50 text-brand-600 flex size-12 items-center justify-center rounded-full">
        <Compass className="size-6" aria-hidden />
      </div>
      <p className="text-ink-400 mt-4 text-xs font-semibold tracking-widest uppercase">404</p>
      <h1 className="text-ink-900 mt-1 text-xl font-semibold">Page not found</h1>
      <p className="text-ink-500 mt-2 max-w-sm text-sm">
        The page you are looking for does not exist or may have moved.
      </p>
      <Button className="mt-6" onClick={() => window.history.back()}>
        Go back
      </Button>
      <Link to="/" className="text-brand-700 mt-3 text-sm hover:underline">
        Return to workspace
      </Link>
    </div>
  )
}
