import { Analytics } from '@vercel/analytics/next'
import { Space_Grotesk } from 'next/font/google'
import type { Metadata, Viewport } from 'next'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' })

export const metadata: Metadata = {
  title: 'First Marina Trust | Controlled operations',
  description: 'A clear, auditable workspace for treasury operations and approvals.',
  generator: 'Winerocks',
  icons: {
    icon: [
      { url: '/favicon_io (8)/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon_io (8)/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon_io (8)/favicon.ico', sizes: 'any' },
    ],
    apple: [
      { url: '/favicon_io (8)/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      { rel: 'android-chrome', url: '/favicon_io (8)/android-chrome-192x192.png', sizes: '192x192' },
      { rel: 'android-chrome', url: '/favicon_io (8)/android-chrome-512x512.png', sizes: '512x512' },
    ],
  },
  manifest: '/favicon_io (8)/site.webmanifest',
  openGraph: {
    title: 'First Marina Trust | Controlled operations',
    description: 'A clear, auditable workspace for treasury operations and approvals.',
    siteName: 'First Marina Trust',
    images: [{ url: '/Logo_1.png', width: 512, height: 512, alt: 'First Marina Trust' }],
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'First Marina Trust | Controlled operations',
    description: 'A clear, auditable workspace for treasury operations and approvals.',
    images: ['/Logo_1.png'],
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#ffffff',
  userScalable: false,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`bg-background ${spaceGrotesk.variable}`}>
      <body className="font-sans antialiased">
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Toaster position="bottom-right" richColors closeButton />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
