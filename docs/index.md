---
layout: home
hero:
  name: Sotrama Suite
  text: Modern Accounting Made Simple
  tagline: Open-source desktop accounting software for small and medium businesses
  image:
    src: /Sotrama-Suite/icon.png
    alt: Sotrama Suite Logo
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/aa790933/Sotrama-Suite
    - theme: alt
      text: Download
      link: https://github.com/aa790933/Sotrama-Suite/releases

features:
  - title: Double-Entry Accounting
    details: Accurate financial tracking with full debit/credit ledger, journal entries, and trial balance verification
    icon: 📊
  - title: Point of Sale (POS)
    details: Integrated retail system with cash drawer, receipt printing, and multiple payment methods
    icon: 🛒
  - title: Invoicing & Billing
    details: Professional invoices, recurring billing, payment tracking, and multi-currency support
    icon: 🧾
  - title: Financial Reports
    details: Profit & Loss, Balance Sheet, General Ledger, Cash Flow, and custom report builder
    icon: 📈
  - title: Offline-First
    details: Stores company data in MariaDB, with local or LAN database options
    icon: 💾
  - title: Cross-Platform
    details: Native desktop apps for Windows, macOS (Intel & Apple Silicon), and Linux
    icon: 🖥️
  - title: Regional Compliance
    details: Built-in GST (India), VAT (EU), Sales Tax (US), TVA (Algeria), MWST (Switzerland)
    icon: 🌍
  - title: Open Source
    details: AGPL-3.0 licensed, community-driven, fully auditable codebase
    icon: 🔓
---

<script setup>
import { VPTeamPage, VPTeamMembers } from 'vitepress/theme'

const coreTeam = [
  {
    avatar: 'https://github.com/aa790933.png',
    name: 'aa790933',
    title: 'Creator & Maintainer',
    links: [
      { icon: 'github', link: 'https://github.com/aa790933' },
    ]
  }
]

const contributors = [
  // Add contributors here
]
</script>

## Quick Links

<div class="vp-doc" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin: 2rem 0;">

<div class="custom-block tip" style="padding: 1.5rem;">
<h3>🚀 Installation</h3>
<p>Download the latest release for your platform</p>
<a href="/getting-started/installation" class="vp-button-brand">Windows · macOS · Linux</a>
</div>

<div class="custom-block tip" style="padding: 1.5rem;">
<h3>📚 User Guides</h3>
<p>Step-by-step tutorials for all features</p>
<a href="/guides/" class="vp-button-brand">Browse Guides</a>
</div>

<div class="custom-block tip" style="padding: 1.5rem;">
<h3>🏗️ Architecture</h3>
<p>Deep dive into the codebase structure</p>
<a href="/architecture/" class="vp-button-brand">Read Architecture</a>
</div>

<div class="custom-block tip" style="padding: 1.5rem;">
<h3>👨‍💻 Development</h3>
<p>Contribute to the project</p>
<a href="/development/setup" class="vp-button-brand">Dev Setup</a>
</div>

</div>

## Community & Support

- [GitHub Issues](https://github.com/aa790933/Sotrama-Suite/issues) — Bug reports & feature requests
- [GitHub Discussions](https://github.com/aa790933/Sotrama-Suite/discussions) — Questions & community chat
- [Telegram](https://t.me/sotrama_suite) — Real-time discussions

## License

Sotrama Suite is licensed under **AGPL-3.0-only**. See [LICENSE](https://github.com/aa790933/Sotrama-Suite/blob/main/LICENSE) for details.

---

*Built by [aa790933](https://github.com/aa790933) · Forked from Frappe Books*
