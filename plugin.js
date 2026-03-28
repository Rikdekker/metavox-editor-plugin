(function (window, undefined) {
    'use strict';

    var API_TIMEOUT = 10000;
    var MAX_RETRIES = 1;

    var currentFileId = null;

    // ─── Plugin Lifecycle ──────────────────────────────────────────────

    window.Asc.plugin.init = function () {
        currentFileId = detectFileId();
        loadMetadata();
    };

    window.Asc.plugin.onExternalMouseUp = function () {};
    window.Asc.plugin.onThemeChanged = function (theme) { applyTheme(theme); };

    // ─── File ID Detection (JWT from callback URL) ─────────────────────

    function detectFileId() {
        try {
            var info = window.Asc.plugin.info;
            if (!info || !info.documentCallbackUrl) return null;
            var url = new URL(info.documentCallbackUrl);
            var jwt = url.searchParams.get('doc');
            if (!jwt) return null;
            var parts = jwt.split('.');
            if (parts.length < 2) return null;
            var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            var payload = JSON.parse(atob(b64));
            return payload.fileId ? String(payload.fileId) : null;
        } catch (e) {
            return null;
        }
    }

    // ─── MetaVox API (via same-origin reverse proxy) ───────────────────

    function fetchMetadata(fileId, callback, retryCount) {
        retryCount = retryCount || 0;
        // Same-origin proxy: /metavox-api/ is proxied to Nextcloud by NPM
        var apiUrl = '/metavox-api/files/' + fileId + '/metadata?format=json';

        var xhr = new XMLHttpRequest();
        xhr.open('GET', apiUrl, true);
        xhr.timeout = API_TIMEOUT;

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;

            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    var data = response.ocs ? response.ocs.data : response;
                    callback(null, Array.isArray(data) ? data : []);
                } catch (e) {
                    callback(new Error('Failed to parse response.'));
                }
            } else if (xhr.status === 0 && retryCount < MAX_RETRIES) {
                setTimeout(function () {
                    fetchMetadata(fileId, callback, retryCount + 1);
                }, 1000);
            } else if (xhr.status === 401 || xhr.status === 403) {
                callback(new Error('Access denied (HTTP ' + xhr.status + ').'));
            } else if (xhr.status === 404) {
                callback(new Error('MetaVox API not found. Check proxy configuration.'));
            } else if (xhr.status === 0) {
                callback(new Error('Cannot connect to MetaVox API.'));
            } else {
                callback(new Error('Error (HTTP ' + xhr.status + ')'));
            }
        };

        xhr.ontimeout = function () {
            if (retryCount < MAX_RETRIES) {
                fetchMetadata(fileId, callback, retryCount + 1);
            } else {
                callback(new Error('Request timed out.'));
            }
        };

        xhr.send();
    }

    // ─── Main Flow ─────────────────────────────────────────────────────

    function loadMetadata() {
        var container = document.getElementById('metavox-content');

        if (!currentFileId) {
            showMessage(container, 'Could not detect file ID. Open a document from Nextcloud.', 'warning');
            return;
        }

        showLoading(container);

        fetchMetadata(currentFileId, function (err, fields) {
            if (err) {
                showMessage(container, err.message, 'error');
                return;
            }
            renderMetadata(container, fields);
        });
    }

    window.metavoxRefresh = function () { loadMetadata(); };

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

        var valueEl = document.createElement('div');
        valueEl.className = 'metavox-field-value';
        var isEmpty = field.value === null || field.value === undefined || field.value === '';

        if (isEmpty) {
            valueEl.classList.add('metavox-field-empty');
            valueEl.textContent = '\u2014';
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
                } catch (e) { container.textContent = String(value); }
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
            if (theme[key]) root.style.setProperty(map[key], theme[key]);
        }
    }

})(window);
