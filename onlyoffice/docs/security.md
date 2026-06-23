# Security

## Current state: reverse proxy (interim)

The plugin currently communicates with the MetaVox API through a reverse proxy on the DocumentServer domain. The proxy adds a hardcoded app password to every request.

**This is insecure.** The proxy endpoint is publicly accessible — anyone who knows the URL can read and write metadata without authentication. This setup is intended for development only.

See the [planned solution](#planned-jwt-based-authentication) below.

### Risks of the proxy approach

- The `/metavox-api/` endpoint is reachable without authentication
- The proxy adds credentials automatically — every request has full permissions
- Anyone can read metadata for any file the service account has access to
- Anyone can write metadata if POST is allowed
- The app password is stored in plain text in the nginx config

### Interim hardening (if proxy is still in use)

1. **Use a dedicated service account** — never an admin account
2. **Restrict POST requests** — block writes if not needed
3. **Add rate limiting** — prevent mass data extraction
4. **Restrict by IP** — if users are on an internal network

See `setup.md` for nginx configuration examples.

---

## Planned: JWT-based authentication

> **Status: Pending implementation in MetaVox.** See [MetaVox internal plan](https://gitea.rikdekker.nl/rik/MetaVox/src/branch/main/internal-docs/editor-plugin-jwt-auth-plan.md).

The planned solution eliminates the reverse proxy entirely by reusing the ONLYOFFICE JWT token for authentication.

### How it works

The ONLYOFFICE Nextcloud connector generates a JWT token per document editing session. This token:
- Is signed with the shared `JWT_SECRET` (HS256) between Nextcloud and the DocumentServer
- Contains: `userId`, `ownerId`, `fileId`, `filePath`, `shareToken`
- Is already available in the plugin via `Asc.plugin.info.documentCallbackUrl`

MetaVox will get a new `EditorController` that validates this JWT and uses it as authentication:

```
Plugin (browser)
  → GET https://nextcloud.example.com/ocs/v2.php/apps/metavox/api/v1/editor/files/{fileId}/metadata?doc=<JWT>&format=json
  → MetaVox validates JWT against ONLYOFFICE jwt_secret
  → Extracts userId from JWT payload
  → Returns metadata for that user
```

### Why this is better

| Aspect | Proxy (current) | JWT (planned) |
|--------|----------------|---------------|
| Authentication | None (hardcoded credentials) | Per-session JWT token |
| Authorization | Service account (shared) | Per-user (userId from JWT) |
| Public access | Anyone with URL | Only with valid JWT |
| Credential exposure | App password in nginx config | No credentials stored |
| CORS | Avoided via same-origin proxy | Avoided via query parameter (no preflight) |
| Proxy dependency | Required | Not needed |

### What needs to happen in MetaVox

1. **New `EditorController`** with `#[PublicPage]` + `#[CORS]` attributes
2. JWT validation using `firebase/jwt` library against the ONLYOFFICE `jwt_secret`
3. Four new OCS endpoints under `/api/v1/editor/`:
   - `GET /editor/files/{fileId}/metadata` — read file metadata
   - `POST /editor/files/{fileId}/metadata` — save file metadata
   - `GET /editor/groupfolders/{gfId}/metadata` — read team folder metadata
   - `GET /editor/groupfolders` — list groupfolders
4. The JWT is passed as `?doc=` query parameter (GET) or body parameter (POST)

### What changes in the plugin

Once the MetaVox endpoints are deployed:
1. Plugin sends requests directly to Nextcloud (not via proxy)
2. JWT token is included as `?doc=` query parameter
3. Nextcloud URL is detected from the callback URL origin
4. The reverse proxy can be removed

### CORS: why no preflight?

The JWT is sent as a query parameter, not a custom header. A GET request with only query parameters is a "simple request" — the browser does not send an OPTIONS preflight. The `#[CORS]` attribute on the endpoint adds `Access-Control-Allow-Origin` to the response.
