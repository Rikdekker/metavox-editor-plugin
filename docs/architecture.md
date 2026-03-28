# Architecture

## Overview

The MetaVox Editor Plugin is an ONLYOFFICE/Euro-Office document editor plugin that displays MetaVox metadata in a right-side panel. It communicates with the MetaVox Nextcloud app through a same-origin reverse proxy.

## Data flow

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                      │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │ Euro-Office       │    │ MetaVox Plugin (panelRight)  │   │
│  │ Document Editor   │    │                              │   │
│  │                   │    │  1. Read Asc.plugin.info     │   │
│  │ Provides:         │───▶│  2. Decode JWT from callback │   │
│  │ - plugin.info     │    │  3. Extract fileId           │   │
│  │ - documentCallback│    │  4. GET /metavox-api/...     │   │
│  └──────────────────┘    └──────────┬───────────────────┘   │
│                                      │ same-origin           │
└──────────────────────────────────────┼──────────────────────┘
                                       │
                         ┌─────────────▼─────────────┐
                         │ Reverse Proxy (NPM/nginx)  │
                         │ euro-office.example.com     │
                         │                             │
                         │ /metavox-api/* ──────────┐  │
                         │   + Basic auth header    │  │
                         │   + OCS-APIREQUEST       │  │
                         └─────────────────────────┼──┘
                                                    │
                         ┌─────────────────────────▼──┐
                         │ Nextcloud + MetaVox         │
                         │ nextcloud.example.com       │
                         │                             │
                         │ /ocs/v2.php/apps/metavox/   │
                         │   api/v1/files/{id}/metadata│
                         └─────────────────────────────┘
```

## File ID detection

The ONLYOFFICE Nextcloud connector sets a `documentCallbackUrl` in the editor config. This URL contains a JWT token as the `doc` query parameter:

```
https://nextcloud.example.com/index.php/apps/onlyoffice/track?doc=<JWT>
```

The JWT payload (base64-encoded, no signature verification needed) contains:

```json
{
  "userId": "admin",
  "ownerId": "admin",
  "fileId": 121442,
  "filePath": "/Demo 3/Reports/file.docx",
  "shareToken": null,
  "action": "track"
}
```

The plugin extracts `fileId` by decoding the JWT payload:

```javascript
var parts = jwt.split('.');
var payload = JSON.parse(atob(parts[1]));
var fileId = payload.fileId;
```

## API communication

The plugin makes a single GET request to fetch metadata:

```
GET /metavox-api/files/{fileId}/metadata?format=json
```

This is a relative URL (same-origin). The reverse proxy forwards it to:

```
GET /ocs/v2.php/apps/metavox/api/v1/files/{fileId}/metadata?format=json
```

The proxy adds `Authorization` and `OCS-APIREQUEST` headers server-side.

### Response format

```json
{
  "ocs": {
    "meta": { "status": "ok", "statuscode": 200 },
    "data": [
      {
        "id": 4,
        "field_name": "file_gf_department",
        "field_label": "Department",
        "field_type": "select",
        "field_options": ["Finance", "HR", "IT", "R&D"],
        "is_required": false,
        "value": "R&D"
      }
    ]
  }
}
```

Each field object contains the definition (name, label, type, options, required) and the current value for this file.

## Rendering

Field values are rendered based on `field_type`:

| Type | Renderer |
|------|----------|
| `text`, `textarea`, `number` | Plain text |
| `date` | `toLocaleDateString()` |
| `select` | Plain text |
| `multiselect` | Split on `;#` separator, rendered as pill tags |
| `checkbox` | Checkmark (✓) or cross (✗) with colored background |
| `url` | Clickable `<a>` link |
| `user` | Plain text (user ID) |
| `filelink` | Plain text (file reference) |

Empty values (`null`, `""`) display an em dash (—) with italic styling.

## ONLYOFFICE Plugin API

The plugin uses these ONLYOFFICE APIs:

| API | Usage |
|-----|-------|
| `window.Asc.plugin.init` | Entry point — called when the plugin panel opens |
| `window.Asc.plugin.info` | Contains `documentCallbackUrl`, `documentTitle`, `userId`, `lang`, `theme` |
| `window.Asc.plugin.onThemeChanged` | Called when the editor theme changes (dark/light) — updates CSS variables |
| `window.Asc.plugin.onExternalMouseUp` | Required stub (prevents plugin from stealing mouse events) |

## File overview

| File | Responsibility |
|------|---------------|
| `config.json` | Plugin manifest — defines `panelRight` variation, supported editors, icon |
| `plugin.js` | Core logic: JWT decoding, API fetch, DOM rendering, theme support |
| `index.html` | Panel HTML shell with header, refresh button, content container |
| `styles.css` | Styling with CSS variables for theme support |
| `settings.html` | Legacy settings form (not used with proxy setup) |
| `settings.js` | Legacy settings persistence (not used with proxy setup) |
| `vendor/plugins.js` | Bundled ONLYOFFICE plugin SDK |
| `resources/icon.svg` | Toolbar icon (document with lines) |

## Why a reverse proxy?

The plugin runs in an iframe on the DocumentServer domain (e.g., `euro-office.example.com`). The MetaVox API lives on the Nextcloud domain (e.g., `nextcloud.example.com`). This is cross-origin.

Cross-origin requests require a CORS preflight (OPTIONS request). Nextcloud returns `405 Method Not Allowed` on OPTIONS — this is a known Nextcloud limitation. Without a successful preflight, the browser blocks the entire request.

The reverse proxy solves this by making the API call same-origin from the plugin's perspective. The proxy handles authentication server-side, so no credentials are exposed in the browser.
