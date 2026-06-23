# MetaVox Editor Integrations

Integrations that surface [MetaVox](https://github.com/Rikdekker/MetaVox) document metadata
while editing a file in Nextcloud. **Each document editor needs a different mechanism**, so
the repo is split by platform:

| Folder | Editor | Status | Mechanism |
|--------|--------|--------|-----------|
| [`onlyoffice/`](onlyoffice/) | ONLYOFFICE / Euro-Office | ✅ Working (v0.3) | ONLYOFFICE plugin SDK — a `panelRight` panel **inside** the editor |
| [`collabora/`](collabora/) | Collabora Online / Nextcloud Office | 📐 Design only — not built | Host-level (WOPI postMessage + NC Files sidebar). See its README |

## Why one plugin can't cover both

The two editors have fundamentally different extension models:

- **ONLYOFFICE / Euro-Office** (Euro-Office is an ONLYOFFICE fork) expose a **plugin SDK**.
  Your own HTML/JS runs *inside* the editor as a docked panel (`window.Asc.plugin.*`,
  manifest with `guid` + `"type": "panelRight"`). That is what [`onlyoffice/`](onlyoffice/) uses.
- **Collabora Online** uses **WOPI + postMessage** between the editor iframe and the host.
  The host can insert toolbar buttons (`Insert_Button`), react to clicks (`Button_Clicked`),
  and draw its own UI *outside/over* the iframe — but there is **no API to inject a custom
  panel with fields inside the editor**. So the ONLYOFFICE plugin cannot be ported; a
  Collabora integration must live at the host level (in/around Nextcloud's `richdocuments`),
  reusing MetaVox's existing Vue metadata form.

See [`collabora/README.md`](collabora/README.md) for the two viable host-level approaches
(Files-sidebar tab vs. toolbar-button overlay) and the recommendation.

## License

AGPL-3.0 — same as Euro-Office DocumentServer, Collabora Online, and MetaVox.
