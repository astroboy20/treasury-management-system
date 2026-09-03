import { Analytics } from '@vercel/analytics/next'
import { Space_Grotesk } from 'next/font/google'
import type { Metadata, Viewport } from 'next'
import './globals.css'

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' })

export const metadata: Metadata = { title: 'Greenline Treasury | Controlled operations', description: 'A clear, auditable workspace for treasury operations and approvals.', generator: 'v0.app' }
export const viewport: Viewport = { colorScheme: 'light', themeColor: '#ffffff', userScalable: false }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className={`bg-background ${spaceGrotesk.variable}`}><body className="font-sans antialiased">{children}{process.env.NODE_ENV === 'production' && <Analytics />}</body></html> }
