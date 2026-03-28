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
2. Detects the Nextcloud file ID from `Asc.plugin.info` (callback URL, document URL)
3. Calls the MetaVox OCS API to fetch the file's metadata
4. Renders the metadata fields (labels + values) in the panel

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

## Configuration

After installation, open the plugin settings (click the MetaVox icon in the toolbar, then access settings):

1. **Nextcloud URL** — The base URL of your Nextcloud instance (e.g., `https://cloud.example.com`)
2. **Username** (optional) — Nextcloud username, only needed for cross-origin setups
3. **App Password** (optional) — Generate in Nextcloud: Settings > Security > Devices & sessions

Settings are stored in the browser's `localStorage`.

### Same-domain vs cross-domain

| Setup | Auth method | Configuration |
|-------|-------------|---------------|
| Same domain (reverse proxy) | Session cookies | Only set Nextcloud URL |
| Different domains | App password | Set URL + username + app password |

## Plugin structure

```
metavox-editor-plugin/
├── config.json          Plugin manifest (panelRight + settings window)
├── index.html           Panel HTML with refresh button
├── plugin.js            Core logic: file ID detection, API, rendering
├── styles.css           Panel styling (theme-aware)
├── settings.html        Settings form (Nextcloud URL, credentials)
├── settings.js          Settings persistence (localStorage)
├── vendor/
│   └── plugins.js       ONLYOFFICE plugin SDK (bundled)
└── resources/
    └── icon.svg         Toolbar icon
```

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

## API endpoint used

```
GET /ocs/v2.php/apps/metavox/api/v1/files/{fileId}/metadata?format=json
```

Response format:
```json
{
  "ocs": {
    "meta": { "status": "ok", "statuscode": 200 },
    "data": [
      {
        "id": 4,
        "field_name": "file_gf_status",
        "field_label": "Status",
        "field_type": "select",
        "field_options": ["Open", "Closed"],
        "is_required": true,
        "value": "Open"
      }
    ]
  }
}
```

## Current limitations

- **Read-only** — metadata is displayed but cannot be edited from the panel (planned for v0.3)
- **File ID detection** relies on `Asc.plugin.info` URLs — works with the standard ONLYOFFICE/Euro-Office Nextcloud connector
- **Cross-origin** requires app password — session cookies don't work cross-domain

## Roadmap

- [x] **v0.1** — Basic scaffold
- [x] **v0.2** — Settings screen, robust file ID detection, auth support, improved UI
- [ ] **v0.3** — Inline editing of metadata fields from the panel
- [ ] **v0.4** — OOXML custom properties sync (embed metadata in the document file itself)

## License

AGPL-3.0 — same as Euro-Office DocumentServer and MetaVox.
