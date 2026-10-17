import { defineConfig } from 'vitepress'

const sidebar = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Installation', link: '/getting-started/installation' },
      { text: 'First Company', link: '/getting-started/first-company' },
      { text: 'Architecture at a glance', link: '/architecture/' },
    ]
  },
  {
    text: 'User Guides',
    items: [
      { text: 'Database connections', link: '/guides/database-connections' },
      { text: 'Backup and restore', link: '/guides/backup-restore' },
      { text: 'Business workflows', link: '/guides/business-workflows' },
    ]
  },
  {
    text: 'Architecture',
    items: [
      { text: 'Overview', link: '/architecture/' },
      { text: 'Database layer', link: '/architecture/database' },
      { text: 'Data model and UML', link: '/architecture/data-model' },
      { text: 'IPC protocol', link: '/architecture/ipc' },
      { text: 'Application boundaries', link: '/architecture/application-boundaries' },
    ]
  },
  {
    text: 'Development',
    items: [
      { text: 'Setup', link: '/development/setup' },
      { text: 'Contributing', link: '/development/contributing' },
      { text: 'CI and releases', link: '/development/ci' },
    ]
  },
  {
    text: 'Reference',
    items: [
      { text: 'Project reference', link: '/api/' },
      { text: 'Releases', link: 'https://github.com/aa790933/Sotrama-Suite/releases' },
    ]
  }
]

export default defineConfig({
  title: 'Sotrama Suite',
  description: 'Sotrama Suite brings sales, billing, payments, and business reporting together in one open-source desktop application.',
  lang: 'en',
  base: '/Sotrama-Suite/',

  head: [
    ['meta', { name: 'theme-color', content: '#d94736' }],
    ['meta', { property: 'og:title', content: 'Sotrama Suite' }],
    ['meta', { property: 'og:description', content: 'Connected tools for sales, billing, payments, company data, and financial reporting.' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: 'https://aa790933.github.io/Sotrama-Suite/' }],
    ['meta', { property: 'og:image', content: 'https://aa790933.github.io/Sotrama-Suite/social-card.png' }],
    ['meta', { property: 'og:image:alt', content: 'Sotrama Suite business management tools' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Sotrama Suite' }],
    ['meta', { name: 'twitter:description', content: 'Connected tools for everyday business operations.' }],
    ['meta', { name: 'twitter:image', content: 'https://aa790933.github.io/Sotrama-Suite/social-card.png' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/Sotrama-Suite/favicon.svg' }],
  ],

  themeConfig: {
    logo: '/sotrama-mark.svg',
    outline: { label: 'On this page' },
    siteTitle: 'Sotrama Suite',
    nav: [
      { text: 'Docs', link: '/getting-started/installation', activeMatch: '/getting-started/' },
      { text: 'Architecture', link: '/architecture/', activeMatch: '/architecture/' },
      { text: 'Guides', link: '/guides/', activeMatch: '/guides/' },
      { text: 'Releases', link: '/releases/', activeMatch: '/releases/' },
      {
        text: 'GitHub',
        link: 'https://github.com/aa790933/Sotrama-Suite',
        rel: 'noopener noreferrer',
      },
    ],
    sidebar,
    socialLinks: [
      { icon: 'github', link: 'https://github.com/aa790933/Sotrama-Suite' },
      { icon: 'telegram', link: 'https://t.me/sotrama_suite' },
    ],
    footer: {
      message: 'Licensed under AGPL-3.0-only.',
      copyright: 'Copyright © 2026 Sotrama Suite contributors',
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonPlaceholder: 'Search documentation',
          },
          modal: {
            noResultsText: 'No results found',
            resetButtonTitle: 'Clear search',
          },
        },
      },
    },
    lastUpdated: true,
    editLink: {
      pattern: 'https://github.com/aa790933/Sotrama-Suite/edit/main/docs/:path',
    },
  },
})
