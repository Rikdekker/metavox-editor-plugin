(function (window, undefined) {
    'use strict';

    var STORAGE_KEY = 'metavox_plugin_settings';
    var API_TIMEOUT = 10000; // 10 seconds
    var MAX_RETRIES = 1;

    // State
    var currentFileId = null;
    var settings = null;

    // ─── Plugin Lifecycle ──────────────────────────────────────────────

    window.Asc.plugin.init = function () {
        settings = loadSettings();
        detectAndLoadMetadata();
    };

    window.Asc.plugin.onExternalMouseUp = function () {};

    window.Asc.plugin.onThemeChanged = function (theme) {
        applyTheme(theme);
    };

    // ─── Settings ──────────────────────────────────────────────────────

    function loadSettings() {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {}
        }
        return { nextcloudUrl: '', authUser: '', authToken: '' };
    }

    function getNextcloudUrl() {
        if (settings && settings.nextcloudUrl) {
            return settings.nextcloudUrl;
        }
        // Fallback: try to detect from plugin info
        return detectNextcloudUrl();
    }

    function getAuthHeaders() {
        var headers = {
            'OCS-APIREQUEST': 'true',
            'Accept': 'application/json'
        };
        if (settings && settings.authUser && settings.authToken) {
            headers['Authorization'] = 'Basic ' + btoa(settings.authUser + ':' + settings.authToken);
        }
        return headers;
    }

    // ─── File ID Detection ─────────────────────────────────────────────

    /**
     * Detect the Nextcloud file ID from the editor context.
     *
     * Strategy (in order):
     * 1. Asc.plugin.info — the ONLYOFFICE connector passes document metadata
     *    that often contains the file ID in the callback URL or document URL
     * 2. Referrer URL — may contain fileId query param
     * 3. Parent frame URL — works when same-origin
     */
    function detectFileId() {
        var fileId = null;

        // Strategy 1: Plugin info object (most reliable)
        try {
            var info = window.Asc.plugin.info;
            if (info) {
                // Try callback URL: typically contains fileId
                fileId = extractFileIdFromUrl(info.documentCallbackUrl);
                if (fileId) return fileId;

                // Try document URL
                fileId = extractFileIdFromUrl(info.documentUrl);
                if (fileId) return fileId;

                // Try the full info object for any fileId reference
                var infoStr = JSON.stringify(info);
                var match = infoStr.match(/fileId["\s:=]+(\d+)/i);
                if (match) return match[1];
            }
        } catch (e) {}

        // Strategy 2: Referrer
        try {
            var referrer = document.referrer;
            if (referrer) {
                fileId = extractFileIdFromUrl(referrer);
                if (fileId) return fileId;
            }
        } catch (e) {}

        // Strategy 3: Parent frame (same-origin only)
        try {
            var parentUrl = window.parent.location.href;
            fileId = extractFileIdFromUrl(parentUrl);
            if (fileId) return fileId;
        } catch (e) {}

        return null;
    }

    /**
     * Extract file ID from a URL string.
     * Looks for:
     * - Query param: ?fileId=123 or &fileid=123
     * - Path segment: /apps/onlyoffice/123
     * - Path segment: /apps/onlyoffice/editor/123
     */
    function extractFileIdFromUrl(url) {
        if (!url) return null;
        try {
            var parsed = new URL(url);

            // Query parameter
            var id = parsed.searchParams.get('fileId') || parsed.searchParams.get('fileid');
            if (id && /^\d+$/.test(id)) return id;

            // Path patterns
            var patterns = [
                /\/apps\/onlyoffice\/(\d+)/,
                /\/apps\/onlyoffice\/editor\/(\d+)/,
                /\/apps\/richdocuments\/(\d+)/,
                /\/index\.php\/apps\/onlyoffice\/(\d+)/,
                /fileId=(\d+)/
            ];
            for (var i = 0; i < patterns.length; i++) {
                var match = (parsed.pathname + parsed.search).match(patterns[i]);
                if (match) return match[1];
            }
        } catch (e) {
            // Not a valid URL — try regex on raw string
            var rawMatch = String(url).match(/fileId[=:](\d+)/i);
            if (rawMatch) return rawMatch[1];
        }
        return null;
    }

    /**
     * Detect Nextcloud base URL from the plugin context.
     */
    function detectNextcloudUrl() {
        try {
            var info = window.Asc.plugin.info;
            if (info && info.documentCallbackUrl) {
                var parsed = new URL(info.documentCallbackUrl);
                var base = parsed.origin + parsed.pathname.replace(/\/ocs\/.*$/, '').replace(/\/apps\/.*$/, '').replace(/\/index\.php.*$/, '');
                return base.replace(/\/+$/, '');
            }
        } catch (e) {}

        try {
            var referrer = document.referrer;
            if (referrer) {
                var parsed2 = new URL(referrer);
                var base2 = parsed2.origin + parsed2.pathname.replace(/\/apps\/.*$/, '').replace(/\/index\.php.*$/, '');
                return base2.replace(/\/+$/, '');
            }
        } catch (e) {}

        return null;
    }

    // ─── MetaVox API ───────────────────────────────────────────────────

    function fetchMetadata(baseUrl, fileId, callback, retryCount) {
        retryCount = retryCount || 0;
        var apiUrl = baseUrl + '/ocs/v2.php/apps/metavox/api/v1/files/' + fileId + '/metadata?format=json';
        var headers = getAuthHeaders();
        var useCredentials = !headers['Authorization']; // Use cookies if no app password

        var xhr = new XMLHttpRequest();
        xhr.open('GET', apiUrl, true);
        xhr.timeout = API_TIMEOUT;
        xhr.withCredentials = useCredentials;

        for (var key in headers) {
            if (headers.hasOwnProperty(key)) {
                xhr.setRequestHeader(key, headers[key]);
            }
        }

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;

            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    // OCS response: { ocs: { meta: {...}, data: [...] } }
                    var data = response.ocs ? response.ocs.data : response;
                    callback(null, Array.isArray(data) ? data : []);
                } catch (e) {
                    callback(new Error('Failed to parse metadata response.'));
                }
            } else if (xhr.status === 0 && retryCount < MAX_RETRIES) {
                // Network error — retry once after 1s
                setTimeout(function () {
                    fetchMetadata(baseUrl, fileId, callback, retryCount + 1);
                }, 1000);
            } else if (xhr.status === 401) {
                callback(new Error('Authentication failed. Open plugin settings to configure your Nextcloud credentials.'));
            } else if (xhr.status === 403) {
                callback(new Error('Access denied. You may not have permission to view this file\u2019s metadata.'));
            } else if (xhr.status === 404) {
                callback(new Error('MetaVox not found. Is the MetaVox app installed and enabled on Nextcloud?'));
            } else if (xhr.status === 0) {
                callback(new Error('Cannot connect to Nextcloud. Check the URL in plugin settings and ensure CORS is configured.'));
            } else {
                callback(new Error('Unexpected error (HTTP ' + xhr.status + ').'));
            }
        };

        xhr.ontimeout = function () {
            if (retryCount < MAX_RETRIES) {
                fetchMetadata(baseUrl, fileId, callback, retryCount + 1);
            } else {
                callback(new Error('Request timed out. Check your network connection.'));
            }
        };

        xhr.send();
    }

    // ─── Main Flow ─────────────────────────────────────────────────────

    function detectAndLoadMetadata() {
        var container = document.getElementById('metavox-content');
        var baseUrl = getNextcloudUrl();
        currentFileId = detectFileId();

        if (!baseUrl) {
            showMessage(container, 'Nextcloud URL not configured. Open plugin settings to set it up.', 'warning');
            return;
        }

        if (!currentFileId) {
            showMessage(container, 'Could not detect the file ID. This plugin works when editing documents opened from Nextcloud.', 'warning');
            return;
        }

        showLoading(container);

        fetchMetadata(baseUrl, currentFileId, function (err, fields) {
            if (err) {
                showMessage(container, err.message, 'error');
                return;
            }
            renderMetadata(container, fields);
        });
    }

    function refreshMetadata() {
        detectAndLoadMetadata();
    }

    // Expose for the refresh button
    window.metavoxRefresh = refreshMetadata;

    // ─── Rendering ─────────────────────────────────────────────────────

    function renderMetadata(container, fields) {
        container.innerHTML = '';

        if (!fields || fields.length === 0) {
            showMessage(container, 'No metadata fields configured for this file.', 'info');
            return;
        }

        var list = document.createElement('div');
        list.className = 'metavox-fields';

        for (var i = 0; i < fields.length; i++) {
            list.appendChild(createFieldRow(fields[i]));
        }

        container.appendChild(list);
    }

    function createFieldRow(field) {
        var row = document.createElement('div');
        row.className = 'metavox-field';

        // Label
        var label = document.createElement('div');
        label.className = 'metavox-field-label';
        label.textContent = field.field_label || field.field_name || 'Unknown';
        if (field.is_required) {
            var req = document.createElement('span');
            req.className = 'metavox-required';
            req.textContent = ' *';
            label.appendChild(req);
        }
        row.appendChild(label);

        // Value
        var valueEl = document.createElement('div');
        valueEl.className = 'metavox-field-value';

        var isEmpty = field.value === null || field.value === undefined || field.value === '';

        if (isEmpty) {
            valueEl.classList.add('metavox-field-empty');
            valueEl.textContent = '\u2014'; // em dash
        } else {
            renderFieldValue(valueEl, field.value, field.field_type);
        }

        row.appendChild(valueEl);
        return row;
    }

    function renderFieldValue(container, value, fieldType) {
        switch (fieldType) {
            case 'checkbox':
                var check = document.createElement('span');
                var isChecked = value === '1' || value === 'true' || value === true;
                check.className = 'metavox-checkbox ' + (isChecked ? 'metavox-checkbox-on' : 'metavox-checkbox-off');
                check.textContent = isChecked ? '\u2713' : '\u2717';
                container.appendChild(check);
                break;

            case 'url':
                var link = document.createElement('a');
                link.href = String(value);
                link.textContent = String(value);
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.className = 'metavox-link';
                container.appendChild(link);
                break;

            case 'date':
                try {
                    var date = new Date(value);
                    container.textContent = isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
                } catch (e) {
                    container.textContent = String(value);
                }
                break;

            case 'multiselect':
                var tags = String(value).split(';#').filter(function (t) { return t.trim(); });
                for (var i = 0; i < tags.length; i++) {
                    var tag = document.createElement('span');
                    tag.className = 'metavox-tag';
                    tag.textContent = tags[i].trim();
                    container.appendChild(tag);
                }
                break;

            default:
                container.textContent = String(value);
                break;
        }
    }

    // ─── UI Helpers ────────────────────────────────────────────────────

    function showMessage(container, text, type) {
        container.innerHTML = '';
        var msg = document.createElement('div');
        msg.className = 'metavox-message metavox-message-' + (type || 'info');
        msg.textContent = text;
        container.appendChild(msg);
    }

    function showLoading(container) {
        container.innerHTML = '';
        var spinner = document.createElement('div');
        spinner.className = 'metavox-loading';
        var dot = document.createElement('div');
        dot.className = 'metavox-spinner';
        spinner.appendChild(dot);
        var text = document.createElement('span');
        text.textContent = 'Loading metadata\u2026';
        spinner.appendChild(text);
        container.appendChild(spinner);
    }

    // ─── Theme ─────────────────────────────────────────────────────────

    function applyTheme(theme) {
        if (!theme) return;
        var root = document.documentElement;
        var map = {
            'background-normal': '--bg-color',
            'text-normal': '--text-color',
            'text-secondary': '--text-secondary',
            'border-regular': '--border-color',
            'highlight': '--accent-color'
        };
        for (var key in map) {
            if (theme[key]) {
                root.style.setProperty(map[key], theme[key]);
            }
        }
    }

})(window);
