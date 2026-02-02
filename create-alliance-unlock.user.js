// ==UserScript==
// @name         ShippingManager - Create Alliance (Level Bypass)
// @namespace    https://rebelship.org/
// @version      1.0
// @description  Opens the native alliance creation modal before level 10 (bypasses client-side level check)
// @author       https://github.com/justonlyforyou/
// @order        50
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// @RequireRebelShipMenu true
// ==/UserScript==
/* globals addMenuItem */

(function() {
    'use strict';

    var LOG_PREFIX = '[CreateAlliance]';

    function log(msg) {
        console.log(LOG_PREFIX + ' ' + msg);
    }

    function getStores() {
        try {
            var appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            var app = appEl.__vue_app__;
            var pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return null;
            return {
                modalStore: pinia._s.get('modal'),
                allianceStore: pinia._s.get('alliance'),
                userStore: pinia._s.get('user')
            };
        } catch (e) {
            log('Failed to get stores: ' + e.message);
            return null;
        }
    }

    function openCreateAllianceModal() {
        var dropdown = document.getElementById('rebelship-dropdown');
        if (dropdown) dropdown.style.display = 'none';

        var stores = getStores();
        if (!stores) {
            log('Failed to access game stores');
            return;
        }

        if (!stores.modalStore) {
            log('Modal store not found');
            return;
        }

        // Check if user is already in an alliance
        if (stores.allianceStore && stores.allianceStore.userInAlliance) {
            log('User is already in an alliance');
            return;
        }

        log('Opening native createAlliance modal');
        stores.modalStore.open('createAlliance');
    }

    function setupMenu() {
        addMenuItem('Create Alliance', openCreateAllianceModal, 999);
        log('Menu registered');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupMenu);
    } else {
        setupMenu();
    }
})();
