// ==UserScript==
// @name         ShippingManager - Vessel Details Fix
// @namespace    http://tampermonkey.net/
// @description  Fix missing vessel details (Engine, Port, Fuel Factor)
// @version      2.5
// @order        65
// @author       RebelShip
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @RequireRebelShipMenu false
// @enabled      false
// ==/UserScript==

(function() {
    'use strict';

    function log(msg) {
        console.log('[VesselDetailsFix] ' + msg);
    }

    function formatPortName(code) {
        if (!code) return null;
        return code.split('_').map(function(part) {
            return part.charAt(0).toUpperCase() + part.slice(1);
        }).join(' ');
    }

    function getPinia() {
        try {
            var appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            var app = appEl.__vue_app__;
            return app._context.provides.pinia || app.config.globalProperties.$pinia;
        } catch {
            return null;
        }
    }

    function getOwnVessels() {
        var pinia = getPinia();
        if (!pinia || !pinia._s) return [];
        var vesselStore = pinia._s.get('vessel');
        if (vesselStore && vesselStore.vessels) {
            return vesselStore.vessels;
        }
        return [];
    }

    function getVesselByName(vesselName) {
        var i;
        var allVessels = window._rebelshipAllVessels;
        if (allVessels && allVessels.length > 0) {
            for (i = 0; i < allVessels.length; i++) {
                if (allVessels[i].name === vesselName) return allVessels[i];
            }
        }
        var ownVessels = getOwnVessels();
        if (ownVessels && ownVessels.length > 0) {
            for (i = 0; i < ownVessels.length; i++) {
                if (ownVessels[i].name === vesselName) return ownVessels[i];
            }
        }
        return null;
    }

    function fixVesselModal() {
        var hasAcquirable = window._rebelshipAllVessels && window._rebelshipAllVessels.length > 0;
        var hasOwn = getOwnVessels().length > 0;
        if (!hasAcquirable && !hasOwn) return;

        var vesselContainers = document.querySelectorAll('.vessel');
        if (!vesselContainers || vesselContainers.length === 0) return;

        vesselContainers.forEach(function(container) {
            if (container.dataset.fixed) return;

            var nameEl = container.querySelector('.name p');
            if (!nameEl) return;

            var vesselName = nameEl.textContent.trim();
            var vessel = getVesselByName(vesselName);
            if (!vessel) return;

            var allPs = container.querySelectorAll('p');
            for (var i = 0; i < allPs.length; i++) {
                var p = allPs[i];
                var label = p.textContent.trim();

                if (label === 'Engine' && allPs[i + 1]) {
                    var engineEl = allPs[i + 1];
                    if (!engineEl.textContent.trim() && vessel.engine_type) {
                        engineEl.textContent = vessel.engine_type;
                        log('Fixed Engine: ' + vessel.engine_type);
                    }
                }

                if (label === 'Port' && allPs[i + 1]) {
                    var portEl = allPs[i + 1];
                    var abbrev = portEl.textContent.trim();
                    if (abbrev.length <= 5 && vessel.current_port_code) {
                        var fullName = formatPortName(vessel.current_port_code);
                        if (fullName) {
                            portEl.textContent = fullName + ' (' + abbrev + ')';
                            log('Fixed Port: ' + fullName);
                        }
                    }
                }

                if (label === 'Year of construction' && vessel.fuel_factor !== undefined) {
                    var row = p.parentElement;
                    if (row && !container.querySelector('.fuel-factor-row')) {
                        var ffRow = row.cloneNode(true);
                        ffRow.classList.add('fuel-factor-row');
                        var ffPs = ffRow.querySelectorAll('p');
                        if (ffPs.length >= 2) {
                            ffPs[0].textContent = 'Fuel Factor';
                            ffPs[1].textContent = vessel.fuel_factor.toFixed(2);
                        }
                        row.parentElement.insertBefore(ffRow, row);
                        log('Added Fuel Factor: ' + vessel.fuel_factor);
                    }
                }
            }

            container.dataset.fixed = 'true';
        });
    }

    function observeModalChanges() {
        var debounceTimer = null;
        var observer = new MutationObserver(function() {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(fixVesselModal, 200);
        });

        observer.observe(document.body, { childList: true, subtree: true });
        log('Observer started');
    }

    function init() {
        observeModalChanges();
        log('Initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
