import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import HolyLoader from 'holy-loader';

import './globals.css';

// Validación de env en arranque del servidor.
import '@/lib/env';
import { ThemeProvider } from '@/components/theme-provider';
import { BackToTop } from '@/components/back-to-top';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: {
      default: t('appName'),
      template: `%s · ${t('appName')}`,
    },
    description: t('appDescription'),
    applicationName: t('appName'),
    manifest: '/manifest.webmanifest',
    robots: { index: false, follow: false },
    icons: {
      icon: [
        { url: '/icons/favicon-16x16.png?v=2', sizes: '16x16', type: 'image/png' },
        { url: '/icons/favicon-32x32.png?v=2', sizes: '32x32', type: 'image/png' },
      ],
      apple: [
        { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      ],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    // Deben coincidir con --background de globals.css: es el color que pinta
    // la barra del navegador en móvil, y si no casa se ve una franja distinta.
    { media: '(prefers-color-scheme: dark)', color: '#0c0a15' },
    { media: '(prefers-color-scheme: light)', color: '#f9f8fc' },
  ],
  colorScheme: 'dark light',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        {/* HolyLoader asigna el color tal cual a `style.background`, así que
            admite la variable del tema: la barra sigue al violeta de marca y
            cambia sola entre claro y oscuro, sin duplicar el valor aquí. */}
        <HolyLoader color="hsl(var(--primary))" height={3} speed={250} />
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <div className="min-h-dvh">{children}</div>
            <BackToTop />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
