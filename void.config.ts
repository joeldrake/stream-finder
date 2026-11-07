import { defineConfig } from 'void/config';

export default defineConfig({
  worker: {
    compatibility_date: '2026-02-24',
  },
  head: {
    title: 'Stream Finder',
    htmlAttrs: { lang: 'sv' },
    meta: [
      { charset: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'description', content: 'Sök bland filmer och serier på SVT Play, Netflix, Disney+ och HBO Max.' },
      // Namnet under ikonen när sidan läggs till på hemskärmen i iOS.
      { name: 'apple-mobile-web-app-title', content: 'Stream Finder' },
      { name: 'theme-color', content: '#f6f6f4', media: '(prefers-color-scheme: light)' },
      { name: 'theme-color', content: '#111114', media: '(prefers-color-scheme: dark)' },
    ],
    link: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      // iOS använder inte SVG eller manifestets ikoner för hemskärmen, bara den här.
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
  },
});
