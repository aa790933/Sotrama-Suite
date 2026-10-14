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
    ]
  },
  {
    text: 'Architecture',
    items: [
      { text: 'Overview', link: '/architecture/' },
      { text: 'Database layer', link: '/architecture/database' },
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
  description: 'Open-source desktop accounting software for small and medium businesses',
  lang: 'en',
 base: '/Sotrama-Suite/',

  head: [
    ['meta', { name: 'theme-color', content: '#221166' }],
    ['meta', { property: 'og:title', content: 'Sotrama Suite' }],
    ['meta', { property: 'og:description', content: 'Open-source desktop accounting backed by MariaDB.' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: 'https://aa790933.github.io/Sotrama-Suite/' }],
  ],

  themeConfig: {
    logo: '/icon.png',
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
      copyright: 'Built by aa790933 Â· Forked from Frappe Books',
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
