# MetaVox Metadata — Collabora Online

**Status: Phase 1 implemented (sidebar *beside* the document).** The editor-auth model and the
in-editor overlay are deliberately deferred — see [Roadmap](#roadmap).

Collabora Online (Nextcloud Office / CODE) cannot host the ONLYOFFICE plugin in
[`../onlyoffice/`](../onlyoffice/) — it has no API to inject a custom panel *inside* the
editor (see the [repo README](../README.md)). A Collabora integration must therefore live at
the **host level** (in/around Nextcloud's `richdocuments` app) and reuse MetaVox's existing
Vue metadata form rather than re-implementing it.

## Reuse — MetaVox already has the UI

MetaVox ships the editable metadata form as a **Files-sidebar tab** today. Both approaches
below reuse it instead of rebuilding:

- `MetaVox/src/filesplugin/filesplugin-main.js` — registers the Files-sidebar tab
  (NC33+ `window._nc_files_scope.v4_0.filesSidebarTabs.set()`, legacy `OCA.Files.Sidebar` fallback)
- `MetaVox/src/filesplugin/FilesSidebarTab.vue` → `MetaVox/src/filesplugin/MetadataForm.vue`
  + per-field components in `MetaVox/src/components/fields/`
- OCS read/write per file:
  `GET|POST /ocs/v2.php/apps/metavox/api/v1/groupfolders/{gfId}/files/{fileId}/metadata`

Unlike the ONLYOFFICE plugin (which decodes the `fileId` from a JWT in the callback URL),
the host already knows the `fileId` — no JWT trick needed.

## Two approaches

### A — MetaVox tab in the Nextcloud Files sidebar (next to the editor) — **IMPLEMENTED (Phase 1)**

The metadata sits in the NC Files sidebar **beside** the open Collabora document. The tab
already exists, so this is near-zero new code; it works for *every* editor (Collabora,
ONLYOFFICE, Euro-Office, plain file view). Trade-off: metadata is *beside* the editor, not
*in* it.

Implemented in MetaVox `src/filesplugin/collabora-sidebar.js` (loaded by
`filesplugin-main.js`): a `MutationObserver` detects the richdocuments viewer opening, reads
the open `fileId`, and opens the sidebar on the MetaVox tab — NC33+ via
`getSidebar().open(node, 'metavox')`, legacy via `OCA.Files.Sidebar.open(path)` +
`setActiveTab('metavox-metadata')`. Everything is feature-detected and wrapped in try/catch, so
it no-ops where the sidebar is not reachable next to the full-frame viewer and never breaks the
ONLYOFFICE flow. **Runs in the NC session — no JWT/proxy** (axios on the tab carries
session/CSRF; per-user ACLs apply).

The one runtime question — whether the Files sidebar is reachable *while* a document is open in
the full-frame richdocuments viewer — is answered by verifying on the dev pair
`collabora-dev.rikdekker.nl` (NC) + `collabora.rikdekker.nl` (Collabora). If it is not
reachable next to the viewer, approach B becomes the real "beside while editing" answer.

### B — Button in the Collabora toolbar → MetaVox overlay

Use Collabora's `Insert_Button` (postMessage) to add a MetaVox button to the editor toolbar;
on `Button_Clicked`, the host renders a MetaVox overlay (reusing `MetadataForm.vue`) over/next
to the iframe, sending `Blur_Focus` so Collabora doesn't grab focus. Closer to "in the editor",
but requires hooking `richdocuments`' `PostMessageService` (an extension point that isn't
standard today — likely a patch or upstream PR), so it carries the highest effort and the
highest maintenance risk against NC/richdocuments updates. Collabora-specific.

## Roadmap

- **Phase 1 — sidebar beside the document (A): done.** See above.
- **Phase 2 — editor-auth model: deferred (decision pending).** The end goal is metadata
  *in* the document (B). That overlay would run outside the NC session and needs authentication.
  Collabora's WOPI `access_token` is **opaque** and is issued/validated by `richdocuments`
  (mapping in `oc_richdocuments_wopi`) — MetaVox **cannot validate it standalone**, and there is
  no public richdocuments validation API. So the real-WOPI route (have richdocuments validate
  the token) would require a patch/upstream PR, while the alternative is a MetaVox-issued
  short-lived HS256 session token (same `EditorController` shape as the planned ONLYOFFICE path,
  no richdocuments coupling). We pick this once we build the overlay and know more about
  richdocuments' options — no `EditorController`/JWT code lands before then.
- **Phase 3 — button in the Collabora toolbar → overlay (B): later.** Depends on the Phase 2
  auth choice and on hooking richdocuments' `PostMessageService`.

## References

- WOPI postMessage model (host UI only *outside* the iframe):
  https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/scenarios/postmessage
- Adding a button to Nextcloud Office:
  https://help.nextcloud.com/t/how-to-add-a-button-to-nextcloud-office-document-editor/158037
- NC Files sidebar tab API: https://github.com/nextcloud-libraries/nextcloud-files
