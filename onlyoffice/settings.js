(function (window, undefined) {
    'use strict';

    var STORAGE_KEY = 'metavox_plugin_settings';

    window.Asc.plugin.init = function () {
        loadSettings();
    };

    window.Asc.plugin.button = function (id) {
        if (id === 0) {
            // Save button
            saveSettings();
        }
        // Close the settings window (both Save and Cancel)
        this.executeCommand('close', '');
    };

    function loadSettings() {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                var settings = JSON.parse(saved);
                document.getElementById('nextcloud-url').value = settings.nextcloudUrl || '';
                document.getElementById('auth-user').value = settings.authUser || '';
                document.getElementById('auth-token').value = settings.authToken || '';
            } catch (e) {
                // Corrupted settings — ignore
            }
        }
    }

    function saveSettings() {
        var nextcloudUrl = document.getElementById('nextcloud-url').value.trim().replace(/\/+$/, '');
        var authUser = document.getElementById('auth-user').value.trim();
        var authToken = document.getElementById('auth-token').value.trim();

        var settings = {
            nextcloudUrl: nextcloudUrl,
            authUser: authUser,
            authToken: authToken
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

        var status = document.getElementById('settings-status');
        status.textContent = 'Settings saved.';
        status.className = 'settings-status-ok';
    }

})(window);
