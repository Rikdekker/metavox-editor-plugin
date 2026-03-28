# MetaVox Editor Plugin

A document editor plugin that displays [MetaVox](https://gitea.rikdekker.nl/rik/MetaVox) metadata in a right-side panel when editing documents through Euro-Office or ONLYOFFICE.

## Overview

When users edit documents in Nextcloud using Euro-Office DocumentServer (or ONLYOFFICE), this plugin shows the file's MetaVox metadata fields in a panel on the right side of the editor.

**Requires:**
- Nextcloud with MetaVox app installed
- Euro-Office DocumentServer or ONLYOFFICE Document Server
- The Nextcloud ONLYOFFICE connector app

## How it works

1. Plugin opens as a right-side panel in the document editor
2. Detects the Nextcloud file ID from the editor context (URL parameters, referrer)
3. Calls the MetaVox OCS API to fetch the file's metadata
4. Renders the metadata fields (labels + values) in the panel

The plugin uses the logged-in user's browser session for authentication — no additional credentials needed.

## Installation

### On Euro-Office / ONLYOFFICE Document Server

Copy the plugin folder to the DocumentServer plugins directory:

```bash
# Docker deployment
docker cp metavox-editor-plugin <container>:/var/www/onlyoffice/documentserver/sdkjs-plugins/metavox-editor-plugin

# Or direct installation
cp -r metavox-editor-plugin /var/www/onlyoffice/documentserver/sdkjs-plugins/
```

Restart the DocumentServer after installation.

### Development mode

Install temporarily via browser console while the editor is open:

```javascript
Asc.editor.installDeveloperPlugin("https://your-server/path/to/config.json");
```

## Plugin structure

```
metavox-editor-plugin/
├── config.json          Plugin manifest (panelRight type)
├── index.html           Panel HTML shell
├── plugin.js            Core logic: file ID detection + MetaVox API
├── styles.css           Panel styling
└── resources/
    └── icon.svg         Toolbar icon
```

## Supported field types

All MetaVox field types are rendered:

| Type | Display |
|------|---------|
| text, textarea | Plain text |
| number | Number |
| date | Localized date |
| select | Selected option |
| multiselect | Comma-separated options |
| checkbox | Yes / No |
| url | URL text |
| user | User ID |
| filelink | File reference |

## Current limitations

- **Read-only** — metadata is displayed but cannot be edited from the panel (planned for a future version)
- **File ID detection** relies on URL parsing — works with the standard ONLYOFFICE Nextcloud connector
- **Cross-origin**: if the DocumentServer runs on a different domain than Nextcloud, browser CORS policies may block API calls. Ensure the MetaVox OCS API allows cross-origin requests or use a same-domain setup.

## Roadmap

- [ ] **v0.2** — Inline editing of metadata fields from the panel
- [ ] **v0.3** — OOXML custom properties sync (embed metadata in the document file itself)

## License

AGPL-3.0 — same as Euro-Office DocumentServer and MetaVox.
