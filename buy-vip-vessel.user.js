// ==UserScript==
// @name        ShippingManager - VIP Vessel Shop (RebelShipMenu)
// @description Quick access to purchase all VIP vessels as much as you have points for ;)
// @version     2.24
// @author      https://github.com/justonlyforyou/
// @order       997
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// @RequireRebelShipMenu true
// ==/UserScript==
/* globals addSubMenu */

(function() {
    'use strict';

    var POINTS_ICON_URL = '/images/icons/points_icon.svg';

    // VIP Vessels data (IDs 59-63)
    var VIP_VESSELS = [
        { id: 59, name: 'Starliner', type: 'Container', points: 2500 },
        { id: 60, name: 'MS Sundown', type: 'Tanker', points: 3500 },
        { id: 61, name: 'MS Anaconda', type: 'Container', points: 4500 },
        { id: 62, name: 'Big Bear', type: 'Container', points: 6000 },
        { id: 63, name: 'Ventura', type: 'Container', points: 8000 }
    ];

    // Get Pinia stores from Vue app
    function getStores() {
        try {
            var appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) {
                console.error('[VIPVessel] Vue app not found');
                return null;
            }
            var app = appEl.__vue_app__;
            var pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) {
                console.error('[VIPVessel] Pinia store not found');
                return null;
            }
            return {
                modalStore: pinia._s.get('modal'),
                shopStore: pinia._s.get('shop'),
                vesselStore: pinia._s.get('vessel'),
                userStore: pinia._s.get('user')
            };
        } catch (e) {
            console.error('[VIPVessel] Failed to get stores:', e);
            return null;
        }
    }

    // Register submenu with all VIP vessels
    function createVIPVesselMenu() {
        var subItems = VIP_VESSELS.map(function(vessel) {
            return {
                label: vessel.name,
                price: vessel.points.toLocaleString(),
                icon: POINTS_ICON_URL,
                onClick: function() {
                    openVesselInGameModal(vessel.id);
                }
            };
        });
        addSubMenu('Buy VIP Vessel', subItems, 997);
        console.log('[VIPVessel] Submenu registered with ' + subItems.length + ' vessels');
    }

    // Fetch vessel data and open game modal
    function openVesselInGameModal(vesselId) {
        var stores = getStores();
        if (!stores) {
            alert('Failed to access game stores. Try refreshing the page.');
            return;
        }

        fetch('/api/vessel/show-acquirable-vessel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vessel_id: vesselId }),
            credentials: 'include'
        })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (!data.data || !data.data.vessels_for_sale) {
                alert('Failed to load vessel data');
                return;
            }

            var vesselData = data.data.vessels_for_sale;
            var vipInfo = VIP_VESSELS.find(function(v) { return v.id === vesselId; });

            // Build full product object matching game's expected structure
            var product = {
                id: vesselId,
                name: vesselData.name,
                sku: 'vip_vessel',
                description: 'Get a special vessel with 50% more revenue for each depart',
                price: vipInfo ? vipInfo.points : vesselData.price_in_points,
                image: 'price_tag_icon.svg',
                rewards: [{ type: 'vessel', name: vesselData.name, vessel_id: vesselId }],
                order: 13,
                restricted: false,
                special_tag: null,
                one_time: null,
                bonus_value: null,
                delay_hours: null,
                discount: null,
                salary: 0,
                info: []
            };

            if (stores.shopStore) {
                stores.shopStore.vip_vessel = vesselData;
                stores.shopStore.selectedVessel = vesselData;
                stores.shopStore.selectedProduct = product;
            }

            if (stores.vesselStore) {
                stores.vesselStore.acquiringVessel = vesselData;
                stores.vesselStore.selectedVessel = vesselData;
            }

            stores.modalStore.props = {
                vip_vessel: vesselData,
                product: product,
                vessel: vesselData,
                componentProps: { vip_vessel: vesselData, product: product }
            };

            stores.modalStore.open('fleet', {
                initialPage: 'order',
                vip_vessel: vesselData,
                vessel: vesselData,
                product: product,
                componentProps: { vip_vessel: vesselData, product: product }
            });
        })
        .catch(function(err) {
            console.error('[VIPVessel] Error:', err);
            alert('Error loading vessel: ' + err.message);
        });
    }

    // Initialize
    function init() {
        createVIPVesselMenu();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 2000); });
    } else {
        setTimeout(init, 2000);
    }
})();
