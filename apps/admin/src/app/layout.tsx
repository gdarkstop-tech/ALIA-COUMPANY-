import { cssVariables, darkColors, lightColors } from '@ghayarly/tokens';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import './globals.css';

const plex = localFont({
  src: [
    { path: '../fonts/IBMPlexSansArabic_400Regular.ttf', weight: '400' },
    { path: '../fonts/IBMPlexSansArabic_500Medium.ttf', weight: '500' },
    { path: '../fonts/IBMPlexSansArabic_600SemiBold.ttf', weight: '600' },
    { path: '../fonts/IBMPlexSansArabic_700Bold.ttf', weight: '700' },
  ],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Dress My Wound Admin',
  description: 'Operations & clinical review console',
  robots: { index: false, follow: false },
};

const themeCss = `:root{${cssVariables(lightColors)}color-scheme:light}@media (prefers-color-scheme: dark){:root{${cssVariables(darkColors)}color-scheme:dark}}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={plex.variable} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
