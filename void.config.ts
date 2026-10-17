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
    ],
    link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
  },
});
