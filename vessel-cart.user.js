// ==UserScript==
// @name        Shipping Manager - Vessel Shopping Cart
// @description Add vessels to cart and bulk purchase them
// @version     3.5
// @author      https://github.com/justonlyforyou/
// @order       26
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==

/* eslint-env browser */
/* global MutationObserver */

(function() {
    'use strict';

    const isMobile = window.innerWidth < 1024;

    // Inject interceptor script into page context (has access to Vue internals)
    const interceptorScript = document.createElement('script');
    interceptorScript.textContent = `
    (function() {
        if (window._rebelshipInterceptorInstalled) return;
        window._rebelshipInterceptorInstalled = true;
        window._rebelshipAllVessels = [];
        window._rebelshipLastBuildConfig = null;

        // Function to find Vue component with vessel build data
        function findBuildVesselComponent() {
            // Try multiple approaches to find the vessel data

            // Approach 1: Look for build-vessel elements and get Vue instance from DOM
            const buildElements = document.querySelectorAll('[id*="build-vessel"], .vesselCard, .engineCard');
            for (const el of buildElements) {
                // Vue 3 attaches __vueParentComponent to DOM elements
                let comp = el.__vueParentComponent;
                while (comp) {
                    // Check proxy (Vue 3 Composition API / Options API data)
                    if (comp.proxy && comp.proxy.vessel) {
                        console.log('[VesselCart] Found vessel in proxy');
                        return comp.proxy.vessel;
                    }
                    // Check data function result
                    if (comp.data && typeof comp.data === 'object' && comp.data.vessel) {
                        console.log('[VesselCart] Found vessel in data');
                        return comp.data.vessel;
                    }
                    // Check exposed/setupState
                    if (comp.setupState && comp.setupState.vessel) {
                        console.log('[VesselCart] Found vessel in setupState');
                        return comp.setupState.vessel;
                    }
                    // Move up the component tree
                    comp = comp.parent;
                }
            }

            // Approach 2: Traverse from app root
            const appEl = document.querySelector('#app');
            if (!appEl) return null;

            // Vue 3 uses __vue_app__ on the mount element
            const app = appEl.__vue_app__;
            if (!app) return null;

            // Get all component instances from the internal component map
            const visited = new Set();
            function searchTree(vnode) {
                if (!vnode || visited.has(vnode)) return null;
                visited.add(vnode);

                // Check this component
                if (vnode.component) {
                    const comp = vnode.component;
                    // Check proxy (this is where reactive data lives in Vue 3)
                    if (comp.proxy && comp.proxy.vessel && (comp.proxy.vessel.capacity_type !== undefined || comp.proxy.vessel.engine_model !== undefined)) {
                        console.log('[VesselCart] Found vessel via tree search (proxy)');
                        return comp.proxy.vessel;
                    }
                    // Check setupState
                    if (comp.setupState && comp.setupState.vessel) {
                        console.log('[VesselCart] Found vessel via tree search (setupState)');
                        return comp.setupState.vessel;
                    }

                    // Search children
                    if (comp.subTree) {
                        const found = searchTree(comp.subTree);
                        if (found) return found;
                    }
                }

                // Search children array
                if (vnode.children && Array.isArray(vnode.children)) {
                    for (const child of vnode.children) {
                        const found = searchTree(child);
                        if (found) return found;
                    }
                }

                // Search dynamicChildren
                if (vnode.dynamicChildren) {
                    for (const child of vnode.dynamicChildren) {
                        const found = searchTree(child);
                        if (found) return found;
                    }
                }

                return null;
            }

            // Start from root component's subTree
            const rootComponent = app._container._vnode;
            if (rootComponent) {
                return searchTree(rootComponent);
            }

            return null;
        }

        // Function to read current build config from Vue component
        window._rebelshipGetBuildConfig = function() {
            console.log('[VesselCart] _rebelshipGetBuildConfig called');

            // Check for build-vessel section in DOM first
            const buildSection = document.querySelector('#build-vessel-order-section, [id*="build-vessel"]');
            if (!buildSection) {
                console.log('[VesselCart] Not on build page (no build-vessel section found)');
                return null;
            }

            // Try to find vessel data in Vue components
            const vesselData = findBuildVesselComponent();
            if (!vesselData) {
                console.log('[VesselCart] Could not find vessel data in Vue components');
                return null;
            }

            console.log('[VesselCart] Raw vessel data from Vue:', vesselData);

            // Convert Vue component data to API format
            const config = {
                name: vesselData.name || 'Custom Vessel',
                ship_yard: vesselData.ship_yard || null,
                vessel_model: vesselData.capacity_type || null,
                engine_type: vesselData.engine_model ? (vesselData.engine_model.type || vesselData.engine_model) : null,
                engine_kw: vesselData.engine_model ? (vesselData.engine_model.power || 0) : 0,
                capacity: vesselData.capacity || 0,
                antifouling_model: vesselData.antifouling_model ? (vesselData.antifouling_model.model || vesselData.antifouling_model) : null,
                bulbous: vesselData.bulbous ? 1 : 0,
                enhanced_thrusters: vesselData.enhanced_thrusters ? 1 : 0,
                propeller_types: vesselData.propeller ? (vesselData.propeller.model || vesselData.propeller) : null,
                range: vesselData.range || null
            };

            // Try to get price from DOM since it's calculated dynamically
            const priceEl = document.querySelector('.price .amount p, .price p:last-child');
            if (priceEl) {
                const priceText = priceEl.textContent.replace(/[^0-9]/g, '');
                config.price = parseInt(priceText) || 0;
                console.log('[VesselCart] Found price from DOM:', config.price);
            }

            console.log('[VesselCart] Converted build config:', config);
            return config;
        };

        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            this._method = method;
            return originalXHROpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function(body) {
            // Capture acquirable vessels list
            if (this._url && this._url.includes('/api/vessel/get-all-acquirable-vessels')) {
                this.addEventListener('load', function() {
                    try {
                        const data = JSON.parse(this.responseText);
                        if (data && data.data && data.data.vessels_for_sale) {
                            window._rebelshipAllVessels = data.data.vessels_for_sale;
                            console.log('[VesselCart Interceptor] Cached ' + window._rebelshipAllVessels.length + ' vessels');
                        }
                    } catch (e) {}
                });
            }
            // Capture build-vessel requests to learn the config format
            if (this._url && this._url.includes('/api/vessel/build-vessel') && this._method === 'POST') {
                try {
                    window._rebelshipLastBuildConfig = JSON.parse(body);
                    console.log('[VesselCart Interceptor] Captured build config:', window._rebelshipLastBuildConfig);
                } catch (e) {}
            }
            return originalXHRSend.apply(this, arguments);
        };

        const originalFetch = window.fetch;
        window.fetch = async function() {
            const url = typeof arguments[0] === 'string' ? arguments[0] : '';
            const options = arguments[1];

            // Capture build-vessel fetch requests
            if (url.includes('/api/vessel/build-vessel') && options && options.method === 'POST') {
                try {
                    window._rebelshipLastBuildConfig = JSON.parse(options.body);
                    console.log('[VesselCart Interceptor] Captured build config (fetch):', window._rebelshipLastBuildConfig);
                } catch (e) {}
            }

            const response = await originalFetch.apply(this, arguments);

            if (url.includes('/api/vessel/get-all-acquirable-vessels')) {
                try {
                    const clone = response.clone();
                    const data = await clone.json();
                    if (data && data.data && data.data.vessels_for_sale) {
                        window._rebelshipAllVessels = data.data.vessels_for_sale;
                        console.log('[VesselCart Interceptor] Cached ' + window._rebelshipAllVessels.length + ' vessels');
                    }
                } catch (e) {}
            }
            return response;
        };

        console.log('[VesselCart Interceptor] Installed with _rebelshipGetBuildConfig');
    })();
    `;
    (document.head || document.documentElement).appendChild(interceptorScript);
    interceptorScript.remove();

    console.log('[VesselCart] Script loaded!');

    // Cart storage key
    const CART_KEY = 'rebelship_vessel_cart';


    // RebelShip Menu Logo SVG
    const REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    const CART_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>';

    // Get cart from localStorage
    function getCart() {
        try {
            const cart = localStorage.getItem(CART_KEY);
            return cart ? JSON.parse(cart) : [];
        } catch (e) {
            console.error('[VesselCart] Failed to load cart:', e);
            return [];
        }
    }

    // Save cart to localStorage
    function saveCart(cart) {
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
            updateCartBadge();
        } catch (e) {
            console.error('[VesselCart] Failed to save cart:', e);
        }
    }

    // Generate unique key for cart item
    function getCartItemKey(vessel) {
        if (vessel.type === 'build') {
            // For builds, create key from config hash
            const cfg = vessel.buildConfig;
            return 'build_' + cfg.ship_yard + '_' + cfg.vessel_model + '_' + cfg.engine_type + '_' + cfg.capacity;
        }
        // For purchases, use vessel ID
        return 'purchase_' + vessel.id;
    }

    // Add vessel to cart
    function addToCart(vessel, quantity = 1) {
        const cart = getCart();
        const key = getCartItemKey(vessel);
        const existingIndex = cart.findIndex(item => getCartItemKey(item.vessel) === key);

        if (existingIndex > -1) {
            cart[existingIndex].quantity += quantity;
        } else {
            cart.push({ vessel, quantity, key });
        }

        saveCart(cart);
        showNotification('Added to cart: ' + vessel.name + ' x' + quantity);
    }

    // Remove from cart by key
    function removeFromCart(key) {
        let cart = getCart();
        cart = cart.filter(item => (item.key || getCartItemKey(item.vessel)) !== key);
        saveCart(cart);
    }

    // Update quantity in cart by key
    function updateQuantity(key, newQuantity) {
        const cart = getCart();
        const index = cart.findIndex(item => (item.key || getCartItemKey(item.vessel)) === key);
        if (index > -1 && newQuantity > 0) {
            cart[index].quantity = newQuantity;
            saveCart(cart);
        } else if (newQuantity <= 0) {
            removeFromCart(key);
        }
    }

    // Clear cart
    function clearCart() {
        localStorage.removeItem(CART_KEY);
        updateCartBadge();
    }

    // Get Pinia stores from Vue app
    function getStores() {
        try {
            const appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;

            const app = appEl.__vue_app__;
            const pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return null;

            // Get all stores, not just a few hardcoded ones
            const stores = {};
            pinia._s.forEach((store, name) => {
                stores[name] = store;
            });

            return stores;
        } catch (e) {
            console.error('[VesselCart] Failed to get stores:', e);
            return null;
        }
    }

    // Get vessel name from the modal UI
    function getVesselNameFromUI() {
        // Try various selectors - search globally since modal structure varies
        const selectors = [
            '.name p',
            '.name',
            '.vessel-name p',
            '.vessel-name',
            '.ship-name'
        ];

        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent) {
                const name = el.textContent.trim();
                // Skip generic/empty names
                if (name && name.length > 1 && name !== 'Order' && name !== 'Back' && name !== 'Fleet') {
                    console.log('[VesselCart] Found name in UI (' + sel + '):', name);
                    return name;
                }
            }
        }

        console.log('[VesselCart] Could not find vessel name in UI');
        return null;
    }

    // Check if we're on a build page by looking for build-specific UI elements
    function isOnBuildPage() {
        const buildSection = document.querySelector('#build-vessel-order-section, [id*="build-vessel"]');
        if (buildSection) {
            console.log('[VesselCart] Build page detected');
            return true;
        }
        return false;
    }

    // Get build configuration from injected script (runs in page context with Vue access)
    function getBuildConfig() {
        // First check if we have a captured config from actual API call
        if (window._rebelshipLastBuildConfig) {
            console.log('[VesselCart] Using captured build config from intercepted API call');
            return window._rebelshipLastBuildConfig;
        }

        // Use the injected function to read from Vue components
        if (typeof window._rebelshipGetBuildConfig === 'function') {
            const config = window._rebelshipGetBuildConfig();
            if (config) {
                return config;
            }
        }

        console.log('[VesselCart] Could not get build config');
        return null;
    }

    // Get current vessel or build config
    function getCurrentVessel() {
        // Check if we're on a build page FIRST
        if (isOnBuildPage()) {
            console.log('[VesselCart] On build page - getting build config');
            const buildConfig = getBuildConfig();
            if (buildConfig) {
                const vesselName = buildConfig.name || getVesselNameFromUI() || 'Custom Vessel';
                const buildPrice = buildConfig.price || 0;
                console.log('[VesselCart] Build config obtained:', buildConfig);
                return {
                    type: 'build',
                    name: vesselName,
                    buildConfig: buildConfig,
                    price: buildPrice
                };
            } else {
                console.log('[VesselCart] On build page but could not read config');
                return null;
            }
        }

        // Not on build page - try to find purchasable vessel
        const allVessels = window._rebelshipAllVessels || [];
        const vesselName = getVesselNameFromUI();

        if (!vesselName) {
            console.log('[VesselCart] Could not find vessel name in UI');
            return null;
        }

        if (allVessels.length === 0) {
            console.log('[VesselCart] No vessels cached - open Fleet menu first to cache vessel list');
            return null;
        }

        // Find vessel in cached list
        const vessel = allVessels.find(v => v.name === vesselName);
        if (vessel) {
            console.log('[VesselCart] Found purchasable vessel:', vessel.name, 'ID:', vessel.id);
            return { type: 'purchase', ...vessel };
        }

        // Try partial match
        const vesselPartial = allVessels.find(v => v.name.includes(vesselName) || vesselName.includes(v.name));
        if (vesselPartial) {
            console.log('[VesselCart] Found vessel (partial):', vesselPartial.name);
            return { type: 'purchase', ...vesselPartial };
        }

        console.log('[VesselCart] Vessel "' + vesselName + '" not found in ' + allVessels.length + ' cached vessels');
        return null;
    }

    // Get quantity from input
    function getQuantityFromModal() {
        // Look for quantity input in the modal
        const qtyInput = document.querySelector('.quantity-input input[type="number"]');
        if (qtyInput) {
            return parseInt(qtyInput.value) || 1;
        }

        // Alternative: look for any number input near bottom-controls
        const modal = document.querySelector('.modal-container');
        if (modal) {
            const inputs = modal.querySelectorAll('input[type="number"]');
            for (const input of inputs) {
                const val = parseInt(input.value);
                if (val > 0) return val;
            }
        }

        return 1;
    }

    // Show notification (game style)
    function showNotification(message, type = 'success') {
        const existing = document.getElementById('rebelship-notification');
        if (existing) existing.remove();

        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#3b82f6'
        };

        const notif = document.createElement('div');
        notif.id = 'rebelship-notification';
        notif.textContent = message;
        notif.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:' + colors[type] + ';color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideDown 0.3s ease;';

        document.body.appendChild(notif);
        setTimeout(() => notif.remove(), 2000);
    }

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

    // Create standalone cart button
    function createCartButton() {
        if (document.getElementById('rebelship-cart-btn')) return;

        const cart = getCart();
        const count = cart.reduce((sum, item) => sum + item.quantity, 0);

        const btn = document.createElement('button');
        btn.id = 'rebelship-cart-btn';
        btn.innerHTML = CART_ICON + ' <span id="rebelship-cart-count">(' + count + ')</span>';
        btn.title = 'Shopping Cart - Click to open';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showCartModal();
        });

        // Mobile: insert into mobile row
        if (isMobile) {
            var row = getOrCreateMobileRow();
            if (!row) {
                setTimeout(createCartButton, 1000);
                return;
            }

            btn.style.cssText = 'display:flex;align-items:center;gap:2px;padding:2px 6px;background:#f59e0b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;';

            var rebelMenu = document.getElementById('rebelship-menu');
            if (rebelMenu) {
                row.insertBefore(btn, rebelMenu);
            } else {
                row.appendChild(btn);
            }

            console.log('[VesselCart] Cart button created (mobile)');
            return;
        }

        // Desktop: insert before RebelShip menu or messaging icon
        let rebelshipMenu = document.getElementById('rebelship-menu');
        if (!rebelshipMenu) {
            let messagingIcon = document.querySelector('div.messaging.cursor-pointer');
            if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
            if (!messagingIcon) {
                setTimeout(createCartButton, 1000);
                return;
            }
            rebelshipMenu = messagingIcon;
        }

        btn.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 12px;background:#f59e0b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;margin-right:10px;box-shadow:0 2px 4px rgba(0,0,0,0.2);';

        if (rebelshipMenu.parentNode) {
            rebelshipMenu.parentNode.insertBefore(btn, rebelshipMenu);
        }

        console.log('[VesselCart] Cart button created (desktop)');
    }

    // Update cart badge
    function updateCartBadge() {
        const cart = getCart();
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

        // Update standalone cart button count
        const cartCount = document.getElementById('rebelship-cart-count');
        if (cartCount) {
            cartCount.textContent = '(' + totalItems + ')';
        }
    }

    // Add menu item
    function addMenuItem(label, hasSubmenu, onClick) {
        const dropdown = getOrCreateRebelShipMenu();
        if (!dropdown) {
            setTimeout(() => addMenuItem(label, hasSubmenu, onClick), 1000);
            return null;
        }

        if (dropdown.querySelector('[data-rebelship-item="' + label + '"]')) {
            return dropdown.querySelector('[data-rebelship-item="' + label + '"]');
        }

        const item = document.createElement('div');
        item.dataset.rebelshipItem = label;
        item.style.cssText = 'position:relative;';

        const itemBtn = document.createElement('div');
        itemBtn.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
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

    // Show shopping cart modal using game's modal system
    function showCartModal() {
        const cart = getCart();
        if (cart.length === 0) {
            showNotification('Cart is empty');
            return;
        }

        const stores = getStores();
        // User store is called 'user' in Pinia
        const userStore = stores ? stores.user : null;
        const userCash = userStore && userStore.user ? userStore.user.cash : 0;

        // Calculate totals - include build prices if available
        const hasBuildItems = cart.some(item => item.vessel.type === 'build');
        const hasUnpricedBuilds = cart.some(item => item.vessel.type === 'build' && (!item.vessel.buildConfig.price || item.vessel.buildConfig.price === 0));
        const purchaseTotal = cart.reduce((sum, item) => {
            if (item.vessel.type === 'build') {
                // Use build price if available
                const buildPrice = item.vessel.buildConfig.price || 0;
                return sum + (buildPrice * item.quantity);
            }
            if (item.vessel.price) {
                return sum + (item.vessel.price * item.quantity);
            }
            return sum;
        }, 0);
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        const canAfford = userCash >= purchaseTotal;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'rebelship-cart-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99998;display:flex;align-items:center;justify-content:center;';

        // Create modal (game style)
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#1a1f2e;border:1px solid #374151;border-radius:12px;width:90%;max-width:500px;max-height:80vh;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5);';

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #374151;background:#0f1420;';
        const checkoutText = hasUnpricedBuilds ? 'Checkout (est.)' : 'Checkout';
        header.innerHTML = '<div style="display:flex;align-items:center;gap:10px;"><span style="color:#fff;font-size:18px;font-weight:600;">' + CART_ICON + ' Shopping Cart</span></div><div style="display:flex;gap:8px;"><button id="cart-close-btn" style="padding:8px 16px;background:#4b5563;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;">Close</button><button id="cart-checkout-btn" style="padding:8px 16px;background:' + (canAfford ? '#10b981' : '#6b7280') + ';color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;"' + (canAfford ? '' : ' disabled') + '>' + checkoutText + '</button></div>';

        // Cart items container
        const itemsContainer = document.createElement('div');
        itemsContainer.style.cssText = 'padding:16px 20px;max-height:300px;overflow-y:auto;';

        // Build cart items
        cart.forEach(item => {
            const key = item.key || getCartItemKey(item.vessel);
            const isBuild = item.vessel.type === 'build';

            let priceText, totalPrice;
            if (isBuild) {
                // Show build details - handle objects by extracting value/name
                const cfg = item.vessel.buildConfig;
                console.log('[VesselCart] Build config structure:', JSON.stringify(cfg, null, 2));

                const getValue = (v) => {
                    if (v === null || v === undefined) return null;
                    if (typeof v === 'string' || typeof v === 'number') return v;
                    if (typeof v === 'object') {
                        // Try common property names for the actual value
                        return v.value || v.name || v.id || v.type || v.label || JSON.stringify(v);
                    }
                    return String(v);
                };

                const details = [];
                const model = getValue(cfg.vessel_model);
                const capacity = getValue(cfg.capacity);
                const shipyard = getValue(cfg.ship_yard);
                const engine = getValue(cfg.engine_type);
                const engineKw = getValue(cfg.engine_kw);

                if (model) details.push(model);
                if (capacity) details.push(formatNumber(capacity) + (model === 'tanker' ? ' BBL' : ' TEU'));
                if (shipyard) details.push(shipyard);
                if (engine) details.push(engine + (engineKw ? ' ' + formatNumber(engineKw) + 'kW' : ''));

                // Add perks line
                const perks = [];
                if (cfg.bulbous) perks.push('Bulbous');
                if (cfg.propeller_types) perks.push(cfg.propeller_types.replace(/_/g, ' '));
                if (cfg.antifouling_model) perks.push('AF: ' + cfg.antifouling_model.replace(/_/g, ' '));

                priceText = details.length > 0 ? details.join(' | ') : 'Build config';
                if (perks.length > 0) {
                    priceText += ' [' + perks.join(', ') + ']';
                }

                // Use price from config if available
                if (cfg.price && cfg.price > 0) {
                    totalPrice = '$' + formatNumber(cfg.price * item.quantity);
                } else {
                    totalPrice = 'Build';
                }
            } else {
                priceText = '$' + formatNumber(item.vessel.price) + ' each';
                totalPrice = '$' + formatNumber(item.vessel.price * item.quantity);
            }

            const itemDiv = document.createElement('div');
            itemDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:#252b3b;border-radius:8px;margin-bottom:8px;';
            itemDiv.innerHTML = '<div style="flex:1;"><div style="color:#fff;font-weight:500;">' + escapeHtml(item.vessel.name) + (isBuild ? ' <span style="color:#f59e0b;font-size:11px;">[BUILD]</span>' : '') + '</div><div style="color:#9ca3af;font-size:12px;">' + escapeHtml(priceText) + '</div></div><div style="display:flex;align-items:center;gap:8px;"><button class="cart-qty-minus" data-key="' + key + '" style="width:28px;height:28px;background:#374151;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:16px;">-</button><span style="color:#fff;min-width:24px;text-align:center;">' + item.quantity + '</span><button class="cart-qty-plus" data-key="' + key + '" style="width:28px;height:28px;background:#374151;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:16px;">+</button><button class="cart-remove" data-key="' + key + '" style="width:28px;height:28px;background:#dc2626;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-left:8px;" title="Remove">x</button></div><div style="min-width:80px;text-align:right;color:#10b981;font-weight:600;">' + totalPrice + '</div>';
            itemsContainer.appendChild(itemDiv);
        });

        // Footer with totals
        const footer = document.createElement('div');
        footer.style.cssText = 'padding:16px 20px;border-top:1px solid #374151;background:#0f1420;';
        const costDisplay = '$' + formatNumber(purchaseTotal) + (hasUnpricedBuilds ? ' (est.)' : '');
        footer.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#9ca3af;">Total Items:</span><span style="color:#fff;font-weight:500;">' + totalItems + ' vessels' + (hasBuildItems ? ' (incl. ' + cart.filter(i => i.vessel.type === 'build').reduce((s, i) => s + i.quantity, 0) + ' builds)' : '') + '</span></div><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#9ca3af;">Cash Available:</span><span style="color:#10b981;font-weight:500;">$' + formatNumber(userCash) + '</span></div><div style="display:flex;justify-content:space-between;"><span style="color:#fff;font-weight:600;">Total Cost:</span><span style="color:' + (canAfford ? '#10b981' : '#ef4444') + ';font-weight:700;font-size:18px;">' + costDisplay + '</span></div>';

        modal.appendChild(header);
        modal.appendChild(itemsContainer);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Close dropdown
        const dropdown = document.querySelector('.rebelship-dropdown');
        if (dropdown) dropdown.style.display = 'none';

        // Event handlers
        overlay.querySelector('#cart-close-btn').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const checkoutBtn = overlay.querySelector('#cart-checkout-btn');
        if (checkoutBtn && canAfford) {
            checkoutBtn.addEventListener('click', () => {
                overlay.remove();
                processCheckout();
            });
        }

        // Quantity buttons
        overlay.querySelectorAll('.cart-qty-minus').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                const item = getCart().find(i => (i.key || getCartItemKey(i.vessel)) === key);
                if (item) {
                    updateQuantity(key, item.quantity - 1);
                    overlay.remove();
                    showCartModal();
                }
            });
        });

        overlay.querySelectorAll('.cart-qty-plus').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                const item = getCart().find(i => (i.key || getCartItemKey(i.vessel)) === key);
                if (item) {
                    updateQuantity(key, item.quantity + 1);
                    overlay.remove();
                    showCartModal();
                }
            });
        });

        overlay.querySelectorAll('.cart-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                removeFromCart(key);
                if (getCart().length === 0) {
                    overlay.remove();
                    showNotification('Cart is empty');
                } else {
                    overlay.remove();
                    showCartModal();
                }
            });
        });
    }

    // Process checkout - purchase all vessels
    async function processCheckout() {
        const cart = getCart();
        if (cart.length === 0) return;

        const progressOverlay = document.createElement('div');
        progressOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;';
        progressOverlay.innerHTML = '<div id="checkout-progress" style="color:#fff;font-size:18px;margin-bottom:20px;">Processing...</div><div id="checkout-status" style="color:#9ca3af;font-size:14px;"></div>';
        document.body.appendChild(progressOverlay);

        const progressEl = progressOverlay.querySelector('#checkout-progress');
        const statusEl = progressOverlay.querySelector('#checkout-status');

        let successCount = 0;
        let failCount = 0;
        let errors = [];
        let totalPurchases = cart.reduce((sum, item) => sum + item.quantity, 0);
        let currentPurchase = 0;

        for (const item of cart) {
            for (let i = 0; i < item.quantity; i++) {
                currentPurchase++;
                const vesselName = item.vessel.name + (item.quantity > 1 ? '_' + (i + 1) : '');
                progressEl.textContent = 'Processing ' + currentPurchase + '/' + totalPurchases;
                statusEl.textContent = vesselName + ' (' + (i + 1) + '/' + item.quantity + ')';

                try {
                    let response, endpoint, body;

                    if (item.vessel.type === 'build' && item.vessel.buildConfig) {
                        // Build new vessel
                        endpoint = '/api/vessel/build-vessel';
                        const buildConfig = { ...item.vessel.buildConfig };
                        // Make name unique for multiple builds
                        if (item.quantity > 1) {
                            buildConfig.name = buildConfig.name + '_' + (i + 1);
                        }
                        body = JSON.stringify(buildConfig);
                        console.log('[VesselCart] Building vessel:', buildConfig);
                    } else {
                        // Purchase existing vessel
                        endpoint = '/api/vessel/purchase-vessel';
                        body = JSON.stringify({ vessel_id: item.vessel.id });
                        console.log('[VesselCart] Purchasing vessel ID:', item.vessel.id);
                    }

                    response = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: body
                    });

                    const data = await response.json();
                    if (data.error) {
                        failCount++;
                        const errorMsg = data.error.replace(/_/g, ' ');
                        errors.push(vesselName + ': ' + errorMsg);
                        statusEl.innerHTML = '<span style="color:#ef4444;">' + errorMsg + '</span>';
                        console.error('[VesselCart] Failed:', data);
                    } else if (data.success || data.data) {
                        successCount++;
                    } else {
                        failCount++;
                        errors.push(vesselName + ': unknown error');
                        console.error('[VesselCart] Failed:', data);
                    }
                } catch (e) {
                    failCount++;
                    errors.push(vesselName + ': ' + e.message);
                    console.error('[VesselCart] Error:', e);
                }

                // Delay between operations
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        // Clear cart after checkout
        clearCart();

        progressEl.textContent = 'Checkout Complete!';
        if (errors.length > 0) {
            statusEl.innerHTML = '<span style="color:#10b981;">' + successCount + ' purchased</span>, <span style="color:#ef4444;">' + failCount + ' failed</span><br><br><div style="text-align:left;max-height:150px;overflow-y:auto;font-size:12px;color:#ef4444;">' + errors.join('<br>') + '</div>';
        } else {
            statusEl.innerHTML = '<span style="color:#10b981;">' + successCount + ' purchased</span>';
        }

        setTimeout(() => {
            progressOverlay.remove();
            // Refresh user data
            const stores = getStores();
            const userStore = stores ? stores.user : null;
            if (userStore && userStore.fetchUser) {
                userStore.fetchUser();
            }
        }, errors.length > 0 ? 4000 : 2000);
    }

    // Watch for order button and inject add-to-cart button
    function watchForOrderButton() {
        const observer = new MutationObserver(() => {
            const bottomControls = document.getElementById('bottom-controls');
            const existingCartBtn = document.getElementById('add-to-cart-btn');

            // No bottom-controls = remove our button if it exists
            if (!bottomControls) {
                if (existingCartBtn) existingCartBtn.remove();
                return;
            }

            // Check if Order button exists (text must say "Order")
            const orderBtn = bottomControls.querySelector('#order-btn');
            const hasOrderText = orderBtn && orderBtn.textContent.trim() === 'Order';

            // No Order button or wrong text = remove our button
            if (!hasOrderText) {
                if (existingCartBtn) existingCartBtn.remove();
                return;
            }

            // Already have our button in this container
            if (existingCartBtn && bottomControls.contains(existingCartBtn)) return;

            // Remove stray button if exists elsewhere
            if (existingCartBtn) existingCartBtn.remove();

            console.log('[VesselCart] Found order button, injecting Add to Cart');

            // Adjust widths: Back 25%, Add to Cart 35%, Order 40%
            const backBtn = bottomControls.querySelector('.light-blue');
            if (backBtn) backBtn.style.width = '25%';
            orderBtn.style.width = '40%';

            // Create Add to Cart button
            const cartBtn = document.createElement('div');
            cartBtn.id = 'add-to-cart-btn';
            cartBtn.className = 'control-btn flex-centered';
            cartBtn.style.cssText = 'width:35%;background:#f59e0b;cursor:pointer;';
            cartBtn.innerHTML = '<span>' + CART_ICON + ' Add to Cart</span>';

            cartBtn.addEventListener('click', () => {
                const currentVessel = getCurrentVessel();
                if (currentVessel) {
                    const qty = getQuantityFromModal();
                    addToCart(currentVessel, qty);
                } else {
                    showNotification('Could not get vessel data', 'error');
                }
            });

            // Insert before Order button
            orderBtn.parentNode.insertBefore(cartBtn, orderBtn);

            console.log('[VesselCart] Add to Cart button injected');
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Helper functions
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatNumber(num) {
        // eslint-disable-next-line security/detect-unsafe-regex
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Initialize
    function init() {
        console.log('[VesselCart] init() called');

        // Create standalone cart button
        createCartButton();

        // Update badge
        updateCartBadge();

        // Watch for order button
        watchForOrderButton();

        console.log('[VesselCart] Initialized, watching for order button');
    }

    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = '@keyframes slideDown { from { opacity: 0; transform: translate(-50%, -20px); } to { opacity: 1; transform: translate(-50%, 0); } }';
    document.head.appendChild(style);

    // Init after delay (page needs to load Vue app)
    setTimeout(init, 2000);
})();
