# Approach B — MetaVox button in the Collabora toolbar → overlay (research)

**Conclusion: feasible WITHOUT patching richdocuments.** Verified against `richdocuments 10.2.0`
on `nc-collab` (paired with `collabora-dev.rikdekker.nl` / `collabora.rikdekker.nl`).

## Why we are here

Phase 1 (the MetaVox Files-sidebar tab *beside* the document) was built and deployed, then
verified in the browser: **Collabora opens full-frame and the Nextcloud Files UI — including the
sidebar — disappears while editing.** So "metadata beside the document *while editing*" is not
reachable via the sidebar. The Server-audit dialog on this instance shows
**"PostMessage API is initialized"**, so the WOPI postMessage channel is available — Approach B
is the real path. This note documents exactly how B can hook in on this server.

## What richdocuments exposes (evidence from `js/richdocuments-document.js`)

All findings are from the shipped, minified bundle on the live server.

1. **Incoming WOPI messages are re-emitted on the Nextcloud event bus.**
   `PostMessageService.handlePostMessage` parses every message from the Collabora iframe and does
   `emit('richdocuments:wopi-post', <raw parsed message>)` (via `@nextcloud/event-bus`):
   ```js
   handlePostMessage = function (n) {
     var o = parsePostMessage(n)
     ... emit('richdocuments:wopi-post', JSON.parse(n))
     this.postMessageHandlers.forEach(e => e({ data: n, parsed: o }))
   }
   ```
   → **MetaVox can `subscribe('richdocuments:wopi-post', cb)` to receive `Button_Clicked` (and
   every other WOPI event) with no patch.**

2. **Document load lifecycle is on the event bus too**, carrying the fileId:
   `emit('richdocuments:wopi-load:started', { wopiFileId })`,
   `…:succeeded`, `…:failed`.
   → **MetaVox knows a document opened and for which file** via
   `subscribe('richdocuments:wopi-load:succeeded', ({ wopiFileId }) => …)`.

3. **richdocuments itself adds toolbar buttons via the same API we'd use.** It already sends:
   ```js
   sendWOPIPostMessage('loolframe', 'Insert_Button', {
     id: 'Open_Local_Editor', imgurl: …, label: 'Open in local editor',
     insertBefore: 'print', accessKey: '2', mobile: false, tablet: false,
   })
   ```
   `sendWOPIPostMessage(target, msgId, values)` wraps `{ MessageId, SendTime, Values }` and posts
   JSON to the target frame. The iframe target ids in use are **`loolframe` / `loleafletframe`**
   (and a `#proxy` frame). The `PostMessageService` instance is **module-private** — there is no
   `window.`/`OCA.` global for it — so we do NOT call `sendWOPIPostMessage` directly.

   → **MetaVox sends `Insert_Button` itself** by posting to the Collabora iframe's
   `contentWindow`:
   ```js
   const frame = document.getElementById('loleafletframe') // WOPI iframe on this build
   frame.contentWindow.postMessage(JSON.stringify({
     MessageId: 'Insert_Button',
     Values: { id: 'metavox-metadata', imgurl: <icon>, label: 'MetaVox',
               mobile: false, tablet: false },
   }), '*')
   ```
   The button must be (re)sent after the doc is ready — trigger it from the
   `richdocuments:wopi-load:succeeded` subscription.

## Resulting flow (no richdocuments patch)

```
doc opens in Collabora
  → richdocuments emits 'richdocuments:wopi-load:succeeded' { wopiFileId }
      → MetaVox: postMessage Insert_Button {id:'metavox-metadata'} to #loleafletframe
user clicks the MetaVox button in the Collabora toolbar
  → Collabora posts a WOPI 'Button_Clicked' {id:'metavox-metadata'} to window
      → richdocuments emits 'richdocuments:wopi-post' { MessageId:'Button_Clicked', Values:{Id:'metavox-metadata'} }
          → MetaVox: render MetadataForm.vue overlay over/next to the iframe for wopiFileId
            (send 'Blur_Focus' so Collabora doesn't steal focus)
```

Everything rides on **public NC event-bus events** + the **standard WOPI postMessage protocol** —
no `PostMessageService` patch, no `richdocuments` fork. Risk is limited to richdocuments renaming
those two event names or the iframe id across versions (cheap to feature-detect and log).

## Open verification steps (next, on nc-collab)

1. Confirm the WOPI iframe element id at runtime (`#loleafletframe` vs `#loolframe` vs nested
   `#proxy`) and that `contentWindow.postMessage(Insert_Button)` makes the button appear.
2. Confirm `Button_Clicked` arrives on `richdocuments:wopi-post` with our `id`.
3. Confirm an absolutely-positioned host overlay can sit over the full-frame iframe and that
   `Blur_Focus`/`Grab_Focus` behave.
4. Decide the **editor-auth model** for the overlay (still deferred):
   - The overlay runs inside the same NC page/session as richdocuments, so axios with
     session/CSRF likely *just works* (same as the sidebar tab) — **no JWT may be needed for B
     either**, since we are not crossing into the WOPI iframe. **Re-test this assumption first**;
     only fall back to a token model if the overlay turns out to be sandboxed from the session.
   - If a token *is* needed: Collabora's WOPI `access_token` is opaque (issued/validated by
     richdocuments, mapping in `oc_richdocuments_wopi`) and not standalone-verifiable by MetaVox;
     prefer a MetaVox-issued short-lived HS256 token (same `EditorController` shape as the
     planned ONLYOFFICE path) over patching richdocuments to expose WOPI validation.

## References
- WOPI postMessage protocol (Insert_Button, Button_Clicked, Blur_Focus, Hide_Menu_Item):
  https://sdk.collaboraonline.com/docs/postmessage_api.html
- NC event bus (`@nextcloud/event-bus` subscribe/emit):
  https://github.com/nextcloud-libraries/nextcloud-event-bus
