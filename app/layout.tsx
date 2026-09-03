import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Greenline Treasury | Controlled operations', description: 'A clear, auditable workspace for treasury operations and approvals.', generator: 'v0.app' }
export const viewport: Viewport = { colorScheme: 'light', themeColor: '#ffffff', userScalable: false }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="bg-background"><body className="antialiased">{children}{process.env.NODE_ENV === 'production' && <Analytics />}</body></html> }
