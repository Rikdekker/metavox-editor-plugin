# Setup Guide

## Requirements

- **Nextcloud** with the [MetaVox](https://gitea.rikdekker.nl/rik/MetaVox) app installed and enabled
- **Euro-Office DocumentServer** or **ONLYOFFICE Document Server**
- **ONLYOFFICE Nextcloud connector** app (`onlyoffice` app in Nextcloud)

### Planned (not yet available)

Once MetaVox implements JWT-based editor authentication (see [security.md](security.md#planned-jwt-based-authentication)), the reverse proxy will no longer be needed. Until then, a reverse proxy is required.

## Step 1: Install the plugin on the DocumentServer

The plugin must be mounted into the DocumentServer's plugin directory.

### Docker (recommended)

Add a volume mount to your `docker-compose.yml`:

```yaml
services:
  euro-office:
    image: ghcr.io/euro-office/documentserver:latest
    volumes:
      # ... existing volumes ...
      - ./metavox-editor-plugin:/var/www/onlyoffice/documentserver/sdkjs-plugins/metavox-editor-plugin:ro
```

Place the plugin files next to the `docker-compose.yml`:

```
euro-office/
├── docker-compose.yml
├── .env
└── metavox-editor-plugin/
    ├── config.json
    ├── index.html
    ├── plugin.js
    ├── styles.css
    └── ...
```

Then restart the container:

```bash
docker compose down && docker compose up -d
```

### Direct installation (non-Docker)

```bash
cp -r metavox-editor-plugin /var/www/onlyoffice/documentserver/sdkjs-plugins/
```

Restart the DocumentServer service after copying.

## Step 1b: Auto-open the plugin (optional)

By default, users must click the MetaVox icon in the Plugins tab to open the panel. To have the plugin open automatically when a document is loaded:

### Docker

Add an `autostart-plugins.json` file next to your `docker-compose.yml`:

```json
{
  "services": {
    "CoAuthoring": {
      "plugins": {
        "autostart": [
          "asc.{b5c3e4f2-7a1d-4e8f-9c6b-2d3f5a8e1b7c}"
        ]
      }
    }
  }
}
```

Mount it in your `docker-compose.yml`:

```yaml
volumes:
  - ./autostart-plugins.json:/etc/onlyoffice/documentserver/autostart-plugins.json:ro
```

After the container starts, merge the autostart config into the DocumentServer's `local.json`:

```bash
docker exec euro-office python3 -c "
import json
with open('/etc/onlyoffice/documentserver/local.json') as f:
    local = json.load(f)
with open('/etc/onlyoffice/documentserver/autostart-plugins.json') as f:
    autostart = json.load(f)
co = local.setdefault('services', {}).setdefault('CoAuthoring', {})
plugins = co.setdefault('plugins', {})
plugins['autostart'] = autostart['services']['CoAuthoring']['plugins']['autostart']
with open('/etc/onlyoffice/documentserver/local.json', 'w') as f:
    json.dump(local, f, indent=2)
print('Autostart configured')
"

docker exec euro-office supervisorctl restart docservice
```

> **Note:** This merge must be re-applied after each `docker compose down/up` because the container regenerates `local.json` on startup.

### Per-user preference

When autostart is enabled, the plugin opens automatically for all users. Each user can disable this for themselves using the **Auto-open** toggle in the plugin panel header. This preference is stored in the browser's `localStorage` and persists between sessions.

- **Auto-open: On** (default) — plugin opens automatically when editing a document
- **Auto-open: Off** — plugin stays closed, user opens it manually via the Plugins tab

## Step 2: Configure the reverse proxy (interim)

> **Security notice:** The reverse proxy makes the MetaVox API accessible without user authentication. This is an interim solution — the planned JWT-based approach (see [security.md](security.md)) will eliminate this risk. For now, follow the hardening steps below.

### Create a dedicated service account

Do **not** use an admin account.

1. Create a dedicated Nextcloud user (e.g., `metavox-plugin-service`)
2. Add this user to the relevant team folders with **read access**
3. Do **not** give this user admin privileges
4. Log in as this user → **Settings → Security → Devices & sessions**
5. Create an app password and copy it

### Generate the Basic auth header

```bash
echo -n "metavox-plugin-service:app-password-here" | base64
```

### Nginx Proxy Manager

Create the custom config file for your Euro-Office proxy host:

**File:** `/data/nginx/custom/server_proxy.conf` (inside the NPM container)

```nginx
# MetaVox API proxy (interim — will be replaced by JWT auth)
location /metavox-api/ {
    proxy_pass https://your-nextcloud.example.com/ocs/v2.php/apps/metavox/api/v1/;
    proxy_set_header Host your-nextcloud.example.com;
    proxy_set_header Authorization "Basic <your-base64-credentials>";
    proxy_set_header OCS-APIREQUEST "true";
    proxy_ssl_verify off;
    proxy_ssl_server_name on;
}
```

Copy into the NPM container and reload:

```bash
docker cp server_proxy.conf nginxproxy-manager:/data/nginx/custom/server_proxy.conf
docker exec nginxproxy-manager nginx -s reload
```

### Hardening the proxy (recommended)

Add rate limiting and method restrictions:

```nginx
# In NPM custom http config: /data/nginx/custom/http.conf
limit_req_zone $binary_remote_addr zone=metavox:10m rate=30r/m;
```

```nginx
# In server_proxy.conf
location /metavox-api/ {
    limit_req zone=metavox burst=10 nodelay;
    limit_except GET POST {
        deny all;
    }
    proxy_pass ...;
}
```

## Step 3: Verify

Test the proxy endpoint:

```bash
curl -s "https://euro-office.example.com/metavox-api/files/12345/metadata?format=json"
```

You should get a JSON response with metadata fields.

## Step 4: Test in the editor

1. Open a document from Nextcloud in Euro-Office
2. Click the **Plugins** tab in the toolbar
3. Click **MetaVox Metadata**
4. The right panel should show the document's metadata fields

## Development: disable caching

The DocumentServer serves plugin files with `Cache-Control: public, max-age=31536000, immutable`. During development, patch the nginx config inside the container:

```bash
docker exec euro-office python3 -c "
with open('/etc/nginx/includes/ds-docservice.conf', 'r') as f:
    content = f.read()

old = '''location ~ ^(\\/[\\d]+\\.[\\d]+\\.[\\d]+[\\.|-][\\w]+)?\\/(web-apps|sdkjs|sdkjs-plugins|fonts|dictionaries)(\\/.*)$ {
  add_header Cache-Control \"public, max-age=31536000, immutable\" always;
  gzip_static on;
  alias /var/www/onlyoffice/documentserver/\$2\$3;
}'''

new = '''location ~ ^(\\/[\\d]+\\.[\\d]+\\.[\\d]+[\\.|-][\\w]+)?\\/(sdkjs-plugins\\/metavox-editor-plugin)(\\/.*)$ {
  add_header Cache-Control \"no-store, no-cache, must-revalidate\" always;
  gzip_static on;
  alias /var/www/onlyoffice/documentserver/\$2\$3;
}

location ~ ^(\\/[\\d]+\\.[\\d]+\\.[\\d]+[\\.|-][\\w]+)?\\/(web-apps|sdkjs|sdkjs-plugins|fonts|dictionaries)(\\/.*)$ {
  add_header Cache-Control \"public, max-age=31536000, immutable\" always;
  gzip_static on;
  alias /var/www/onlyoffice/documentserver/\$2\$3;
}'''

if old in content:
    content = content.replace(old, new)
    with open('/etc/nginx/includes/ds-docservice.conf', 'w') as f:
        f.write(content)
    print('Patched')
"

docker exec euro-office nginx -s reload
```

> **Note:** This patch is lost when the container restarts.
