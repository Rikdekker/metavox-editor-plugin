# Troubleshooting

## Plugin does not appear in the editor

**Symptoms:** No "MetaVox Metadata" button in the Plugins tab.

**Causes:**
- Plugin files not mounted correctly in the container
- Container not restarted after adding the volume mount

**Fix:**
```bash
# Verify the plugin is visible inside the container
docker exec euro-office ls /var/www/onlyoffice/documentserver/sdkjs-plugins/metavox-editor-plugin/config.json

# If not found, check your docker-compose volume mount and restart
docker compose down && docker compose up -d
```

---

## "Could not detect file ID"

**Symptoms:** Panel shows a warning that the file ID could not be detected.

**Causes:**
- The document was not opened from Nextcloud (opened directly or via a different connector)
- The ONLYOFFICE Nextcloud connector is not installed or configured
- The `documentCallbackUrl` in `Asc.plugin.info` does not contain a JWT `doc` parameter

**Fix:**
- Ensure you open the document from within the Nextcloud Files app
- Verify the ONLYOFFICE connector app is installed and configured in Nextcloud admin settings

---

## "Cannot connect to MetaVox API" / "Error (HTTP 502)"

**Symptoms:** Panel shows a connection error.

**Causes:**
- Reverse proxy not configured (no `/metavox-api/` location block)
- Wrong Nextcloud URL in the proxy config
- Nextcloud is not reachable from the proxy server
- Invalid or expired app password

**Fix:**
```bash
# Test the proxy endpoint directly
curl -v "https://euro-office.example.com/metavox-api/files/12345/metadata?format=json"

# If 502/503: check if Nextcloud is reachable from the server
curl -s -o /dev/null -w "%{http_code}" "https://nextcloud.example.com/status.php"

# If 401: regenerate the app password and update the proxy config
echo -n "username:new-app-password" | base64
# Update the Authorization header in the proxy config and reload nginx
```

---

## "No metadata fields configured for this file"

**Symptoms:** Panel shows an info message that no fields are configured.

**Causes:**
- The file is not in a Nextcloud Team Folder (groupfolder)
- No MetaVox fields are assigned to the Team Folder containing this file
- The MetaVox app is installed but no fields have been created yet

**Fix:**
- Open Nextcloud → Admin Settings → MetaVox → verify fields exist
- Check that the Team Folder has MetaVox fields assigned

---

## Fields appear but all values are "—" (empty)

**Symptoms:** Field labels are shown but no values.

**Causes:**
- No metadata values have been entered for this file in Nextcloud
- **MetaVox version too old:** the `/files/{fileId}/metadata` API endpoint had a bug where it returned fields without groupfolder context, causing values to not match. This was fixed in MetaVox 2.0.0-beta.3.

**Fix:**
- Verify the file has metadata in Nextcloud (check the grid view)
- Update MetaVox to at least 2.0.0-beta.3
- Test the API directly: `curl https://euro-office.example.com/metavox-api/files/{fileId}/metadata?format=json` — the response should include `"value": "..."` for fields that have data

---

## Old plugin version is loaded (changes not visible)

**Symptoms:** You updated plugin files but the editor still shows the old version.

**Cause:** The DocumentServer nginx serves plugin files with `Cache-Control: public, max-age=31536000, immutable`. The browser caches them for 1 year.

**Fix:**

1. **Quick fix:** Open in an incognito/private browser window
2. **Proper fix:** Patch the nginx config inside the container to disable caching for the plugin (see [setup guide](setup.md#development-disable-caching))
3. **Nuclear option:** Restart the container AND clear browser cache

> **Note:** The nginx cache patch is lost on container restart. For production, use versioned deployments instead of hot-reloading files.

---

## Plugin shows "Auto-open is disabled"

**Symptoms:** Panel shows an info message about auto-open being disabled instead of metadata.

**Cause:** The user previously toggled auto-open off. The preference is stored in the browser's `localStorage`.

**Fix:**
- Click the **toggle switch** in the plugin header to re-enable auto-open
- Or clear `localStorage` for the DocumentServer domain in browser DevTools:
  ```javascript
  localStorage.removeItem('metavox_auto_show')
  ```

---

## Plugin does not auto-open when loading a document

**Symptoms:** The plugin is installed but the panel does not open automatically. Users must click Plugins → MetaVox Metadata manually.

**Causes:**
- The plugin GUID is not in the DocumentServer's `autostart` config
- The autostart config was lost after a container restart

**Fix:**
- Follow the [autostart setup](setup.md#step-1b-auto-open-the-plugin-optional) instructions
- After container restart, re-apply the merge command to inject the autostart config into `local.json`

---

## "Access denied (HTTP 403)"

**Symptoms:** Panel shows an access denied error.

**Causes:**
- The app password user does not have access to the file
- The file is in a Team Folder the user is not a member of

**Fix:**
- Use an admin account for the app password, or ensure the user has access to the Team Folder
- Check Nextcloud Team Folder permissions
