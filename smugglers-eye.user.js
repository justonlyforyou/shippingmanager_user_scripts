// ==UserScript==
// @name         ShippingManager - Smuggler's Eye
// @namespace    https://rebelship.org/
// @version      1.1
// @description  Auto-adjust cargo prices: 4% instant markup, gradual increase, max guards on pirate routes
// @author       https://github.com/justonlyforyou/
// @order        24
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

    console.log('[SmugglersEye] Script loading...');

    // ========== CONFIGURATION ==========
    var SCRIPT_NAME = 'SmugglersEye';
    var STORE_NAME = 'data';
    var CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
    var AUTOPRICE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
    var API_BASE = 'https://shippingmanager.cc/api';
    var originalFetch = window.fetch;

    // ========== STATE ==========
    var settings = {
        enabled: false,
        instant4Percent: true,
        gradual8Percent: false,
        gradualIncreaseStep: 1,
        gradualIncreaseInterval: 25,
        targetPercent: 8,
        maxGuardsOnPirateRoutes: true,
        notifyIngame: true,
        notifySystem: false
    };
    var monitorInterval = null;
    var isProcessing = false;
    var isModalOpen = false;
    var modalListenerAttached = false;
    var autoPriceCacheData = {};
    var gradualIncreaseData = {};
    var hijackingRiskCache = {};

    // ========== REBELSHIPBRIDGE STORAGE (Own) ==========
    async function dbGet(key) {
        try {
            var result = await window.RebelShipBridge.storage.get(SCRIPT_NAME, STORE_NAME, key);
            if (result) {
                return JSON.parse(result);
            }
            return null;
        } catch (e) {
            console.error('[SmugglersEye] dbGet error:', e);
            return null;
        }
    }

    async function dbSet(key, value) {
        try {
            await window.RebelShipBridge.storage.set(SCRIPT_NAME, STORE_NAME, key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.error('[SmugglersEye] dbSet error:', e);
            return false;
        }
    }

    // ========== SHARED STORAGE (DepartManager) ==========
    async function dbGetShared() {
        try {
            var result = await window.RebelShipBridge.storage.get('DepartManager', 'data', 'storage');
            if (result) {
                return JSON.parse(result);
            }
            return null;
        } catch (e) {
            console.error('[SmugglersEye] dbGetShared error:', e);
            return null;
        }
    }

    async function dbSetShared(storage) {
        try {
            await window.RebelShipBridge.storage.set('DepartManager', 'data', 'storage', JSON.stringify(storage));
            return true;
        } catch (e) {
            console.error('[SmugglersEye] dbSetShared error:', e);
            return false;
        }
    }

    // ========== SETTINGS ==========
    async function loadSettings() {
        try {
            var record = await dbGet('settings');
            if (record) {
                settings = {
                    enabled: record.enabled !== undefined ? record.enabled : false,
                    instant4Percent: record.instant4Percent !== undefined ? record.instant4Percent : true,
                    gradual8Percent: record.gradual8Percent !== undefined ? record.gradual8Percent : false,
                    gradualIncreaseStep: record.gradualIncreaseStep !== undefined ? record.gradualIncreaseStep : 1,
                    gradualIncreaseInterval: record.gradualIncreaseInterval !== undefined ? record.gradualIncreaseInterval : 25,
                    targetPercent: record.targetPercent !== undefined ? record.targetPercent : 8,
                    maxGuardsOnPirateRoutes: record.maxGuardsOnPirateRoutes !== undefined ? record.maxGuardsOnPirateRoutes : true,
                    notifyIngame: record.notifyIngame !== undefined ? record.notifyIngame : true,
                    notifySystem: record.notifySystem !== undefined ? record.notifySystem : false
                };
            }
            return settings;
        } catch (e) {
            console.error('[SmugglersEye] Failed to load settings:', e);
            return settings;
        }
    }

    async function saveSettings() {
        try {
            await dbSet('settings', settings);
            log('Settings saved');
        } catch (e) {
            console.error('[SmugglersEye] Failed to save settings:', e);
        }
    }

    // ========== AUTOPRICE CACHE ==========
    async function loadAutoPriceCache() {
        var cached = await dbGet('autoPriceCache');
        if (cached) {
            autoPriceCacheData = cached;
        }
        return autoPriceCacheData;
    }

    async function saveAutoPriceCache() {
        await dbSet('autoPriceCache', autoPriceCacheData);
    }

    function getAutoprice(routeId, vesselType) {
        var cacheKey = routeId + '_' + (vesselType === 'tanker' ? 't' : 'c');
        var entry = autoPriceCacheData[cacheKey];
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

    // ========== GRADUAL INCREASE TRACKING ==========
    async function loadGradualIncreaseData() {
        var cached = await dbGet('gradualIncrease');
        if (cached) {
            gradualIncreaseData = cached;
        }
        return gradualIncreaseData;
    }

    async function saveGradualIncreaseData() {
        await dbSet('gradualIncrease', gradualIncreaseData);
    }

    function getLastGradualIncrease(vesselId) {
        return gradualIncreaseData[vesselId] || 0;
    }

    function setLastGradualIncrease(vesselId, timestamp) {
        gradualIncreaseData[vesselId] = timestamp;
        saveGradualIncreaseData();
    }

    // ========== PENDING ROUTE SETTINGS (Shared) ==========
    async function savePendingRouteSettings(vesselId, data) {
        var storage = await dbGetShared();
        if (!storage) {
            storage = { settings: {}, drydockVessels: {}, pendingRouteSettings: {} };
        }
        if (!storage.pendingRouteSettings) {
            storage.pendingRouteSettings = {};
        }
        storage.pendingRouteSettings[vesselId] = {
            name: data.name,
            speed: data.speed,
            guards: data.guards,
            prices: data.prices,
            savedAt: Date.now()
        };
        await dbSetShared(storage);
        log('Saved pending route settings for ' + data.name);
    }

    // ========== HIJACKING RISK CACHE ==========
    function updateHijackingRiskCache(vessels) {
        for (var i = 0; i < vessels.length; i++) {
            var vessel = vessels[i];
            if (!vessel.routes || !Array.isArray(vessel.routes)) continue;
            for (var j = 0; j < vessel.routes.length; j++) {
                var route = vessel.routes[j];
                if (route.origin && route.destination && route.hijacking_risk !== undefined) {
                    var routeKey = route.origin + '<>' + route.destination;
                    var reverseKey = route.destination + '<>' + route.origin;
                    hijackingRiskCache[routeKey] = route.hijacking_risk;
                    hijackingRiskCache[reverseKey] = route.hijacking_risk;
                }
            }
        }
    }

    function getVesselHijackingRisk(vessel) {
        if (!vessel.route_origin || !vessel.route_destination) return 0;
        var routeKey = vessel.route_origin + '<>' + vessel.route_destination;
        var risk = hijackingRiskCache[routeKey];
        if (risk !== undefined) return risk;
        var reverseKey = vessel.route_destination + '<>' + vessel.route_origin;
        risk = hijackingRiskCache[reverseKey];
        if (risk !== undefined) return risk;
        return 0;
    }

    // ========== API FUNCTIONS ==========
    function fetchWithCookie(url, options) {
        options = options || {};
        var mergedHeaders = Object.assign({
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }, options.headers);

        return fetch(url, Object.assign({
            credentials: 'include'
        }, options, {
            headers: mergedHeaders
        })).then(function(response) {
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            return response.json();
        });
    }

    function fetchVessels() {
        return fetchWithCookie(API_BASE + '/vessel/get-all-user-vessels', {
            method: 'POST',
            body: JSON.stringify({ include_routes: true })
        }).then(function(data) {
            var vessels = data.data && data.data.user_vessels ? data.data.user_vessels : [];
            if (vessels.length > 0) {
                updateHijackingRiskCache(vessels);
            }
            return vessels;
        });
    }

    function updateRouteData(vesselId, speed, guards, prices) {
        return fetchWithCookie(API_BASE + '/route/update-route-data', {
            method: 'POST',
            body: JSON.stringify({
                user_vessel_id: vesselId,
                speed: speed,
                guards: guards,
                prices: prices
            })
        }).then(function(data) {
            return data && data.data && data.data.user_vessel;
        });
    }

    async function fetchAutoPrice(vesselId, routeId) {
        try {
            var response = await originalFetch(API_BASE + '/demand/auto-price', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ user_vessel_id: vesselId, route_id: routeId })
            });
            if (response.ok) {
                var data = await response.json();
                return data && data.data ? data.data : null;
            }
        } catch (e) {
            log('fetchAutoPrice failed: ' + e.message, 'error');
        }
        return null;
    }

    // ========== UTILITY ==========
    function calculatePriceDiffPercent(price, autoprice) {
        if (!autoprice || autoprice === 0) return 0;
        return Math.round(((price - autoprice) / autoprice) * 100);
    }

    // ========== CORE LOGIC ==========
    async function initAutoPriceCache(vessels) {
        if (!vessels || vessels.length === 0) return;

        var vesselsWithRoutes = vessels.filter(function(v) {
            var routeId = (v.active_route && v.active_route.route_id) || v.route_id;
            return routeId && v.route_destination && !v.is_parked;
        });

        if (vesselsWithRoutes.length === 0) return;

        var now = Date.now();
        var needsFetch = [];

        for (var i = 0; i < vesselsWithRoutes.length; i++) {
            var v = vesselsWithRoutes[i];
            var routeId = (v.active_route && v.active_route.route_id) || v.route_id;
            var cacheKey = routeId + '_' + (v.capacity_type === 'tanker' ? 't' : 'c');
            var entry = autoPriceCacheData[cacheKey];

            if (!entry || (now - entry.timestamp) >= AUTOPRICE_CACHE_TTL) {
                needsFetch.push({ vessel: v, routeId: routeId, cacheKey: cacheKey });
            }
        }

        if (needsFetch.length === 0) {
            log('Auto-price cache valid for all ' + vesselsWithRoutes.length + ' routes');
            return;
        }

        log('Fetching auto-prices for ' + needsFetch.length + ' routes...');

        var batchSize = 5;
        for (var j = 0; j < needsFetch.length; j += batchSize) {
            var batch = needsFetch.slice(j, j + batchSize);
            await Promise.all(batch.map(async function(item) {
                var prices = await fetchAutoPrice(item.vessel.id, item.routeId);
                if (prices) {
                    autoPriceCacheData[item.cacheKey] = { prices: prices, timestamp: now };
                }
            }));

            if (j + batchSize < needsFetch.length) {
                await new Promise(function(r) { setTimeout(r, 100); });
            }
        }

        await saveAutoPriceCache();
        log('Auto-price cache updated for ' + needsFetch.length + ' routes');
    }

    async function applySmugglersEyeToVessel(vessel) {
        if (!settings.enabled) return { updated: false, pending: false };

        if (!vessel.route_destination) return { updated: false, pending: false };

        var routeId = (vessel.active_route && vessel.active_route.route_id) || vessel.route_id;
        if (!routeId) return { updated: false, pending: false };

        if (vessel.is_parked) return { updated: false, pending: false };

        var autoprice = getAutoprice(routeId, vessel.capacity_type);
        if (!autoprice) return { updated: false, pending: false };

        var currentPrices = vessel.prices || {};
        var newPrices = Object.assign({}, currentPrices);
        var newGuards = vessel.route_guards || 0;
        var needsUpdate = false;

        // 4% Instant Markup
        if (settings.instant4Percent) {
            if (currentPrices.dry && autoprice.dry) {
                var diffDry = calculatePriceDiffPercent(currentPrices.dry, autoprice.dry);
                if (diffDry < 4) {
                    newPrices.dry = Math.round(autoprice.dry * 1.04);
                    needsUpdate = true;
                }
            }
            if (currentPrices.refrigerated && autoprice.ref) {
                var diffRef = calculatePriceDiffPercent(currentPrices.refrigerated, autoprice.ref);
                if (diffRef < 4) {
                    newPrices.refrigerated = Math.round(autoprice.ref * 1.04);
                    needsUpdate = true;
                }
            }
            if (currentPrices.fuel && autoprice.fuel) {
                var diffFuel = calculatePriceDiffPercent(currentPrices.fuel, autoprice.fuel);
                if (diffFuel < 4) {
                    newPrices.fuel = Math.round(autoprice.fuel * 1.04 * 100) / 100;
                    needsUpdate = true;
                }
            }
            if (currentPrices.crude_oil && autoprice.crude) {
                var diffCrude = calculatePriceDiffPercent(currentPrices.crude_oil, autoprice.crude);
                if (diffCrude < 4) {
                    newPrices.crude_oil = Math.round(autoprice.crude * 1.04 * 100) / 100;
                    needsUpdate = true;
                }
            }
        }

        // Gradual Increase
        if (settings.gradual8Percent) {
            var now = Date.now();
            var lastIncrease = getLastGradualIncrease(vessel.id);
            var targetPercent = settings.targetPercent;
            var increaseStep = settings.gradualIncreaseStep;
            var intervalMs = settings.gradualIncreaseInterval * 60 * 60 * 1000;
            var stepMultiplier = 1 + increaseStep / 100;

            if (!lastIncrease || (now - lastIncrease) >= intervalMs) {
                var gradualUpdated = false;

                if (currentPrices.dry && autoprice.dry) {
                    var currentDiffDry = calculatePriceDiffPercent(newPrices.dry || currentPrices.dry, autoprice.dry);
                    if (currentDiffDry < targetPercent) {
                        var maxPriceDry = Math.round(autoprice.dry * (1 + targetPercent / 100));
                        newPrices.dry = Math.min(Math.round((newPrices.dry || currentPrices.dry) * stepMultiplier), maxPriceDry);
                        gradualUpdated = true;
                    }
                }
                if (currentPrices.refrigerated && autoprice.ref) {
                    var currentDiffRef = calculatePriceDiffPercent(newPrices.refrigerated || currentPrices.refrigerated, autoprice.ref);
                    if (currentDiffRef < targetPercent) {
                        var maxPriceRef = Math.round(autoprice.ref * (1 + targetPercent / 100));
                        newPrices.refrigerated = Math.min(Math.round((newPrices.refrigerated || currentPrices.refrigerated) * stepMultiplier), maxPriceRef);
                        gradualUpdated = true;
                    }
                }
                if (currentPrices.fuel && autoprice.fuel) {
                    var currentDiffFuel = calculatePriceDiffPercent(newPrices.fuel || currentPrices.fuel, autoprice.fuel);
                    if (currentDiffFuel < targetPercent) {
                        var maxPriceFuel = Math.round(autoprice.fuel * (1 + targetPercent / 100) * 100) / 100;
                        newPrices.fuel = Math.min(Math.round((newPrices.fuel || currentPrices.fuel) * stepMultiplier * 100) / 100, maxPriceFuel);
                        gradualUpdated = true;
                    }
                }
                if (currentPrices.crude_oil && autoprice.crude) {
                    var currentDiffCrude = calculatePriceDiffPercent(newPrices.crude_oil || currentPrices.crude_oil, autoprice.crude);
                    if (currentDiffCrude < targetPercent) {
                        var maxPriceCrude = Math.round(autoprice.crude * (1 + targetPercent / 100) * 100) / 100;
                        newPrices.crude_oil = Math.min(Math.round((newPrices.crude_oil || currentPrices.crude_oil) * stepMultiplier * 100) / 100, maxPriceCrude);
                        gradualUpdated = true;
                    }
                }

                if (gradualUpdated) {
                    setLastGradualIncrease(vessel.id, now);
                    needsUpdate = true;
                }
            }
        }

        // Max Guards on Pirate Routes
        if (settings.maxGuardsOnPirateRoutes) {
            var hijackingRisk = getVesselHijackingRisk(vessel);
            if (hijackingRisk > 0 && newGuards < 10) {
                newGuards = 10;
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            if (vessel.status === 'port') {
                log(vessel.name + ": Applying changes directly");
                await updateRouteData(vessel.id, vessel.route_speed, newGuards, newPrices);
                return { updated: true, pending: false };
            } else {
                log(vessel.name + ": Saving pending changes (enroute)");
                await savePendingRouteSettings(vessel.id, {
                    name: vessel.name,
                    speed: vessel.route_speed,
                    guards: newGuards,
                    prices: newPrices
                });
                return { updated: false, pending: true };
            }
        }

        return { updated: false, pending: false };
    }

    function runSmugglersEye(manual) {
        if (!settings.enabled && !manual) {
            return Promise.resolve({ skipped: true, reason: 'disabled' });
        }

        if (isProcessing) {
            return Promise.resolve({ skipped: true, reason: 'processing' });
        }

        isProcessing = true;
        var result = {
            checked: true,
            updated: 0,
            pending: 0,
            error: null
        };

        return fetchVessels().then(function(vessels) {
            if (!vessels || vessels.length === 0) {
                log('No vessels found');
                return result;
            }

            return initAutoPriceCache(vessels).then(function() {
                var promises = vessels.map(function(vessel) {
                    return applySmugglersEyeToVessel(vessel).then(function(vesselResult) {
                        if (vesselResult.updated) result.updated++;
                        if (vesselResult.pending) result.pending++;
                    });
                });

                return Promise.all(promises).then(function() {
                    if (result.updated > 0 || result.pending > 0) {
                        var msg = "Smuggler's Eye: " + result.updated + ' direct, ' + result.pending + ' pending';
                        log(msg);
                        if (result.updated > 0) {
                            showToast(result.updated + ' vessel(s) updated');
                        }
                    } else {
                        log('No price changes needed');
                    }
                    return result;
                });
            });
        }).catch(function(error) {
            log('Error: ' + error.message, 'error');
            result.error = error.message;
            return result;
        }).finally(function() {
            isProcessing = false;
        });
    }

    // ========== MONITORING ==========
    function startMonitoring() {
        if (monitorInterval) {
            clearInterval(monitorInterval);
        }
        monitorInterval = setInterval(function() {
            runSmugglersEye(false);
        }, CHECK_INTERVAL_MS);
        log('Monitoring started (15 min interval)');
        runSmugglersEye(false);
    }

    function stopMonitoring() {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
        log('Monitoring stopped');
    }

    // ========== LOGGING & NOTIFICATIONS ==========
    function log(message, level) {
        var prefix = '[SmugglersEye]';
        if (level === 'error') {
            console.error(prefix, message);
        } else {
            console.log(prefix, message);
        }
    }

    function sendSystemNotification(title, message) {
        if (!settings.notifySystem) return;

        if (typeof window.RebelShipNotify !== 'undefined' && window.RebelShipNotify.notify) {
            try {
                window.RebelShipNotify.notify(title + ': ' + message);
                return;
            } catch (e) {
                log('System notification failed: ' + e.message, 'error');
            }
        }

        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                try {
                    new Notification(title, {
                        body: message,
                        icon: 'https://shippingmanager.cc/favicon.ico',
                        tag: 'smugglers-eye'
                    });
                } catch (e) {
                    log('Web notification failed: ' + e.message, 'error');
                }
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(function(permission) {
                    if (permission === 'granted') {
                        sendSystemNotification(title, message);
                    }
                });
            }
        }
    }

    // ========== UI: PINIA STORES ==========
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

    function getModalStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('modal');
        } catch {
            return null;
        }
    }

    function getToastStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('toast');
        } catch {
            return null;
        }
    }

    function showToast(message, type) {
        type = type || 'success';
        if (settings.notifyIngame) {
            var toastStore = getToastStore();
            if (toastStore) {
                try {
                    if (type === 'error' && toastStore.error) {
                        toastStore.error(message);
                    } else if (toastStore.success) {
                        toastStore.success(message);
                    }
                } catch (err) {
                    log('Toast error: ' + err.message, 'error');
                }
            }
        }
        sendSystemNotification("Smuggler's Eye", message);
    }

    // ========== CUSTOM MODAL (Game-style) ==========
    function injectModalStyles() {
        if (document.getElementById('smuggler-modal-styles')) return;

        var style = document.createElement('style');
        style.id = 'smuggler-modal-styles';
        style.textContent = [
            '@keyframes smuggler-fade-in{0%{opacity:0}to{opacity:1}}',
            '@keyframes smuggler-fade-out{0%{opacity:1}to{opacity:0}}',
            '@keyframes smuggler-drop-down{0%{transform:translateY(-10px)}to{transform:translateY(0)}}',
            '@keyframes smuggler-push-up{0%{transform:translateY(0)}to{transform:translateY(-10px)}}',
            '#smuggler-modal-wrapper{align-items:flex-start;display:flex;height:100vh;justify-content:center;left:0;overflow:hidden;position:absolute;top:0;width:100vw;z-index:9999}',
            '#smuggler-modal-wrapper #smuggler-modal-background{animation:smuggler-fade-in .15s linear forwards;background-color:rgba(0,0,0,.5);height:100%;left:0;opacity:0;position:absolute;top:0;width:100%}',
            '#smuggler-modal-wrapper.hide #smuggler-modal-background{animation:smuggler-fade-out .15s linear forwards}',
            '#smuggler-modal-wrapper #smuggler-modal-content-wrapper{animation:smuggler-drop-down .15s linear forwards,smuggler-fade-in .15s linear forwards;height:100%;max-width:700px;opacity:0;position:relative;width:1140px;z-index:9001}',
            '#smuggler-modal-wrapper.hide #smuggler-modal-content-wrapper{animation:smuggler-push-up .15s linear forwards,smuggler-fade-out .15s linear forwards}',
            '@media screen and (min-width:1200px){#smuggler-modal-wrapper #smuggler-modal-content-wrapper{max-width:460px}}',
            '@media screen and (min-width:992px) and (max-width:1199px){#smuggler-modal-wrapper #smuggler-modal-content-wrapper{max-width:460px}}',
            '@media screen and (min-width:769px) and (max-width:991px){#smuggler-modal-wrapper #smuggler-modal-content-wrapper{max-width:460px}}',
            '@media screen and (max-width:768px){#smuggler-modal-wrapper #smuggler-modal-content-wrapper{max-width:100%}}',
            '#smuggler-modal-wrapper #smuggler-modal-container{background-color:#fff;height:100vh;overflow:hidden;position:absolute;width:100%}',
            '#smuggler-modal-container .modal-header{align-items:center;background:#626b90;border-radius:0;color:#fff;display:flex;height:31px;justify-content:space-between;text-align:left;width:100%;border:0!important;padding:0 .5rem!important}',
            '#smuggler-modal-container .header-title{font-weight:700;text-transform:uppercase;width:90%}',
            '#smuggler-modal-container .header-icon{cursor:pointer;height:1.2rem;margin:0 .5rem}',
            '#smuggler-modal-container .header-icon.closeModal{height:19px;width:19px}',
            '#smuggler-modal-container #smuggler-modal-content{height:calc(100% - 31px);max-width:inherit;overflow:hidden;display:flex;flex-direction:column}',
            '#smuggler-modal-container #smuggler-central-container{background-color:#e9effd;margin:0;overflow-x:hidden;overflow-y:auto;width:100%;flex:1;padding:10px 15px}',
            '#smuggler-modal-wrapper.hide{pointer-events:none}'
        ].join('');
        document.head.appendChild(style);
    }

    function closeModal() {
        if (!isModalOpen) return;
        log('Closing modal');
        isModalOpen = false;
        var modalWrapper = document.getElementById('smuggler-modal-wrapper');
        if (modalWrapper) {
            modalWrapper.classList.add('hide');
        }
    }

    function setupModalWatcher() {
        if (modalListenerAttached) return;
        modalListenerAttached = true;

        window.addEventListener('rebelship-menu-click', function() {
            if (isModalOpen) {
                log('RebelShip menu clicked, closing modal');
                closeModal();
            }
        });
    }

    function openSettingsModal() {
        var modalStore = getModalStore();
        if (modalStore && modalStore.closeAll) {
            modalStore.closeAll();
        }

        injectModalStyles();

        var existing = document.getElementById('smuggler-modal-wrapper');
        if (existing) {
            var contentCheck = existing.querySelector('#smuggler-settings-content');
            if (contentCheck) {
                existing.classList.remove('hide');
                isModalOpen = true;
                updateSettingsContent();
                return;
            }
            existing.remove();
        }

        var headerEl = document.querySelector('header');
        var headerHeight = headerEl ? headerEl.offsetHeight : 89;

        var modalWrapper = document.createElement('div');
        modalWrapper.id = 'smuggler-modal-wrapper';

        var modalBackground = document.createElement('div');
        modalBackground.id = 'smuggler-modal-background';
        modalBackground.onclick = function() { closeModal(); };

        var modalContentWrapper = document.createElement('div');
        modalContentWrapper.id = 'smuggler-modal-content-wrapper';

        var modalContainer = document.createElement('div');
        modalContainer.id = 'smuggler-modal-container';
        modalContainer.className = 'font-lato';
        modalContainer.style.top = headerHeight + 'px';
        modalContainer.style.height = 'calc(100vh - ' + headerHeight + 'px)';
        modalContainer.style.maxHeight = 'calc(100vh - ' + headerHeight + 'px)';

        var modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';

        var headerTitle = document.createElement('span');
        headerTitle.className = 'header-title';
        headerTitle.textContent = "Smuggler's Eye Settings";

        var closeIcon = document.createElement('img');
        closeIcon.className = 'header-icon closeModal';
        closeIcon.src = '/images/icons/close_icon_new.svg';
        closeIcon.onclick = function() { closeModal(); };
        closeIcon.onerror = function() {
            this.style.display = 'none';
            var fallback = document.createElement('span');
            fallback.textContent = 'X';
            fallback.style.cssText = 'cursor:pointer;font-weight:bold;padding:0 .5rem;';
            fallback.onclick = function() { closeModal(); };
            this.parentNode.appendChild(fallback);
        };

        modalHeader.appendChild(headerTitle);
        modalHeader.appendChild(closeIcon);

        var modalContent = document.createElement('div');
        modalContent.id = 'smuggler-modal-content';

        var centralContainer = document.createElement('div');
        centralContainer.id = 'smuggler-central-container';

        var settingsContent = document.createElement('div');
        settingsContent.id = 'smuggler-settings-content';
        centralContainer.appendChild(settingsContent);

        modalContent.appendChild(centralContainer);
        modalContainer.appendChild(modalHeader);
        modalContainer.appendChild(modalContent);
        modalContentWrapper.appendChild(modalContainer);
        modalWrapper.appendChild(modalBackground);
        modalWrapper.appendChild(modalContentWrapper);
        document.body.appendChild(modalWrapper);

        isModalOpen = true;
        updateSettingsContent();
    }

    function updateSettingsContent() {
        var settingsContent = document.getElementById('smuggler-settings-content');
        if (!settingsContent) return;

        settingsContent.innerHTML = '\
            <div style="padding:20px;max-width:400px;margin:0 auto;font-family:Lato,sans-serif;color:#01125d;">\
                <div style="margin-bottom:20px;">\
                    <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:16px;">\
                        <input type="checkbox" id="se-enabled" ' + (settings.enabled ? 'checked' : '') + '\
                               style="width:20px;height:20px;margin-right:12px;accent-color:#0db8f4;cursor:pointer;">\
                        <span>Enable Smuggler\'s Eye</span>\
                    </label>\
                </div>\
                <div id="se-options-wrapper" style="margin-bottom:20px;' + (settings.enabled ? '' : 'opacity:0.5;pointer-events:none;') + '">\
                <div style="margin-bottom:20px;">\
                    <label style="display:flex;align-items:flex-start;cursor:pointer;">\
                        <input type="checkbox" id="se-instant4" ' + (settings.instant4Percent ? 'checked' : '') + (settings.enabled ? '' : ' disabled') + '\
                               style="width:20px;height:20px;margin-right:12px;margin-top:2px;flex-shrink:0;accent-color:#0db8f4;cursor:pointer;">\
                        <span style="text-align:left;"><span style="font-weight:600;">4% Instant Markup</span>\
                        <span style="display:block;font-size:12px;color:#626b90;margin-top:2px;">Raise prices below 4% to 4%</span></span>\
                    </label>\
                </div>\
                <div style="margin-bottom:20px;">\
                    <label style="display:flex;align-items:center;cursor:pointer;">\
                        <input type="checkbox" id="se-gradual" ' + (settings.gradual8Percent ? 'checked' : '') + (settings.enabled ? '' : ' disabled') + '\
                               style="width:20px;height:20px;margin-right:12px;accent-color:#0db8f4;cursor:pointer;">\
                        <span style="font-weight:600;">Gradual Increase</span>\
                    </label>\
                </div>\
                <div id="se-gradual-options" style="margin-bottom:20px;padding-left:32px;' + (settings.gradual8Percent ? '' : 'display:none;') + '">\
                    <div style="display:flex;gap:12px;margin-bottom:12px;">\
                        <div style="flex:1;">\
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#01125d;">Step (%)</label>\
                            <input type="number" id="se-step" min="1" max="10" value="' + settings.gradualIncreaseStep + '"' + (settings.enabled ? '' : ' disabled') + '\
                                   class="redesign" style="width:100%;height:2rem;padding:0 0.5rem;background:#ebe9ea;border:0;border-radius:7px;color:#01125d;font-size:14px;font-family:Lato,sans-serif;text-align:center;box-sizing:border-box;">\
                        </div>\
                        <div style="flex:1;">\
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#01125d;">Interval (h)</label>\
                            <input type="number" id="se-interval" min="1" max="168" value="' + settings.gradualIncreaseInterval + '"' + (settings.enabled ? '' : ' disabled') + '\
                                   class="redesign" style="width:100%;height:2rem;padding:0 0.5rem;background:#ebe9ea;border:0;border-radius:7px;color:#01125d;font-size:14px;font-family:Lato,sans-serif;text-align:center;box-sizing:border-box;">\
                        </div>\
                        <div style="flex:1;">\
                            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#01125d;">Max (%)</label>\
                            <input type="number" id="se-target" min="1" max="20" value="' + settings.targetPercent + '"' + (settings.enabled ? '' : ' disabled') + '\
                                   class="redesign" style="width:100%;height:2rem;padding:0 0.5rem;background:#ebe9ea;border:0;border-radius:7px;color:#01125d;font-size:14px;font-family:Lato,sans-serif;text-align:center;box-sizing:border-box;">\
                        </div>\
                    </div>\
                    <div style="font-size:11px;color:#626b90;">Increase prices by Step% every Interval hours until Max%</div>\
                </div>\
                <div style="margin-bottom:20px;">\
                    <label style="display:flex;align-items:flex-start;cursor:pointer;">\
                        <input type="checkbox" id="se-guards" ' + (settings.maxGuardsOnPirateRoutes ? 'checked' : '') + (settings.enabled ? '' : ' disabled') + '\
                               style="width:20px;height:20px;margin-right:12px;margin-top:2px;flex-shrink:0;accent-color:#0db8f4;cursor:pointer;">\
                        <span style="text-align:left;"><span style="font-weight:600;">Max Guards on Pirate Routes</span>\
                        <span style="display:block;font-size:12px;color:#626b90;margin-top:2px;">Set 10 guards when hijacking risk > 0%</span></span>\
                    </label>\
                </div>\
                </div>\
                <div style="margin-bottom:24px;">\
                    <div style="font-weight:700;font-size:14px;margin-bottom:12px;color:#01125d;">Notifications</div>\
                    <div style="display:flex;gap:24px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;">\
                            <input type="checkbox" id="se-notify-ingame" ' + (settings.notifyIngame ? 'checked' : '') + '\
                                   style="width:18px;height:18px;margin-right:8px;accent-color:#0db8f4;cursor:pointer;">\
                            <span style="font-size:13px;">Ingame</span>\
                        </label>\
                        <label style="display:flex;align-items:center;cursor:pointer;">\
                            <input type="checkbox" id="se-notify-system" ' + (settings.notifySystem ? 'checked' : '') + '\
                                   style="width:18px;height:18px;margin-right:8px;accent-color:#0db8f4;cursor:pointer;">\
                            <span style="font-size:13px;">System</span>\
                        </label>\
                    </div>\
                </div>\
                <div style="display:flex;gap:12px;justify-content:space-between;margin-top:30px;">\
                    <button id="se-run-now" style="padding:10px 24px;background:linear-gradient(180deg,#3b82f6,#1d4ed8);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:500;font-family:Lato,sans-serif;">Run Now</button>\
                    <button id="se-save" style="padding:10px 24px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:16px;font-weight:500;font-family:Lato,sans-serif;">Save</button>\
                </div>\
            </div>';

        // Toggle options wrapper enabled/disabled
        document.getElementById('se-enabled').addEventListener('change', function() {
            var wrapper = document.getElementById('se-options-wrapper');
            var inputs = wrapper.querySelectorAll('input');
            if (this.checked) {
                wrapper.style.opacity = '';
                wrapper.style.pointerEvents = '';
                inputs.forEach(function(inp) { inp.disabled = false; });
            } else {
                wrapper.style.opacity = '0.5';
                wrapper.style.pointerEvents = 'none';
                inputs.forEach(function(inp) { inp.disabled = true; });
            }
        });

        // Toggle gradual options visibility
        document.getElementById('se-gradual').addEventListener('change', function() {
            var opts = document.getElementById('se-gradual-options');
            opts.style.display = this.checked ? '' : 'none';
        });

        document.getElementById('se-run-now').addEventListener('click', function() {
            var btn = this;
            btn.disabled = true;
            btn.textContent = 'Running...';
            runSmugglersEye(true).then(function() {
                btn.textContent = 'Run Now';
                btn.disabled = false;
            });
        });

        document.getElementById('se-save').addEventListener('click', function() {
            var enabled = document.getElementById('se-enabled').checked;
            var instant4 = document.getElementById('se-instant4').checked;
            var gradual = document.getElementById('se-gradual').checked;
            var step = parseInt(document.getElementById('se-step').value, 10);
            var interval = parseInt(document.getElementById('se-interval').value, 10);
            var target = parseInt(document.getElementById('se-target').value, 10);
            var guards = document.getElementById('se-guards').checked;
            var notifyIngame = document.getElementById('se-notify-ingame').checked;
            var notifySystem = document.getElementById('se-notify-system').checked;

            // Validate
            if (isNaN(step) || step < 1 || step > 10) {
                alert('Step must be between 1 and 10');
                return;
            }
            if (isNaN(interval) || interval < 1 || interval > 168) {
                alert('Interval must be between 1 and 168 hours');
                return;
            }
            if (isNaN(target) || target < 1 || target > 20) {
                alert('Max must be between 1 and 20');
                return;
            }

            var wasEnabled = settings.enabled;
            settings.enabled = enabled;
            settings.instant4Percent = instant4;
            settings.gradual8Percent = gradual;
            settings.gradualIncreaseStep = step;
            settings.gradualIncreaseInterval = interval;
            settings.targetPercent = target;
            settings.maxGuardsOnPirateRoutes = guards;
            settings.notifyIngame = notifyIngame;
            settings.notifySystem = notifySystem;

            saveSettings().then(function() {
                if (enabled && !wasEnabled) {
                    startMonitoring();
                } else if (!enabled && wasEnabled) {
                    stopMonitoring();
                }

                log('Settings saved');
                showToast("Smuggler's Eye settings saved");
                closeModal();
            });
        });
    }

    // ========== INITIALIZATION ==========
    var uiInitialized = false;
    var uiRetryCount = 0;
    var MAX_UI_RETRIES = 30;

    function initUI() {
        if (uiInitialized) return;

        var hasApp = document.getElementById('app');
        if (!hasApp) {
            uiRetryCount++;
            if (uiRetryCount < MAX_UI_RETRIES) {
                setTimeout(initUI, 1000);
                return;
            }
            log('Max UI retries reached, running in background mode');
            return;
        }

        uiInitialized = true;
        addMenuItem("Smuggler's Eye", openSettingsModal, 24);
        log('Menu item added');
    }

    async function init() {
        log('Initializing v1.0...');

        await loadSettings();
        await loadAutoPriceCache();
        await loadGradualIncreaseData();
        setupModalWatcher();
        initUI();

        if (settings.enabled) {
            setTimeout(startMonitoring, 3000);
        }
    }

    // Expose for Android BackgroundScriptService
    window.rebelshipRunSmugglersEye = function() {
        return loadSettings().then(function() {
            if (!settings.enabled) {
                return { skipped: true, reason: 'disabled' };
            }
            return runSmugglersEye(false);
        });
    };

    // Wait for page ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 2000);
        });
    } else {
        setTimeout(init, 2000);
    }

    // Register for background job system
    window.rebelshipBackgroundJobs = window.rebelshipBackgroundJobs || [];
    window.rebelshipBackgroundJobs.push({
        name: 'SmugglersEye',
        run: function() { return window.rebelshipRunSmugglersEye(); }
    });
})();
