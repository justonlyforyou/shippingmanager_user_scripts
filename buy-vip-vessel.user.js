// ==UserScript==
// @name        Shipping Manager - Buy VIP Vessel
// @description Quick access to purchase hidden VIP vessels using game modal
// @version     1.6
// @author      https://github.com/justonlyforyou/
// @order       27
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    const isMobile = window.innerWidth < 1024;

    // VIP Vessels data (IDs 59-63)
    const VIP_VESSELS = [
        { id: 59, name: 'Starliner', type: 'Container', points: 2500 },
        { id: 60, name: 'MS Sundown', type: 'Tanker', points: 3500 },
        { id: 61, name: 'MS Anaconda', type: 'Container', points: 4500 },
        { id: 62, name: 'Big Bear', type: 'Container', points: 6000 },
        { id: 63, name: 'Ventura', type: 'Container', points: 8000 }
    ];

    // Get Pinia stores from Vue app
    function getStores() {
        try {
            const appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) {
                console.error('[VIPVessel] Vue app not found');
                return null;
            }
            const app = appEl.__vue_app__;
            const pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
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

    // RebelShip Menu Logo SVG (simple ship icon)
    const REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    // Get or create shared mobile row (fixed at top)
    function getOrCreateMobileRow() {
        var existing = document.getElementById('rebel-mobile-row');
        if (existing) return existing;

        // Create fixed row at top of screen
        var row = document.createElement('div');
        row.id = 'rebel-mobile-row';
        row.style.cssText = 'position:fixed;top:0;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:10px;background:#1a1a2e;padding:4px 6px;font-size:14px;z-index:9999;';

        document.body.appendChild(row);

        // Add margin to push page content down
        var appContainer = document.querySelector('#app') || document.body.firstElementChild;
        if (appContainer) {
            appContainer.style.marginTop = '2px';
        }

        return row;
    }

    // Get or create RebelShip menu
    function getOrCreateRebelShipMenu() {
        let menu = document.getElementById('rebelship-menu');
        if (menu) {
            return menu.querySelector('.rebelship-dropdown');
        }

        // Mobile: insert into mobile row
        if (isMobile) {
            var row = getOrCreateMobileRow();
            if (!row) return null;

            const container = document.createElement('div');
            container.id = 'rebelship-menu';
            container.style.cssText = 'position:relative;display:inline-block;margin-left:auto;';

            const btn = document.createElement('button');
            btn.id = 'rebelship-menu-btn';
            btn.innerHTML = REBELSHIP_LOGO;
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:18px;height:18px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;';
            btn.title = 'RebelShip Menu';

            const dropdown = document.createElement('div');
            dropdown.className = 'rebelship-dropdown';
            dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

            container.appendChild(btn);
            container.appendChild(dropdown);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
            });

            document.addEventListener('click', (e) => {
                if (!container.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });

            row.appendChild(container);
            return dropdown;
        }

        // Desktop: insert before messaging icon
        let messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) return null;

        const container = document.createElement('div');
        container.id = 'rebelship-menu';
            container.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:10px;margin-left:auto;';

        const btn = document.createElement('button');
        btn.id = 'rebelship-menu-btn';
        btn.innerHTML = REBELSHIP_LOGO;
        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        btn.title = 'RebelShip Menu';

        const dropdown = document.createElement('div');
        dropdown.className = 'rebelship-dropdown';
        dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

        container.appendChild(btn);
        container.appendChild(dropdown);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        if (messagingIcon.parentNode) {
            messagingIcon.parentNode.insertBefore(container, messagingIcon);
        }

        return dropdown;
    }

    // Add menu item to RebelShip menu
    function addMenuItem(label, hasSubmenu, onClick) {
        const dropdown = getOrCreateRebelShipMenu();
        if (!dropdown) {
            setTimeout(() => addMenuItem(label, hasSubmenu, onClick), 1000);
            return null;
        }

        // Check if item already exists
        if (dropdown.querySelector(`[data-rebelship-item="${label}"]`)) {
            return dropdown.querySelector(`[data-rebelship-item="${label}"]`);
        }

        const item = document.createElement('div');
        item.dataset.rebelshipItem = label;
        item.style.cssText = 'position:relative;';

        const itemBtn = document.createElement('div');
        itemBtn.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:13px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
        itemBtn.innerHTML = '<span>' + label + '</span>' + (hasSubmenu ? '<span style="font-size:10px;">&#9664;</span>' : '');

        itemBtn.addEventListener('mouseenter', () => itemBtn.style.background = '#374151');
        itemBtn.addEventListener('mouseleave', () => itemBtn.style.background = 'transparent');

        if (!hasSubmenu && onClick) {
            itemBtn.addEventListener('click', onClick);
        }

        item.appendChild(itemBtn);
        dropdown.appendChild(item);

        return item;
    }

    // Create VIP Vessel submenu
    function createVIPVesselMenu() {
        const menuItem = addMenuItem('Buy VIP Vessel', true);
        if (!menuItem) return;

        // Check if submenu already exists
        if (menuItem.querySelector('.vip-submenu')) return;

        // Create submenu
        const submenu = document.createElement('div');
        submenu.className = 'vip-submenu';
        submenu.style.cssText = 'display:none;position:absolute;left:0;top:0;transform:translateX(-100%);background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

        VIP_VESSELS.forEach(vessel => {
            const vesselItem = document.createElement('div');
            vesselItem.style.cssText = 'padding:10px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
            vesselItem.innerHTML = '<span style="color:#fff;font-weight:500;">' + vessel.name + '</span><span style="color:#fbbf24;font-size:11px;">' + vessel.points.toLocaleString() + ' pts</span>';
            vesselItem.addEventListener('mouseenter', () => vesselItem.style.background = '#374151');
            vesselItem.addEventListener('mouseleave', () => vesselItem.style.background = 'transparent');
            vesselItem.addEventListener('click', () => {
                document.getElementById('rebelship-menu').querySelector('.rebelship-dropdown').style.display = 'none';
                openVesselInGameModal(vessel.id);
            });
            submenu.appendChild(vesselItem);
        });

        menuItem.appendChild(submenu);

        // Show submenu on hover
        menuItem.addEventListener('mouseenter', () => submenu.style.display = 'block');
        menuItem.addEventListener('mouseleave', () => submenu.style.display = 'none');

        console.log('[VIPVessel] Menu item added');
    }

    // Fetch vessel data and open game modal
    async function openVesselInGameModal(vesselId) {
        const stores = getStores();
        if (!stores) {
            alert('Failed to access game stores. Try refreshing the page.');
            return;
        }

        try {
            console.log('[VIPVessel] Fetching vessel data for ID:', vesselId);

            const response = await fetch('/api/vessel/show-acquirable-vessel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vessel_id: vesselId }),
                credentials: 'include'
            });

            const data = await response.json();

            if (!data.data || !data.data.vessels_for_sale) {
                alert('Failed to load vessel data');
                return;
            }

            const vesselData = data.data.vessels_for_sale;
            const vipInfo = VIP_VESSELS.find(v => v.id === vesselId);

            const product = {
                sku: 'vip_vessel_' + vesselId,
                rewards: [{ vessel_id: vesselId }],
                points: vipInfo ? vipInfo.points : 0
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
                componentProps: { vip_vessel: vesselData }
            });

            console.log('[VIPVessel] Modal opened for:', vesselData.name);

        } catch (err) {
            console.error('[VIPVessel] Error:', err);
            alert('Error loading vessel: ' + err.message);
        }
    }

    // Initialize
    function init() {
        createVIPVesselMenu();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
    } else {
        setTimeout(init, 2000);
    }
})();
