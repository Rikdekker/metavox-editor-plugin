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

    // ─── Document Properties (ODF, read via editor API — no auth) ───────
    //
    // Reads the document's own standard (core) properties through the
    // ONLYOFFICE/Euro-Office Automation API. On save to ODF these live in
    // meta.xml as dc:/meta: elements, so they travel with the file and stay
    // readable in LibreOffice without MetaVox (open-standards, anti-lock-in).
    //
    // ApiCore exposes a fixed, enumerable set of getters (verified against the
    // Euro-Office v9.3.1 API surface). ApiCustomProperties only supports
    // Get(name)/Add(name,value) — no enumeration. To show the MetaVox metadata
    // that the server embedded as metavox:<field> custom properties, we read a
    // single known index key (metavox:__index) — a JSON map of {field: label}
    // written alongside the values — then Get() each field by name. This makes
    // the embedded metadata visible JWT-free, straight from the document.

    // Standard properties to surface, in display order.
    // key = ApiCore getter suffix, label = panel label.
    var CORE_PROPERTIES = [
        { key: 'Title', label: 'Title' },
        { key: 'Subject', label: 'Subject' },
        { key: 'Description', label: 'Description' },
        { key: 'Keywords', label: 'Keywords' },
        { key: 'Category', label: 'Category' },
        { key: 'ContentStatus', label: 'Status' },
        { key: 'Creator', label: 'Author' },
        { key: 'LastModifiedBy', label: 'Last modified by' },
        { key: 'Language', label: 'Language' }
    ];

    // Reads core document properties via callCommand. The command body runs
    // inside the editor (has the global Api); its return value is delivered to
    // the callback. callCommand's value-return path is used here — if a build
    // does not support it the callback receives null and the section is hidden.
    function readDocumentProperties(callback) {
        try {
            var editorType = (window.Asc.plugin.info && window.Asc.plugin.info.editorType) || 'word';
            // The command body is serialized and executed in the editor context.
            // It must be self-contained (no closure over plugin-side vars), so we
            // inject the editorType + property list as a JSON literal.
            var injected = JSON.stringify({ editorType: editorType, props: CORE_PROPERTIES });

            var commandBody = 'var __cfg = ' + injected + ';' +
                'var doc = null, core = null, custom = null;' +
                'try {' +
                '  if (__cfg.editorType === "cell") { doc = Api; }' +
                '  else if (__cfg.editorType === "slide") { doc = Api.GetPresentation(); }' +
                '  else { doc = Api.GetDocument(); }' +
                '} catch (e) { doc = null; }' +
                'try { core = doc ? doc.GetCore() : null; } catch (e) { core = null; }' +
                'try { custom = doc ? doc.GetCustomProperties() : null; } catch (e) { custom = null; }' +
                'var out = { core: {}, metavox: [] };' +
                'if (core) {' +
                '  for (var i = 0; i < __cfg.props.length; i++) {' +
                '    var k = __cfg.props[i].key;' +
                '    try { var v = core["Get" + k] ? core["Get" + k]() : null;' +
                '      if (v !== null && v !== undefined && v !== "") { out.core[k] = String(v); } } catch (e) {}' +
                '  }' +
                '}' +
                // Read the metavox: custom properties via the embedded index.
                'if (custom) {' +
                '  var idx = null;' +
                '  try { idx = custom.Get("metavox:__index"); } catch (e) { idx = null; }' +
                '  if (idx) {' +
                '    var map = null; try { map = JSON.parse(idx); } catch (e) { map = null; }' +
                '    if (map) {' +
                '      for (var name in map) { if (!map.hasOwnProperty(name)) continue;' +
                '        var val = null; try { val = custom.Get("metavox:" + name); } catch (e) { val = null; }' +
                '        if (val !== null && val !== undefined && val !== "") {' +
                '          out.metavox.push({ name: name, label: String(map[name] || name), value: String(val) });' +
                '        }' +
                '      }' +
                '    }' +
                '  }' +
                '}' +
                'return JSON.stringify(out);';

            // eslint-disable-next-line no-new-func
            var command = new Function(commandBody);

            window.Asc.plugin.callCommand(command, false, false, function (result) {
                var parsed = null;
                try { parsed = result ? JSON.parse(result) : null; } catch (e) { parsed = null; }
                callback(parsed);
            });
        } catch (e) {
            callback(null);
        }
    }

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

        // Two independent sources, rendered side by side:
        //  - Document properties: the file's own ODF core properties (always
        //    available via the editor API, no auth, travel with the document).
        //  - MetaVox database fields: requires the API (Phase 2). A failure
        //    here is non-fatal — we still show the document properties.
        var docProps = null;
        var dbFields = null;     // null = still loading / failed; [] = loaded empty
        var dbError = null;
        var docPropsDone = false;
        var dbDone = false;

        function renderIfReady() {
            if (!docPropsDone || !dbDone) return;
            renderPanel(container, docProps, dbFields, dbError);
        }

        // 1. Document's own ODF properties (via editor API)
        readDocumentProperties(function (props) {
            docProps = props;
            docPropsDone = true;
            renderIfReady();
        });

        // 2. MetaVox database fields (groupfolder + file level)
        var gfFields = [];
        var fileFields = [];
        var dbCallsDone = 0;
        var dbTotalCalls = currentGroupfolderId ? 2 : 1;
        var anyDbError = null;

        function dbCheckDone() {
            dbCallsDone++;
            if (dbCallsDone < dbTotalCalls) return;
            dbFields = gfFields.concat(fileFields);
            currentFields = dbFields;
            dbError = anyDbError;
            dbDone = true;
            renderIfReady();
        }

        if (currentGroupfolderId) {
            fetchGroupfolderMetadata(currentGroupfolderId, function (err, fields) {
                if (!err && fields) gfFields = fields;
                dbCheckDone();
            });
        }

        fetchMetadata(currentFileId, currentGroupfolderId, function (err, fields) {
            if (err) anyDbError = err;
            if (fields) fileFields = fields;
            dbCheckDone();
        });
    }

    // Renders both sections. Document properties always render (when present);
    // the DB section degrades gracefully to a quiet note when the API is
    // unreachable (no proxy/JWT yet), instead of a panel-wide red error.
    function renderPanel(container, docProps, dbFields, dbError) {
        container.innerHTML = '';

        var core = (docProps && docProps.core) || {};
        var embedded = (docProps && docProps.metavox) || [];
        var hasCore = Object.keys(core).length > 0;
        var hasEmbedded = embedded.length > 0;
        var anyAbove = false;

        // 1. MetaVox metadata embedded in the document (read JWT-free via the
        //    custom-property index). This is the metadata that travels with the file.
        if (hasEmbedded) {
            renderEmbeddedMetavox(container, embedded);
            anyAbove = true;
        }

        // 2. The document's own standard (core) properties.
        if (hasCore) {
            if (anyAbove) container.appendChild(makeSeparator());
            renderCoreProperties(container, core);
            anyAbove = true;
        }

        // 3. The MetaVox database fields (live, editable) — needs the API (JWT phase).
        if (dbFields && dbFields.length > 0) {
            if (anyAbove) container.appendChild(makeSeparator());
            renderMetadata(container, dbFields);
        } else if (dbError && !hasEmbedded) {
            // Only nag about the DB when we couldn't show embedded metadata either.
            if (anyAbove) container.appendChild(makeSeparator());
            showInlineNote(container, 'MetaVox database not connected.');
        } else if (!anyAbove) {
            showMessage(container, 'No metadata available for this document.', 'info');
        }
    }

    function makeSeparator() {
        var sep = document.createElement('div');
        sep.className = 'metavox-separator';
        return sep;
    }

    // Section: MetaVox metadata embedded in the document file (read-only here;
    // editing arrives with the JWT/DB phase). Each item: {name, label, value}.
    function renderEmbeddedMetavox(container, items) {
        var section = document.createElement('div');
        section.className = 'metavox-section metavox-section-embedded';

        var header = document.createElement('div');
        header.className = 'metavox-section-header';
        header.textContent = 'MetaVox metadata';
        section.appendChild(header);

        var list = document.createElement('div');
        list.className = 'metavox-fields';
        for (var i = 0; i < items.length; i++) {
            list.appendChild(makeReadonlyRow(items[i].label || items[i].name, items[i].value));
        }
        section.appendChild(list);
        container.appendChild(section);
    }

    // Read-only section listing the document's own ODF core properties.
    function renderCoreProperties(container, core) {
        var section = document.createElement('div');
        section.className = 'metavox-section metavox-section-docprops';

        var header = document.createElement('div');
        header.className = 'metavox-section-header';
        header.textContent = 'Document properties';
        section.appendChild(header);

        var list = document.createElement('div');
        list.className = 'metavox-fields';
        for (var i = 0; i < CORE_PROPERTIES.length; i++) {
            var def = CORE_PROPERTIES[i];
            if (!Object.prototype.hasOwnProperty.call(core, def.key)) continue;
            list.appendChild(makeReadonlyRow(def.label, core[def.key]));
        }
        section.appendChild(list);
        container.appendChild(section);
    }

    function makeReadonlyRow(labelText, valueText) {
        var row = document.createElement('div');
        row.className = 'metavox-field';

        var label = document.createElement('div');
        label.className = 'metavox-field-label';
        label.textContent = labelText;
        row.appendChild(label);

        var valueEl = document.createElement('div');
        valueEl.className = 'metavox-field-value';
        valueEl.textContent = valueText;
        row.appendChild(valueEl);
        return row;
    }

    function showInlineNote(container, text) {
        var note = document.createElement('div');
        note.className = 'metavox-message metavox-message-info metavox-inline-note';
        note.textContent = text;
        container.appendChild(note);
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

    // Renders the MetaVox database fields. Appends to the container (the
    // caller, renderPanel, owns clearing and ordering) and is only invoked
    // when there is at least one field, so it has no empty-state branch.
    function renderMetadata(container, fields) {
        if (!fields || fields.length === 0) return;

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
