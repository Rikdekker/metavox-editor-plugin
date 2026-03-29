(function (window, undefined) {
    'use strict';

    var API_TIMEOUT = 10000;
    var MAX_RETRIES = 1;
    var AUTO_SHOW_KEY = 'metavox_auto_show';

    var currentFileId = null;
    var currentFilePath = null;
    var currentGroupfolderId = null;
    var currentFields = [];

    // ─── Plugin Lifecycle ──────────────────────────────────────────────

    window.Asc.plugin.init = function () {
        var jwtData = getJwtPayload();
        currentFileId = jwtData ? String(jwtData.fileId) : null;
        currentFilePath = jwtData ? jwtData.filePath : null;

        initAutoShowToggle();

        if (!isAutoShowEnabled()) {
            // User disabled auto-open — show minimal state
            var container = document.getElementById('metavox-content');
            showMessage(container, 'Auto-open is disabled. Click the toggle above to enable.', 'info');
            return;
        }

        resolveGroupfolderAndLoad();
    };

    window.Asc.plugin.onExternalMouseUp = function () {};
    window.Asc.plugin.onThemeChanged = function (theme) { applyTheme(theme); };

    // ─── JWT + Groupfolder Detection ──────────────────────────────────

    function getJwtPayload() {
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
            return JSON.parse(atob(b64));
        } catch (e) {
            return null;
        }
    }

    function resolveGroupfolderAndLoad() {
        var container = document.getElementById('metavox-content');

        if (!currentFileId) {
            showMessage(container, 'Could not detect file ID. Open a document from Nextcloud.', 'warning');
            return;
        }

        var subtitle = document.querySelector('.metavox-subtitle');
        if (subtitle) subtitle.textContent = 'File ID: ' + currentFileId;

        if (!currentFilePath) {
            // No filePath — try without groupfolder
            loadMetadata();
            return;
        }

        // Extract the first path segment (groupfolder name)
        var pathParts = currentFilePath.replace(/^\//, '').split('/');
        var gfName = pathParts[0];

        if (!gfName) {
            loadMetadata();
            return;
        }

        // Fetch groupfolders to find the ID
        showLoading(container);

        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/metavox-api/groupfolders?format=json', true);
        xhr.timeout = API_TIMEOUT;

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    var gfs = response.ocs ? response.ocs.data : response;
                    if (Array.isArray(gfs)) {
                        for (var i = 0; i < gfs.length; i++) {
                            var mp = gfs[i].mount_point || gfs[i].label || '';
                            if (mp === gfName) {
                                currentGroupfolderId = gfs[i].id;
                                break;
                            }
                        }
                    }
                } catch (e) {}
            }
            // Load metadata (with or without groupfolder ID)
            loadMetadata();
        };

        xhr.ontimeout = function () { loadMetadata(); };
        xhr.send();
    }

    // ─── MetaVox API ───────────────────────────────────────────────────

    function fetchMetadata(fileId, groupfolderId, callback, retryCount) {
        retryCount = retryCount || 0;
        var apiUrl;
        if (groupfolderId) {
            apiUrl = '/metavox-api/groupfolders/' + groupfolderId + '/files/' + fileId + '/metadata?format=json';
        } else {
            apiUrl = '/metavox-api/files/' + fileId + '/metadata?format=json';
        }

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
                setTimeout(function () { fetchMetadata(fileId, groupfolderId, callback, retryCount + 1); }, 1000);
            } else {
                callback(new Error('Error (HTTP ' + (xhr.status || 'network') + ')'));
            }
        };

        xhr.ontimeout = function () {
            if (retryCount < MAX_RETRIES) {
                fetchMetadata(fileId, groupfolderId, callback, retryCount + 1);
            } else {
                callback(new Error('Request timed out.'));
            }
        };

        xhr.send();
    }

    function saveField(fileId, fieldName, value, callback) {
        var apiUrl;
        if (currentGroupfolderId) {
            apiUrl = '/metavox-api/groupfolders/' + currentGroupfolderId + '/files/' + fileId + '/metadata?format=json';
        } else {
            apiUrl = '/metavox-api/files/' + fileId + '/metadata?format=json';
        }
        var body = { metadata: {} };
        body.metadata[fieldName] = value;

        var xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl, true);
        xhr.timeout = API_TIMEOUT;
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200) {
                callback(null);
            } else {
                callback(new Error('Save failed (HTTP ' + (xhr.status || 'network') + ')'));
            }
        };

        xhr.ontimeout = function () { callback(new Error('Save timed out.')); };
        xhr.send(JSON.stringify(body));
    }

    // ─── Main Flow ─────────────────────────────────────────────────────

    function loadMetadata() {
        var container = document.getElementById('metavox-content');

        if (!currentFileId) {
            showMessage(container, 'Could not detect file ID. Open a document from Nextcloud.', 'warning');
            return;
        }

        showLoading(container);

        // Fetch both groupfolder metadata and file metadata in parallel
        var gfFields = [];
        var fileFields = [];
        var done = 0;
        var totalCalls = currentGroupfolderId ? 2 : 1;

        function checkDone() {
            done++;
            if (done < totalCalls) return;
            // Combine: groupfolder fields first, then item fields
            currentFields = gfFields.concat(fileFields);
            renderMetadata(container, currentFields);
        }

        // 1. Groupfolder-level metadata (team folder info)
        if (currentGroupfolderId) {
            fetchGroupfolderMetadata(currentGroupfolderId, function (err, fields) {
                if (!err && fields) gfFields = fields;
                checkDone();
            });
        }

        // 2. File-level metadata
        fetchMetadata(currentFileId, currentGroupfolderId, function (err, fields) {
            if (err) {
                if (totalCalls === 1) {
                    showMessage(container, err.message, 'error');
                    return;
                }
            }
            if (fields) fileFields = fields;
            checkDone();
        });
    }

    function fetchGroupfolderMetadata(groupfolderId, callback) {
        var apiUrl = '/metavox-api/groupfolders/' + groupfolderId + '/metadata?format=json';

        var xhr = new XMLHttpRequest();
        xhr.open('GET', apiUrl, true);
        xhr.timeout = API_TIMEOUT;

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200) {
                try {
                    var response = JSON.parse(xhr.responseText);
                    var data = response.ocs ? response.ocs.data : response;
                    // Mark these as groupfolder fields and filter only applies_to_groupfolder=1
                    var gfFields = [];
                    if (Array.isArray(data)) {
                        for (var i = 0; i < data.length; i++) {
                            var atg = data[i].applies_to_groupfolder;
                            if (atg === 1 || atg === '1') {
                                data[i]._isGroupfolderField = true;
                                gfFields.push(data[i]);
                            }
                        }
                    }
                    callback(null, gfFields);
                } catch (e) {
                    callback(null, []);
                }
            } else {
                callback(null, []);
            }
        };

        xhr.ontimeout = function () { callback(null, []); };
        xhr.send();
    }

    window.metavoxRefresh = function () { loadMetadata(); };

    // ─── Rendering ─────────────────────────────────────────────────────

    function renderMetadata(container, fields) {
        container.innerHTML = '';

        if (!fields || fields.length === 0) {
            showMessage(container, 'No metadata fields configured for this file.', 'info');
            return;
        }

        // Split into groupfolder fields (read-only, from gf metadata endpoint)
        // and item fields (editable, from file metadata endpoint)
        var gfFields = [];
        var itemFields = [];
        for (var i = 0; i < fields.length; i++) {
            if (fields[i]._isGroupfolderField) {
                gfFields.push(fields[i]);
            } else {
                // Skip applies_to_groupfolder=1 fields from file endpoint (they have no values there)
                var atg = fields[i].applies_to_groupfolder;
                if (atg !== 1 && atg !== '1') {
                    itemFields.push(fields[i]);
                }
            }
        }

        // Groupfolder section (collapsible, read-only)
        if (gfFields.length > 0) {
            var gfSection = document.createElement('div');
            gfSection.className = 'metavox-section metavox-section-gf';

            var gfHeader = document.createElement('div');
            gfHeader.className = 'metavox-section-header';
            gfHeader.innerHTML = '<span>Team folder</span><span class="metavox-collapse-icon">\u25B6</span>';
            var gfExpanded = false;
            var gfContent = document.createElement('div');
            gfContent.className = 'metavox-section-content';
            gfContent.style.display = 'none';

            gfHeader.addEventListener('click', function () {
                gfExpanded = !gfExpanded;
                gfContent.style.display = gfExpanded ? '' : 'none';
                gfHeader.querySelector('.metavox-collapse-icon').textContent = gfExpanded ? '\u25BC' : '\u25B6';
            });

            for (var g = 0; g < gfFields.length; g++) {
                gfContent.appendChild(createFieldRow(gfFields[g], true)); // true = readOnly
            }

            gfSection.appendChild(gfHeader);
            gfSection.appendChild(gfContent);
            container.appendChild(gfSection);
        }

        // Item metadata section (editable)
        if (itemFields.length > 0) {
            if (gfFields.length > 0) {
                var sep = document.createElement('div');
                sep.className = 'metavox-separator';
                container.appendChild(sep);
            }

            var itemSection = document.createElement('div');
            itemSection.className = 'metavox-section metavox-section-items';

            if (gfFields.length > 0) {
                var itemHeader = document.createElement('div');
                itemHeader.className = 'metavox-section-header';
                itemHeader.textContent = 'Document Metadata';
                itemSection.appendChild(itemHeader);
            }

            var list = document.createElement('div');
            list.className = 'metavox-fields';

            for (var j = 0; j < itemFields.length; j++) {
                list.appendChild(createFieldRow(itemFields[j], false)); // false = editable
            }

            itemSection.appendChild(list);
            container.appendChild(itemSection);
        }

        if (gfFields.length === 0 && itemFields.length === 0) {
            showMessage(container, 'No metadata fields configured for this file.', 'info');
        }
    }

    function createFieldRow(field, readOnly) {
        var row = document.createElement('div');
        row.className = 'metavox-field';
        row.setAttribute('data-field-name', field.field_name);

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

        // Value (clickable for editing)
        var valueEl = document.createElement('div');
        valueEl.className = 'metavox-field-value';
        var isEmpty = field.value === null || field.value === undefined || field.value === '';

        if (field.field_type === 'checkbox' && !readOnly) {
            // Checkbox: render as toggle, click directly saves
            renderCheckboxValue(valueEl, field);
        } else {
            if (isEmpty) {
                valueEl.classList.add('metavox-field-empty');
                valueEl.textContent = '\u2014';
            } else {
                renderFieldValue(valueEl, field.value, field.field_type);
            }
            // Click to edit (only for non-readonly fields)
            if (!readOnly) {
                valueEl.classList.add('metavox-editable');
                valueEl.addEventListener('click', function (e) {
                    if (e.target.tagName === 'A') return;
                    startEditing(row, field);
                });
            }
        }

        row.appendChild(valueEl);
        return row;
    }

    function renderFieldValue(container, value, fieldType) {
        switch (fieldType) {
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

    function renderCheckboxValue(container, field) {
        var isChecked = field.value === '1' || field.value === 'true' || field.value === true;
        var check = document.createElement('span');
        check.className = 'metavox-checkbox metavox-editable ' + (isChecked ? 'metavox-checkbox-on' : 'metavox-checkbox-off');
        check.textContent = isChecked ? '\u2713' : '\u2717';
        check.addEventListener('click', function () {
            var newVal = isChecked ? '0' : '1';
            check.classList.add('metavox-saving');
            saveField(currentFileId, field.field_name, newVal, function (err) {
                check.classList.remove('metavox-saving');
                if (err) {
                    showFieldError(container.closest('.metavox-field'), err.message);
                } else {
                    field.value = newVal;
                    container.innerHTML = '';
                    renderCheckboxValue(container, field);
                    flashSuccess(container.closest('.metavox-field'));
                }
            });
        });
        container.appendChild(check);
    }

    // ─── Inline Editing ────────────────────────────────────────────────

    function startEditing(row, field) {
        // Don't start if already editing
        if (row.querySelector('.metavox-editor')) return;

        var valueEl = row.querySelector('.metavox-field-value');
        var oldValue = field.value || '';
        valueEl.innerHTML = '';
        valueEl.classList.remove('metavox-field-empty');
        valueEl.classList.add('metavox-editing');

        var editor;

        switch (field.field_type) {
            case 'select':
                editor = createSelectEditor(field, oldValue);
                break;
            case 'multiselect':
                editor = createMultiselectEditor(field, oldValue);
                break;
            case 'date':
                editor = createDateEditor(field, oldValue);
                break;
            case 'number':
                editor = createInputEditor(field, oldValue, 'number');
                break;
            case 'url':
                editor = createInputEditor(field, oldValue, 'url');
                break;
            default:
                editor = createInputEditor(field, oldValue, 'text');
                break;
        }

        valueEl.appendChild(editor);

        // Focus the input
        var input = editor.querySelector('input, select, textarea');
        if (input) input.focus();
    }

    function cancelEditing(row, field) {
        var valueEl = row.querySelector('.metavox-field-value');
        valueEl.classList.remove('metavox-editing');
        valueEl.innerHTML = '';
        var isEmpty = !field.value && field.value !== '0';
        if (isEmpty) {
            valueEl.classList.add('metavox-field-empty');
            valueEl.textContent = '\u2014';
        } else {
            renderFieldValue(valueEl, field.value, field.field_type);
        }
        // Re-attach click handler
        valueEl.addEventListener('click', function (e) {
            if (e.target.tagName === 'A') return;
            startEditing(row, field);
        });
    }

    function commitEdit(row, field, newValue) {
        var valueEl = row.querySelector('.metavox-field-value');
        valueEl.innerHTML = '';
        valueEl.classList.remove('metavox-editing');
        valueEl.classList.add('metavox-saving-field');
        valueEl.textContent = 'Saving\u2026';

        saveField(currentFileId, field.field_name, newValue, function (err) {
            valueEl.classList.remove('metavox-saving-field');
            if (err) {
                showFieldError(row, err.message);
                cancelEditing(row, field);
            } else {
                field.value = newValue;
                cancelEditing(row, field); // Re-renders with new value
                flashSuccess(row);
            }
        });
    }

    // ─── Editor Factories ──────────────────────────────────────────────

    function createInputEditor(field, currentValue, type) {
        var wrap = document.createElement('div');
        wrap.className = 'metavox-editor';

        var input = document.createElement('input');
        input.type = type || 'text';
        input.className = 'metavox-edit-input';
        input.value = currentValue;

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit(wrap.closest('.metavox-field'), field, input.value);
            } else if (e.key === 'Escape') {
                cancelEditing(wrap.closest('.metavox-field'), field);
            }
        });

        input.addEventListener('blur', function () {
            // Small delay to allow click events on other elements
            setTimeout(function () {
                if (document.activeElement !== input) {
                    if (input.value !== currentValue) {
                        commitEdit(wrap.closest('.metavox-field'), field, input.value);
                    } else {
                        cancelEditing(wrap.closest('.metavox-field'), field);
                    }
                }
            }, 150);
        });

        wrap.appendChild(input);
        return wrap;
    }

    function createSelectEditor(field, currentValue) {
        var wrap = document.createElement('div');
        wrap.className = 'metavox-editor';

        var select = document.createElement('select');
        select.className = 'metavox-edit-select';

        // Empty option
        var emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '\u2014';
        select.appendChild(emptyOpt);

        var options = field.field_options || [];
        for (var i = 0; i < options.length; i++) {
            var opt = document.createElement('option');
            opt.value = options[i];
            opt.textContent = options[i];
            if (options[i] === currentValue) opt.selected = true;
            select.appendChild(opt);
        }

        select.addEventListener('change', function () {
            commitEdit(wrap.closest('.metavox-field'), field, select.value);
        });

        select.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                cancelEditing(wrap.closest('.metavox-field'), field);
            }
        });

        wrap.appendChild(select);
        return wrap;
    }

    function createMultiselectEditor(field, currentValue) {
        var wrap = document.createElement('div');
        wrap.className = 'metavox-editor metavox-multiselect-editor';

        var selected = currentValue ? String(currentValue).split(';#').filter(function (t) { return t.trim(); }) : [];
        var options = field.field_options || [];

        for (var i = 0; i < options.length; i++) {
            (function (optionValue) {
                var label = document.createElement('label');
                label.className = 'metavox-ms-option';

                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = selected.indexOf(optionValue) !== -1;

                cb.addEventListener('change', function () {
                    if (cb.checked) {
                        if (selected.indexOf(optionValue) === -1) selected.push(optionValue);
                    } else {
                        selected = selected.filter(function (s) { return s !== optionValue; });
                    }
                    var newValue = selected.join(';#');
                    commitEdit(wrap.closest('.metavox-field'), field, newValue);
                });

                var text = document.createTextNode(' ' + optionValue);
                label.appendChild(cb);
                label.appendChild(text);
                wrap.appendChild(label);
            })(options[i]);
        }

        return wrap;
    }

    function createDateEditor(field, currentValue) {
        var wrap = document.createElement('div');
        wrap.className = 'metavox-editor';

        var input = document.createElement('input');
        input.type = 'date';
        input.className = 'metavox-edit-input';
        input.value = currentValue || '';

        input.addEventListener('change', function () {
            commitEdit(wrap.closest('.metavox-field'), field, input.value);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                cancelEditing(wrap.closest('.metavox-field'), field);
            }
        });

        wrap.appendChild(input);
        return wrap;
    }

    // ─── Feedback ──────────────────────────────────────────────────────

    function flashSuccess(row) {
        row.classList.add('metavox-save-success');
        setTimeout(function () { row.classList.remove('metavox-save-success'); }, 1200);
    }

    function showFieldError(row, message) {
        var existing = row.querySelector('.metavox-field-error');
        if (existing) existing.remove();

        var err = document.createElement('div');
        err.className = 'metavox-field-error';
        err.textContent = message;
        row.appendChild(err);
        setTimeout(function () { err.remove(); }, 3000);
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

    // ─── Auto-show Toggle ──────────────────────────────────────────────

    function isAutoShowEnabled() {
        return localStorage.getItem(AUTO_SHOW_KEY) !== 'false';
    }

    function initAutoShowToggle() {
        var headerLeft = document.querySelector('.metavox-header-left');
        if (!headerLeft) return;

        var toggle = document.createElement('button');
        toggle.className = 'metavox-auto-toggle';
        toggle.title = 'Auto-open MetaVox when editing documents';
        updateToggleState(toggle, isAutoShowEnabled());

        toggle.addEventListener('click', function () {
            var enabled = !isAutoShowEnabled();
            localStorage.setItem(AUTO_SHOW_KEY, enabled ? 'true' : 'false');
            updateToggleState(toggle, enabled);
        });

        // Insert after subtitle
        var subtitle = headerLeft.querySelector('.metavox-subtitle');
        if (subtitle) {
            subtitle.parentNode.insertBefore(toggle, subtitle.nextSibling);
        } else {
            headerLeft.appendChild(toggle);
        }
    }

    function updateToggleState(toggle, enabled) {
        toggle.innerHTML = '<span class="metavox-toggle-track ' + (enabled ? 'metavox-toggle-on' : '') + '">'
            + '<span class="metavox-toggle-thumb"></span></span>'
            + '<span class="metavox-toggle-label">' + (enabled ? 'Auto-open' : 'Manual') + '</span>';
    }

})(window);
