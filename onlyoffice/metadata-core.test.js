/**
 * Invariant guard for the MetaVox encoding contract (run: node metadata-core.test.js).
 *
 * The plugin's metadata-core.js MUST encode/decode field values identically to
 * the MetaVox PHP backend and the Files-sidebar Vue. This test pins the
 * round-trip so the shared contract can't silently drift.
 */
global.window = {};
require('./metadata-core.js');
var C = global.window.MetaVoxCore;

var failures = 0;
function eq(actual, expected, label) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) { console.error('FAIL ' + label + ': got ' + a + ', expected ' + e); failures++; }
}

// multiselect round-trip (";#")
eq(C.encodeMultiselect(['a', 'b', 'c']), 'a;#b;#c', 'encodeMultiselect');
eq(C.decodeMultiselect('a;#b;#c'), ['a', 'b', 'c'], 'decodeMultiselect');
eq(C.decodeMultiselect(C.encodeMultiselect(['x', 'y'])), ['x', 'y'], 'multiselect roundtrip');
eq(C.decodeMultiselect(''), [], 'decodeMultiselect empty');

// checkbox round-trip ("1"/"0")
eq(C.encodeCheckbox(true), '1', 'encodeCheckbox true');
eq(C.encodeCheckbox(false), '0', 'encodeCheckbox false');
eq(C.decodeCheckbox('1'), true, 'decodeCheckbox 1');
eq(C.decodeCheckbox('0'), false, 'decodeCheckbox 0');
eq(C.decodeCheckbox(C.encodeCheckbox(true)), true, 'checkbox roundtrip');

// select options (newline-separated string OR array)
eq(C.parseSelectOptions('Yes\nNo\n'), ['Yes', 'No'], 'parseSelectOptions string');
eq(C.parseSelectOptions(['A', '', 'B']), ['A', 'B'], 'parseSelectOptions array');

// type alias
eq(C.normalizeType('multi_select'), 'multiselect', 'normalizeType alias');
eq(C.isMultiselect('multi_select'), true, 'isMultiselect alias');

// date padding
eq(C.padDatetimeLocal('2026-06-24T10:30'), '2026-06-24T10:30:00', 'padDatetimeLocal');
eq(C.padDatetimeLocal('2026-06-24'), '2026-06-24', 'padDatetimeLocal date-only');

// display
eq(C.formatDisplay('a;#b', 'multiselect'), 'a, b', 'formatDisplay multiselect');
eq(C.formatDisplay('1', 'checkbox'), '✓', 'formatDisplay checkbox');

if (failures) { console.error('\n' + failures + ' invariant failure(s).'); process.exit(1); }
console.log('metadata-core: all invariants OK');
