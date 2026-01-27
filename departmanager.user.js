// ==UserScript==
// @name         ShippingManager - Depart Manager
// @namespace    https://rebelship.org/
// @description  Unified departure management: Auto bunker rebuy, auto-depart, route settings
// @version      3.37
// @author       https://github.com/justonlyforyou/
// @order        10
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// @background-job-required true
// @RequireRebelShipMenu true
// ==/UserScript==
/* globals addMenuItem */

(function() {
    'use strict';

    var SCRIPT_NAME = 'Depart Manager';
    var SCRIPT_NAME_BRIDGE = 'DepartManager';
    var STORE_NAME = 'data';
    var AUTOPRICE_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
    var CHECK_INTERVAL = 60 * 1000; // 60 seconds
    var CATCHUP_THRESHOLD = 2 * 60 * 1000; // 2 minutes - if more time passed, run immediate catch-up
    var API_BASE = 'https://shippingmanager.cc/api';

    // Legacy key for Android settings sync
    var OLD_STORAGE_KEY = 'rebelship_depart_manager';

    // In-memory cache (loaded from Bridge storage)
    var storageCache = null;
    var lastCheckTimeCache = 0;
    var autoPriceCacheData = {};

    // Hijacking risk cache - stores route_origin<>route_destination -> risk mapping
    var hijackingRiskCache = {};

    // ============================================
    // REBELSHIPBRIDGE STORAGE HELPERS
    // ============================================
    async function dbGet(key) {
        try {
            var result = await window.RebelShipBridge.storage.get(SCRIPT_NAME_BRIDGE, STORE_NAME, key);
            if (result) {
                return JSON.parse(result);
            }
            return null;
        } catch (e) {
            log('dbGet error: ' + e.message, 'error');
            return null;
        }
    }

    async function dbSet(key, value) {
        try {
            await window.RebelShipBridge.storage.set(SCRIPT_NAME_BRIDGE, STORE_NAME, key, JSON.stringify(value));
            return true;
        } catch (e) {
            log('dbSet error: ' + e.message, 'error');
            return false;
        }
    }

    var DEFAULT_SETTINGS = {
        // Fuel Settings
        fuelMode: 'off',
        fuelPriceThreshold: 500,
        fuelMinCash: 1000000,
        fuelIntelligentMaxPrice: 600,
        fuelIntelligentBelowEnabled: false,
        fuelIntelligentBelow: 500,
        fuelIntelligentShipsEnabled: false,
        fuelIntelligentShips: 5,
        fuelNotifyIngame: true,
        fuelNotifySystem: false,
        // CO2 Settings
        co2Mode: 'off',
        co2PriceThreshold: 10,
        co2MinCash: 1000000,
        co2IntelligentMaxPrice: 12,
        co2IntelligentBelowEnabled: false,
        co2IntelligentBelow: 500,
        co2IntelligentShipsEnabled: false,
        co2IntelligentShips: 5,
        avoidNegativeCO2: false,
        co2NotifyIngame: true,
        co2NotifySystem: false,
        // Depart Settings
        autoDepartEnabled: false,
        departNotifyIngame: true,
        departNotifySystem: false,
        // Min Utilization Settings
        minUtilizationEnabled: false,
        minUtilizationThreshold: 50,
        minUtilizationNotifyIngame: true,
        minUtilizationNotifySystem: false,
        // Notifications (legacy, kept for backward compatibility)
        systemNotifications: false
    };

    var DEBUG_MODE = false;

    function log(msg, level) {
        level = level || 'info';
        var prefix = '[Depart Manager]';
        if (level === 'error') {
            console.error(prefix, msg);
        } else if (level === 'warn') {
            console.warn(prefix, msg);
        } else if (DEBUG_MODE) {
            console.log(prefix, msg);
        }
    }


    // ============================================
    // STORAGE - Unified storage for all features (IndexedDB with in-memory cache)
    // ============================================
    function getDefaultStorage() {
        return {
            settings: Object.assign({}, DEFAULT_SETTINGS),
            pendingRouteSettings: {},
            priceChangedAt: {},
            lastGradualIncrease: {}
        };
    }

    function getStorage() {
        if (storageCache) {
            return {
                settings: Object.assign({}, DEFAULT_SETTINGS, storageCache.settings || {}),
                pendingRouteSettings: storageCache.pendingRouteSettings || {},
                priceChangedAt: storageCache.priceChangedAt || {},
                lastGradualIncrease: storageCache.lastGradualIncrease || {}
            };
        }
        return getDefaultStorage();
    }

    async function saveStorage(storage) {
        storageCache = storage;
        var success = await dbSet('storage', storage);
        if (success) {
            syncSettingsToAndroid(storage.settings);
        }
    }

    function getSettings() {
        return getStorage().settings;
    }

    async function saveSettings(settings) {
        var storage = getStorage();
        storage.settings = settings;
        await saveStorage(storage);
        log('Settings saved');
    }

    function getLastCheckTime() {
        return lastCheckTimeCache;
    }

    async function saveLastCheckTime() {
        lastCheckTimeCache = Date.now();
        await dbSet('lastCheckTime', lastCheckTimeCache);
    }

    function syncSettingsToAndroid(settings) {
        if (typeof window.RebelShipBridge !== 'undefined') {
            try {
                if (window.RebelShipBridge.syncSettings) {
                    window.RebelShipBridge.syncSettings(OLD_STORAGE_KEY, JSON.stringify(settings));
                }
                if (window.RebelShipBridge.syncRebuySettings) {
                    window.RebelShipBridge.syncRebuySettings(settings);
                }
            } catch (e) {
                log('Android sync failed: ' + e.message);
            }
        }
    }

    // ============================================
    // LOAD DATA FROM REBELSHIPBRIDGE STORAGE
    // ============================================
    async function loadStorage() {
        try {
            var dbData = await dbGet('storage');
            if (dbData) {
                storageCache = dbData;
                log('Loaded storage from RebelShipBridge');
            }
            var lastCheckData = await dbGet('lastCheckTime');
            if (typeof lastCheckData === 'number') {
                lastCheckTimeCache = lastCheckData;
            }
            var cacheData = await dbGet('autoPriceCache');
            if (cacheData) {
                autoPriceCacheData = cacheData;
            }
        } catch (err) {
            log('loadStorage error: ' + err.message, 'error');
        }
    }

    // ============================================
    // PENDING ROUTE SETTINGS STORAGE
    // ============================================
    function savePendingRouteSettings(vesselId, data) {
        var storage = getStorage();
        storage.pendingRouteSettings[vesselId] = {
            name: data.name,
            speed: data.speed,
            guards: data.guards,
            prices: data.prices,
            savedAt: Date.now()
        };
        saveStorage(storage);
        log('Saved pending route settings for ' + data.name);
    }

    function getPendingRouteSettings(vesselId) {
        var storage = getStorage();
        return storage.pendingRouteSettings[vesselId] || null;
    }

    function deletePendingRouteSettings(vesselId) {
        var storage = getStorage();
        var vessel = storage.pendingRouteSettings[vesselId];
        if (vessel) {
            delete storage.pendingRouteSettings[vesselId];
            saveStorage(storage);
            log('Deleted pending route settings for ' + vessel.name);
        }
    }

    function getAllPendingRouteSettings() {
        var storage = getStorage();
        var result = [];
        for (var id in storage.pendingRouteSettings) {
            result.push({ vesselId: parseInt(id), data: storage.pendingRouteSettings[id] });
        }
        return result;
    }

    function getPendingRouteSettingsCount() {
        var storage = getStorage();
        return Object.keys(storage.pendingRouteSettings).length;
    }

    // ============================================
    // PRICE CHANGE TRACKING
    // ============================================
    function savePriceChangedAt(vesselId, timestamp) {
        var storage = getStorage();
        storage.priceChangedAt[vesselId] = timestamp;
        saveStorage(storage);
    }

    function getPriceChangedAt(vesselId) {
        var storage = getStorage();
        return storage.priceChangedAt[vesselId] || null;
    }

    function pricesChanged(oldPrices, newPrices) {
        if (!oldPrices || !newPrices) return true;
        if (oldPrices.dry !== newPrices.dry) return true;
        if (oldPrices.refrigerated !== newPrices.refrigerated) return true;
        if (oldPrices.fuel !== newPrices.fuel) return true;
        if (oldPrices.crude_oil !== newPrices.crude_oil) return true;
        return false;
    }

    // ============================================
    // PINIA STORE HELPERS
    // ============================================
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

    function getStore(name) {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get(name);
        } catch {
            return null;
        }
    }

    function getUserStore() { return getStore('user'); }
    function getModalStore() { return getStore('modal'); }
    function getToastStore() { return getStore('toast'); }

    function updatePiniaStore(userData) {
        var userStore = getUserStore();
        if (userStore && userStore.user && userData) {
            if (userData.fuel !== undefined) userStore.user.fuel = userData.fuel;
            if (userData.co2 !== undefined) userStore.user.co2 = userData.co2;
            if (userData.cash !== undefined) userStore.user.cash = userData.cash;
        }
        refreshBunkerUI();
    }

    function refreshBunkerUI() {
        setTimeout(function() {
            try {
                var pinia = getPinia();
                if (!pinia || !pinia._s) return;
                var userStore = pinia._s.get('user');
                if (userStore) {
                    if (userStore.fetchUser) userStore.fetchUser();
                    if (userStore.fetchUserSettings) userStore.fetchUserSettings();
                }
            } catch (e) {
                log('Bunker UI refresh error: ' + e.message);
            }
        }, 200);
    }

    function refreshGameData() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return;
            var vesselStore = pinia._s.get('vessel');
            if (vesselStore && vesselStore.fetchUserVessels) {
                vesselStore.fetchUserVessels();
            }
            var userStore = pinia._s.get('user');
            if (userStore && userStore.fetchUser) {
                userStore.fetchUser();
            }
        } catch (e) {
            log('Game data refresh error: ' + e.message);
        }
    }

    // ============================================
    // NOTIFICATIONS
    // ============================================
    /**
     * Unified notification function
     * - Shows in-game toast (always)
     * - Sends desktop notification via RebelShipNotify (if enabled in settings)
     * - Format: "[Depart Manager] MESSAGE"
     *
     * @param {string} message - The notification message
     * @param {string} type - 'success', 'error', 'warning', 'info' (default: 'success')
     * @param {string} category - Category for grouping (default: 'general')
     */
    function notify(message, type, category) {
        type = type || 'success';
        category = category || 'general';

        var formattedMessage = '[Depart Manager] ' + message;
        log(type.toUpperCase() + ': ' + message);

        var settings = getSettings();

        // Determine notification settings based on category
        var showIngame = true;
        var showSystem = false;

        if (category === 'fuel') {
            showIngame = settings.fuelNotifyIngame !== false;
            showSystem = settings.fuelNotifySystem === true;
        } else if (category === 'co2') {
            showIngame = settings.co2NotifyIngame !== false;
            showSystem = settings.co2NotifySystem === true;
        } else if (category === 'depart') {
            showIngame = settings.departNotifyIngame !== false;
            showSystem = settings.departNotifySystem === true;
        }

        // In-game toast (uses raw message, game UI handles styling)
        if (showIngame) {
            var toastStore = getToastStore();
            if (toastStore) {
                try {
                    if (type === 'error' && toastStore.error) {
                        toastStore.error(message);
                    } else if (type === 'warning' && toastStore.warning) {
                        toastStore.warning(message);
                    } else if (type === 'info' && toastStore.info) {
                        toastStore.info(message);
                    } else if (toastStore.success) {
                        toastStore.success(message);
                    }
                } catch {
                    // Toast store not available
                }
            }
        }

        // Desktop notification via RebelShipNotify (Windows/Android browser)
        if (showSystem && window.RebelShipNotify && window.RebelShipNotify.notify) {
            try {
                window.RebelShipNotify.notify(formattedMessage);
            } catch (e) {
                log('RebelShipNotify error: ' + e.message, 'error');
            }
        }
    }


    // ============================================
    // API FUNCTIONS
    // ============================================
    var originalFetch = window.fetch;

    async function apiFetch(endpoint, body, maxRetries) {
        maxRetries = maxRetries ?? 3;
        var lastError;

        for (var attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                var response = await originalFetch(API_BASE + endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(body || {})
                });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return await response.json();
            } catch (e) {
                lastError = e;
                log('API call (' + endpoint + ') attempt ' + attempt + '/' + maxRetries + ' failed: ' + e.message);
                if (attempt < maxRetries) {
                    var delay = attempt * 1000;
                    await new Promise(function(r) { setTimeout(r, delay); });
                }
            }
        }

        log('API call failed (' + endpoint + '): ' + lastError.message, 'error');
        return null;
    }

    async function fetchVesselData() {
        var data = await apiFetch('/vessel/get-all-user-vessels', { include_routes: true });
        if (data && data.data && data.data.user_vessels) {
            var vessels = data.data.user_vessels;
            // Update hijacking risk cache from vessel routes
            updateHijackingRiskCache(vessels);
            return vessels;
        }
        return [];
    }

    /**
     * Update hijacking risk cache from vessel routes data
     * Routes contain hijacking_risk per origin<>destination pair
     */
    function updateHijackingRiskCache(vessels) {
        for (var i = 0; i < vessels.length; i++) {
            var vessel = vessels[i];
            if (!vessel.routes || !Array.isArray(vessel.routes)) continue;
            for (var j = 0; j < vessel.routes.length; j++) {
                var route = vessel.routes[j];
                if (route.origin && route.destination && route.hijacking_risk !== undefined) {
                    var routeKey = route.origin + '<>' + route.destination;
                    var reverseKey = route.destination + '<>' + route.origin;
                    // Store both directions since piracy risk applies both ways
                    hijackingRiskCache[routeKey] = route.hijacking_risk;
                    hijackingRiskCache[reverseKey] = route.hijacking_risk;
                }
            }
        }
    }

    /**
     * Get hijacking risk for a vessel's current route
     * @param {Object} vessel - Vessel object with route_origin and route_destination
     * @returns {number} Hijacking risk percentage (0 if not found)
     */
    function getVesselHijackingRisk(vessel) {
        if (!vessel.route_origin || !vessel.route_destination) return 0;
        var routeKey = vessel.route_origin + '<>' + vessel.route_destination;
        var risk = hijackingRiskCache[routeKey];
        if (risk !== undefined) return risk;
        // Try reverse direction
        var reverseKey = vessel.route_destination + '<>' + vessel.route_origin;
        risk = hijackingRiskCache[reverseKey];
        if (risk !== undefined) return risk;
        return 0;
    }

    async function fetchBunkerStateAPI(maxRetries) {
        maxRetries = maxRetries ?? 3;
        var lastError;

        for (var attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                var response = await originalFetch(API_BASE + '/user/get-user-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({})
                });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                var data = await response.json();
                if (!data.data || !data.data.settings || !data.user) return null;
                return {
                    fuel: data.user.fuel / 1000,
                    co2: data.user.co2 / 1000,
                    cash: data.user.cash,
                    maxFuel: data.data.settings.max_fuel / 1000,
                    maxCO2: data.data.settings.max_co2 / 1000
                };
            } catch (e) {
                lastError = e;
                log('fetchBunkerStateAPI attempt ' + attempt + '/' + maxRetries + ' failed: ' + e.message);
                if (attempt < maxRetries) {
                    var delay = attempt * 1000;
                    await new Promise(function(r) { setTimeout(r, delay); });
                }
            }
        }

        log('fetchBunkerStateAPI failed: ' + lastError.message, 'error');
        return null;
    }

    async function fetchPricesAPI(maxRetries) {
        maxRetries = maxRetries ?? 3;
        var lastError;

        for (var attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                var response = await originalFetch(API_BASE + '/bunker/get-prices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({})
                });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                var data = await response.json();
                if (!data.data || !data.data.prices) return null;

                var prices = data.data.prices;
                var discountedFuel = data.data.discounted_fuel;
                var discountedCo2 = data.data.discounted_co2;

                var fuelPrice, co2Price;
                if (discountedFuel !== undefined) {
                    fuelPrice = discountedFuel;
                } else {
                    var current = findCurrentPriceSlot(prices);
                    fuelPrice = current ? current.fuel_price : null;
                }

                if (discountedCo2 !== undefined) {
                    co2Price = discountedCo2;
                } else {
                    var currentCo2 = findCurrentPriceSlot(prices);
                    co2Price = currentCo2 ? currentCo2.co2_price : null;
                }

                return { fuelPrice: fuelPrice, co2Price: co2Price };
            } catch (e) {
                lastError = e;
                log('fetchPricesAPI attempt ' + attempt + '/' + maxRetries + ' failed: ' + e.message);
                if (attempt < maxRetries) {
                    var delay = attempt * 1000;
                    await new Promise(function(r) { setTimeout(r, delay); });
                }
            }
        }

        log('fetchPricesAPI failed: ' + lastError.message, 'error');
        return null;
    }

    function findCurrentPriceSlot(prices) {
        if (!prices || prices.length === 0) return null;
        var now = new Date();
        var utcHours = now.getUTCHours();
        var utcMinutes = now.getUTCMinutes();
        var hourStr = utcHours < 10 ? '0' + utcHours : '' + utcHours;
        var currentSlot = utcMinutes < 30 ? hourStr + ':00' : hourStr + ':30';
        for (var i = 0; i < prices.length; i++) {
            if (prices[i].time === currentSlot) return prices[i];
        }
        return prices[0];
    }

    async function getBunkerData() {
        // Always fetch from API to get fresh data
        // Vue store can be stale after purchases/departures
        return await fetchBunkerStateAPI();
    }

    async function updateRouteData(vesselId, speed, guards, prices, oldPrices) {
        var body = {
            user_vessel_id: vesselId,
            speed: speed,
            guards: guards,
            prices: prices
        };
        var data = await apiFetch('/route/update-route-data', body);
        var result = data && data.data && data.data.user_vessel;

        if (result && prices) {
            if (pricesChanged(oldPrices, prices)) {
                savePriceChangedAt(vesselId, Date.now());
            }
        }

        return result;
    }

    // ============================================
    // CENTRAL AUTO-PRICE CACHE
    // Fetched once at startup, read by all features
    // ============================================
    function getAutoPriceCache() {
        return autoPriceCacheData;
    }

    async function saveAutoPriceCache(cache) {
        autoPriceCacheData = cache;
        await dbSet('autoPriceCache', cache);
    }

    function getAutoprice(routeId, vesselType) {
        // Read-only from cache - no API calls
        var cacheKey = routeId + '_' + (vesselType === 'tanker' ? 't' : 'c');
        var cache = getAutoPriceCache();
        var entry = cache[cacheKey];

        if (entry && entry.prices) {
            return {
                dry: entry.prices.dry,
                ref: entry.prices.ref,
                fuel: entry.prices.fuel,
                crude: entry.prices.crude
            };
        }
        return null;
    }

    async function initAutoPriceCache() {
        var vessels = await fetchVesselData();
        if (!vessels || vessels.length === 0) return;

        var vesselsWithRoutes = vessels.filter(function(v) {
            var routeId = (v.active_route && v.active_route.route_id) || v.route_id;
            return routeId && v.route_destination && !v.is_parked;
        });

        if (vesselsWithRoutes.length === 0) return;

        var cache = getAutoPriceCache();
        var now = Date.now();
        var needsFetch = [];

        // Check which routes need fresh data
        for (var i = 0; i < vesselsWithRoutes.length; i++) {
            var v = vesselsWithRoutes[i];
            var routeId = (v.active_route && v.active_route.route_id) || v.route_id;
            var cacheKey = routeId + '_' + (v.capacity_type === 'tanker' ? 't' : 'c');
            var entry = cache[cacheKey];

            if (!entry || (now - entry.timestamp) >= AUTOPRICE_CACHE_TTL) {
                needsFetch.push({ vessel: v, routeId: routeId, cacheKey: cacheKey });
            }
        }

        if (needsFetch.length === 0) {
            log('Auto-price cache valid for all ' + vesselsWithRoutes.length + ' routes');
            return;
        }

        log('Fetching auto-prices for ' + needsFetch.length + ' routes...');

        // Fetch in batches of 5
        var batchSize = 5;
        for (var j = 0; j < needsFetch.length; j += batchSize) {
            var batch = needsFetch.slice(j, j + batchSize);
            await Promise.all(batch.map(async function(item) {
                try {
                    var response = await originalFetch(API_BASE + '/demand/auto-price', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ user_vessel_id: item.vessel.id, route_id: item.routeId })
                    });
                    if (response.ok) {
                        var data = await response.json();
                        if (data && data.data) {
                            cache[item.cacheKey] = { prices: data.data, timestamp: now };
                        }
                    }
                } catch {
                    // Ignore individual failures
                }
            }));

            if (j + batchSize < needsFetch.length) {
                await new Promise(function(r) { setTimeout(r, 100); });
            }
        }

        saveAutoPriceCache(cache);
        log('Auto-price cache updated for ' + needsFetch.length + ' routes');
    }

    var lastFuelPurchaseTime = 0;
    var lastCO2PurchaseTime = 0;
    var PURCHASE_COOLDOWN_MS = 2000; // 2 seconds cooldown between purchases

    async function purchaseFuelAPI(amountTons, pricePerTon) {
        try {
            if (amountTons <= 0) return { success: false, error: 'Amount <= 0' };

            // Prevent duplicate purchases within cooldown period
            var now = Date.now();
            if (now - lastFuelPurchaseTime < PURCHASE_COOLDOWN_MS) {
                log('Fuel purchase skipped - cooldown active (' + (PURCHASE_COOLDOWN_MS - (now - lastFuelPurchaseTime)) + 'ms remaining)');
                return { success: false, error: 'cooldown' };
            }
            lastFuelPurchaseTime = now;

            var amountKg = Math.floor(amountTons * 1000);
            log('Purchasing ' + amountTons.toFixed(0) + 't fuel @ $' + pricePerTon + '/t');

            var response = await originalFetch(API_BASE + '/bunker/purchase-fuel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ amount: amountKg })
            });

            if (!response.ok) throw new Error('HTTP ' + response.status);
            var data = await response.json();

            if (data.user) updatePiniaStore(data.user);

            notify('Purchased ' + formatNumber(amountTons) + 't fuel @ $' + formatNumber(pricePerTon), 'success', 'fuel');
            return { success: true, data: data };
        } catch (e) {
            log('Fuel purchase failed: ' + e.message, 'error');
            notify('Fuel purchase failed: ' + e.message, 'error', 'fuel');
            return { success: false, error: e.message };
        }
    }

    async function purchaseCO2API(amountTons, pricePerTon) {
        try {
            if (amountTons <= 0) return { success: false, error: 'Amount <= 0' };

            // Prevent duplicate purchases within cooldown period
            var now = Date.now();
            if (now - lastCO2PurchaseTime < PURCHASE_COOLDOWN_MS) {
                log('CO2 purchase skipped - cooldown active (' + (PURCHASE_COOLDOWN_MS - (now - lastCO2PurchaseTime)) + 'ms remaining)');
                return { success: false, error: 'cooldown' };
            }
            lastCO2PurchaseTime = now;

            var amountKg = Math.floor(amountTons * 1000);
            log('Purchasing ' + amountTons.toFixed(0) + 't CO2 @ $' + pricePerTon + '/t');

            var response = await originalFetch(API_BASE + '/bunker/purchase-co2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ amount: amountKg })
            });

            if (!response.ok) throw new Error('HTTP ' + response.status);
            var data = await response.json();

            if (data.user) updatePiniaStore(data.user);

            notify('Purchased ' + formatNumber(amountTons) + 't CO2 @ $' + formatNumber(pricePerTon), 'success', 'co2');
            return { success: true, data: data };
        } catch (e) {
            log('CO2 purchase failed: ' + e.message, 'error');
            notify('CO2 purchase failed: ' + e.message, 'error', 'co2');
            return { success: false, error: e.message };
        }
    }

    async function departVesselAPI(vesselId, speed, guards) {
        try {
            var response = await originalFetch(API_BASE + '/route/depart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    user_vessel_id: vesselId,
                    speed: speed,
                    guards: guards || 0,
                    history: 0
                })
            });

            if (!response.ok) throw new Error('HTTP ' + response.status);
            var data = await response.json();

            if (!data.data || !data.data.depart_info) {
                var errorMsg = data.error || 'Unknown error';
                return { success: false, error: errorMsg };
            }

            var departInfo = data.data.depart_info;
            return {
                success: true,
                income: departInfo.depart_income,
                harborFee: departInfo.harbor_fee,
                channelFee: departInfo.channel_payment,
                fuelUsed: departInfo.fuel_usage / 1000,
                co2Used: departInfo.co2_emission / 1000
            };
        } catch (e) {
            log('departVesselAPI failed: ' + e.message, 'error');
            return { success: false, error: e.message };
        }
    }

    // Fetch port demand from API
    async function fetchPortDemandAPI(portCode) {
        try {
            var response = await originalFetch(API_BASE + '/port/get-ports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ port_code: [portCode] })
            });

            if (!response.ok) throw new Error('HTTP ' + response.status);
            var data = await response.json();

            if (data.data && data.data.port && data.data.port.length > 0) {
                return data.data.port[0];
            }
            return null;
        } catch (e) {
            log('fetchPortDemandAPI failed: ' + e.message, 'error');
            return null;
        }
    }

    // Calculate utilization percentage for a vessel at destination port
    function calculatePortUtilization(vessel, portData) {
        if (!portData || !portData.demand) return 100; // If no data, assume full

        var demand = portData.demand;
        var consumed = portData.consumed || {};
        var vesselCapacity = getVesselCapacity(vessel);

        if (vesselCapacity <= 0) return 100;

        var totalDemand = 0;
        var totalConsumed = 0;

        if (vessel.capacity_type === 'container') {
            var containerDemand = demand.container || {};
            var containerConsumed = consumed.container || {};
            totalDemand = (containerDemand.dry || 0) + (containerDemand.refrigerated || 0);
            totalConsumed = (containerConsumed.dry || 0) + (containerConsumed.refrigerated || 0);
        } else if (vessel.capacity_type === 'tanker') {
            var tankerDemand = demand.tanker || {};
            var tankerConsumed = consumed.tanker || {};
            // Tanker demand is in barrels, convert to TEU equivalent (/74)
            totalDemand = ((tankerDemand.fuel || 0) + (tankerDemand.crude_oil || 0)) / 74;
            totalConsumed = ((tankerConsumed.fuel || 0) + (tankerConsumed.crude_oil || 0)) / 74;
        }

        // Available demand = total demand - already consumed
        var availableDemand = Math.max(0, totalDemand - totalConsumed);

        // Utilization = how much of vessel capacity can be filled
        if (vesselCapacity <= 0) return 100;
        var utilization = (availableDemand / vesselCapacity) * 100;

        return Math.min(100, utilization);
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '';
        return Number(num).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    function getVesselCapacity(vessel) {
        if (!vessel || !vessel.capacity_max) return 0;
        var cap = vessel.capacity_max;
        if (vessel.capacity_type === 'tanker') {
            return ((cap.fuel || 0) + (cap.crude_oil || 0)) / 74;
        }
        return (cap.dry || 0) + (cap.refrigerated || 0);
    }

    function calculateFuelConsumption(vessel, distance, actualSpeed) {
        var capacity = getVesselCapacity(vessel);
        if (capacity <= 0 || distance <= 0 || actualSpeed <= 0) return 0;
        var fuelFactor = vessel.fuel_factor || 1;
        var fuelKg = capacity * distance * Math.sqrt(actualSpeed) * fuelFactor / 40;
        var fuelTons = fuelKg / 1000;
        return fuelTons * 1.02;
    }

    function calculateCO2Consumption(vessel, distance) {
        var capacity = getVesselCapacity(vessel);
        if (capacity <= 0 || distance <= 0) return 0;
        var co2Factor = vessel.co2_factor || 1;
        var co2PerTeuNm = (2 - capacity / 15000) * co2Factor;
        var totalCO2Kg = co2PerTeuNm * capacity * distance;
        return totalCO2Kg / 1000;
    }

    function getVesselFuelRequired(vessel) {
        // Use API value directly - no buffer needed, API returns correct fuel consumption
        var fuelNeeded = vessel.route_fuel_required || vessel.fuel_required;
        if (fuelNeeded) {
            // API value is in kg, convert to tons
            return fuelNeeded / 1000;
        }
        // Fallback: calculate ourselves (already includes small buffer)
        var distance = vessel.route_distance;
        var speed = vessel.route_speed || vessel.max_speed;
        return calculateFuelConsumption(vessel, distance, speed);
    }

    // ============================================
    // AUTO-EXPAND ADVANCED & PRICE DIFF BADGES
    // ============================================
    var uiCurrentAutoPrice = null; // Stored from intercepted demand/auto-price response

    /**
     * Expand collapsed customBlackBar elements (Advanced settings)
     */
    function expandIfCollapsed(element) {
        var svg = element.querySelector('svg');
        if (!svg) return;
        var style = svg.getAttribute('style');
        if (style && style.indexOf('rotate: 0deg') !== -1) {
            element.click();
        }
    }

    function expandAllAdvanced() {
        var bars = document.querySelectorAll('.customBlackBar');
        bars.forEach(function(bar) {
            expandIfCollapsed(bar);
        });
    }

    function uiParsePrice(priceStr) {
        if (!priceStr) return null;
        var match = priceStr.match(/[\d.]+/);
        return match ? parseFloat(match[0]) : null;
    }

    function uiCalcDiffPercent(current, base) {
        if (!base || base === 0) return 0;
        return Math.round(((current - base) / base) * 100);
    }

    function uiGetCargoType(cargoEl) {
        var typeP = cargoEl.querySelector('.type p');
        if (typeP) return typeP.textContent.trim().toLowerCase();
        return null;
    }

    function uiUpdateDiffBadge(priceSpan, diffPercent) {
        var badge = priceSpan.nextElementSibling;
        if (!badge || !badge.classList.contains('price-diff-badge')) {
            badge = document.createElement('span');
            badge.className = 'price-diff-badge';
            badge.style.cssText = 'margin-left: 6px; font-size: 12px; font-weight: bold;';
            priceSpan.parentNode.insertBefore(badge, priceSpan.nextSibling);
        }

        if (diffPercent === 0) {
            badge.textContent = '0%';
            badge.style.color = '#000';
        } else if (diffPercent > 0) {
            badge.textContent = '+' + diffPercent + '%';
            badge.style.color = '#4ade80';
        } else {
            badge.textContent = diffPercent + '%';
            badge.style.color = '#ef4444';
        }
    }


    /**
     * Get current vessel being edited from Pinia store
     */
    function getCurrentEditingVessel() {
        try {
            var routeStore = getStore('route');
            if (routeStore && routeStore.selectedVessel) {
                return routeStore.selectedVessel;
            }
            var globalStore = getStore('global');
            if (globalStore && globalStore.trackedVessel) {
                return globalStore.trackedVessel;
            }
        } catch {
            // Ignore
        }
        return null;
    }

    // Store initial prices for create route modal (the displayed price IS the auto-price)
    var uiCreateRouteBasePrices = null;

    /**
     * Remove all price diff badges from the UI
     */
    function uiClearPriceDiffBadges() {
        var badges = document.querySelectorAll('.price-diff-badge');
        badges.forEach(function(badge) {
            badge.remove();
        });
    }

    /**
     * Check if we're in a create route modal (not edit route)
     */
    function isCreateRouteModal() {
        var header = document.querySelector('.modal-header .header-title');
        if (header && header.textContent.toLowerCase().includes('create')) {
            return true;
        }
        // Also check if vessel has no active route
        var vessel = getCurrentEditingVessel();
        if (vessel && !vessel.active_route && !vessel.route_id) {
            return true;
        }
        return false;
    }

    /**
     * Read current prices from DOM as base prices for create route
     */
    function readBasePricesFromDOM() {
        var prices = {};
        var cargos = document.querySelectorAll('.changePrice .cargo');
        cargos.forEach(function(cargo) {
            var cargoType = uiGetCargoType(cargo);
            var priceSpan = cargo.querySelector('.priceSelector .greenText');
            if (cargoType && priceSpan) {
                var price = uiParsePrice(priceSpan.textContent);
                if (price) {
                    if (cargoType === 'crude oil') prices.crude = price;
                    else if (cargoType === 'fuel') prices.fuel = price;
                    else if (cargoType === 'dry' || cargoType === 'dry storage') prices.dry = price;
                    else if (cargoType === 'refrigerated') prices.ref = price;
                }
            }
        });
        return Object.keys(prices).length > 0 ? prices : null;
    }

    /**
     * Update price diff badges
     * Uses central auto-price cache, intercepted auto-price, or DOM prices for create route
     */
    function uiUpdatePriceDiffs() {
        var changePriceEls = document.querySelectorAll('.changePrice');
        if (changePriceEls.length === 0) {
            return;
        }

        var autoPrice = null;

        // For CREATE route: prefer API auto-price for correct price diff calculation
        // Fall back to DOM prices only if API price not available
        if (isCreateRouteModal()) {
            if (uiCurrentAutoPrice) {
                autoPrice = uiCurrentAutoPrice;
                log('uiUpdatePriceDiffs: CREATE route - using API auto-price: ' + JSON.stringify(autoPrice));
            } else {
                if (!uiCreateRouteBasePrices) {
                    uiCreateRouteBasePrices = readBasePricesFromDOM();
                    if (uiCreateRouteBasePrices) {
                        log('uiUpdatePriceDiffs: CREATE route - fallback to DOM: ' + JSON.stringify(uiCreateRouteBasePrices));
                    }
                }
                autoPrice = uiCreateRouteBasePrices;
            }
        } else {
            // For EDIT route: use interceptor or cache
            autoPrice = uiCurrentAutoPrice;
            if (!autoPrice) {
                var vessel = getCurrentEditingVessel();
                if (vessel) {
                    var routeId = (vessel.active_route && vessel.active_route.route_id) || vessel.route_id;
                    if (routeId) {
                        autoPrice = getAutoprice(routeId, vessel.capacity_type);
                        if (autoPrice) {
                            log('uiUpdatePriceDiffs: EDIT route - using cache for route ' + routeId);
                        }
                    }
                }
            }
        }

        if (!autoPrice) {
            return;
        }

        changePriceEls.forEach(function(changePriceEl) {
            var cargos = changePriceEl.querySelectorAll('.cargo');
            cargos.forEach(function(cargo) {
                var cargoType = uiGetCargoType(cargo);
                var priceSpan = cargo.querySelector('.priceSelector .greenText');
                if (!cargoType || !priceSpan) return;

                var currentPrice = uiParsePrice(priceSpan.textContent);
                var cargoAutoPrice = null;

                if (cargoType === 'crude oil') {
                    cargoAutoPrice = autoPrice.crude_oil || autoPrice.crude;
                } else if (cargoType === 'fuel') {
                    cargoAutoPrice = autoPrice.fuel;
                } else if (cargoType === 'dry') {
                    cargoAutoPrice = autoPrice.dry;
                } else if (cargoType === 'refrigerated') {
                    cargoAutoPrice = autoPrice.refrigerated || autoPrice.ref;
                } else if (cargoType === 'dry storage') {
                    cargoAutoPrice = autoPrice.dry;
                }

                if (currentPrice && cargoAutoPrice) {
                    var diff = uiCalcDiffPercent(currentPrice, cargoAutoPrice);
                    uiUpdateDiffBadge(priceSpan, diff);
                }
            });
        });
    }

    function uiHookPriceButtons() {
        var buttons = document.querySelectorAll('.priceSelector button');
        buttons.forEach(function(btn) {
            if (btn.dataset.autoPriceHooked) return;
            btn.dataset.autoPriceHooked = 'true';
            btn.addEventListener('click', function() {
                setTimeout(uiUpdatePriceDiffs, 150);
            });
        });

        var resetBtns = document.querySelectorAll('.resetButton');
        resetBtns.forEach(function(btn) {
            if (btn.dataset.autoPriceHooked) return;
            btn.dataset.autoPriceHooked = 'true';
            btn.addEventListener('click', function() {
                // Reset base prices - will be re-read from DOM
                uiCreateRouteBasePrices = null;
                uiCurrentAutoPrice = null;
                setTimeout(function() {
                    uiCreateRouteBasePrices = readBasePricesFromDOM();
                    uiUpdatePriceDiffs();
                }, 300);
            });
        });
    }

    /**
     * Hook canal toggle buttons - when toggled, click reset button to recalculate prices
     */
    function uiHookCanalToggles() {
        var canalToggles = document.querySelectorAll('.channel #custom-switch-button-wrapper');
        canalToggles.forEach(function(toggle) {
            if (toggle.dataset.canalHooked) return;
            toggle.dataset.canalHooked = 'true';
            toggle.addEventListener('click', function() {
                // Reset base prices so they get re-read after reset
                uiCreateRouteBasePrices = null;
                uiCurrentAutoPrice = null;

                // Find and click reset button after a short delay
                setTimeout(function() {
                    var resetBtn = document.querySelector('.resetButton');
                    if (resetBtn) {
                        resetBtn.click();
                        log('Canal toggled - reset prices');

                        // After reset, read new base prices and update badges
                        setTimeout(function() {
                            uiCreateRouteBasePrices = readBasePricesFromDOM();
                            if (uiCreateRouteBasePrices) {
                                log('Canal toggled - new base prices: ' + JSON.stringify(uiCreateRouteBasePrices));
                            }
                            uiUpdatePriceDiffs();
                        }, 500);
                    }
                }, 300);
            });
        });
    }

    function uiMainLoop() {
        expandAllAdvanced();

        if (document.querySelector('.changePrice')) {
            uiHookPriceButtons();
            uiHookCanalToggles();
            // Don't call uiUpdatePriceDiffs here - it's called when auto-price is intercepted
        }
    }

    var uiObserver = null;

    function startUIObserver() {
        if (uiObserver) return;

        setTimeout(uiMainLoop, 1500);
        setTimeout(uiMainLoop, 3000);
        setInterval(uiMainLoop, 5000);

        uiObserver = new window.MutationObserver(function(mutations) {
            var shouldRun = false;
            mutations.forEach(function(mutation) {
                // Check for modal close - clear price cache
                mutation.removedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) return;
                    if (node.id === 'modal-container' || (node.querySelector && node.querySelector('#modal-container'))) {
                        uiCurrentAutoPrice = null;
                        uiCreateRouteBasePrices = null;
                        uiClearPriceDiffBadges();
                        log('Modal closed - cleared price cache');
                    }
                });
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) return;
                    if (node.classList && node.classList.contains('customBlackBar')) {
                        setTimeout(function() { expandIfCollapsed(node); }, 100);
                    }
                    if (node.querySelectorAll) {
                        var bars = node.querySelectorAll('.customBlackBar');
                        if (bars.length > 0) {
                            bars.forEach(function(bar) {
                                setTimeout(function() { expandIfCollapsed(bar); }, 100);
                            });
                        }
                    }
                    if (node.classList && node.classList.contains('changePrice')) {
                        shouldRun = true;
                    }
                    if (node.querySelectorAll && node.querySelectorAll('.changePrice').length > 0) {
                        shouldRun = true;
                    }
                    if (node.classList && (node.classList.contains('route_advanced') || node.classList.contains('advancedContent'))) {
                        shouldRun = true;
                    }
                });
            });
            if (shouldRun) {
                setTimeout(uiMainLoop, 200);
                // Update price diffs - will use central cache or intercepted auto-price
                setTimeout(uiUpdatePriceDiffs, 300);
                setTimeout(uiUpdatePriceDiffs, 800);
            }
        });

        uiObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ============================================
    // FETCH INTERCEPTOR - Central hook for depart
    // ============================================
    window.fetch = async function() {
        var args = arguments;
        var url = args[0];
        var options = args[1];
        var urlStr = typeof url === 'string' ? url : url.toString();

        // Intercept depart request - apply pending settings BEFORE departure
        if (urlStr.includes('/route/depart')) {
            await applyPendingSettingsBeforeDepart(options);
        }

        // Track price changes BEFORE the request
        var priceChangeContext = null;
        if (urlStr.includes('/route/update-route-data') || urlStr.includes('/route/create-user-route')) {
            priceChangeContext = await preparePriceChangeTracking(urlStr, options);
        }

        // Execute original fetch
        var response = await originalFetch.apply(this, args);
        var responseClone = response.clone();

        // After successful response, check if prices actually changed
        if (priceChangeContext && response.ok) {
            await handlePriceChangeResponse(priceChangeContext, responseClone);
        }

        // Intercept vessel data responses - update hijacking risk cache
        if (urlStr.includes('/vessel/get-vessels') ||
            urlStr.includes('/vessel/get-all-user-vessels') ||
            urlStr.includes('/game/index')) {
            try {
                var data = await responseClone.json();
                handleVesselDataResponse(data);
            } catch {
                // Ignore JSON parse errors
            }
        }

        // Intercept route planner routes response - reset auto-price cache
        if (urlStr.includes('/route/get-routes-by-ports')) {
            // Reset auto-price cache when new route search happens
            // This prevents stale prices from previous route being used
            uiCurrentAutoPrice = null;
            uiCreateRouteBasePrices = null;
            uiClearPriceDiffBadges();
            log('Route search - reset auto-price cache');
        }

        // Intercept game's auto-price response - store for price diff badges
        if (urlStr.includes('/demand/auto-price')) {
            try {
                var autoPriceClone = response.clone();
                var autoPriceData = await autoPriceClone.json();
                if (autoPriceData && autoPriceData.data) {
                    uiCurrentAutoPrice = autoPriceData.data;
                    // Reset create route base prices so DOM is re-read for this route
                    uiCreateRouteBasePrices = null;
                    log('Auto-price intercepted: ' + JSON.stringify(uiCurrentAutoPrice));
                    // Update badges after a short delay, retry if elements not ready
                    setTimeout(uiUpdatePriceDiffs, 200);
                    setTimeout(uiUpdatePriceDiffs, 500);
                    setTimeout(uiUpdatePriceDiffs, 1000);
                }
            } catch {
                // Ignore JSON parse errors
            }
        }

        return response;
    };

    async function preparePriceChangeTracking(urlStr, options) {
        if (!options || !options.body) return null;

        try {
            var body = JSON.parse(options.body);
            var vesselId = body.user_vessel_id;
            var isCreate = urlStr.includes('/route/create-user-route');

            if (isCreate) {
                return { type: 'create', vesselId: vesselId, newPrices: body.prices };
            }

            var vessels = await fetchVesselData();
            if (!vessels) return null;

            var vessel = vessels.find(function(v) { return v.id === vesselId; });
            if (!vessel) return null;

            return {
                type: 'update',
                vesselId: vesselId,
                vesselName: vessel.name,
                oldPrices: vessel.prices ? { dry: vessel.prices.dry, fuel: vessel.prices.fuel } : null,
                newPrices: body.prices
            };
        } catch {
            return null;
        }
    }

    async function handlePriceChangeResponse(context, responseClone) {
        try {
            var data = await responseClone.json();
            if (!data || !data.data) return;

            var timestamp = Date.now();

            if (context.type === 'create') {
                savePriceChangedAt(context.vesselId, timestamp);
                return;
            }

            if (context.oldPrices && context.newPrices) {
                if (pricesChanged(context.oldPrices, context.newPrices)) {
                    savePriceChangedAt(context.vesselId, timestamp);
                }
            } else if (context.newPrices) {
                savePriceChangedAt(context.vesselId, timestamp);
            }
        } catch {
            // Ignore
        }
    }

    async function handleVesselDataResponse(data) {
        var vessels = [];
        if (data && data.data && data.data.user_vessels) {
            vessels = data.data.user_vessels;
        } else if (data && data.vessels) {
            vessels = data.vessels;
        }
        if (vessels.length === 0) return;

        // Update hijacking risk cache from intercepted vessel data (game/index, etc.)
        updateHijackingRiskCache(vessels);
    }

    // ============================================
    // PRE-DEPARTURE HOOK - Apply Pending Settings
    // ============================================
    async function applyPendingSettingsBeforeDepart(options) {
        if (!options || !options.body) return;

        try {
            var body = JSON.parse(options.body);
            var vesselId = body.user_vessel_id;
            if (!vesselId) return;

            // Get vessel data
            var vessels = await fetchVesselData();
            var vessel = vessels ? vessels.find(function(v) { return v.id === vesselId; }) : null;

            // Check for pending settings
            var pending = getPendingRouteSettings(vesselId);
            if (!pending) return;

            log('Applying pending settings for vessel ' + vesselId + ' before departure');

            var oldPrices = vessel ? vessel.prices : null;
            var success = await updateRouteData(vesselId, pending.speed, pending.guards, pending.prices, oldPrices);
            if (success) {
                log(pending.name + ': Pending settings applied before departure');
                deletePendingRouteSettings(vesselId);
            }
        } catch (e) {
            log('Failed to apply pending settings: ' + e.message, 'error');
        }
    }

    async function applyAllPendingSettings() {
        var allPending = getAllPendingRouteSettings();
        if (allPending.length === 0) return 0;

        var vessels = await fetchVesselData();
        if (!vessels || vessels.length === 0) return 0;

        var vesselMap = new Map(vessels.map(function(v) { return [v.id, v]; }));
        var appliedCount = 0;

        for (var i = 0; i < allPending.length; i++) {
            var entry = allPending[i];
            var vessel = vesselMap.get(entry.vesselId);

            if (!vessel || vessel.status !== 'port' || vessel.is_parked) continue;

            log('Applying pending settings for ' + entry.data.name);
            var success = await updateRouteData(entry.vesselId, entry.data.speed, entry.data.guards, entry.data.prices, vessel.prices);
            if (success) {
                deletePendingRouteSettings(entry.vesselId);
                appliedCount++;
            }

            await new Promise(function(resolve) { setTimeout(resolve, 200); });
        }

        return appliedCount;
    }

    async function cleanupStalePendingSettings() {
        var storage = getStorage();
        var pendingIds = Object.keys(storage.pendingRouteSettings);
        if (pendingIds.length === 0) return;

        var vessels = await fetchVesselData();
        if (!vessels || vessels.length === 0) return;

        var vesselMap = new Map(vessels.map(function(v) { return [v.id, v]; }));
        var removed = 0;

        for (var i = 0; i < pendingIds.length; i++) {
            var pendingKey = pendingIds[i];
            var vesselId = parseInt(pendingKey);
            var vessel = vesselMap.get(vesselId);
            var pending = storage.pendingRouteSettings[pendingKey];

            if (!pending) {
                delete storage.pendingRouteSettings[pendingKey];
                removed++;
                continue;
            }

            if (!vessel || !vessel.route_origin || !vessel.route_destination) {
                delete storage.pendingRouteSettings[pendingKey];
                removed++;
                continue;
            }

            var speedMatch = pending.speed === undefined || pending.speed === vessel.route_speed;
            var guardsMatch = pending.guards === undefined || pending.guards === vessel.route_guards;
            var pricesMatch = true;
            if (pending.prices && vessel.prices) {
                pricesMatch = (pending.prices.dry === undefined || pending.prices.dry === vessel.prices.dry) &&
                              (pending.prices.refrigerated === undefined || pending.prices.refrigerated === vessel.prices.refrigerated) &&
                              (pending.prices.fuel === undefined || pending.prices.fuel === vessel.prices.fuel) &&
                              (pending.prices.crude_oil === undefined || pending.prices.crude_oil === vessel.prices.crude_oil);
            }

            if (speedMatch && guardsMatch && pricesMatch) {
                delete storage.pendingRouteSettings[pendingKey];
                removed++;
            }
        }

        if (removed > 0) {
            saveStorage(storage);
        }
    }

    // ============================================
    // BUNKER LOGIC - Fuel and CO2 Auto-Rebuy
    // ============================================
    async function calculateTotalFuelShortfall(vessels) {
        var totalNeeded = 0;
        for (var i = 0; i < vessels.length; i++) {
            var v = vessels[i];
            if (v.status === 'port' && !v.is_parked && v.route_destination) {
                var fuelNeeded = getVesselFuelRequired(v);
                totalNeeded += fuelNeeded;
            }
        }
        return totalNeeded;
    }

    async function autoRebuyFuel() {
        var settings = getSettings();
        if (settings.fuelMode === 'off') return { bought: 0, reason: 'disabled' };

        var bunker = await getBunkerData();
        var prices = await fetchPricesAPI();
        if (!bunker || !prices || prices.fuelPrice === null) {
            return { bought: 0, reason: 'no data' };
        }

        var currentFuel = bunker.fuel;
        var maxFuel = bunker.maxFuel;
        var cash = bunker.cash;
        var fuelPrice = prices.fuelPrice;
        var availableCash = Math.max(0, cash - settings.fuelMinCash);
        var maxAffordable = Math.floor(availableCash / fuelPrice);
        var fuelSpace = maxFuel - currentFuel;

        log('Fuel: Price=$' + fuelPrice + ', Threshold=$' + settings.fuelPriceThreshold + ', Space=' + fuelSpace.toFixed(0) + 't, Mode=' + settings.fuelMode);

        // STEP 1: BASIC THRESHOLD - ALWAYS fill if price is good (applies to both 'basic' and 'intelligent' modes)
        if (fuelPrice <= settings.fuelPriceThreshold) {
            if (fuelSpace < 1) {
                log('Fuel: Price good but bunker full');
                return { bought: 0, reason: 'tank full' };
            }

            var amountToBuy = Math.min(Math.ceil(fuelSpace), maxAffordable);
            if (amountToBuy <= 0) {
                log('Fuel: Price good but cannot afford (cash reserve)');
                return { bought: 0, reason: 'insufficient cash' };
            }

            log('Fuel: BASIC - Price $' + fuelPrice + ' <= $' + settings.fuelPriceThreshold + ' - FILLING BUNKER with ' + amountToBuy + 't');
            var result = await purchaseFuelAPI(amountToBuy, fuelPrice);
            return { bought: result.success ? amountToBuy : 0, reason: result.success ? 'ok' : result.error };
        }

        // STEP 2: Price above basic threshold - check intelligent mode
        if (settings.fuelMode !== 'intelligent') {
            log('Fuel: Price $' + fuelPrice + ' > threshold $' + settings.fuelPriceThreshold + ' and intelligent disabled - skipping');
            return { bought: 0, reason: 'price $' + fuelPrice + ' > threshold $' + settings.fuelPriceThreshold };
        }

        // Intelligent mode - only buy shortfall with additional conditions
        if (fuelPrice > settings.fuelIntelligentMaxPrice) {
            log('Fuel INTEL: Price $' + fuelPrice + ' > max $' + settings.fuelIntelligentMaxPrice + ' - skipping');
            return { bought: 0, reason: 'price $' + fuelPrice + ' > max $' + settings.fuelIntelligentMaxPrice };
        }

        // Check optional "bunker below" condition
        if (settings.fuelIntelligentBelowEnabled) {
            if (currentFuel >= settings.fuelIntelligentBelow) {
                log('Fuel INTEL: Bunker ' + currentFuel.toFixed(0) + 't >= ' + settings.fuelIntelligentBelow + 't - skipping');
                return { bought: 0, reason: 'bunker ' + currentFuel.toFixed(0) + 't >= ' + settings.fuelIntelligentBelow + 't' };
            }
        }

        // Get vessels for ships check and fuel calculation
        var vessels = await fetchVesselData();
        if (!vessels) {
            log('Fuel INTEL: Could not fetch vessels - skipping');
            return { bought: 0, reason: 'no vessel data' };
        }

        // Check optional "min ships at port" condition
        if (settings.fuelIntelligentShipsEnabled) {
            var shipsAtPort = vessels.filter(function(v) { return v.status === 'port'; }).length;
            if (shipsAtPort < settings.fuelIntelligentShips) {
                log('Fuel INTEL: ' + shipsAtPort + ' ships < required ' + settings.fuelIntelligentShips + ' - skipping');
                return { bought: 0, reason: shipsAtPort + ' ships < required ' + settings.fuelIntelligentShips };
            }
        }

        // Calculate fuel shortfall for departing vessels
        var totalFuelNeeded = await calculateTotalFuelShortfall(vessels);
        var shortfall = Math.ceil(totalFuelNeeded - currentFuel);

        if (shortfall <= 0) {
            log('Fuel INTEL: No shortfall - need ' + totalFuelNeeded.toFixed(0) + 't, have ' + currentFuel.toFixed(0) + 't');
            return { bought: 0, reason: 'sufficient fuel' };
        }

        var amountToBuyInt = Math.min(shortfall, Math.floor(fuelSpace), maxAffordable);
        if (amountToBuyInt <= 0) {
            log('Fuel INTEL: Cannot buy - insufficient funds or space');
            return { bought: 0, reason: 'insufficient cash or space' };
        }

        log('Fuel INTEL: Shortfall ' + shortfall + 't - buying ' + amountToBuyInt + 't @ $' + fuelPrice);
        var resultInt = await purchaseFuelAPI(amountToBuyInt, fuelPrice);
        return { bought: resultInt.success ? amountToBuyInt : 0, reason: resultInt.success ? 'ok' : resultInt.error };
    }

    async function autoRebuyCO2() {
        var settings = getSettings();
        if (settings.co2Mode === 'off') return { bought: 0, reason: 'disabled' };

        var bunker = await getBunkerData();
        var prices = await fetchPricesAPI();
        if (!bunker || !prices || prices.co2Price === null) {
            return { bought: 0, reason: 'no data' };
        }

        var currentCO2 = bunker.co2;
        var maxCO2 = bunker.maxCO2;
        var cash = bunker.cash;
        var co2Price = prices.co2Price;
        var availableCash = Math.max(0, cash - settings.co2MinCash);
        var maxAffordable = Math.floor(availableCash / co2Price);
        var co2Space = maxCO2 - currentCO2;

        log('CO2: Price=$' + co2Price + ', BasicThreshold=$' + settings.co2PriceThreshold + ', Mode=' + settings.co2Mode);

        // ONLY BASIC MODE fills the bunker here
        // Intelligent mode does NOT buy proactively - it only fills to 0 after departures if negative
        if (co2Price <= settings.co2PriceThreshold) {
            if (co2Space < 1) {
                log('CO2: Price good but bunker full');
                return { bought: 0, reason: 'tank full' };
            }

            var amountToBuy = Math.min(Math.ceil(co2Space), maxAffordable);
            if (amountToBuy <= 0) {
                log('CO2: Price good but cannot afford (cash reserve)');
                return { bought: 0, reason: 'insufficient cash' };
            }

            log('CO2: BASIC - Price $' + co2Price + ' <= $' + settings.co2PriceThreshold + ' - FILLING BUNKER with ' + amountToBuy + 't');
            var result = await purchaseCO2API(amountToBuy, co2Price);
            return { bought: result.success ? amountToBuy : 0, reason: result.success ? 'ok' : result.error };
        }

        // Price > basic threshold - do NOT buy anything proactively
        // Intelligent mode only kicks in AFTER departures if bunker goes negative
        log('CO2: Price $' + co2Price + ' > basic threshold $' + settings.co2PriceThreshold + ' - not buying proactively');
        return { bought: 0, reason: 'price above basic threshold' };
    }

    // ============================================
    // AUTO-DEPART LOGIC
    // ============================================
    var autoDepartRunning = false;

    async function autoDepartVessels(manual) {
        var settings = getSettings();
        if (!manual && !settings.autoDepartEnabled) return { departed: 0 };

        if (autoDepartRunning) {
            log('Auto-depart already running');
            if (manual) notify('Auto-depart already running', 'info');
            return { departed: 0 };
        }

        autoDepartRunning = true;

        try {
            var departedCount = 0;
            var totalFuelUsed = 0;
            var totalCO2Used = 0;
            var totalIncome = 0;
            var errors = [];
            var skipped = [];

            // Batch tracking for notifications
            var batchCount = 0;
            var batchFuel = 0;
            var batchCO2 = 0;
            var batchIncome = 0;

            // Fetch initial data
            var vessels = await fetchVesselData();
            var bunker = await getBunkerData();
            var prices = await fetchPricesAPI();

            if (!vessels || !bunker || !prices) {
                log('Missing data for auto-depart');
                if (manual) notify('Failed to fetch data', 'error');
                autoDepartRunning = false;
                return { departed: 0 };
            }

            // Filter ready vessels
            var readyVessels = vessels.filter(function(v) {
                return v.status === 'port' && !v.is_parked && v.route_destination;
            });

            if (readyVessels.length === 0) {
                log('No vessels ready to depart');
                if (manual) notify('No vessels ready to depart', 'info');
                autoDepartRunning = false;
                return { departed: 0 };
            }

            log('Found ' + readyVessels.length + ' vessels ready to depart');

            // Sort by fuel requirement (smallest first = more vessels can depart)
            readyVessels.sort(function(a, b) {
                return getVesselFuelRequired(a) - getVesselFuelRequired(b);
            });

            // Check price thresholds once
            var canBuyFuel = false;
            var canBuyCO2 = false;

            if (settings.fuelMode !== 'off') {
                if (prices.fuelPrice <= settings.fuelPriceThreshold) {
                    canBuyFuel = true;
                } else if (settings.fuelMode === 'intelligent' && prices.fuelPrice <= settings.fuelIntelligentMaxPrice) {
                    canBuyFuel = true;
                }
            }

            if (settings.co2Mode !== 'off') {
                if (prices.co2Price <= settings.co2PriceThreshold) {
                    canBuyCO2 = true;
                } else if (settings.co2Mode === 'intelligent' && prices.co2Price <= settings.co2IntelligentMaxPrice) {
                    canBuyCO2 = true;
                }
            }

            log('Price check: Fuel $' + prices.fuelPrice + ' (can buy: ' + canBuyFuel + '), CO2 $' + prices.co2Price + ' (can buy: ' + canBuyCO2 + ')');

            // Process each vessel individually
            for (var i = 0; i < readyVessels.length; i++) {
                var vessel = readyVessels[i];
                var fuelNeeded = getVesselFuelRequired(vessel);
                var co2Needed = calculateCO2Consumption(vessel, vessel.route_distance);

                // Min utilization check
                if (settings.minUtilizationEnabled && vessel.route_destination && vessel.route_origin) {
                    var actualDestination = vessel.current_port_code === vessel.route_origin
                        ? vessel.route_destination
                        : vessel.route_origin;
                    var portDemand = await fetchPortDemandAPI(actualDestination);
                    var utilization = calculatePortUtilization(vessel, portDemand);

                    if (utilization < settings.minUtilizationThreshold) {
                        var utilMsg = vessel.name + ': Low utilization (' + utilization.toFixed(0) + '% < ' + settings.minUtilizationThreshold + '%)';
                        log(utilMsg);
                        skipped.push(utilMsg);

                        if (settings.minUtilizationNotifyIngame) {
                            try {
                                var toastStore = getToastStore();
                                if (toastStore && toastStore.warning) {
                                    toastStore.warning(vessel.name + ': Skipped - ' + utilization.toFixed(0) + '% util');
                                }
                            } catch (e) {
                                log('Toast error: ' + e.message);
                            }
                        }
                        continue;
                    }
                }

                // Refresh bunker before each vessel
                bunker = await getBunkerData();
                if (!bunker) {
                    errors.push(vessel.name + ': Failed to get bunker data');
                    continue;
                }

                // STEP 1: Check if we need fuel and buy BEFORE departure
                if (bunker.fuel < fuelNeeded) {
                    if (canBuyFuel) {
                        var fuelShortfall = fuelNeeded - bunker.fuel + 50; // +50 buffer
                        var fuelSpace = bunker.maxFuel - bunker.fuel;
                        var availableCash = Math.max(0, bunker.cash - settings.fuelMinCash);
                        var maxAffordable = Math.floor(availableCash / prices.fuelPrice);
                        var fuelToBuy = Math.min(fuelShortfall, fuelSpace, maxAffordable);

                        if (fuelToBuy > 0) {
                            log(vessel.name + ': Buying ' + fuelToBuy.toFixed(0) + 't fuel (need ' + fuelNeeded.toFixed(0) + 't, have ' + bunker.fuel.toFixed(0) + 't)');
                            var fuelResult = await purchaseFuelAPI(fuelToBuy, prices.fuelPrice);
                            if (fuelResult.success) {
                                await new Promise(function(r) { setTimeout(r, 300); });
                                bunker = await getBunkerData();
                            }
                        }
                    }

                    // Final fuel check
                    if (bunker.fuel < fuelNeeded) {
                        var fuelMsg = vessel.name + ': not_enough_fuel (' + bunker.fuel.toFixed(0) + 't < ' + fuelNeeded.toFixed(0) + 't)';
                        log(fuelMsg);
                        skipped.push(fuelMsg);
                        continue;
                    }
                }

                // STEP 2: Buy CO2 BEFORE departure (CO2 can go negative - no skip!)
                var co2Deficit = 0;
                if (bunker.co2 < co2Needed && canBuyCO2) {
                    var co2Shortfall = co2Needed - bunker.co2;
                    var co2Space = bunker.maxCO2 - bunker.co2;
                    var availableCashCO2 = Math.max(0, bunker.cash - settings.co2MinCash);
                    var maxAffordableCO2 = Math.floor(availableCashCO2 / prices.co2Price);
                    // Buy what we need, but max what fits in bunker
                    var co2ToBuy = Math.min(co2Shortfall, co2Space, maxAffordableCO2);

                    if (co2ToBuy > 0) {
                        log(vessel.name + ': Buying ' + co2ToBuy.toFixed(0) + 't CO2 (need ' + co2Needed.toFixed(0) + 't, have ' + bunker.co2.toFixed(0) + 't, max ' + bunker.maxCO2.toFixed(0) + 't)');
                        var co2Result = await purchaseCO2API(co2ToBuy, prices.co2Price);
                        if (co2Result.success) {
                            await new Promise(function(r) { setTimeout(r, 300); });
                            bunker = await getBunkerData();
                        }
                    }

                    // Calculate deficit: what exceeds bunker capacity (will go negative after depart)
                    if (co2Needed > bunker.maxCO2) {
                        co2Deficit = co2Needed - bunker.maxCO2;
                        log(vessel.name + ': CO2 deficit ' + co2Deficit.toFixed(0) + 't (need ' + co2Needed.toFixed(0) + 't > max ' + bunker.maxCO2.toFixed(0) + 't)');
                    }
                }
                // NO SKIP FOR CO2 - game allows negative CO2!

                // STEP 3: Depart the vessel
                var result = await departVesselAPI(vessel.id, vessel.route_speed, vessel.route_guards);

                if (result.success) {
                    departedCount++;
                    totalFuelUsed += result.fuelUsed;
                    totalCO2Used += result.co2Used;
                    totalIncome += result.income;

                    batchCount++;
                    batchFuel += result.fuelUsed;
                    batchCO2 += result.co2Used;
                    batchIncome += result.income;

                    log(vessel.name + ': Departed');

                    // STEP 4: Buy back CO2 deficit immediately after departure
                    if (co2Deficit > 0 && canBuyCO2) {
                        log(vessel.name + ': Buying back ' + co2Deficit.toFixed(0) + 't CO2 deficit');
                        await purchaseCO2API(co2Deficit, prices.co2Price);
                        await new Promise(function(r) { setTimeout(r, 300); });
                    }

                    // Every 10 ships: show batch summary
                    if (batchCount >= 10) {
                        var batchMsg = 'Departed ' + batchCount + ' | +$' + formatNumber(batchIncome) +
                            ' | Fuel: ' + batchFuel.toFixed(0) + 't | CO2: ' + batchCO2.toFixed(0) + 't';
                        notify(batchMsg, 'success', 'depart');
                        refreshGameData();
                        batchCount = 0;
                        batchFuel = 0;
                        batchCO2 = 0;
                        batchIncome = 0;
                    }
                } else {
                    var errMsg = vessel.name + ': ' + result.error;
                    log(errMsg, 'error');
                    errors.push(errMsg);
                }

                await new Promise(function(r) { setTimeout(r, 400); });
            }

            // Post-depart: Avoid negative CO2 (Intelligent mode only)
            var CO2_BUFFER = 100;
            if (settings.avoidNegativeCO2 && departedCount > 0 && settings.co2Mode === 'intelligent') {
                bunker = await getBunkerData();
                if (bunker && bunker.co2 < CO2_BUFFER && prices.co2Price > settings.co2PriceThreshold) {
                    if (prices.co2Price <= settings.co2IntelligentMaxPrice) {
                        var refillAmount = Math.ceil(CO2_BUFFER - bunker.co2);
                        log('CO2 buffer refill: ' + bunker.co2.toFixed(1) + 't -> ' + CO2_BUFFER + 't');
                        await purchaseCO2API(refillAmount, prices.co2Price);
                    }
                }
            }

            // Post-depart: Final Fill if price <= basic threshold
            if (departedCount > 0) {
                bunker = await getBunkerData();

                if (bunker) {
                    if (settings.fuelMode !== 'off' && prices.fuelPrice <= settings.fuelPriceThreshold) {
                        var fuelToFill = bunker.maxFuel - bunker.fuel;
                        if (fuelToFill > 0) {
                            var fuelCost = fuelToFill * prices.fuelPrice;
                            if (bunker.cash - fuelCost >= settings.fuelMinCash) {
                                await purchaseFuelAPI(fuelToFill, prices.fuelPrice);
                            }
                        }
                    }

                    if (settings.co2Mode !== 'off' && prices.co2Price <= settings.co2PriceThreshold) {
                        bunker = await getBunkerData();
                        if (bunker) {
                            var co2ToFill = bunker.maxCO2 - bunker.co2;
                            if (co2ToFill > 0) {
                                var co2Cost = co2ToFill * prices.co2Price;
                                if (bunker.cash - co2Cost >= settings.co2MinCash) {
                                    await purchaseCO2API(co2ToFill, prices.co2Price);
                                }
                            }
                        }
                    }
                }
            }

            // Send notification for remaining batch
            if (batchCount > 0) {
                var remainderMsg = 'Departed ' + batchCount + ' | +$' + formatNumber(batchIncome) +
                    ' | Fuel: ' + batchFuel.toFixed(0) + 't | CO2: ' + batchCO2.toFixed(0) + 't';
                notify(remainderMsg, 'success', 'depart');
                refreshGameData();
            }

            // Show errors/skipped when manual
            if (manual) {
                if (errors.length > 0) {
                    notify('Errors: ' + errors.join(', '), 'error');
                }
                if (skipped.length > 0 && departedCount === 0) {
                    notify('Skipped: ' + skipped.join(', '), 'warning');
                }
                if (departedCount === 0 && errors.length === 0 && skipped.length === 0) {
                    notify('No vessels departed', 'info');
                }
            }

            log('Auto-depart complete: ' + departedCount + ' departed, ' + skipped.length + ' skipped');
            return { departed: departedCount, fuelUsed: totalFuelUsed, co2Used: totalCO2Used, income: totalIncome };

        } catch (e) {
            log('Auto-depart error: ' + e.message, 'error');
            if (manual) notify('Error: ' + e.message, 'error');
            return { departed: 0 };
        } finally {
            autoDepartRunning = false;
        }
    }

    // ============================================
    // ROUTE SETTINGS TAB
    // ============================================
    var rsPendingChanges = new Map();
    var rsActiveSubtab = 'cargo';
    var rsSettingsTabAdded = false;
    var rsCachedVessels = null;

    function rsOpenVesselPreview(vesselId) {
        // Find the vessel in cached data
        var vessel = rsCachedVessels ? rsCachedVessels.find(function(v) { return v.id === vesselId; }) : null;
        if (!vessel) {
            log('Vessel not found for preview: ' + vesselId, 'error');
            return;
        }

        // Open vessel popover using same pattern as game's vesselClick
        try {
            var app = document.getElementById('app');
            if (app && app.__vue_app__) {
                var vueApp = app.__vue_app__;
                var routeStore = vueApp.config.globalProperties.$pinia._s.get('route');
                var globalStore = vueApp.config.globalProperties.$pinia._s.get('global');
                var modalStore = vueApp.config.globalProperties.$pinia._s.get('modal');

                if (routeStore && globalStore && modalStore) {
                    // Set selectedVessel on routeStore
                    routeStore.selectedVessel = vessel;
                    // Use $patch to set popupData and trackedVessel (same as game's vesselClick)
                    globalStore.$patch(function(state) {
                        state.popupData.show = true;
                        state.popupData.type = 'vessel';
                        state.trackedVessel = vessel;
                        state.isSideBarOpen = false;
                    });
                    // Close the modal
                    modalStore.closeAll();
                    return;
                }
            }
        } catch (e) {
            log('Failed to open vessel preview via Vue: ' + e.message);
        }

    }

    function rsGetAutoPrice(vessel, key) {
        // Read from central cache
        var routeId = (vessel.active_route && vessel.active_route.route_id) || vessel.route_id;
        if (!routeId) return null;
        var ap = getAutoprice(routeId, vessel.capacity_type);
        if (!ap) return null;
        // Map key names (central cache uses ref/crude, RS uses refrigerated/crude_oil)
        if (key === 'refrigerated') return ap.ref;
        if (key === 'crude_oil') return ap.crude;
        return ap[key];
    }

    function rsCalcPctDiff(current, auto) {
        if (auto === null || auto === undefined || auto === 0) return '-';
        if (current === null || current === undefined || current === '') return '-';
        var pct = ((current - auto) / auto * 100).toFixed(1);
        return (pct > 0 ? '+' : '') + pct + '%';
    }

    function rsFormatPriceAge(vesselId) {
        var timestamp = getPriceChangedAt(vesselId);
        if (!timestamp) return '-';
        var now = Date.now();
        var ageMs = now - timestamp;
        var days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        var hours = Math.floor((ageMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        if (days > 0) return days + 'd' + (hours > 0 ? ' ' + hours + 'h' : '');
        if (hours > 0) return hours + 'h';
        var mins = Math.floor(ageMs / (60 * 1000));
        return mins > 0 ? mins + 'm' : 'now';
    }

    function rsEscapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function rsToGameCode(code) {
        if (!code) return '';
        var parts = code.split('_');
        if (parts.length > 2) {
            return parts.map(function(p) { return p.charAt(0).toUpperCase(); }).join('');
        }
        return parts[0].substring(0, 3).toUpperCase();
    }

    function rsGetVesselsWithRoutes() {
        if (!rsCachedVessels) return [];
        return rsCachedVessels.filter(function(v) {
            return v.route_origin && v.route_destination;
        });
    }

    function rsGetStatusInfo(v) {
        // Moored states
        if (v.is_parked && v.status === 'port') return { code: 'MP', tooltip: 'Moored at Port', cssClass: 'status-mp' };
        if (v.is_parked && v.status === 'enroute') return { code: 'ME', tooltip: 'Moored on Arrival', cssClass: 'status-me' };

        // Drydock trip detection (TO vs FROM) - check before generic enroute
        if (v.status === 'enroute' && v.next_route_is_maintenance) {
            return { code: 'TD', tooltip: 'Going to Drydock', cssClass: 'status-td' };
        }
        if (v.status === 'enroute' && v.route_dry_operation === 1 && !v.next_route_is_maintenance) {
            return { code: 'FD', tooltip: 'Returning from Drydock', cssClass: 'status-fd' };
        }

        // Bug-use detection (no route but going to drydock = fast delivery exploit)
        if (v.next_route_is_maintenance && !v.active_route && !v.route_id) {
            return { code: 'BU', tooltip: 'Bug Use (No Route)', cssClass: 'status-bu' };
        }

        // Trip direction (outbound vs return) - use active_route.reversed field
        if (v.status === 'enroute' && v.active_route) {
            if (v.active_route.reversed === true) {
                return { code: 'ER', tooltip: 'Enroute Return', cssClass: 'status-er' };
            }
            if (v.active_route.reversed === false) {
                return { code: 'EO', tooltip: 'Enroute Outbound', cssClass: 'status-eo' };
            }
        }

        // Standard states
        if (v.status === 'anchor') return { code: 'A', tooltip: 'Anchored', cssClass: 'status-a' };
        if (v.status === 'enroute') return { code: 'E', tooltip: 'Enroute', cssClass: 'status-e' };
        if (v.status === 'port') return { code: 'P', tooltip: 'In Port', cssClass: 'status-p' };
        if (v.status === 'maintenance') return { code: 'M', tooltip: 'In Drydock', cssClass: 'status-m' };
        if (v.status === 'drydock') return { code: 'D', tooltip: 'Drydock', cssClass: 'status-d' };
        if (v.status === 'loading') return { code: 'L', tooltip: 'Loading', cssClass: 'status-e' };
        if (v.status === 'unloading') return { code: 'U', tooltip: 'Unloading', cssClass: 'status-e' };
        return { code: '?', tooltip: 'Status: ' + v.status, cssClass: '' };
    }

    function rsHandleChange(e) {
        var el = e.target;
        var vesselId = el.dataset.vesselId;
        var original = el.dataset.original;
        var value = el.value;
        var changeKey = el.dataset.changeKey;
        if (!changeKey || !vesselId) return;

        var isChanged = value !== original && value !== '';

        if (isChanged) {
            if (!rsPendingChanges.has(vesselId)) rsPendingChanges.set(vesselId, {});
            var numVal = parseFloat(value);
            rsPendingChanges.get(vesselId)[changeKey] = isNaN(numVal) ? null : numVal;
            el.classList.add('changed');
        } else {
            if (rsPendingChanges.has(vesselId)) {
                delete rsPendingChanges.get(vesselId)[changeKey];
                if (Object.keys(rsPendingChanges.get(vesselId)).length === 0) {
                    rsPendingChanges.delete(vesselId);
                }
            }
            el.classList.remove('changed');
        }

        // Update percentage cell for price changes - show new % as pending indicator
        if (changeKey.indexOf('price_') === 0) {
            // Get auto price dynamically from cache (not from data attribute which may be stale)
            var keyType = changeKey.replace('price_', '');
            if (keyType === 'crude') keyType = 'crude_oil';
            var vessel = rsCachedVessels ? rsCachedVessels.find(function(v) { return v.id === parseInt(vesselId); }) : null;
            var autoPrice = vessel ? rsGetAutoPrice(vessel, keyType) : null;
            var newPrice = parseFloat(value);
            var pctCell = document.querySelector('[data-pct-for="' + vesselId + '-' + changeKey + '"]');
            if (pctCell) {
                // Remove existing pending indicator
                var existingIndicator = pctCell.querySelector('.pending-indicator');
                if (existingIndicator) existingIndicator.remove();

                if (isChanged && !isNaN(newPrice) && autoPrice !== null) {
                    var newPct = rsCalcPctDiff(newPrice, autoPrice);
                    var indicator = document.createElement('span');
                    indicator.className = 'pending-indicator';
                    indicator.textContent = '->' + newPct;
                    pctCell.appendChild(indicator);
                }
            }
        }

        rsUpdateSaveButton();
    }

    function rsUpdateSaveButton() {
        var btn = document.querySelector('.rs-save-btn');
        var statusEl = document.querySelector('.rs-status');
        if (btn) {
            var hasChanges = rsPendingChanges.size > 0;
            btn.classList.toggle('has-changes', hasChanges);
            if (statusEl && hasChanges) {
                statusEl.textContent = rsPendingChanges.size + ' vessel(s) changed';
            }
        }
    }

    async function rsSaveRouteSettings() {
        if (rsPendingChanges.size === 0) return;

        var statusEl = document.querySelector('.rs-status');
        var saveBtn = document.querySelector('.rs-save-btn');
        if (statusEl) statusEl.textContent = 'Saving...';
        if (saveBtn) saveBtn.disabled = true;

        var appliedCount = 0;
        var pendingCount = 0;

        for (var entry of rsPendingChanges) {
            var vesselId = entry[0];
            var changes = entry[1];

            var vessel = rsCachedVessels.find(function(v) { return v.id === parseInt(vesselId); });
            if (!vessel) continue;

            var speed = changes.speed !== undefined ? changes.speed : vessel.route_speed;
            var guards = changes.guards !== undefined ? changes.guards : vessel.route_guards;
            var prices = {
                dry: changes.price_dry !== undefined ? changes.price_dry : (vessel.prices ? vessel.prices.dry : null),
                refrigerated: changes.price_refrigerated !== undefined ? changes.price_refrigerated : (vessel.prices ? vessel.prices.refrigerated : null),
                fuel: changes.price_fuel !== undefined ? changes.price_fuel : (vessel.prices ? vessel.prices.fuel : null),
                crude_oil: changes.price_crude !== undefined ? changes.price_crude : (vessel.prices ? vessel.prices.crude_oil : null)
            };

            var canApplyNow = vessel.status === 'port' && !vessel.is_parked;

            if (canApplyNow) {
                await updateRouteData(parseInt(vesselId), speed, guards, prices, vessel.prices);
                appliedCount++;
            } else {
                savePendingRouteSettings(parseInt(vesselId), { name: vessel.name, speed: speed, guards: guards, prices: prices });
                pendingCount++;
            }
        }

        if (statusEl) {
            var parts = [];
            if (appliedCount > 0) parts.push(appliedCount + ' applied');
            if (pendingCount > 0) parts.push(pendingCount + ' pending');
            statusEl.textContent = parts.join(', ') || 'Done';
        }

        rsPendingChanges.clear();
        rsUpdateSaveButton();

        document.querySelectorAll('.rs-table .changed').forEach(function(el) {
            el.classList.remove('changed');
            el.dataset.original = el.value;
        });

        rsCachedVessels = await fetchVesselData();
        rsRenderTable();

        if (saveBtn) saveBtn.disabled = false;
    }

    function rsRenderRow(v, isCargo, showAge) {
        var risk = getVesselHijackingRisk(v);
        var statusInfo = rsGetStatusInfo(v);
        var route = rsToGameCode(v.route_origin) + ' > ' + rsToGameCode(v.route_destination);
        var pending = getPendingRouteSettings(v.id);
        var hasPending = pending !== null;

        var price1 = isCargo ? (v.prices ? v.prices.dry : null) : (v.prices ? v.prices.fuel : null);
        var price2 = isCargo ? (v.prices ? v.prices.refrigerated : null) : (v.prices ? v.prices.crude_oil : null);
        var auto1 = isCargo ? rsGetAutoPrice(v, 'dry') : rsGetAutoPrice(v, 'fuel');
        var auto2 = isCargo ? rsGetAutoPrice(v, 'refrigerated') : rsGetAutoPrice(v, 'crude_oil');
        var pct1 = rsCalcPctDiff(price1, auto1);
        var pct2 = rsCalcPctDiff(price2, auto2);
        var key1 = isCargo ? 'price_dry' : 'price_fuel';
        var key2 = isCargo ? 'price_refrigerated' : 'price_crude';

        var currentGuards = parseInt(v.route_guards, 10) || 0;

        var speedHtml = '<input type="number" class="speed-input" min="1" max="' + v.max_speed + '" data-vessel-id="' + v.id + '" data-change-key="speed" data-original="' + v.route_speed + '" value="' + v.route_speed + '">';
        if (hasPending && pending.speed !== undefined && pending.speed !== v.route_speed) {
            speedHtml += '<span class="pending-indicator">->' + pending.speed + '</span>';
        }

        var price1Html = '<input type="number" step="0.01" data-vessel-id="' + v.id + '" data-change-key="' + key1 + '" data-auto="' + (auto1 !== null ? auto1 : '') + '" data-original="' + (price1 !== null ? price1 : '') + '" value="' + (price1 !== null ? price1 : '') + '" placeholder="-">';
        var pendingPrice1 = hasPending && pending.prices ? (isCargo ? pending.prices.dry : pending.prices.fuel) : null;
        if (pendingPrice1 !== null && pendingPrice1 !== undefined && pendingPrice1 !== price1) {
            price1Html += '<span class="pending-indicator">->' + pendingPrice1 + '</span>';
        }

        var price2Html = '<input type="number" step="0.01" data-vessel-id="' + v.id + '" data-change-key="' + key2 + '" data-auto="' + (auto2 !== null ? auto2 : '') + '" data-original="' + (price2 !== null ? price2 : '') + '" value="' + (price2 !== null ? price2 : '') + '" placeholder="-">';
        var pendingPrice2 = hasPending && pending.prices ? (isCargo ? pending.prices.refrigerated : pending.prices.crude_oil) : null;
        if (pendingPrice2 !== null && pendingPrice2 !== undefined && pendingPrice2 !== price2) {
            price2Html += '<span class="pending-indicator">->' + pendingPrice2 + '</span>';
        }

        var guardsHtml = '<select data-vessel-id="' + v.id + '" data-change-key="guards" data-original="' + currentGuards + '">' +
            [0,1,2,3,4,5,6,7,8,9,10].map(function(i) { return '<option value="' + i + '"' + (i === currentGuards ? ' selected' : '') + '>' + i + '</option>'; }).join('') + '</select>';
        if (hasPending && pending.guards !== undefined && pending.guards !== currentGuards) {
            guardsHtml += '<span class="pending-indicator">->' + pending.guards + '</span>';
        }

        var autoDisplay = (auto1 !== null) ? '$' + Math.round(auto1) : '-';
        var pct1Class = pct1 !== '-' && parseFloat(pct1) > 0 ? 'pct-positive' : (pct1 !== '-' && parseFloat(pct1) < 0 ? 'pct-negative' : '');
        var pct2Class = pct2 !== '-' && parseFloat(pct2) > 0 ? 'pct-positive' : (pct2 !== '-' && parseFloat(pct2) < 0 ? 'pct-negative' : '');
        var priceAge = rsFormatPriceAge(v.id);

        // Build percentage cell content with pending indicator if applicable
        var pct1Html = pct1;
        if (pendingPrice1 !== null && pendingPrice1 !== undefined && pendingPrice1 !== price1 && auto1 !== null) {
            var pendingPct1 = rsCalcPctDiff(pendingPrice1, auto1);
            pct1Html += '<span class="pending-indicator">->' + pendingPct1 + '</span>';
        }

        var pct2Html = pct2;
        if (pendingPrice2 !== null && pendingPrice2 !== undefined && pendingPrice2 !== price2 && auto2 !== null) {
            var pendingPct2 = rsCalcPctDiff(pendingPrice2, auto2);
            pct2Html += '<span class="pending-indicator">->' + pendingPct2 + '</span>';
        }

        return '<tr>' +
            '<td class="status-cell"><span class="status-icon ' + statusInfo.cssClass + '" title="' + statusInfo.tooltip + '">' + statusInfo.code + '</span></td>' +
            '<td class="route-cell">' + route + '</td>' +
            '<td class="name-cell" title="' + rsEscapeHtml(v.name) + '" data-vessel-id="' + v.id + '">' + rsEscapeHtml(v.name) + '</td>' +
            '<td class="num">' + speedHtml + '</td>' +
            '<td class="num max-speed">' + v.max_speed + '</td>' +
            '<td class="num auto-price">' + autoDisplay + '</td>' +
            '<td class="num">' + price1Html + '</td>' +
            '<td class="num pct-diff ' + pct1Class + '" data-pct-for="' + v.id + '-' + key1 + '">' + pct1Html + '</td>' +
            '<td class="num">' + price2Html + '</td>' +
            '<td class="num pct-diff ' + pct2Class + '" data-pct-for="' + v.id + '-' + key2 + '">' + pct2Html + '</td>' +
            '<td class="num">' + guardsHtml + '</td>' +
            '<td class="num ' + (risk > 0 ? 'warning' : '') + '">' + risk + '%</td>' +
            (showAge ? '<td class="num price-age">' + priceAge + '</td>' : '') +
        '</tr>';
    }

    function rsRenderTable() {
        var wrapper = document.querySelector('.rs-table-wrapper');
        if (!wrapper) return;

        if (!rsCachedVessels) {
            wrapper.innerHTML = '<div class="rs-loading">Loading...</div>';
            return;
        }

        var vessels = rsGetVesselsWithRoutes();
        var isCargo = rsActiveSubtab === 'cargo';

        var filtered = vessels.filter(function(v) {
            return isCargo ? v.capacity_type === 'container' : v.capacity_type === 'tanker';
        });

        if (filtered.length === 0) {
            wrapper.innerHTML = '<div class="rs-no-data">No ' + (isCargo ? 'cargo vessels' : 'tankers') + ' with active routes</div>';
            return;
        }

        var label1 = isCargo ? 'Dry' : 'Fuel';
        var label2 = isCargo ? 'Ref' : 'Crude';

        var statusTip = 'Status Codes:\nP = In Port\nA = Anchored\nEO = Enroute Outbound\nER = Enroute Return\nTD = To Drydock\nFD = From Drydock\nM = In Maintenance\nMP = Moored at Port\nME = Moored Enroute';
        var headers = '<th class="th-status" data-tip="' + statusTip + '">S</th>' +
            '<th class="th-route" data-tip="Route (Origin - Destination)">Route</th>' +
            '<th class="th-vessel" data-tip="Vessel Name">Vessel</th>' +
            '<th data-tip="Current Speed (knots)">kn</th>' +
            '<th data-tip="Maximum Speed">Max</th>' +
            '<th data-tip="Auto-calculated Price">Auto</th>' +
            '<th data-tip="' + (isCargo ? 'Dry Cargo Price\nper TEU' : 'Fuel Price\nper Ton') + '">' + label1 + '</th>' +
            '<th data-tip="Difference from\nAuto Price">%</th>' +
            '<th data-tip="' + (isCargo ? 'Refrigerated Price\nper TEU' : 'Crude Oil Price\nper Ton') + '">' + label2 + '</th>' +
            '<th data-tip="Difference from\nAuto Price">%</th>' +
            '<th data-tip="Guards\n0 or 10">G</th>' +
            '<th data-tip="Hijacking Risk\nPercentage">R%</th>';

        var rows = filtered.map(function(v) { return rsRenderRow(v, isCargo, false); }).join('');

        wrapper.innerHTML = '<table class="rs-table"><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';

        wrapper.querySelectorAll('input, select').forEach(function(el) {
            el.addEventListener('input', rsHandleChange);
            el.addEventListener('change', rsHandleChange);
        });

        // Click handler for vessel name - shows vessel on map with route preview
        wrapper.querySelectorAll('.name-cell').forEach(function(cell) {
            cell.addEventListener('click', function() {
                var vesselId = parseInt(cell.dataset.vesselId, 10);
                if (vesselId) rsOpenVesselPreview(vesselId);
            });
        });
    }

    function rsRenderSettingsPanel() {
        var container = document.getElementById('rs-settings-container');
        if (!container) return;

        rsCachedVessels = null;

        container.innerHTML = '<div class="rs-header">' +
            '<button class="rs-subtab ' + (rsActiveSubtab === 'cargo' ? 'active' : '') + '" data-subtab="cargo">Cargo</button>' +
            '<button class="rs-subtab ' + (rsActiveSubtab === 'tanker' ? 'active' : '') + '" data-subtab="tanker">Tanker</button>' +
            '<span class="rs-status"></span>' +
            '<button class="rs-save-btn">Save</button>' +
        '</div>' +
        '<div class="rs-table-wrapper"><div class="rs-loading">Loading...</div></div>' +
        '<div class="rs-footer"><a href="https://discord.gg/2wvtPz6k89" target="_blank">Join the RebelShip Discord Community</a></div>';

        container.querySelectorAll('.rs-subtab').forEach(function(btn) {
            btn.addEventListener('click', function() {
                rsActiveSubtab = btn.dataset.subtab;
                container.querySelectorAll('.rs-subtab').forEach(function(b) { b.classList.toggle('active', b === btn); });
                rsRenderTable();
            });
        });

        container.querySelector('.rs-save-btn').addEventListener('click', rsSaveRouteSettings);

        fetchVesselData().then(function(vessels) {
            rsCachedVessels = vessels;
            rsRenderTable();
        });
    }

    function rsOpenSettingsModal() {
        var bottomNav = document.getElementById('bottom-nav');
        var hasRouteModal = bottomNav && bottomNav.querySelector('#assigned-page-btn');

        if (!hasRouteModal) {
            // Route modal not open - need to open it first
            var modalStore = getModalStore();
            if (!modalStore) {
                log('Modal store not found', 'error');
                return;
            }

            // Open the routes modal - game handles transition from current modal
            modalStore.open('routes', { initialPage: 'assigned' });

            // Wait for modal to fully load with tabs, then add our Settings tab and activate it
            var attempts = 0;
            var waitForModal = setInterval(function() {
                attempts++;
                var nav = document.getElementById('bottom-nav');
                var hasAssigned = nav && nav.querySelector('#assigned-page-btn');

                if (hasAssigned) {
                    clearInterval(waitForModal);
                    // Add Settings tab if not already there
                    rsAddSettingsButton();
                    // Now activate it
                    rsActivateSettingsTab();
                } else if (attempts > 20) {
                    clearInterval(waitForModal);
                    log('Failed to wait for route modal tabs', 'error');
                }
            }, 100);
        } else {
            // Modal already open - just activate the Settings tab
            rsActivateSettingsTab();
        }
    }

    function rsActivateSettingsTab() {
        var bottomNav = document.getElementById('bottom-nav');
        if (bottomNav) {
            // Remove selected-page class from all tabs
            var allTabs = bottomNav.querySelectorAll('.flex-centered');
            allTabs.forEach(function(tab) {
                tab.classList.remove('selected-page');
            });

            // Set Settings tab as active with selected-page class and color icon
            var settingsBtn = document.getElementById('rs-settings-page-btn');
            if (settingsBtn) {
                settingsBtn.classList.add('selected-page');
                var iconContainer = settingsBtn.querySelector('div');
                if (iconContainer) iconContainer.style.color = '#0db8f4';
            }

            // Add click handlers to other tabs to close Settings view
            var otherTabs = bottomNav.querySelectorAll('#assigned-page-btn, #anchored-page-btn, #port-page-btn');
            otherTabs.forEach(function(tab) {
                tab.addEventListener('click', rsCloseSettingsView, { once: true });
            });
        }

        rsInjectSettingsContent();
    }

    function rsCloseSettingsView() {
        // Reset Settings tab styling only
        var settingsBtn = document.getElementById('rs-settings-page-btn');
        if (settingsBtn) {
            settingsBtn.classList.remove('selected-page');
            var iconContainer = settingsBtn.querySelector('div');
            if (iconContainer) iconContainer.style.color = '#94a3b8';
        }
    }

    function rsCleanupSettingsView() {
        // Reset Settings tab styling
        rsCloseSettingsView();

        // Restore original viewport (disable zoom)
        rsRestoreViewport();

        // Remove settings container
        var settingsContainer = document.getElementById('rs-settings-container');
        if (settingsContainer) settingsContainer.remove();

        // Remove hide button style
        var hideStyle = document.getElementById('rs-hide-depart-btn');
        if (hideStyle) hideStyle.remove();
    }

    var rsOriginalViewport = null;

    function rsEnableZoom() {
        var viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
            rsOriginalViewport = viewport.getAttribute('content');
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
        }
    }

    function rsRestoreViewport() {
        if (rsOriginalViewport !== null) {
            var viewport = document.querySelector('meta[name="viewport"]');
            if (viewport) {
                viewport.setAttribute('content', rsOriginalViewport);
            }
            rsOriginalViewport = null;
        }
    }

    async function rsInjectSettingsContent() {
        var centralContainer = document.getElementById('central-container');
        if (!centralContainer) return;

        // Enable pinch-zoom on mobile
        rsEnableZoom();

        // Refresh storage from DB to get latest pending settings from other scripts
        await loadStorage();

        // Update title only, keep navigation intact
        var modalStore = getModalStore();
        if (modalStore && modalStore.modalSettings) {
            modalStore.modalSettings.title = 'Route Settings';
        }

        // Add CSS to hide original content and depart button
        var hideButtonStyle = document.createElement('style');
        hideButtonStyle.id = 'rs-hide-depart-btn';
        hideButtonStyle.textContent = '#central-container>:not(#rs-settings-container):not(style){display:none!important}.control-btn.dark-green{display:none!important}';
        document.head.appendChild(hideButtonStyle);

        // Create overlay container instead of replacing innerHTML
        var settingsContainer = document.createElement('div');
        settingsContainer.id = 'rs-settings-container';
        centralContainer.appendChild(settingsContainer);

        // Prevent touch events from propagating to modal swipe handler
        settingsContainer.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true });
        settingsContainer.addEventListener('touchmove', function(e) { e.stopPropagation(); }, { passive: true });
        settingsContainer.addEventListener('touchend', function(e) { e.stopPropagation(); }, { passive: true });

        // Add click handlers to other tabs to close Settings view
        var bottomNav = document.getElementById('bottom-nav');
        if (bottomNav) {
            var otherTabs = bottomNav.querySelectorAll('#assigned-page-btn, #anchored-page-btn, #port-page-btn');
            otherTabs.forEach(function(tab) {
                var handler = function() {
                    rsCleanupSettingsView();
                    tab.removeEventListener('click', handler);
                };
                tab.addEventListener('click', handler);
            });
        }

        // Watch for modal close to cleanup
        var modalCloseObserver = new window.MutationObserver(function() {
            if (!document.getElementById('central-container')) {
                rsCleanupSettingsView();
                modalCloseObserver.disconnect();
            }
        });
        modalCloseObserver.observe(document.body, { childList: true, subtree: true });

        var style = document.createElement('style');
        style.textContent = '#rs-settings-container{width:100%;height:100%;display:flex;flex-direction:column;background:#f5f5f5;color:#01125d;font-family:Lato,sans-serif;font-size:11px}.rs-header{display:flex;align-items:center;gap:4px;padding:4px 6px;background:#e8e8e8;border-bottom:1px solid #ccc}.rs-subtab{padding:3px 8px;background:#fff;color:#01125d;border:1px solid #ccc;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600}.rs-subtab:hover{background:#ddd}.rs-subtab.active{background:#0db8f4;color:#fff;border-color:#0db8f4}.rs-save-btn{margin-left:auto;padding:3px 10px;background:#22c55e;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;opacity:0.4}.rs-save-btn.has-changes{opacity:1}.rs-status{font-size:9px;color:#666;margin-left:6px}.rs-table-wrapper{flex:1;overflow:auto}.rs-table{width:100%;border-collapse:collapse;font-size:10px}.rs-table thead{position:sticky;top:0;background:#e0e0e0;z-index:1}.rs-table th{padding:1px;text-align:center;font-weight:600;color:#01125d;border-bottom:1px solid #ccc;white-space:nowrap;background:#e0e0e0;font-size:10px}.rs-table td{padding:1px;border-bottom:1px solid #ddd;vertical-align:middle;text-align:center}.rs-table td.route-cell,.rs-table td.name-cell{text-align:left}.rs-table td.max-speed,.rs-table td.auto-price,.rs-table td.pct-diff{color:#666;font-size:9px}.rs-table tr:hover{background:#e8f4fc}.rs-table .warning{color:#d97706}.rs-table .status-cell{width:22px;text-align:center;padding:1px}.rs-table .status-icon{display:inline-block;height:14px;line-height:14px;text-align:center;font-size:8px;font-weight:700;border-radius:2px;padding:0 2px}.rs-table .status-icon.status-e{background:#3b82f6;color:#fff}.rs-table .status-icon.status-p{background:#22c55e;color:#fff}.rs-table .status-icon.status-a{background:#f59e0b;color:#fff}.rs-table .status-icon.status-mp,.rs-table .status-icon.status-me{background:#8b5cf6;color:#fff}.rs-table .status-icon.status-m{background:#ef4444;color:#fff}.rs-table .status-icon.status-d{background:#6366f1;color:#fff}.rs-table .status-icon.status-td{background:#f97316;color:#fff}.rs-table .status-icon.status-fd{background:#14b8a6;color:#fff}.rs-table .status-icon.status-eo{background:#1d4ed8;color:#fff}.rs-table .status-icon.status-er{background:#0891b2;color:#fff}.rs-table .status-icon.status-bu{background:#dc2626;color:#fff}.rs-table .route-cell{font-size:9px;white-space:nowrap}.rs-table .name-cell{max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;cursor:pointer}.rs-table .name-cell:hover{text-decoration:underline}.rs-table input[type="number"]{width:32px;padding:1px 2px;margin:0;background:#fff;border:1px solid #ccc;border-radius:2px;color:#01125d;font-size:10px;text-align:right;box-sizing:border-box;-moz-appearance:textfield}.rs-table input.speed-input{width:24px}.rs-table .pct-positive{color:#22c55e}.rs-table .pct-negative{color:#ef4444}.rs-table input[type="number"]::-webkit-outer-spin-button,.rs-table input[type="number"]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}.rs-table input[type="number"]:focus{outline:none;border-color:#0db8f4}.rs-table input.changed{background:#fef3c7;border-color:#f59e0b}.rs-table select{padding:1px 2px;background:#fff;border:1px solid #ccc;border-radius:2px;color:#01125d;font-size:10px;cursor:pointer}.rs-table select:focus{outline:none;border-color:#0db8f4}.rs-table select.changed{background:#fef3c7;border-color:#f59e0b}.rs-loading,.rs-error,.rs-no-data{padding:20px;text-align:center;color:#666}.rs-table .pending-indicator{display:inline;font-size:9px;color:#8b5cf6;font-weight:600;margin-left:2px}.rs-table th[data-tip]{position:relative;cursor:help}.rs-table th[data-tip]:hover::after{content:attr(data-tip);position:absolute;top:100%;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:6px 10px;border-radius:4px;font-size:10px;font-weight:400;white-space:pre-line;z-index:100;min-width:100px;max-width:180px;text-align:left;box-shadow:0 2px 8px rgba(0,0,0,0.3);margin-top:4px}.rs-table th[data-tip]:nth-child(-n+3):hover::after{left:0;transform:translateX(0)}.rs-table th[data-tip]:nth-last-child(-n+5):hover::after{left:auto;right:0;transform:translateX(0)}.rs-footer{position:fixed;bottom:73px;left:0;right:0;max-width:460px;margin:0 auto;padding:6px 4px;text-align:center;background:#e8e8e8;border-top:1px solid #ccc;z-index:9999}.rs-footer a{color:#5865F2;font-size:14px;font-weight:700;text-decoration:underline}';
        centralContainer.appendChild(style);

        rsRenderSettingsPanel();
    }

    var RS_GEAR_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>';

    function rsAddSettingsButton() {
        var bottomNav = document.getElementById('bottom-nav');
        if (!bottomNav) return false;
        if (document.getElementById('rs-settings-page-btn')) return true;
        if (!bottomNav.querySelector('#assigned-page-btn')) return false;

        var settingsBtn = document.createElement('div');
        settingsBtn.id = 'rs-settings-page-btn';
        settingsBtn.className = 'flex-centered flex-vertical';
        settingsBtn.style.cssText = 'cursor:pointer;';
        settingsBtn.innerHTML = '<div style="width:24px;height:24px;color:#94a3b8;">' + RS_GEAR_ICON + '</div><span class="modal-bottom-navigation-btn" style="font-size:12px;">Settings</span>';
        settingsBtn.addEventListener('click', rsOpenSettingsModal);
        bottomNav.appendChild(settingsBtn);
        rsSettingsTabAdded = true;
        return true;
    }

    function rsWatchRoutesModal() {
        setInterval(function() {
            var bottomNav = document.getElementById('bottom-nav');
            var hasAssigned = bottomNav && bottomNav.querySelector('#assigned-page-btn');
            if (hasAssigned && !rsSettingsTabAdded) rsAddSettingsButton();
            if (!hasAssigned && rsSettingsTabAdded) rsSettingsTabAdded = false;
        }, 500);
    }

    // ============================================
    // SETTINGS MODAL UI (Custom modal like auto-repair)
    // ============================================
    var isDMSettingsModalOpen = false;
    var dmModalListenerAttached = false;

    function injectDMModalStyles() {
        if (document.getElementById('dm-modal-styles')) return;

        var style = document.createElement('style');
        style.id = 'dm-modal-styles';
        style.textContent = [
            '@keyframes dm-fade-in{0%{opacity:0}to{opacity:1}}',
            '@keyframes dm-fade-out{0%{opacity:1}to{opacity:0}}',
            '@keyframes dm-drop-down{0%{transform:translateY(-10px)}to{transform:translateY(0)}}',
            '@keyframes dm-push-up{0%{transform:translateY(0)}to{transform:translateY(-10px)}}',
            '#dm-modal-wrapper{align-items:flex-start;display:flex;height:100vh;justify-content:center;left:0;overflow:hidden;position:absolute;top:0;width:100vw;z-index:9999}',
            '#dm-modal-wrapper #dm-modal-background{animation:dm-fade-in .15s linear forwards;background-color:rgba(0,0,0,.5);height:100%;left:0;opacity:0;position:absolute;top:0;width:100%}',
            '#dm-modal-wrapper.hide #dm-modal-background{animation:dm-fade-out .15s linear forwards}',
            '#dm-modal-wrapper #dm-modal-content-wrapper{animation:dm-drop-down .15s linear forwards,dm-fade-in .15s linear forwards;height:100%;max-width:700px;opacity:0;position:relative;width:1140px;z-index:9001}',
            '#dm-modal-wrapper.hide #dm-modal-content-wrapper{animation:dm-push-up .15s linear forwards,dm-fade-out .15s linear forwards}',
            '@media screen and (min-width:1200px){#dm-modal-wrapper #dm-modal-content-wrapper{max-width:460px}}',
            '@media screen and (min-width:992px) and (max-width:1199px){#dm-modal-wrapper #dm-modal-content-wrapper{max-width:460px}}',
            '@media screen and (min-width:769px) and (max-width:991px){#dm-modal-wrapper #dm-modal-content-wrapper{max-width:460px}}',
            '@media screen and (max-width:768px){#dm-modal-wrapper #dm-modal-content-wrapper{max-width:100%}}',
            '#dm-modal-wrapper #dm-modal-container{background-color:#fff;height:100vh;overflow:hidden;position:absolute;width:100%}',
            '#dm-modal-container .modal-header{align-items:center;background:#626b90;border-radius:0;color:#fff;display:flex;height:31px;justify-content:space-between;text-align:left;width:100%;border:0!important;padding:0 .5rem!important}',
            '#dm-modal-container .header-title{font-weight:700;text-transform:uppercase;width:90%}',
            '#dm-modal-container .header-icon{cursor:pointer;height:1.2rem;margin:0 .5rem}',
            '#dm-modal-container .header-icon.closeModal{height:19px;width:19px}',
            '#dm-modal-container #dm-modal-content{height:calc(100% - 31px);max-width:inherit;overflow:hidden;display:flex;flex-direction:column}',
            '#dm-modal-container #dm-central-container{background-color:#e9effd;margin:0;overflow-x:hidden;overflow-y:auto;width:100%;flex:1;padding:10px 15px}',
            '#dm-modal-wrapper.hide{pointer-events:none}'
        ].join('');
        document.head.appendChild(style);
    }

    function closeDMSettingsModal() {
        if (!isDMSettingsModalOpen) return;
        log('Closing DM settings modal');
        isDMSettingsModalOpen = false;
        var modalWrapper = document.getElementById('dm-modal-wrapper');
        if (modalWrapper) {
            modalWrapper.classList.add('hide');
        }
    }

    function setupDMModalWatcher() {
        if (dmModalListenerAttached) return;
        dmModalListenerAttached = true;

        window.addEventListener('rebelship-menu-click', function() {
            if (isDMSettingsModalOpen) {
                log('RebelShip menu clicked, closing DM modal');
                closeDMSettingsModal();
            }
        });
    }

    function openSettingsModal() {
        // Close any open game modal first
        var modalStore = getModalStore();
        if (modalStore && modalStore.closeAll) {
            modalStore.closeAll();
        }

        injectDMModalStyles();

        var existing = document.getElementById('dm-modal-wrapper');
        if (existing) {
            var contentCheck = existing.querySelector('#dm-settings-content');
            if (contentCheck) {
                existing.classList.remove('hide');
                isDMSettingsModalOpen = true;
                updateDMSettingsContent();
                return;
            }
            existing.remove();
        }

        var headerEl = document.querySelector('header');
        var headerHeight = headerEl ? headerEl.offsetHeight : 89;

        var modalWrapper = document.createElement('div');
        modalWrapper.id = 'dm-modal-wrapper';

        var modalBackground = document.createElement('div');
        modalBackground.id = 'dm-modal-background';
        modalBackground.onclick = function() { closeDMSettingsModal(); };

        var modalContentWrapper = document.createElement('div');
        modalContentWrapper.id = 'dm-modal-content-wrapper';

        var modalContainer = document.createElement('div');
        modalContainer.id = 'dm-modal-container';
        modalContainer.className = 'font-lato';
        modalContainer.style.top = headerHeight + 'px';
        modalContainer.style.height = 'calc(100vh - ' + headerHeight + 'px)';
        modalContainer.style.maxHeight = 'calc(100vh - ' + headerHeight + 'px)';

        var modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';

        var headerTitle = document.createElement('span');
        headerTitle.className = 'header-title';
        headerTitle.textContent = 'Depart Manager Settings';

        var closeIcon = document.createElement('img');
        closeIcon.className = 'header-icon closeModal';
        closeIcon.src = '/images/icons/close_icon_new.svg';
        closeIcon.onclick = function() { closeDMSettingsModal(); };
        closeIcon.onerror = function() {
            this.style.display = 'none';
            var fallback = document.createElement('span');
            fallback.textContent = 'X';
            fallback.style.cssText = 'cursor:pointer;font-weight:bold;padding:0 .5rem;';
            fallback.onclick = function() { closeDMSettingsModal(); };
            this.parentNode.appendChild(fallback);
        };

        modalHeader.appendChild(headerTitle);
        modalHeader.appendChild(closeIcon);

        var modalContent = document.createElement('div');
        modalContent.id = 'dm-modal-content';

        var centralContainer = document.createElement('div');
        centralContainer.id = 'dm-central-container';

        var settingsContent = document.createElement('div');
        settingsContent.id = 'dm-settings-content';
        centralContainer.appendChild(settingsContent);

        modalContent.appendChild(centralContainer);
        modalContainer.appendChild(modalHeader);
        modalContainer.appendChild(modalContent);
        modalContentWrapper.appendChild(modalContainer);
        modalWrapper.appendChild(modalBackground);
        modalWrapper.appendChild(modalContentWrapper);
        document.body.appendChild(modalWrapper);

        isDMSettingsModalOpen = true;
        updateDMSettingsContent();
    }

    function updateDMSettingsContent() {
        var settingsContent = document.getElementById('dm-settings-content');
        if (!settingsContent) return;

        var settings = getSettings();
        var pendingCount = getPendingRouteSettingsCount();

        var html = '<div style="padding:10px 0;width:100%;font-family:Lato,sans-serif;color:#01125d;">';

            // === FUEL & CO2 SETTINGS (side by side) ===
            html += '<div class="dm-flex-row" style="display:flex;gap:8px;margin-bottom:16px;">';
            // === FUEL SETTINGS ===
            html += '<div class="dm-flex-box" style="flex:1;background:#fff;border-radius:8px;padding:10px;border:1px solid #ddd;">';
            html += '<div style="font-weight:700;font-size:14px;margin-bottom:10px;color:#0db8f4;">Fuel Auto-Rebuy</div>';
            // Basic Mode Checkbox
            html += '<div style="margin-bottom:12px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-fuel-basic"' + (settings.fuelMode !== 'off' ? ' checked' : '') + ' style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;">';
            html += '<span style="font-weight:600;">Basic Mode</span></label>';
            html += '<div style="font-size:12px;color:#666;">Fill bunker when price <= threshold</div>';
            html += '</div>';
            // Basic Settings (shown when Basic enabled)
            html += '<div id="dm-fuel-basic-settings" style="padding:12px;background:#f9fafb;border-radius:6px;margin-bottom:12px;">';
            html += '<div style="margin-bottom:10px;">';
            html += '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Price Threshold ($/t)</label>';
            html += '<input type="number" id="dm-fuel-threshold" value="' + settings.fuelPriceThreshold + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;">';
            html += '</div>';
            html += '<div style="margin-bottom:10px;">';
            html += '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Min Cash Reserve ($)</label>';
            html += '<input type="number" id="dm-fuel-mincash" value="' + settings.fuelMinCash + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;">';
            html += '</div>';
            // Intelligent Mode Checkbox (inside Basic settings)
            html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-fuel-intel"' + (settings.fuelMode === 'intelligent' ? ' checked' : '') + ' style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;">';
            html += '<span style="font-weight:600;">+ Intelligent Mode</span></label>';
            html += '<div style="font-size:12px;color:#666;">Buy shortfall only when price > basic threshold</div>';
            html += '</div>';
            // Intelligent Settings (shown when Intelligent enabled)
            html += '<div id="dm-fuel-intel-settings" style="margin-top:10px;padding:10px;background:#f0f9ff;border-radius:6px;border:1px solid #bae6fd;">';
            html += '<div style="margin-bottom:10px;">';
            html += '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Max Price ($/t)</label>';
            html += '<input type="number" id="dm-fuel-intel-max" value="' + settings.fuelIntelligentMaxPrice + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;">';
            html += '</div>';
            html += '<div style="margin-bottom:8px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-fuel-intel-below-en"' + (settings.fuelIntelligentBelowEnabled ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:8px;accent-color:#0db8f4;">';
            html += '<span style="font-size:13px;">Only if bunker below (t)</span></label>';
            html += '</div>';
            html += '<input type="number" id="dm-fuel-intel-below" value="' + settings.fuelIntelligentBelow + '" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:10px;">';
            html += '<div style="margin-bottom:8px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-fuel-intel-ships-en"' + (settings.fuelIntelligentShipsEnabled ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:8px;accent-color:#0db8f4;">';
            html += '<span style="font-size:13px;">Only if ships at port >=</span></label>';
            html += '</div>';
            html += '<input type="number" id="dm-fuel-intel-ships" value="' + settings.fuelIntelligentShips + '" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;">';
            html += '</div>';
            html += '</div>';
            // Fuel Notifications
            html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd;">';
            html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Notifications</div>';
            html += '<div style="display:flex;gap:16px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-fuel-notify-ingame"' + (settings.fuelNotifyIngame ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:6px;accent-color:#0db8f4;">';
            html += '<span style="font-size:12px;">Ingame</span></label>';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-fuel-notify-system"' + (settings.fuelNotifySystem ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:6px;accent-color:#0db8f4;">';
            html += '<span style="font-size:12px;">System</span></label>';
            html += '</div>';
            html += '</div>';
            html += '</div>';

            // === CO2 SETTINGS ===
            html += '<div class="dm-flex-box" style="flex:1;background:#fff;border-radius:8px;padding:10px;border:1px solid #ddd;">';
            html += '<div style="font-weight:700;font-size:14px;margin-bottom:10px;color:#0db8f4;">CO2 Auto-Rebuy</div>';
            // Basic Mode Checkbox
            html += '<div style="margin-bottom:12px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-co2-basic"' + (settings.co2Mode !== 'off' ? ' checked' : '') + ' style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;">';
            html += '<span style="font-weight:600;">Basic Mode</span></label>';
            html += '<div style="font-size:12px;color:#666;">Fill bunker when price <= threshold</div>';
            html += '</div>';
            // Basic Settings (shown when Basic enabled)
            html += '<div id="dm-co2-basic-settings" style="padding:12px;background:#f9fafb;border-radius:6px;margin-bottom:12px;">';
            html += '<div style="margin-bottom:10px;">';
            html += '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Price Threshold ($/t)</label>';
            html += '<input type="number" id="dm-co2-threshold" value="' + settings.co2PriceThreshold + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;">';
            html += '</div>';
            html += '<div style="margin-bottom:10px;">';
            html += '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Min Cash Reserve ($)</label>';
            html += '<input type="number" id="dm-co2-mincash" value="' + settings.co2MinCash + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;">';
            html += '</div>';
            // Intelligent Mode Checkbox (inside Basic settings)
            html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-co2-intel"' + (settings.co2Mode === 'intelligent' ? ' checked' : '') + ' style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;">';
            html += '<span style="font-weight:600;">+ Intelligent Mode</span></label>';
            html += '<div style="font-size:12px;color:#666;">Buy shortfall only when price > basic threshold</div>';
            html += '</div>';
            // Intelligent Settings (shown when Intelligent enabled)
            html += '<div id="dm-co2-intel-settings" style="margin-top:10px;padding:10px;background:#f0fdf4;border-radius:6px;border:1px solid #bbf7d0;">';
            html += '<div style="margin-bottom:10px;">';
            html += '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Max Price ($/t)</label>';
            html += '<input type="number" id="dm-co2-intel-max" value="' + settings.co2IntelligentMaxPrice + '" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;">';
            html += '</div>';
            html += '<div style="margin-bottom:8px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-co2-intel-below-en"' + (settings.co2IntelligentBelowEnabled ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:8px;accent-color:#0db8f4;">';
            html += '<span style="font-size:13px;">Only if bunker below (t)</span></label>';
            html += '</div>';
            html += '<input type="number" id="dm-co2-intel-below" value="' + settings.co2IntelligentBelow + '" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:10px;">';
            html += '<div style="margin-bottom:8px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-co2-intel-ships-en"' + (settings.co2IntelligentShipsEnabled ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:8px;accent-color:#0db8f4;">';
            html += '<span style="font-size:13px;">Only if ships at port >=</span></label>';
            html += '</div>';
            html += '<input type="number" id="dm-co2-intel-ships" value="' + settings.co2IntelligentShips + '" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;">';
            html += '</div>';
            html += '</div>';
            // Avoid Negative CO2 (outside the nested settings)
            html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-avoid-neg-co2"' + (settings.avoidNegativeCO2 ? ' checked' : '') + ' style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;">';
            html += '<span>Avoid Negative CO2 (Intelligent: to 100t buffer, Basic: to 100%)</span></label>';
            html += '</div>';
            // CO2 Notifications
            html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd;">';
            html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Notifications</div>';
            html += '<div style="display:flex;gap:16px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-co2-notify-ingame"' + (settings.co2NotifyIngame ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:6px;accent-color:#0db8f4;">';
            html += '<span style="font-size:12px;">Ingame</span></label>';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-co2-notify-system"' + (settings.co2NotifySystem ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:6px;accent-color:#0db8f4;">';
            html += '<span style="font-size:12px;">System</span></label>';
            html += '</div>';
            html += '</div>';
            html += '</div>';
            html += '</div>'; // Close flex container

            // === AUTO-DEPART SETTINGS ===
            html += '<div style="background:#fff;border-radius:8px;padding:10px;margin-bottom:12px;border:1px solid #ddd;">';
            html += '<div style="font-weight:700;font-size:16px;margin-bottom:12px;color:#0db8f4;">Auto-Depart</div>';
            html += '<div style="margin-bottom:12px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-auto-depart"' + (settings.autoDepartEnabled ? ' checked' : '') + ' style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;">';
            html += '<span style="font-weight:600;">Enable Auto-Depart</span></label>';
            html += '<div style="font-size:12px;color:#666;margin-top:4px;">Automatically departs vessels with routes when fuel is available.</div>';
            html += '</div>';
            // Depart Notifications
            html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd;">';
            html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Notifications</div>';
            html += '<div style="display:flex;gap:16px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-depart-notify-ingame"' + (settings.departNotifyIngame ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:6px;accent-color:#0db8f4;">';
            html += '<span style="font-size:12px;">Ingame</span></label>';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-depart-notify-system"' + (settings.departNotifySystem ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:6px;accent-color:#0db8f4;">';
            html += '<span style="font-size:12px;">System</span></label>';
            html += '</div>';
            html += '</div>';
            // Min Utilization Settings
            html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd;">';
            html += '<div style="margin-bottom:12px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-min-util-enabled"' + (settings.minUtilizationEnabled ? ' checked' : '') + ' style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;">';
            html += '<span style="font-weight:600;">Min Utilization Check</span></label>';
            html += '<div style="font-size:12px;color:#666;margin-top:4px;">Skip departure if port demand is below threshold.</div>';
            html += '</div>';
            html += '<div style="margin-bottom:12px;">';
            html += '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Min Utilization</label>';
            html += '<select id="dm-min-util-threshold" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;">';
            for (var u = 10; u <= 100; u += 10) {
                html += '<option value="' + u + '"' + (settings.minUtilizationThreshold === u ? ' selected' : '') + '>' + u + '%</option>';
            }
            html += '</select>';
            html += '</div>';
            html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Notifications</div>';
            html += '<div style="display:flex;gap:16px;">';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-min-util-notify-ingame"' + (settings.minUtilizationNotifyIngame ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:6px;accent-color:#0db8f4;">';
            html += '<span style="font-size:12px;">Ingame</span></label>';
            html += '<label style="display:flex;align-items:center;cursor:pointer;">';
            html += '<input type="checkbox" id="dm-min-util-notify-system"' + (settings.minUtilizationNotifySystem ? ' checked' : '') + ' style="width:16px;height:16px;margin-right:6px;accent-color:#0db8f4;">';
            html += '<span style="font-size:12px;">System</span></label>';
            html += '</div>';
            html += '</div>';
            html += '</div>';

            // === STATUS ===
            html += '<div style="background:#f3f4f6;border-radius:8px;padding:12px;margin-bottom:20px;">';
            html += '<div style="font-weight:700;font-size:14px;margin-bottom:8px;">Status</div>';
            html += '<div style="font-size:13px;color:#626b90;">';
            html += '<div>Pending Route Changes: <strong>' + pendingCount + '</strong> vessel(s)</div>';
            html += '</div></div>';

            // === BUTTONS ===
            html += '<div style="display:flex;gap:12px;justify-content:space-between;margin-bottom:40px;">';
            html += '<button id="dm-run-depart" style="padding:10px 16px;background:linear-gradient(180deg,#3b82f6,#1d4ed8);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:13px;">Run Depart</button>';
            html += '<button id="dm-open-route-settings" style="padding:10px 16px;background:linear-gradient(180deg,#0db8f4,#0284c7);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:13px;">Route Settings</button>';
            html += '<button id="dm-save" style="padding:10px 20px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:16px;font-weight:500;">Save</button>';
            html += '</div>';

            html += '</div>';

        settingsContent.innerHTML = html;

        document.getElementById('dm-run-depart').addEventListener('click', async function() {
                this.disabled = true;
                this.textContent = 'Running...';
                await autoDepartVessels(true);
                this.textContent = 'Run Depart';
                this.disabled = false;
            });

        document.getElementById('dm-open-route-settings').addEventListener('click', function() {
            closeDMSettingsModal();
            rsOpenSettingsModal();
        });

            // Visibility toggle functions
            function updateFuelVisibility() {
                var basicChecked = document.getElementById('dm-fuel-basic').checked;
                var intelChecked = document.getElementById('dm-fuel-intel').checked;
                document.getElementById('dm-fuel-basic-settings').style.display = basicChecked ? 'block' : 'none';
                document.getElementById('dm-fuel-intel-settings').style.display = (basicChecked && intelChecked) ? 'block' : 'none';
            }

            function updateCO2Visibility() {
                var basicChecked = document.getElementById('dm-co2-basic').checked;
                var intelChecked = document.getElementById('dm-co2-intel').checked;
                document.getElementById('dm-co2-basic-settings').style.display = basicChecked ? 'block' : 'none';
                document.getElementById('dm-co2-intel-settings').style.display = (basicChecked && intelChecked) ? 'block' : 'none';
            }

            // Initial visibility
            updateFuelVisibility();
            updateCO2Visibility();

            // Checkbox change listeners
            document.getElementById('dm-fuel-basic').addEventListener('change', updateFuelVisibility);
            document.getElementById('dm-fuel-intel').addEventListener('change', updateFuelVisibility);
            document.getElementById('dm-co2-basic').addEventListener('change', updateCO2Visibility);
            document.getElementById('dm-co2-intel').addEventListener('change', updateCO2Visibility);

            document.getElementById('dm-save').addEventListener('click', async function() {
                var fuelBasic = document.getElementById('dm-fuel-basic').checked;
                var fuelIntel = document.getElementById('dm-fuel-intel').checked;
                var co2Basic = document.getElementById('dm-co2-basic').checked;
                var co2Intel = document.getElementById('dm-co2-intel').checked;

                var newSettings = {
                    fuelMode: fuelBasic ? (fuelIntel ? 'intelligent' : 'basic') : 'off',
                    fuelPriceThreshold: parseInt(document.getElementById('dm-fuel-threshold').value, 10) || 500,
                    fuelMinCash: parseInt(document.getElementById('dm-fuel-mincash').value, 10) || 1000000,
                    fuelIntelligentMaxPrice: parseInt(document.getElementById('dm-fuel-intel-max').value, 10) || 600,
                    fuelIntelligentBelowEnabled: document.getElementById('dm-fuel-intel-below-en').checked,
                    fuelIntelligentBelow: parseInt(document.getElementById('dm-fuel-intel-below').value, 10) || 500,
                    fuelIntelligentShipsEnabled: document.getElementById('dm-fuel-intel-ships-en').checked,
                    fuelIntelligentShips: parseInt(document.getElementById('dm-fuel-intel-ships').value, 10) || 5,
                    fuelNotifyIngame: document.getElementById('dm-fuel-notify-ingame').checked,
                    fuelNotifySystem: document.getElementById('dm-fuel-notify-system').checked,
                    co2Mode: co2Basic ? (co2Intel ? 'intelligent' : 'basic') : 'off',
                    co2PriceThreshold: parseInt(document.getElementById('dm-co2-threshold').value, 10) || 10,
                    co2MinCash: parseInt(document.getElementById('dm-co2-mincash').value, 10) || 1000000,
                    co2IntelligentMaxPrice: parseInt(document.getElementById('dm-co2-intel-max').value, 10) || 12,
                    co2IntelligentBelowEnabled: document.getElementById('dm-co2-intel-below-en').checked,
                    co2IntelligentBelow: parseInt(document.getElementById('dm-co2-intel-below').value, 10) || 500,
                    co2IntelligentShipsEnabled: document.getElementById('dm-co2-intel-ships-en').checked,
                    co2IntelligentShips: parseInt(document.getElementById('dm-co2-intel-ships').value, 10) || 5,
                    avoidNegativeCO2: document.getElementById('dm-avoid-neg-co2').checked,
                    co2NotifyIngame: document.getElementById('dm-co2-notify-ingame').checked,
                    co2NotifySystem: document.getElementById('dm-co2-notify-system').checked,
                    autoDepartEnabled: document.getElementById('dm-auto-depart').checked,
                    departNotifyIngame: document.getElementById('dm-depart-notify-ingame').checked,
                    departNotifySystem: document.getElementById('dm-depart-notify-system').checked,
                    minUtilizationEnabled: document.getElementById('dm-min-util-enabled').checked,
                    minUtilizationThreshold: parseInt(document.getElementById('dm-min-util-threshold').value, 10) || 50,
                    minUtilizationNotifyIngame: document.getElementById('dm-min-util-notify-ingame').checked,
                    minUtilizationNotifySystem: document.getElementById('dm-min-util-notify-system').checked,
                    systemNotifications: false
                };

                await saveSettings(newSettings);
                notify('Settings saved');
                closeDMSettingsModal();
            });
    }

    // ============================================
    // PERIODIC CHECK
    // ============================================
    async function periodicCheck() {
        var settings = getSettings();
        log('Running periodic check...');

        var appliedCount = await applyAllPendingSettings();
        if (appliedCount > 0) {
            log('Applied pending settings for ' + appliedCount + ' vessel(s)');
        }

        var vessels = await fetchVesselData();
        if (vessels && vessels.length > 0) {
            await handleVesselDataResponse({ data: { user_vessels: vessels } });
        }

        if (settings.fuelMode !== 'off') {
            try {
                await autoRebuyFuel();
            } catch (e) {
                log('autoRebuyFuel error: ' + e.message, 'error');
            }
        }

        if (settings.co2Mode !== 'off') {
            try {
                await autoRebuyCO2();
            } catch (e) {
                log('autoRebuyCO2 error: ' + e.message, 'error');
            }
        }

        if (settings.autoDepartEnabled) {
            try {
                await autoDepartVessels(false);
            } catch (e) {
                log('autoDepartVessels error: ' + e.message, 'error');
            }
        }

        saveLastCheckTime();
        log('Periodic check completed');
    }

    // ============================================
    // EXPOSE FOR ANDROID BACKGROUND SERVICE
    // ============================================
    window.rebelshipRunDepartManager = async function() {
        // Ensure storage is loaded (needed when called from background without init)
        if (!storageCache) {
            await loadStorage();
        }
        var settings = getSettings();
        if (!settings.autoDepartEnabled && settings.fuelMode === 'off' && settings.co2Mode === 'off') {
            return { skipped: true, reason: 'all disabled' };
        }
        await periodicCheck();
        return { success: true };
    };

    // ============================================
    // INITIALIZATION
    // ============================================
    var monitoringInterval = null;

    function startMonitoring() {
        if (monitoringInterval) clearInterval(monitoringInterval);
        log('Starting monitoring (interval: ' + (CHECK_INTERVAL / 1000) + 's)');
        monitoringInterval = setInterval(periodicCheck, CHECK_INTERVAL);
    }

    function requestNotificationPermission() {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    var uiInitialized = false;
    var uiRetryCount = 0;
    var MAX_UI_RETRIES = 30;

    function initUI() {
        if (uiInitialized) return;

        var hasApp = document.getElementById('app');
        var hasMessaging = document.querySelector('.messaging');

        if (!hasApp || !hasMessaging) {
            uiRetryCount++;
            if (uiRetryCount < MAX_UI_RETRIES) {
                setTimeout(initUI, 1000);
                return;
            }
            log('Max UI retries reached, running in background mode');
            return;
        }

        uiInitialized = true;
    }

    async function init() {
        try {
            // Register menu immediately - no DOM needed for IPC call
            addMenuItem(SCRIPT_NAME, openSettingsModal, 20);
            initUI();

            // Load data from IndexedDB or migrate from localStorage
            await loadStorage();

            requestNotificationPermission();
            rsWatchRoutesModal();
            setupDMModalWatcher();
            startUIObserver();

            setTimeout(cleanupStalePendingSettings, 3000);

            // Initialize auto-price cache in background - don't block UI
            initAutoPriceCache().catch(function(e) {
                log('initAutoPriceCache failed: ' + e.message, 'error');
            });

            // Check if we missed checks (Android background reload scenario)
            var lastCheck = getLastCheckTime();
            var timeSinceLastCheck = Date.now() - lastCheck;
            var needsCatchup = lastCheck > 0 && timeSinceLastCheck > CATCHUP_THRESHOLD;

            // Start monitoring immediately
            startMonitoring();

            // Only run immediate check if we missed the threshold (catch-up scenario)
            if (needsCatchup) {
                var missedMinutes = Math.floor(timeSinceLastCheck / 60000);
                log('CATCH-UP: ' + missedMinutes + ' minutes since last check - running immediate check');
                periodicCheck();
            }

        } catch (err) {
            log('init() error: ' + err.message, 'error');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Register for background job system
    window.rebelshipBackgroundJobs = window.rebelshipBackgroundJobs || [];
    window.rebelshipBackgroundJobs.push({
        name: 'DepartManager',
        run: async function() { return await window.rebelshipRunDepartManager(); }
    });
})();