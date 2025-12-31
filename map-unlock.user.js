// ==UserScript==
// @name        Shipping Manager - Premium Feature Unlocker
// @description Unlocks premium map themes, tanker ops, metropolis and extended zoom
// @version     1.0
// @author      https://github.com/justonlyforyou/
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    if (window._rebelShipUnlockActive) return;
    window._rebelShipUnlockActive = true;

    var TOKEN = 'sk.eyJ1Ijoic2hqb3J0aCIsImEiOiJjbGV0cHdodGwxaWZnM3NydnlvNHc4cG02In0.D5n6nIFb0JqhGA9lM_jRkw';

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

    function switchToPremiumTheme(themeName) {
        var theme = PREMIUM_THEMES[themeName];
        if (!theme) return;

        currentPremiumTheme = themeName;

        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
        }

        var tilePane = document.querySelector('.leaflet-tile-pane');
        if (!tilePane) return;

        tilePane.querySelectorAll('img').forEach(function(img) {
            var match = img.src.match(/\/(\d+)\/(\d+)\/(\d+)/);
            if (match) {
                img.src = theme.base + '/' + match[1] + '/' + match[2] + '/' + match[3] + theme.suffix + '?access_token=' + TOKEN;
            }
        });

        currentObserver = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                m.addedNodes.forEach(function(node) {
                    if (node.tagName === 'IMG') {
                        var match = node.src.match(/\/(\d+)\/(\d+)\/(\d+)/);
                        if (match && currentPremiumTheme) {
                            var t = PREMIUM_THEMES[currentPremiumTheme];
                            node.src = t.base + '/' + match[1] + '/' + match[2] + '/' + match[3] + t.suffix + '?access_token=' + TOKEN;
                        }
                    }
                });
            });
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
        } catch(e) {}

        console.log('[Map Unlock] Switched to premium theme:', themeName);
    }

    function stopPremiumTheme() {
        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
        }
        currentPremiumTheme = null;

        // Remove all tile images to force complete reload
        var tilePane = document.querySelector('.leaflet-tile-pane');
        if (tilePane) {
            tilePane.querySelectorAll('img').forEach(function(img) {
                img.remove();
            });
        }

        // Force map to reload tiles
        try {
            var app = document.querySelector('#app').__vue_app__;
            var pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            var map = pinia._s.get('mapStore').map;

            // Invalidate and redraw
            map.invalidateSize();
            map._resetView(map.getCenter(), map.getZoom(), true);
        } catch(e) {
            // Fallback: reload page section
            try {
                var tileContainers = document.querySelectorAll('.leaflet-tile-container');
                tileContainers.forEach(function(c) { c.innerHTML = ''; });
                window.dispatchEvent(new Event('resize'));
            } catch(e2) {}
        }

        console.log('[Map Unlock] Reset to standard tiles');
    }

    // Auto-accept cookies
    function acceptCookies() {
        var btn = document.querySelector('button.dark-green');
        if (btn && btn.textContent.includes('accept')) {
            btn.click();
            return true;
        }
        return false;
    }

    var cookieTries = 0;
    var cookieInterval = setInterval(function() {
        if (acceptCookies() || cookieTries++ > 20) clearInterval(cookieInterval);
    }, 500);

    // Unlock tanker ops and metropolis
    function unlockFeatures() {
        try {
            var app = document.querySelector('#app');
            if (!app || !app.__vue_app__) return;
            var pinia = app.__vue_app__._context.provides.pinia || app.__vue_app__.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return;
            var userStore = pinia._s.get('user');
            if (!userStore || !userStore.user) return;

            var companyType = userStore.user.company_type;
            if (!companyType) return;

            var hasTanker = Array.isArray(companyType) ? companyType.includes('tanker') : (typeof companyType === 'string' && companyType.indexOf('tanker') >= 0);
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
                userStore.$patch(function(state) {
                    state.user.company_type = newCompanyType;
                    if (state.settings) state.settings.metropolis = newMetropolis;
                });
            }
        } catch(e) {}
    }

    // Unlock zoom range
    function unlockZoom() {
        try {
            var app = document.querySelector('#app');
            if (!app || !app.__vue_app__) return;
            var pinia = app.__vue_app__._context.provides.pinia || app.__vue_app__.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return;
            var mapStore = pinia._s.get('mapStore');
            if (mapStore && mapStore.map) {
                mapStore.map.setMinZoom(1);
                mapStore.map.setMaxZoom(18);
            }
        } catch(e) {}
    }

    // Fix layer control - keep standard options, add premium options
    function fixLayerControl() {
        var baseDiv = document.querySelector('.leaflet-control-layers-base');
        if (!baseDiv) return;
        if (baseDiv.dataset.fixed) return;
        baseDiv.dataset.fixed = 'true';

        // Remove locked labels and premium notices (they don't work anyway)
        baseDiv.querySelectorAll('label.locked').forEach(function(l) { l.remove(); });
        baseDiv.querySelectorAll('.premium-span').forEach(function(s) { s.remove(); });
        baseDiv.querySelectorAll('.custom-separator').forEach(function(s) { s.remove(); });

        // Add premium section header
        var premHeader = document.createElement('div');
        premHeader.style.cssText = 'color:#4ade80;font-size:11px;padding:4px 0;margin-top:8px;border-top:1px solid #444;';
        premHeader.textContent = 'Premium (unlocked)';
        baseDiv.appendChild(premHeader);

        // Add working premium theme options
        var themeNames = ['Dark', 'Light', 'Street', 'Satellite', 'City', 'Sky'];
        themeNames.forEach(function(name) {
            var label = document.createElement('label');
            label.className = 'rebel-premium';
            label.style.cssText = 'display:block;cursor:pointer;padding:2px 0;';
            var span = document.createElement('span');
            var radio = document.createElement('input');
            radio.type = 'radio';
            radio.className = 'leaflet-control-layers-selector';
            radio.name = 'leaflet-base-layers_rebel';
            radio.style.marginRight = '4px';
            span.appendChild(radio);
            span.appendChild(document.createTextNode(' ' + name));
            label.appendChild(span);

            label.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                // Uncheck all radios in the control
                baseDiv.querySelectorAll('input[type=radio]').forEach(function(r) { r.checked = false; });
                radio.checked = true;
                switchToPremiumTheme(name);
            };

            baseDiv.appendChild(label);
        });

        // Make original standard options reset to normal tiles when clicked
        baseDiv.querySelectorAll('label').forEach(function(label) {
            if (label.classList.contains('rebel-premium')) return;
            if (label.dataset.rebelFixed) return;
            label.dataset.rebelFixed = 'true';

            label.addEventListener('click', function() {
                // Uncheck premium radios
                baseDiv.querySelectorAll('input[name=leaflet-base-layers_rebel]').forEach(function(r) { r.checked = false; });
                // Reset to standard tiles
                stopPremiumTheme();
            });
        });

        console.log('[Map Unlock] Layer control fixed with premium options');
    }

    setInterval(unlockFeatures, 2000);
    setInterval(unlockZoom, 2000);
    setTimeout(fixLayerControl, 2500);
    setInterval(fixLayerControl, 3000);
    setTimeout(unlockFeatures, 3000);
    setTimeout(unlockZoom, 3000);

    console.log('[Map Unlock] Script loaded');
})();
