// ==UserScript==
// @name        ShippingManager - Auto Port Refresh
// @description Automatically refreshes the port (left side menu) every 30 seconds.
// @version     1.2
// @author      https://github.com/justonlyforyou/
// @order       50
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    if (window._rebelShipAtPortRefreshActive) return;
    window._rebelShipAtPortRefreshActive = true;

    var REFRESH_INTERVAL_MS = 30 * 1000; // 30 seconds
    var refreshTimer = null;

    function log(msg) {
        console.log('[AtPortRefresh] ' + msg);
    }

    function getPinia() {
        var app = document.querySelector('#app');
        if (!app || !app.__vue_app__) return null;
        return app.__vue_app__._context?.provides?.pinia || app.__vue_app__.config?.globalProperties?.$pinia;
    }

    function getVesselStore() {
        var pinia = getPinia();
        if (!pinia || !pinia._s) return null;
        return pinia._s.get('vessel');
    }

    function refreshAtPort() {
        var vesselStore = getVesselStore();
        if (vesselStore && vesselStore.fetchUserVessels) {
            vesselStore.fetchUserVessels();
            return true;
        }
        return false;
    }

    function startRefreshTimer() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }

        log('Starting At Port refresh timer (every 30 seconds)');
        refreshTimer = setInterval(function() {
            refreshAtPort();
        }, REFRESH_INTERVAL_MS);
    }

    function init() {
        log('Initializing At Port Refresh script v1.2');

        // Wait for Vue app to be ready
        var checkInterval = setInterval(function() {
            var pinia = getPinia();
            if (pinia) {
                clearInterval(checkInterval);
                log('Pinia found, starting refresh timer');
                startRefreshTimer();
            }
        }, 1000);

        // Timeout after 30 seconds
        setTimeout(function() {
            clearInterval(checkInterval);
        }, 30000);
    }

    init();
})();
