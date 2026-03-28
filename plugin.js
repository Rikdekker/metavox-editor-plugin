(function (window, undefined) {
    'use strict';

    var PLUGIN_GUID = 'asc.{b5c3e4f2-7a1d-4e8f-9c6b-2d3f5a8e1b7c}';

    window.Asc.plugin.init = function () {
        this.resizeWindow(300, 600, 300, 600, 300, 600);
        detectAndLoadMetadata();
    };

    window.Asc.plugin.onExternalMouseUp = function () {};
    window.Asc.plugin.onThemeChanged = function (theme) {
        applyTheme(theme);
    };

    // ─── File ID Detection ─────────────────────────────────────────────

    /**
     * Detect the Nextcloud file ID from the editor context.
     * The ONLYOFFICE Nextcloud connector embeds the file ID in the page URL
     * as a query parameter (e.g., ?fileId=123) or path segment.
     */
    function detectFileId() {
        // Try query parameter first (most common)
        var params = new URLSearchParams(window.location.search);
        var fileId = params.get('fileId') || params.get('fileid');
        if (fileId) return fileId;

        // Try parent frame URL (plugin runs in iframe)
        try {
            var parentParams = new URLSearchParams(window.parent.location.search);
            fileId = parentParams.get('fileId') || parentParams.get('fileid');
            if (fileId) return fileId;
        } catch (e) {
            // Cross-origin — expected when DocumentServer is on different domain
        }

        // Try extracting from referrer
        try {
            var referrer = document.referrer || window.parent.document.referrer;
            if (referrer) {
                var url = new URL(referrer);
                fileId = url.searchParams.get('fileId') || url.searchParams.get('fileid');
                if (fileId) return fileId;

                // Try path pattern: /apps/onlyoffice/{fileId}
                var match = url.pathname.match(/\/apps\/onlyoffice\/(\d+)/);
                if (match) return match[1];
            }
        } catch (e) {
            // Cross-origin referrer access blocked
        }

        // Try extracting from the editor iframe src or page path
        try {
            var frames = window.parent.document.querySelectorAll('iframe');
            for (var i = 0; i < frames.length; i++) {
                var src = frames[i].getAttribute('src') || '';
                var srcMatch = src.match(/fileId=(\d+)/i);
                if (srcMatch) return srcMatch[1];
            }
        } catch (e) {
            // Cross-origin
        }

        return null;
    }

    /**
     * Detect the Nextcloud base URL from the editor context.
     */
    function detectNextcloudUrl() {
        // Try referrer first
        try {
            var referrer = document.referrer || window.parent.document.referrer;
            if (referrer) {
                var url = new URL(referrer);
                // Strip /apps/onlyoffice/... to get base URL
                var base = url.origin + url.pathname.replace(/\/apps\/.*$/, '').replace(/\/index\.php.*$/, '');
                return base.replace(/\/+$/, '');
            }
        } catch (e) {}

        // Try parent location
        try {
            var parentUrl = window.parent.location.origin;
            return parentUrl;
        } catch (e) {}

        return null;
    }

    // ─── MetaVox API ───────────────────────────────────────────────────

    /**
     * Fetch metadata for a file from the MetaVox OCS API.
     * Uses the same browser session/cookies as the logged-in Nextcloud user.
     */
    function fetchMetadata(baseUrl, fileId, callback) {
        var apiUrl = baseUrl + '/ocs/v2.php/apps/metavox/api/v1/files/' + fileId + '/metadata?format=json';

        var xhr = new XMLHttpRequest();
        xhr.open('GET', apiUrl, true);
        xhr.setRequestHeader('OCS-APIREQUEST', 'true');
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.withCredentials = true;

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;

            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    var data = response.ocs ? response.ocs.data : response;
                    callback(null, data);
                } catch (e) {
                    callback(new Error('Failed to parse metadata response'));
                }
            } else if (xhr.status === 403) {
                callback(new Error('Access denied — you may not have permission to view this file\'s metadata.'));
            } else if (xhr.status === 404) {
                callback(new Error('MetaVox app not found — is it installed and enabled?'));
            } else {
                callback(new Error('Failed to fetch metadata (HTTP ' + xhr.status + ')'));
            }
        };

        xhr.send();
    }

    // ─── Rendering ─────────────────────────────────────────────────────

    function detectAndLoadMetadata() {
        var container = document.getElementById('metavox-content');
        var fileId = detectFileId();
        var baseUrl = detectNextcloudUrl();

        if (!fileId) {
            showMessage(container, 'Could not detect file ID. This plugin works when editing documents through Nextcloud with the ONLYOFFICE/Euro-Office connector.', 'warning');
            return;
        }

        if (!baseUrl) {
            showMessage(container, 'Could not detect Nextcloud URL.', 'warning');
            return;
        }

        showMessage(container, 'Loading metadata...', 'loading');

        fetchMetadata(baseUrl, fileId, function (err, metadata) {
            if (err) {
                showMessage(container, err.message, 'error');
                return;
            }

            renderMetadata(container, metadata);
        });
    }

    function renderMetadata(container, metadata) {
        container.innerHTML = '';

        if (!metadata || (Array.isArray(metadata) && metadata.length === 0) || (typeof metadata === 'object' && Object.keys(metadata).length === 0)) {
            showMessage(container, 'No metadata fields configured for this file.', 'info');
            return;
        }

        // metadata can be an array of field objects or an object with field_name: value pairs
        var fields = Array.isArray(metadata) ? metadata : normalizeMetadata(metadata);

        if (fields.length === 0) {
            showMessage(container, 'No metadata fields configured for this file.', 'info');
            return;
        }

        var table = document.createElement('div');
        table.className = 'metavox-fields';

        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            var row = createFieldRow(field);
            table.appendChild(row);
        }

        container.appendChild(table);
    }

    function normalizeMetadata(obj) {
        var fields = [];
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                var val = obj[key];
                if (typeof val === 'object' && val !== null && val.field_name) {
                    fields.push(val);
                } else {
                    fields.push({
                        field_name: key,
                        field_label: key,
                        field_type: 'text',
                        value: val
                    });
                }
            }
        }
        return fields;
    }

    function createFieldRow(field) {
        var row = document.createElement('div');
        row.className = 'metavox-field';

        var label = document.createElement('div');
        label.className = 'metavox-field-label';
        label.textContent = field.field_label || field.field_name || 'Unknown';
        row.appendChild(label);

        var value = document.createElement('div');
        value.className = 'metavox-field-value';
        value.textContent = formatValue(field.value, field.field_type);

        if (!field.value && field.value !== 0 && field.value !== false) {
            value.classList.add('metavox-field-empty');
            value.textContent = '—';
        }

        row.appendChild(value);
        return row;
    }

    function formatValue(value, fieldType) {
        if (value === null || value === undefined || value === '') return '';

        switch (fieldType) {
            case 'checkbox':
                return value === '1' || value === 'true' || value === true ? 'Yes' : 'No';
            case 'date':
                try {
                    var date = new Date(value);
                    return date.toLocaleDateString();
                } catch (e) {
                    return value;
                }
            case 'multiselect':
                return String(value).replace(/;#/g, ', ');
            case 'url':
                return value;
            case 'user':
                // User IDs may be stored as uid — display as-is for now
                return String(value);
            default:
                return String(value);
        }
    }

    function showMessage(container, text, type) {
        container.innerHTML = '';
        var msg = document.createElement('div');
        msg.className = 'metavox-message metavox-message-' + (type || 'info');
        msg.textContent = text;
        container.appendChild(msg);
    }

    // ─── Theme ─────────────────────────────────────────────────────────

    function applyTheme(theme) {
        if (!theme) return;
        var root = document.documentElement;
        if (theme['background-normal']) {
            root.style.setProperty('--bg-color', theme['background-normal']);
        }
        if (theme['text-normal']) {
            root.style.setProperty('--text-color', theme['text-normal']);
        }
        if (theme['border-regular']) {
            root.style.setProperty('--border-color', theme['border-regular']);
        }
    }

})(window);
