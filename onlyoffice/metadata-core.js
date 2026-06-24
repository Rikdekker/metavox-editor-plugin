/**
 * MetaVox field-type logic — framework-free shared core (classic-script build).
 *
 * Attaches `window.MetaVoxCore`. This is the SAME logic as the canonical ES
 * module `src/filesplugin/metadata-core/fieldTypes.js` in the MetaVox app repo
 * (gitea.rikdekker.nl/rik/MetaVox). The plugin loads as a classic <script>
 * (no bundler), so it consumes this global build instead of `import`. Keep the
 * two in lockstep — the storage/encoding contract MUST match the PHP backend
 * (FieldService.php / DocumentPropertiesService.php):
 *   - multiselect joined with ";#"   - select options newline-separated
 *   - date floating ISO              - checkbox "1"/"0"
 *
 * Single source of truth for ENCODING; the editor UI rendering stays in plugin.js.
 */
(function (window) {
    'use strict';

    var MULTISELECT_SEPARATOR = ';#';

    var FIELD_TYPES = [
        'text', 'textarea', 'number', 'date', 'checkbox',
        'select', 'multiselect', 'url', 'user', 'usergroup', 'filelink'
    ];

    function normalizeType(type) {
        return type === 'multi_select' ? 'multiselect' : (type || 'text');
    }

    function isMultiselect(type) {
        return normalizeType(type) === 'multiselect';
    }

    function dateIncludesTime(field) {
        var opts = (field && (field.field_options != null ? field.field_options : field.options));
        return !!(opts && typeof opts === 'object' && !Array.isArray(opts) && opts.includeTime);
    }

    function parseSelectOptions(fieldOptions) {
        if (Array.isArray(fieldOptions)) {
            return fieldOptions.filter(function (o) { return String(o).trim() !== ''; });
        }
        if (typeof fieldOptions === 'string') {
            return fieldOptions.split('\n').map(function (o) { return o.trim(); })
                .filter(function (o) { return o !== ''; });
        }
        return [];
    }

    function decodeMultiselect(value) {
        if (Array.isArray(value)) return value.filter(function (v) { return String(v).trim() !== ''; });
        if (typeof value !== 'string' || value === '') return [];
        return value.split(MULTISELECT_SEPARATOR).map(function (v) { return v.trim(); })
            .filter(function (v) { return v !== ''; });
    }

    function encodeMultiselect(values) {
        return Array.isArray(values) ? values.join(MULTISELECT_SEPARATOR) : '';
    }

    function decodeCheckbox(value) {
        return value === '1' || value === 'true' || value === true;
    }

    function encodeCheckbox(checked) {
        return checked ? '1' : '0';
    }

    function padDatetimeLocal(value) {
        if (typeof value === 'string' && value.length === 16) return value + ':00';
        return value;
    }

    function formatDisplay(value, type) {
        if (value === null || value === undefined || value === '') return '';
        switch (normalizeType(type)) {
            case 'multiselect':
                return decodeMultiselect(value).join(', ');
            case 'checkbox':
                return decodeCheckbox(value) ? '✓' : '✗';
            default:
                return String(value);
        }
    }

    window.MetaVoxCore = {
        MULTISELECT_SEPARATOR: MULTISELECT_SEPARATOR,
        FIELD_TYPES: FIELD_TYPES,
        normalizeType: normalizeType,
        isMultiselect: isMultiselect,
        dateIncludesTime: dateIncludesTime,
        parseSelectOptions: parseSelectOptions,
        decodeMultiselect: decodeMultiselect,
        encodeMultiselect: encodeMultiselect,
        decodeCheckbox: decodeCheckbox,
        encodeCheckbox: encodeCheckbox,
        padDatetimeLocal: padDatetimeLocal,
        formatDisplay: formatDisplay
    };

})(window);
