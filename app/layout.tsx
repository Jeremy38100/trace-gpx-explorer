import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import './globals.css';

const robotoSans = Roboto({
  variable: '--font-roboto',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    'https://trace-gpx-explorer.jeremy-roche5.chatgpt.site',
  ),
  title: 'Trace — GPX Explorer',
  description: 'Explore every climb, split, and effort in your GPX activities.',
  openGraph: {
    title: 'Trace — GPX Explorer',
    description:
      'Explore every climb, split, and effort in your GPX activities.',
    url: '/',
    siteName: 'Trace',
    type: 'website',
    images: [
      { url: '/og.png', width: 1200, height: 630, alt: 'Trace GPX Explorer' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Trace — GPX Explorer',
    description:
      'Explore every climb, split, and effort in your GPX activities.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${robotoSans.variable} antialiased`}>{children}</body>
    </html>
  );
}
