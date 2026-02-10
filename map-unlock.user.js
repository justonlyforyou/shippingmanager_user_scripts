// ==UserScript==
// @name        ShippingManager - Premium Feature Unlocker
// @description Unlocks premium map themes, tanker ops, metropolis and extended zoom
// @version     1.14
// @author      https://github.com/justonlyforyou/
// @order        30
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==
/* globals MutationObserver, Event */

(function() {
    'use strict';

    if (window._rebelShipUnlockActive) return;
    window._rebelShipUnlockActive = true;

    var TOKEN = 'sk.eyJ1Ijoic2hqb3J0aCIsImEiOiJjbGV0cHdodGwxaWZnM3NydnlvNHc4cG02In0.D5n6nIFb0JqhGA9lM_jRkw';
    var TILE_COORD_REGEX = /\/(\d+)\/(\d+)\/(\d+)/;

    var PREMIUM_THEMES = {
        'Dark': { base: 'https://api.mapbox.com/styles/v1/mapbox/dark-v10/tiles', suffix: '' },
        'Light': { base: 'https://api.mapbox.com/styles/v1/mapbox/light-v10/tiles', suffix: '' },
        'Street': { base: 'https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles', suffix: '' },
        'Satellite': { base: 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles', suffix: '' },
        'City': { base: 'https://api.mapbox.com/styles/v1/shjorth/ck6hrwoqh0uuy1iqvq5jmcch2/tiles/256', suffix: '@2x' },
        'Sky': { base: 'https://api.mapbox.com/styles/v1/shjorth/ck6hzf3qq11wg1ijsrtfaouxb/tiles/256', suffix: '@2x' }
    };

    var currentObserver = null;
    var currentPremiumTheme = null;
    var layerObserver = null;
    var initInterval = null;
    var cookieInterval = null;
    var featuresUnlocked = false;
    var zoomUnlocked = false;
    var themeRestored = false;

    // LocalStore helpers - game uses "localStore" key with preferredTile field
    function getLocalStore() {
        try {
            return JSON.parse(localStorage.getItem('localStore')) || {};
        } catch { return {}; }
    }

    function savePreferredTile(themeName) {
        var store = getLocalStore();
        store.preferredTile = themeName;
        localStorage.setItem('localStore', JSON.stringify(store));
    }

    function getSavedTheme() {
        var store = getLocalStore();
        return store.preferredTile;
    }

    // Tile URL helpers - cached regex, reused across all tile operations
    function parseTileUrl(src) {
        return TILE_COORD_REGEX.exec(src);
    }

    function buildTileUrl(theme, z, x, y) {
        return theme.base + '/' + z + '/' + x + '/' + y + theme.suffix + '?access_token=' + TOKEN;
    }

    function switchToPremiumTheme(themeName, skipSave) {
        var theme = PREMIUM_THEMES[themeName];
        if (!theme) return;

        currentPremiumTheme = themeName;

        if (!skipSave) {
            savePreferredTile(themeName);
        }

        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
        }

        var tilePane = document.querySelector('.leaflet-tile-pane');
        if (!tilePane) return;

        var imgs = tilePane.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
            var match = parseTileUrl(imgs[i].src);
            if (match) {
                imgs[i].src = buildTileUrl(theme, match[1], match[2], match[3]);
            }
        }

        // Watch for new tiles - only process IMG addedNodes
        currentObserver = new MutationObserver(function(mutations) {
            if (!currentPremiumTheme) return;
            var t = PREMIUM_THEMES[currentPremiumTheme];
            if (!t) return;
            for (var m = 0; m < mutations.length; m++) {
                var added = mutations[m].addedNodes;
                for (var n = 0; n < added.length; n++) {
                    if (added[n].tagName === 'IMG') {
                        var tileMatch = parseTileUrl(added[n].src);
                        if (tileMatch) {
                            added[n].src = buildTileUrl(t, tileMatch[1], tileMatch[2], tileMatch[3]);
                        }
                    }
                }
            }
        });
        currentObserver.observe(tilePane, { childList: true, subtree: true });

        try {
            var app = document.querySelector('#app').__vue_app__;
            var pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            var map = pinia._s.get('mapStore').map;
            map.invalidateSize();
            var center = map.getCenter();
            map.panTo([center.lat + 0.0001, center.lng], {animate: false});
            setTimeout(function() { map.panTo([center.lat, center.lng], {animate: false}); }, 100);
        } catch {}

        console.log('[Map Unlock] Switched to premium theme:', themeName);
    }

    function stopPremiumTheme() {
        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
        }
        currentPremiumTheme = null;

        var tilePane = document.querySelector('.leaflet-tile-pane');
        if (tilePane) {
            var imgs = tilePane.querySelectorAll('img');
            for (var i = 0; i < imgs.length; i++) {
                imgs[i].remove();
            }
        }

        try {
            var app = document.querySelector('#app').__vue_app__;
            var pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            var map = pinia._s.get('mapStore').map;
            map.invalidateSize();
            map._resetView(map.getCenter(), map.getZoom(), true);
        } catch {
            try {
                var tileContainers = document.querySelectorAll('.leaflet-tile-container');
                for (var i = 0; i < tileContainers.length; i++) {
                    tileContainers[i].innerHTML = '';
                }
                window.dispatchEvent(new Event('resize'));
            } catch {}
        }

        console.log('[Map Unlock] Reset to standard tiles');
    }

    // Auto-accept cookies
    function acceptCookies() {
        var banner = document.querySelector('.cookieConsent');
        if (banner) {
            var btn = banner.querySelector('button.dark-green');
            if (btn) {
                btn.click();
                return true;
            }
        }
        return false;
    }

    // Patch company_type and metropolis on the user store
    function applyFeaturePatch(userStore) {
        var companyType = userStore.user.company_type;
        if (!companyType) return;

        var hasTanker = Array.isArray(companyType) ? companyType.indexOf('tanker') !== -1 : (typeof companyType === 'string' && companyType.indexOf('tanker') >= 0);
        var needsPatch = false;
        var newCompanyType = companyType;
        var newMetropolis = userStore.settings ? userStore.settings.metropolis : 0;

        if (!hasTanker) {
            newCompanyType = Array.isArray(companyType) ? companyType.slice().concat(['tanker']) : [companyType, 'tanker'];
            needsPatch = true;
        }
        if (userStore.settings && !userStore.settings.metropolis) {
            newMetropolis = 1;
            needsPatch = true;
        }
        if (needsPatch) {
            userStore.user.company_type = newCompanyType;
            if (userStore.settings) userStore.settings.metropolis = newMetropolis;
        }
    }

    // Unlock tanker ops and metropolis - patches once, then subscribes for re-patches
    function unlockFeatures() {
        if (featuresUnlocked) return;
        try {
            var app = document.querySelector('#app');
            if (!app || !app.__vue_app__) return;
            var pinia = app.__vue_app__._context.provides.pinia || app.__vue_app__.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return;
            var userStore = pinia._s.get('user');
            if (!userStore || !userStore.user) return;

            applyFeaturePatch(userStore);

            // Subscribe to store changes so the patch survives API re-fetches
            userStore.$subscribe(function() {
                if (userStore.user) applyFeaturePatch(userStore);
            });

            featuresUnlocked = true;
        } catch {}
    }

    // Unlock zoom range - runs once, then sets flag
    function unlockZoom() {
        if (zoomUnlocked) return;
        try {
            var app = document.querySelector('#app');
            if (!app || !app.__vue_app__) return;
            var pinia = app.__vue_app__._context.provides.pinia || app.__vue_app__.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return;
            var mapStore = pinia._s.get('mapStore');
            if (mapStore && mapStore.map) {
                mapStore.map.setMinZoom(1);
                mapStore.map.setMaxZoom(18);
                zoomUnlocked = true;
            }
        } catch {}
    }

    // Sync radio buttons with current theme state
    function syncRadioState(baseDiv) {
        var activeTheme = currentPremiumTheme;
        var i, radios, labels, radio;

        if (activeTheme && PREMIUM_THEMES[activeTheme]) {
            radios = baseDiv.querySelectorAll('label:not(.rebel-premium) input[type=radio]');
            for (i = 0; i < radios.length; i++) {
                radios[i].checked = false;
            }
            labels = baseDiv.querySelectorAll('label.rebel-premium');
            for (i = 0; i < labels.length; i++) {
                radio = labels[i].querySelector('input[type=radio]');
                if (radio) {
                    radio.checked = (labels[i].textContent.trim() === activeTheme);
                }
            }
        } else {
            radios = baseDiv.querySelectorAll('input[name=leaflet-base-layers_rebel]');
            for (i = 0; i < radios.length; i++) {
                radios[i].checked = false;
            }
        }
    }

    // Remove locked labels and premium spans from layer control
    function cleanLockedLabels(baseDiv) {
        var i;
        var locked = baseDiv.querySelectorAll('label.locked');
        for (i = 0; i < locked.length; i++) locked[i].remove();
        var premSpans = baseDiv.querySelectorAll('.premium-span');
        for (i = 0; i < premSpans.length; i++) premSpans[i].remove();
        var seps = baseDiv.querySelectorAll('.custom-separator');
        for (i = 0; i < seps.length; i++) seps[i].remove();
    }

    // Fix layer control - keep standard options, add premium options
    function fixLayerControl() {
        var baseDiv = document.querySelector('.leaflet-control-layers-base');
        if (!baseDiv) return false;

        // Always clean locked labels
        cleanLockedLabels(baseDiv);

        // Already setup? Just sync state
        if (baseDiv.dataset.fixed) {
            syncRadioState(baseDiv);
            return true;
        }
        baseDiv.dataset.fixed = 'true';

        // Add premium section header
        var premHeader = document.createElement('div');
        premHeader.className = 'rebel-premium-header';
        premHeader.style.cssText = 'color:#4ade80;font-size:11px;padding:4px 0;margin-top:8px;border-top:1px solid #444;';
        premHeader.textContent = 'Premium (unlocked)';
        baseDiv.appendChild(premHeader);

        // Add premium theme options
        var themeNames = ['Dark', 'Light', 'Street', 'Satellite', 'City', 'Sky'];
        for (var t = 0; t < themeNames.length; t++) {
            (function(name) {
                var label = document.createElement('label');
                label.className = 'rebel-premium';
                label.style.cssText = 'display:block;cursor:pointer;padding:2px 0;';
                var span = document.createElement('span');
                var radio = document.createElement('input');
                radio.type = 'radio';
                radio.className = 'leaflet-control-layers-selector';
                radio.name = 'leaflet-base-layers_rebel';
                radio.style.marginRight = '4px';
                radio.dataset.theme = name;

                span.appendChild(radio);
                span.appendChild(document.createTextNode(' ' + name));
                label.appendChild(span);

                radio.addEventListener('change', function() {
                    if (radio.checked) {
                        var stdRadios = baseDiv.querySelectorAll('label:not(.rebel-premium) input[type=radio]');
                        for (var r = 0; r < stdRadios.length; r++) stdRadios[r].checked = false;
                        switchToPremiumTheme(name);
                    }
                });

                label.addEventListener('click', function(e) {
                    if (e.target !== radio) {
                        radio.checked = true;
                        radio.dispatchEvent(new Event('change'));
                    }
                });

                baseDiv.appendChild(label);
            })(themeNames[t]);
        }

        // Make standard options reset to normal tiles - only process unfixed labels
        var stdLabels = baseDiv.querySelectorAll('label:not(.rebel-premium):not([data-rebel-fixed])');
        for (var s = 0; s < stdLabels.length; s++) {
            stdLabels[s].dataset.rebelFixed = 'true';
            stdLabels[s].addEventListener('click', function() {
                var premRadios = baseDiv.querySelectorAll('input[name=leaflet-base-layers_rebel]');
                for (var r = 0; r < premRadios.length; r++) premRadios[r].checked = false;
                currentPremiumTheme = null;
                stopPremiumTheme();
            });
        }

        syncRadioState(baseDiv);

        // Observer on layer control to clean re-added locked labels (replaces setInterval polling)
        if (!layerObserver) {
            layerObserver = new MutationObserver(function() {
                cleanLockedLabels(baseDiv);
                syncRadioState(baseDiv);
            });
            layerObserver.observe(baseDiv, { childList: true });
        }

        return true;
    }

    // Restore saved premium theme after page load
    function restoreSavedTheme() {
        var saved = getSavedTheme();
        if (!saved || !PREMIUM_THEMES[saved]) return true; // Nothing to restore

        var tilePane = document.querySelector('.leaflet-tile-pane');
        if (!tilePane) return false;

        console.log('[Map Unlock] Restoring saved theme:', saved);
        switchToPremiumTheme(saved, true);

        var baseDiv = document.querySelector('.leaflet-control-layers-base');
        if (baseDiv) {
            var allRadios = baseDiv.querySelectorAll('input[type=radio]');
            for (var i = 0; i < allRadios.length; i++) allRadios[i].checked = false;
            var labels = baseDiv.querySelectorAll('label.rebel-premium');
            for (var j = 0; j < labels.length; j++) {
                if (labels[j].textContent.trim() === saved) {
                    var radio = labels[j].querySelector('input[type=radio]');
                    if (radio) radio.checked = true;
                }
            }
        }
        return true;
    }

    // --- Unified init loop (replaces 3 separate setIntervals + 3 setTimeouts) ---
    var initTries = 0;

    function tryInit() {
        initTries++;
        unlockFeatures();
        unlockZoom();

        var layerReady = fixLayerControl();

        if (!themeRestored) {
            themeRestored = restoreSavedTheme();
        }

        if (featuresUnlocked && zoomUnlocked && layerReady && themeRestored) {
            clearInterval(initInterval);
            initInterval = null;
            console.log('[Map Unlock] Init complete after ' + initTries + ' tries');
        } else if (initTries > 30) {
            clearInterval(initInterval);
            initInterval = null;
            console.log('[Map Unlock] Init stopped after max tries');
        }
    }

    // Cookie accept (self-clearing)
    var cookieTries = 0;
    cookieInterval = setInterval(function() {
        if (acceptCookies() || cookieTries++ > 20) {
            clearInterval(cookieInterval);
            cookieInterval = null;
        }
    }, 500);

    // Start unified init loop
    setTimeout(tryInit, 500);
    initInterval = setInterval(tryInit, 2000);

    // Cleanup on page unload
    window.addEventListener('beforeunload', function() {
        if (currentObserver) { currentObserver.disconnect(); currentObserver = null; }
        if (layerObserver) { layerObserver.disconnect(); layerObserver = null; }
        if (initInterval) { clearInterval(initInterval); initInterval = null; }
        if (cookieInterval) { clearInterval(cookieInterval); cookieInterval = null; }
    });
})();
