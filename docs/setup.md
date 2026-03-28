# Setup Guide

## Requirements

- **Nextcloud** with the [MetaVox](https://gitea.rikdekker.nl/rik/MetaVox) app installed and enabled
- **Euro-Office DocumentServer** or **ONLYOFFICE Document Server**
- **ONLYOFFICE Nextcloud connector** app (`onlyoffice` app in Nextcloud)
- **Nginx Proxy Manager** (or any reverse proxy) in front of the DocumentServer

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

## Step 2: Create a Nextcloud app password

The reverse proxy authenticates with Nextcloud using an app password.

1. Log in to Nextcloud as an admin user
2. Go to **Settings → Security → Devices & sessions**
3. Enter a name (e.g., "MetaVox Editor Plugin") and click **Create new app password**
4. Copy the generated password — you'll need it in the next step

## Step 3: Configure the reverse proxy

The plugin communicates with the MetaVox API through a same-origin reverse proxy. This avoids CORS issues entirely.

### How it works

```
Plugin (euro-office.example.com)
  → /metavox-api/files/123/metadata     (same-origin request)
  → Reverse proxy adds Basic auth header
  → Nextcloud MetaVox OCS API responds
```

### Generate the Basic auth header

Encode your Nextcloud credentials:

```bash
echo -n "username:app-password" | base64
# Output: dXNlcm5hbWU6YXBwLXBhc3N3b3Jk
```

### Nginx Proxy Manager

Create or edit the custom config file for your Euro-Office proxy host:

**File:** `/data/nginx/custom/server_proxy.conf` (inside the NPM container)

```nginx
# MetaVox API proxy — avoids CORS by proxying through same origin
location /metavox-api/ {
    proxy_pass https://your-nextcloud.example.com/ocs/v2.php/apps/metavox/api/v1/;
    proxy_set_header Host your-nextcloud.example.com;
    proxy_set_header Authorization "Basic <your-base64-credentials>";
    proxy_set_header OCS-APIREQUEST "true";
    proxy_ssl_verify off;
    proxy_ssl_server_name on;
}
```

Replace:
- `your-nextcloud.example.com` with your Nextcloud domain
- `<your-base64-credentials>` with the base64 string from above

Copy the file into the NPM container and reload:

```bash
docker cp server_proxy.conf nginxproxy-manager:/data/nginx/custom/server_proxy.conf
docker exec nginxproxy-manager nginx -s reload
```

### Plain nginx

Add to your Euro-Office server block:

```nginx
server {
    server_name euro-office.example.com;

    # ... existing Euro-Office proxy config ...

    # MetaVox API proxy
    location /metavox-api/ {
        proxy_pass https://your-nextcloud.example.com/ocs/v2.php/apps/metavox/api/v1/;
        proxy_set_header Host your-nextcloud.example.com;
        proxy_set_header Authorization "Basic <your-base64-credentials>";
        proxy_set_header OCS-APIREQUEST "true";
        proxy_ssl_verify off;
        proxy_ssl_server_name on;
    }
}
```

## Step 4: Verify

Test the proxy endpoint:

```bash
curl -s "https://euro-office.example.com/metavox-api/files/12345/metadata?format=json"
```

You should get a JSON response with metadata fields. If you see `{"ocs":{"data":[...]}}`, the setup is complete.

## Step 5: Test in the editor

1. Open a document from Nextcloud in Euro-Office
2. Click the **Plugins** tab in the toolbar
3. Click **MetaVox Metadata**
4. The right panel should show the document's metadata fields

## Development: disable caching

The DocumentServer serves plugin files with aggressive cache headers (`max-age=31536000, immutable`). During development, patch the nginx config inside the container to disable caching for the plugin:

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

> **Note:** This patch is lost when the container restarts. Re-apply after each restart during development.
