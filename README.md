# MetaVox Editor Plugin

A document editor plugin that displays [MetaVox](https://gitea.rikdekker.nl/rik/MetaVox) metadata in a right-side panel when editing documents through Euro-Office or ONLYOFFICE.

## Overview

When users edit documents in Nextcloud using Euro-Office DocumentServer (or ONLYOFFICE), this plugin shows the file's MetaVox metadata fields in a panel on the right side of the editor. Fields with values are displayed, empty fields show a dash.

**Requires:**
- Nextcloud with MetaVox app (>= 2.0.0-beta.3)
- Euro-Office DocumentServer or ONLYOFFICE Document Server
- ONLYOFFICE Nextcloud connector app
- Reverse proxy (Nginx Proxy Manager or plain nginx)

## Quick start

1. Mount the plugin in the DocumentServer container (volume mount)
2. Configure a reverse proxy that forwards `/metavox-api/` to the Nextcloud MetaVox OCS API
3. Open a document from Nextcloud → click Plugins → MetaVox Metadata

See [docs/setup.md](docs/setup.md) for detailed instructions.

## How it works

1. User opens a document from Nextcloud in Euro-Office
2. Plugin reads `Asc.plugin.info.documentCallbackUrl`
3. Decodes the JWT token to extract the Nextcloud `fileId`
4. Fetches metadata via `/metavox-api/files/{fileId}/metadata` (same-origin reverse proxy)
5. Renders field labels and values in the panel

See [docs/architecture.md](docs/architecture.md) for the full technical overview.

## Supported field types

| Type | Display |
|------|---------|
| text, textarea | Plain text |
| number | Number |
| date | Localized date |
| select | Selected option |
| multiselect | Pill tags |
| checkbox | Visual checkmark |
| url | Clickable link |
| user | User ID |
| filelink | File reference |

## Plugin structure

```
metavox-editor-plugin/
├── config.json          Plugin manifest (panelRight type)
├── index.html           Panel HTML with refresh button
├── plugin.js            Core logic: JWT detection, API, rendering
├── styles.css           Panel styling (theme-aware)
├── vendor/
│   └── plugins.js       ONLYOFFICE plugin SDK (bundled)
├── resources/
│   └── icon.svg         Toolbar icon
└── docs/
    ├── setup.md          Installation & configuration
    ├── architecture.md   How it works (developer reference)
    └── troubleshooting.md Common problems & solutions
```

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md).

## Roadmap

- [x] **v0.1** — Basic scaffold
- [x] **v0.2** — File ID detection via JWT, reverse proxy, improved UI
- [ ] **v0.3** — Inline editing of metadata fields from the panel
- [ ] **v0.4** — OOXML custom properties sync (embed metadata in the document)

## License

AGPL-3.0 — same as Euro-Office DocumentServer and MetaVox.
