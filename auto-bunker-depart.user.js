// ==UserScript==
// @name         ShippingManager - Auto Bunker-Refill & Depart
// @namespace    http://tampermonkey.net/
// @description  Auto-buy fuel/CO2 and auto-depart vessels - works in background mode via direct API
// @version      11.1
// @author       https://github.com/justonlyforyou/
// @order        20
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// @background-job-required true
// ==/UserScript==

/* globals CustomEvent */
(function() {
    'use strict';

    const SCRIPT_NAME = 'Auto Bunker & Depart';
    const STORAGE_KEY = 'rebelship_autobuy_settings';
    const CHECK_INTERVAL = 10000;
    const API_BASE = 'https://shippingmanager.cc/api';

    const DEFAULT_SETTINGS = {
        // Fuel settings
        fuelMode: 'off',  // 'off', 'basic', 'intelligent'
        fuelPriceThreshold: 500,
        fuelMinCash: 1000000,
        // Fuel Intelligent mode settings
        fuelIntelligentMaxPrice: 600,
        fuelIntelligentBelowEnabled: false,
        fuelIntelligentBelow: 500,
        fuelIntelligentShipsEnabled: false,
        fuelIntelligentShips: 5,
        // CO2 settings
        co2Mode: 'off',  // 'off', 'basic', 'intelligent'
        co2PriceThreshold: 10,
        co2MinCash: 1000000,
        // CO2 Intelligent mode settings
        co2IntelligentMaxPrice: 12,
        co2IntelligentBelowEnabled: false,
        co2IntelligentBelow: 500,
        co2IntelligentShipsEnabled: false,
        co2IntelligentShips: 5,
        // Avoid negative CO2 bunker (refill after departures)
        avoidNegativeCO2: false,
        // Auto-Depart
        autoDepartEnabled: false,
        // System notifications
        systemNotifications: false
    };

    const isMobile = window.innerWidth < 1024;
    const isAndroidApp = typeof window.RebelShipBridge !== 'undefined';

    // Check background mode dynamically (not at load time)
    function isBackgroundMode() {
        return !document.getElementById('app') || !document.querySelector('.messaging');
    }

    console.log('[Auto-Buy] v10.0 - Android:', isAndroidApp);

    // ============================================
    // SETTINGS STORAGE
    // ============================================
    function loadSettings() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                var parsed = JSON.parse(stored);
                var result = {};
                for (var key in DEFAULT_SETTINGS) {
                    result[key] = parsed[key] !== undefined ? parsed[key] : DEFAULT_SETTINGS[key];
                }
                return result;
            }
        } catch (e) {
            console.error('[Auto-Buy] Failed to load settings:', e);
        }
        var defaults = {};
        for (var k in DEFAULT_SETTINGS) {
            defaults[k] = DEFAULT_SETTINGS[k];
        }
        return defaults;
    }

    function saveSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            console.log('[Auto-Buy] Settings saved:', settings);
            syncSettingsToAndroid(settings);
        } catch (e) {
            console.error('[Auto-Buy] Failed to save settings:', e);
        }
    }

    async function syncSettingsToAndroid(settings) {
        if (!isAndroidApp) return;
        try {
            await window.RebelShipBridge.syncRebuySettings(settings);
            console.log('[Auto-Buy] Settings synced to Android');
        } catch (e) {
            console.log('[Auto-Buy] Could not sync to Android:', e.message);
        }
    }

    // ============================================
    // DIRECT API FUNCTIONS (No Pinia dependency)
    // ============================================

    /**
     * Fetch bunker state directly from API
     * Returns: { fuel, co2, cash, maxFuel, maxCO2 } in TONS
     */
    async function fetchBunkerStateAPI() {
        try {
            var response = await fetch(API_BASE + '/user/get-user-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            var data = await response.json();
            if (!data.data || !data.data.user || !data.data.settings) {
                console.error('[Auto-Buy] Invalid user settings response');
                return null;
            }
            return {
                fuel: data.data.user.fuel / 1000,
                co2: data.data.user.co2 / 1000,
                cash: data.data.user.cash,
                maxFuel: data.data.settings.max_fuel / 1000,
                maxCO2: data.data.settings.max_co2 / 1000
            };
        } catch (e) {
            console.error('[Auto-Buy] fetchBunkerStateAPI failed:', e);
            return null;
        }
    }

    /**
     * Fetch current prices from API with UTC time slot matching
     */
    async function fetchPricesAPI() {
        try {
            var response = await fetch(API_BASE + '/bunker/get-prices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            var data = await response.json();
            if (!data.data || !data.data.prices) {
                console.error('[Auto-Buy] Invalid prices response');
                return null;
            }

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
            console.error('[Auto-Buy] fetchPricesAPI failed:', e);
            return null;
        }
    }

    function findCurrentPriceSlot(prices) {
        if (!prices || prices.length === 0) return null;
        var now = new Date();
        var utcHours = now.getUTCHours();
        var utcMinutes = now.getUTCMinutes();
        var hourStr = utcHours < 10 ? '0' + utcHours : '' + utcHours;
        var currentSlot = utcMinutes < 30 ? hourStr + ':00' : hourStr + ':30';
        for (var i = 0; i < prices.length; i++) {
            if (prices[i].time === currentSlot) {
                return prices[i];
            }
        }
        return prices[0];
    }

    /**
     * Purchase fuel via API
     * @param {number} amountTons - Amount in tons
     * @param {number} pricePerTon - Price per ton for logging
     */
    async function purchaseFuelAPI(amountTons, pricePerTon) {
        try {
            if (amountTons <= 0) {
                console.log('[Auto-Buy] Fuel purchase skipped - amount is 0 or negative');
                return { success: false, error: 'Amount <= 0' };
            }
            var amountKg = Math.floor(amountTons * 1000);
            console.log('[Auto-Buy] Purchasing ' + amountTons.toFixed(0) + 't fuel @ $' + pricePerTon + '/t');

            var response = await fetch(API_BASE + '/bunker/purchase-fuel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ amount: amountKg })
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var data = await response.json();
            console.log('[Auto-Buy] Fuel purchase response:', data);

            if (data.user) {
                updatePiniaStore(data.user);
            }

            notify('Purchased ' + amountTons.toFixed(0) + 't fuel @ $' + pricePerTon, 'success', 'fuel');
            return { success: true, data: data };
        } catch (e) {
            console.error('[Auto-Buy] Fuel purchase failed:', e);
            notify('Fuel purchase failed: ' + e.message, 'error', 'fuel');
            return { success: false, error: e.message };
        }
    }

    /**
     * Purchase CO2 via API
     * Note: Game has quirk where it buys 1t less than requested
     */
    async function purchaseCO2API(amountTons, pricePerTon) {
        try {
            if (amountTons <= 0) {
                console.log('[Auto-Buy] CO2 purchase skipped - amount is 0 or negative');
                return { success: false, error: 'Amount <= 0' };
            }
            var amountKg = Math.floor(amountTons * 1000);
            console.log('[Auto-Buy] Purchasing ' + amountTons.toFixed(0) + 't CO2 @ $' + pricePerTon + '/t');

            var response = await fetch(API_BASE + '/bunker/purchase-co2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ amount: amountKg })
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var data = await response.json();
            console.log('[Auto-Buy] CO2 purchase response:', data);

            if (data.user) {
                updatePiniaStore(data.user);
            }

            notify('Purchased ' + amountTons.toFixed(0) + 't CO2 @ $' + pricePerTon, 'success', 'co2');
            return { success: true, data: data };
        } catch (e) {
            console.error('[Auto-Buy] CO2 purchase failed:', e);
            notify('CO2 purchase failed: ' + e.message, 'error', 'co2');
            return { success: false, error: e.message };
        }
    }

    /**
     * Fetch all vessels via API
     */
    async function fetchVesselsAPI() {
        try {
            var response = await fetch(API_BASE + '/vessel/get-all-user-vessels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ include_routes: false })
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            var data = await response.json();
            if (!data.data || !data.data.user_vessels) {
                return [];
            }
            return data.data.user_vessels;
        } catch (e) {
            console.error('[Auto-Buy] fetchVesselsAPI failed:', e);
            return [];
        }
    }

    /**
     * Depart a single vessel via API
     */
    async function departVesselAPI(vesselId, speed, guards) {
        try {
            var response = await fetch(API_BASE + '/route/depart', {
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

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var data = await response.json();

            if (!data.data || !data.data.depart_info) {
                var errorMsg = data.error || 'Unknown error';
                console.log('[Auto-Buy] Depart failed for vessel ' + vesselId + ': ' + errorMsg);
                return { success: false, error: errorMsg };
            }

            var departInfo = data.data.depart_info;
            console.log('[Auto-Buy] Departed vessel ' + vesselId + ' - Income: $' + departInfo.depart_income);

            return {
                success: true,
                income: departInfo.depart_income,
                harborFee: departInfo.harbor_fee,
                fuelUsed: departInfo.fuel_usage / 1000
            };
        } catch (e) {
            console.error('[Auto-Buy] departVesselAPI failed:', e);
            return { success: false, error: e.message };
        }
    }

    // ============================================
    // PINIA STORE HELPERS (for UI updates when available)
    // ============================================
    function getPinia() {
        var app = document.getElementById('app');
        if (!app || !app.__vue_app__) return null;
        return app.__vue_app__.config.globalProperties.$pinia;
    }

    function getUserStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('user');
        } catch (err) { // eslint-disable-line no-unused-vars
            return null;
        }
    }

    function getVesselStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('vessel');
        } catch (err) { // eslint-disable-line no-unused-vars
            return null;
        }
    }

    function getModalStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('modal');
        } catch (err) { // eslint-disable-line no-unused-vars
            return null;
        }
    }

    function getToastStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('toast');
        } catch (err) { // eslint-disable-line no-unused-vars
            return null;
        }
    }

    function updatePiniaStore(userData) {
        var userStore = getUserStore();
        if (userStore && userData) {
            userStore.$patch(function(state) {
                if (userData.fuel !== undefined) state.user.fuel = userData.fuel;
                if (userData.co2 !== undefined) state.user.co2 = userData.co2;
                if (userData.cash !== undefined) state.user.cash = userData.cash;
            });
        }
    }

    /**
     * Show notification via all available channels
     * @param {string} message - The message to show
     * @param {string} type - 'success' or 'error'
     * @param {string} category - 'fuel', 'co2', or 'depart'
     */
    function notify(message, type, category) {
        console.log('[Auto-Buy] NOTIFY (' + category + '/' + type + '): ' + message);

        // 1. In-game toast (Pinia)
        var toastStore = getToastStore();
        if (toastStore) {
            if (type === 'error' && toastStore.error) {
                toastStore.error(message);
            } else if (toastStore.success) {
                toastStore.success(message);
            }
            console.log('[Auto-Buy] Toast shown via Pinia');
        }

        // 2. Android bridge notification (injected by BackgroundScriptService)
        if (window.RebelShipNotify) {
            try {
                if (category === 'fuel' && window.RebelShipNotify.fuelBought) {
                    window.RebelShipNotify.fuelBought(message);
                } else if (category === 'co2' && window.RebelShipNotify.co2Bought) {
                    window.RebelShipNotify.co2Bought(message);
                } else if (category === 'depart' && window.RebelShipNotify.shipsDeparted) {
                    window.RebelShipNotify.shipsDeparted(message);
                } else if (type === 'error' && window.RebelShipNotify.error) {
                    window.RebelShipNotify.error(message);
                } else if (window.RebelShipNotify.notify) {
                    window.RebelShipNotify.notify(message);
                }
                console.log('[Auto-Buy] Android notification sent via bridge');
            } catch (e) {
                console.log('[Auto-Buy] Android notification failed:', e.message);
            }
        } else if (isBackgroundMode()) {
            // Fallback: Direct navigation trick for Android headless mode
            try {
                var title = category === 'fuel' ? 'Fuel Purchased' :
                           category === 'co2' ? 'CO2 Purchased' :
                           category === 'depart' ? 'Ships Departed' :
                           type === 'error' ? 'RebelShip Error' : 'RebelShip';
                var url = 'https://rebelship-notify.local/send?title=' + encodeURIComponent(title) + '&message=' + encodeURIComponent(message);
                var iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                iframe.src = url;
                document.body.appendChild(iframe);
                setTimeout(function() { iframe.remove(); }, 100);
                console.log('[Auto-Buy] Android notification sent via navigation');
            } catch (e) {
                console.log('[Auto-Buy] Navigation notification failed:', e.message);
            }
        }

        // 3. Web Notification API (desktop/system)
        showSystemNotification(message, type);
    }


    /**
     * Show system notification via Web Notification API
     * Only sends if systemNotifications setting is enabled
     */
    function showSystemNotification(message, _type) {
        // Check if system notifications are enabled
        var currentSettings = loadSettings();
        if (!currentSettings.systemNotifications) {
            return;
        }

        if (typeof Notification === 'undefined') {
            console.log('[Auto-Buy] Notification API not available');
            return;
        }

        if (Notification.permission === 'default') {
            console.log('[Auto-Buy] Requesting notification permission...');
            Notification.requestPermission();
            return;
        }

        if (Notification.permission !== 'granted') {
            console.log('[Auto-Buy] Notification permission denied');
            return;
        }

        var tag = 'autobuy-' + Date.now();

        try {
            // Create notification (variable unused but instantiation triggers display)
            new Notification('Auto Bunker & Depart', {
                body: message,
                tag: tag,
                icon: 'https://shippingmanager.cc/favicon.ico',
                requireInteraction: false
            });
            console.log('[Auto-Buy] System notification created');
        } catch (err) { // eslint-disable-line no-unused-vars
            console.log('[Auto-Buy] System notification failed');
        }
    }

    // ============================================
    // BUNKER DATA (hybrid - Pinia if available, else API)
    // ============================================
    async function getBunkerData() {
        // Try Pinia first (faster, already loaded)
        var userStore = getUserStore();
        if (userStore && userStore.user && userStore.settings) {
            return {
                cash: userStore.user.cash,
                fuel: userStore.user.fuel / 1000,
                co2: userStore.user.co2 / 1000,
                maxFuel: userStore.settings.max_fuel / 1000,
                maxCO2: userStore.settings.max_co2 / 1000
            };
        }

        // Fall back to API (background mode)
        console.log('[Auto-Buy] Pinia not available, using API');
        return await fetchBunkerStateAPI();
    }

    // ============================================
    // VESSEL CALCULATIONS (matching copilot formulas)
    // ============================================
    function getVesselCapacity(vessel) {
        if (!vessel || !vessel.capacity_max) return 0;
        var cap = vessel.capacity_max;
        if (vessel.capacity_type === 'tanker') {
            return ((cap.fuel || 0) + (cap.crude_oil || 0)) / 74;
        }
        return (cap.dry || 0) + (cap.refrigerated || 0);
    }

    /**
     * Calculate fuel consumption using game formula (from app.js module 2576)
     * Game formula: fuel_kg = capacity * distance * sqrt(actualSpeed) * fuel_factor / 40
     */
    function calculateFuelConsumption(vessel, distance, actualSpeed) {
        var capacity = getVesselCapacity(vessel);
        if (capacity <= 0 || distance <= 0 || actualSpeed <= 0) return 0;

        var fuelFactor = vessel.fuel_factor || 1;

        // Correct game formula: capacity * distance * sqrt(actualSpeed) * fuel_factor / 40
        var fuelKg = capacity * distance * Math.sqrt(actualSpeed) * fuelFactor / 40;
        var fuelTons = fuelKg / 1000;
        // Add 2% safety margin for rounding differences
        return fuelTons * 1.02;
    }

    /**
     * Calculate CO2 consumption using game formula
     * Formula: co2_per_teu_nm = (2 - capacity / 15000) * co2_factor
     * Total: co2_per_teu_nm * cargo * distance
     */
    function calculateCO2Consumption(vessel, distance) {
        var capacity = getVesselCapacity(vessel);
        if (capacity <= 0 || distance <= 0) return 0;

        var co2Factor = vessel.co2_factor || 1;

        // CO2 per TEU per nautical mile
        var co2PerTeuNm = (2 - capacity / 15000) * co2Factor;

        // Use max capacity for buffer in intelligent rebuy
        var totalCO2Kg = co2PerTeuNm * capacity * distance;

        return totalCO2Kg / 1000; // Return in tons
    }

    async function getVesselsReadyToDepart() {
        var vessels;

        // Try Pinia first
        var vesselStore = getVesselStore();
        if (vesselStore && vesselStore.userVessels) {
            vessels = vesselStore.userVessels;
        } else {
            // Fall back to API
            vessels = await fetchVesselsAPI();
        }

        var ready = vessels.filter(function(v) {
            // Must be at port, not parked, have a route assigned
            return v.status === 'port' &&
                !v.is_parked &&
                v.route_destination &&
                v.route_distance > 0;
        });

        console.log('[Auto-Depart] Found ' + ready.length + ' vessels ready (of ' + vessels.length + ' total)');
        if (ready.length > 0) {
            console.log('[Auto-Depart] First ready vessel:', ready[0].name, '->', ready[0].route_destination);
        }

        return ready;
    }

    // ============================================
    // AUTO-REBUY LOGIC (matching copilot - Barrel Boss / Atmosphere Broker)
    // Mode Priority:
    // 1. NORMAL: price <= threshold -> fill bunker completely (HIGHEST)
    // 2. INTELLIGENT: price <= maxPrice AND optional conditions met -> buy SHORTFALL only
    //
    // Intelligent Mode optional conditions (all ENABLED conditions must be met):
    // - Max price (always checked)
    // - Bunker below threshold (optional - fuelIntelligentBelowEnabled)
    // - Min ships at port (optional - fuelIntelligentShipsEnabled)
    // ============================================
    async function autoRebuyFuel(bunker, prices, settings) {
        if (settings.fuelMode === 'off') return false;

        var fuelPrice = prices.fuelPrice;
        if (!fuelPrice) return false;

        var fuelSpace = bunker.maxFuel - bunker.fuel;
        var availableCash = Math.max(0, bunker.cash - settings.fuelMinCash);
        var maxAffordable = Math.floor(availableCash / fuelPrice);
        var amountToBuy = 0;
        var reason = '';

        // ========== NORMAL MODE: Price below threshold - fill bunker (HIGHEST PRIORITY) ==========
        if (fuelPrice <= settings.fuelPriceThreshold) {
            if (fuelSpace < 0.5) {
                console.log('[Auto-Buy] Fuel: Bunker full');
                return false;
            }
            amountToBuy = Math.min(Math.ceil(fuelSpace), maxAffordable);
            reason = 'Normal: price $' + fuelPrice + '/t <= threshold $' + settings.fuelPriceThreshold + '/t - filling bunker';

        // ========== INTELLIGENT MODE: Buy shortfall only with optional conditions ==========
        } else if (settings.fuelMode === 'intelligent') {
            // Check max price condition (always required)
            var maxFuelPrice = parseInt(settings.fuelIntelligentMaxPrice, 10);
            if (!maxFuelPrice || isNaN(maxFuelPrice) || fuelPrice > maxFuelPrice) {
                console.log('[Auto-Buy] Fuel Intelligent: Price $' + fuelPrice + '/t > max $' + maxFuelPrice + '/t - skipping');
                return false;
            }

            // Check optional "bunker below" condition
            if (settings.fuelIntelligentBelowEnabled) {
                if (bunker.fuel >= settings.fuelIntelligentBelow) {
                    console.log('[Auto-Buy] Fuel Intelligent: Bunker ' + bunker.fuel.toFixed(1) + 't >= threshold ' + settings.fuelIntelligentBelow + 't - skipping');
                    return false;
                }
                console.log('[Auto-Buy] Fuel Intelligent: Bunker ' + bunker.fuel.toFixed(1) + 't < threshold ' + settings.fuelIntelligentBelow + 't - condition met');
            }

            // Get vessels for ships check and fuel calculation
            var vessels = await fetchVesselsAPI();
            if (!vessels) {
                console.log('[Auto-Buy] Fuel Intelligent: Could not fetch vessels - skipping');
                return false;
            }

            // Check optional "min ships at port" condition
            if (settings.fuelIntelligentShipsEnabled) {
                var shipsAtPort = vessels.filter(function(v) { return v.status === 'port'; }).length;
                if (shipsAtPort < settings.fuelIntelligentShips) {
                    console.log('[Auto-Buy] Fuel Intelligent: Only ' + shipsAtPort + ' ships at port < required ' + settings.fuelIntelligentShips + ' - skipping');
                    return false;
                }
                console.log('[Auto-Buy] Fuel Intelligent: ' + shipsAtPort + ' ships at port >= required ' + settings.fuelIntelligentShips + ' - condition met');
            }

            // Calculate fuel shortfall for departing vessels
            var readyVessels = vessels.filter(function(v) {
                return v.status === 'port' && !v.is_parked && v.route_destination;
            });

            if (readyVessels.length === 0) {
                console.log('[Auto-Buy] Fuel Intelligent: No vessels ready to depart - skipping');
                return false;
            }

            var totalFuelNeeded = 0;
            for (var i = 0; i < readyVessels.length; i++) {
                var vessel = readyVessels[i];
                var distance = vessel.route_distance;
                if (!distance || distance <= 0) continue;

                var speed = vessel.route_speed || vessel.max_speed;
                var fuelNeeded = vessel.route_fuel_required || vessel.fuel_required;
                if (fuelNeeded) {
                    // Add 2% buffer to game's fuel requirement
                    fuelNeeded = fuelNeeded * 1.02;
                } else {
                    // calculateFuelConsumption already includes 2% buffer
                    fuelNeeded = calculateFuelConsumption(vessel, distance, speed) * 1000;
                }
                totalFuelNeeded += (fuelNeeded || 0) / 1000;
            }

            var shortfall = Math.ceil(totalFuelNeeded - bunker.fuel);

            if (shortfall > 0) {
                amountToBuy = Math.min(shortfall, Math.floor(fuelSpace), maxAffordable);
                reason = 'Intelligent: ' + readyVessels.length + ' vessels need ' + totalFuelNeeded.toFixed(1) + 't, bunker has ' + bunker.fuel.toFixed(1) + 't (shortfall: ' + shortfall + 't)';
            } else {
                console.log('[Auto-Buy] Fuel Intelligent: No shortfall, ' + readyVessels.length + ' vessels need ' + totalFuelNeeded.toFixed(1) + 't, bunker has ' + bunker.fuel.toFixed(1) + 't - skipping');
                return false;
            }

        // ========== BASIC MODE ONLY: Price above threshold ==========
        } else {
            console.log('[Auto-Buy] Fuel: Price $' + fuelPrice + '/t > threshold $' + settings.fuelPriceThreshold + '/t and intelligent disabled - skipping');
            return false;
        }

        if (amountToBuy <= 0) {
            console.log('[Auto-Buy] Fuel: Cannot buy - insufficient funds or space');
            return false;
        }

        console.log('[Auto-Buy] Fuel: ' + reason + ', buying ' + amountToBuy.toFixed(0) + 't @ $' + fuelPrice);
        var result = await purchaseFuelAPI(amountToBuy, fuelPrice);
        return result.success;
    }

    async function autoRebuyCO2(bunker, prices, settings) {
        if (settings.co2Mode === 'off') return false;

        var co2Price = prices.co2Price;
        if (!co2Price) return false;

        var co2Space = bunker.maxCO2 - bunker.co2;
        var availableCash = Math.max(0, bunker.cash - settings.co2MinCash);
        var maxAffordable = Math.floor(availableCash / co2Price);
        var amountToBuy = 0;
        var reason = '';

        // ========== NORMAL MODE: Price below threshold - fill bunker (HIGHEST PRIORITY) ==========
        if (co2Price <= settings.co2PriceThreshold) {
            if (co2Space < 0.5) {
                console.log('[Auto-Buy] CO2: Bunker full');
                return false;
            }
            amountToBuy = Math.min(Math.ceil(co2Space), maxAffordable);
            reason = 'Normal: price $' + co2Price + '/t <= threshold $' + settings.co2PriceThreshold + '/t - filling bunker';

        // ========== INTELLIGENT MODE: Buy shortfall only with optional conditions ==========
        } else if (settings.co2Mode === 'intelligent') {
            // Check max price condition (always required)
            var maxCO2Price = parseInt(settings.co2IntelligentMaxPrice, 10);
            if (!maxCO2Price || isNaN(maxCO2Price) || co2Price > maxCO2Price) {
                console.log('[Auto-Buy] CO2 Intelligent: Price $' + co2Price + '/t > max $' + maxCO2Price + '/t - skipping');
                return false;
            }

            // Check optional "bunker below" condition
            if (settings.co2IntelligentBelowEnabled) {
                if (bunker.co2 >= settings.co2IntelligentBelow) {
                    console.log('[Auto-Buy] CO2 Intelligent: Bunker ' + bunker.co2.toFixed(1) + 't >= threshold ' + settings.co2IntelligentBelow + 't - skipping');
                    return false;
                }
                console.log('[Auto-Buy] CO2 Intelligent: Bunker ' + bunker.co2.toFixed(1) + 't < threshold ' + settings.co2IntelligentBelow + 't - condition met');
            }

            // Get vessels for ships check and CO2 calculation
            var vessels = await fetchVesselsAPI();
            if (!vessels) {
                console.log('[Auto-Buy] CO2 Intelligent: Could not fetch vessels - skipping');
                return false;
            }

            // Check optional "min ships at port" condition
            if (settings.co2IntelligentShipsEnabled) {
                var shipsAtPort = vessels.filter(function(v) { return v.status === 'port'; }).length;
                if (shipsAtPort < settings.co2IntelligentShips) {
                    console.log('[Auto-Buy] CO2 Intelligent: Only ' + shipsAtPort + ' ships at port < required ' + settings.co2IntelligentShips + ' - skipping');
                    return false;
                }
                console.log('[Auto-Buy] CO2 Intelligent: ' + shipsAtPort + ' ships at port >= required ' + settings.co2IntelligentShips + ' - condition met');
            }

            // Calculate CO2 shortfall for departing vessels
            var readyVessels = vessels.filter(function(v) {
                return v.status === 'port' && !v.is_parked && v.route_destination;
            });

            if (readyVessels.length === 0) {
                console.log('[Auto-Buy] CO2 Intelligent: No vessels ready to depart - skipping');
                return false;
            }

            var totalCO2Needed = 0;
            for (var i = 0; i < readyVessels.length; i++) {
                var vessel = readyVessels[i];
                var distance = vessel.route_distance;
                if (!distance || distance <= 0) continue;

                var co2Needed = calculateCO2Consumption(vessel, distance);
                totalCO2Needed += co2Needed || 0;
            }

            var shortfall = Math.ceil(totalCO2Needed - bunker.co2);

            if (shortfall > 0) {
                amountToBuy = Math.min(shortfall, Math.floor(co2Space), maxAffordable);
                reason = 'Intelligent: ' + readyVessels.length + ' vessels need ' + totalCO2Needed.toFixed(1) + 't, bunker has ' + bunker.co2.toFixed(1) + 't (shortfall: ' + shortfall + 't)';
            } else {
                console.log('[Auto-Buy] CO2 Intelligent: No shortfall, ' + readyVessels.length + ' vessels need ' + totalCO2Needed.toFixed(1) + 't, bunker has ' + bunker.co2.toFixed(1) + 't - skipping');
                return false;
            }

        // ========== BASIC MODE ONLY: Price above threshold ==========
        } else {
            console.log('[Auto-Buy] CO2: Price $' + co2Price + '/t > threshold $' + settings.co2PriceThreshold + '/t and intelligent disabled - skipping');
            return false;
        }

        if (amountToBuy <= 0) {
            console.log('[Auto-Buy] CO2: Cannot buy - insufficient funds or space');
            return false;
        }

        console.log('[Auto-Buy] CO2: ' + reason + ', buying ' + amountToBuy.toFixed(0) + 't @ $' + co2Price);
        var result = await purchaseCO2API(amountToBuy, co2Price);
        return result.success;
    }

    // ============================================
    // AUTO-DEPART LOGIC (API-based, like Cargo Marshal)
    // ============================================

    /**
     * Depart a single vessel - checks fuel BEFORE departing
     * Returns: { success, needsFuel, error }
     */
    async function departSingleVessel(vessel, bunker) {
        // Calculate fuel needed for this vessel
        var fuelNeeded = vessel.route_fuel_required || vessel.fuel_required;
        if (fuelNeeded) {
            // Add 2% buffer to game's fuel requirement
            fuelNeeded = fuelNeeded * 1.02;
        } else {
            var distance = vessel.route_distance;
            var speed = vessel.route_speed || vessel.max_speed;
            // calculateFuelConsumption already includes 2% buffer
            fuelNeeded = calculateFuelConsumption(vessel, distance, speed) * 1000;
        }
        fuelNeeded = fuelNeeded / 1000; // Convert to tons

        // Check if we have enough fuel
        if (bunker.fuel < fuelNeeded) {
            console.log('[Auto-Depart] Not enough fuel for ' + vessel.name + ': have ' + bunker.fuel.toFixed(0) + 't, need ' + fuelNeeded.toFixed(0) + 't');
            return { success: false, needsFuel: true, fuelShortfall: fuelNeeded - bunker.fuel };
        }

        // Depart via API
        var departSpeed = vessel.route_speed || vessel.max_speed;
        var result = await departVesselAPI(vessel.id, departSpeed, 0);

        if (result.success) {
            console.log('[Auto-Depart] Departed: ' + vessel.name + ' (' + vessel.route_origin + ' -> ' + vessel.route_destination + ') - Income: $' + result.income);
            return { success: true, income: result.income, fuelUsed: result.fuelUsed };
        }

        // Check error type
        var err = result.error || '';
        if (err.indexOf('fuel') !== -1 || err.indexOf('Fuel') !== -1 || err.indexOf('Not enough') !== -1) {
            return { success: false, needsFuel: true, error: err };
        }

        // Other error (vessel already departed, invalid status, etc.)
        console.log('[Auto-Depart] Failed: ' + vessel.name + ' - ' + err);
        return { success: false, needsFuel: false, error: err };
    }

    /**
     * Depart all ready vessels one by one
     * Stops when fuel runs out, returns status for rebuy loop
     */
    async function autoDepartVessels(settings) {
        if (!settings.autoDepartEnabled) return { departed: 0, needsFuel: false };

        var vessels = await getVesselsReadyToDepart();
        if (vessels.length === 0) {
            console.log('[Auto-Depart] No vessels ready to depart');
            return { departed: 0, needsFuel: false };
        }

        console.log('[Auto-Depart] ' + vessels.length + ' vessels ready to depart');

        var departed = 0;
        var totalIncome = 0;
        var needsFuel = false;

        for (var i = 0; i < vessels.length; i++) {
            var vessel = vessels[i];

            // Get fresh bunker data before each departure
            var bunker = await getBunkerData();
            if (!bunker) {
                console.log('[Auto-Depart] Could not get bunker data');
                break;
            }

            var result = await departSingleVessel(vessel, bunker);

            if (result.success) {
                departed++;
                totalIncome += result.income || 0;
                // Don't spam individual toasts, summary comes at end
            } else if (result.needsFuel) {
                needsFuel = true;
                console.log('[Auto-Depart] Stopping - need more fuel');
                break;
            }
            // Other errors: skip vessel, continue with next

            // Small delay between departures
            await new Promise(function(resolve) { setTimeout(resolve, 200); });
        }

        if (departed > 0) {
            console.log('[Auto-Depart] Departed ' + departed + ' vessels, total income: $' + totalIncome);

            // Show summary notification
            notify('Departed ' + departed + ' ships - Income: $' + Math.round(totalIncome), 'success', 'depart');

            // AVOID NEGATIVE CO2: After all departures, refill CO2 if negative
            if (settings.avoidNegativeCO2) {
                try {
                    var freshBunker = await fetchBunkerStateAPI();
                    if (freshBunker && freshBunker.co2 < 0) {
                        var co2Prices = await fetchPricesAPI();
                        if (co2Prices && co2Prices.co2Price > 0) {
                            var co2Needed = Math.ceil(Math.abs(freshBunker.co2)) + 1;
                            var co2Space = freshBunker.maxCO2 - freshBunker.co2;
                            var minCash = settings.co2MinCash;
                            var cashAvailable = Math.max(0, freshBunker.cash - minCash);
                            var maxAffordable = Math.floor(cashAvailable / co2Prices.co2Price);
                            var amountToBuy = Math.min(co2Needed, Math.floor(co2Space), maxAffordable);

                            if (amountToBuy > 0) {
                                console.log('[Auto-Depart] Avoid negative CO2: Bunker at ' + freshBunker.co2.toFixed(1) + 't, buying ' + amountToBuy + 't @ $' + co2Prices.co2Price + '/t');
                                await purchaseCO2API(amountToBuy, co2Prices.co2Price);
                            }
                        }
                    }
                } catch (co2Error) {
                    console.log('[Auto-Depart] Avoid negative CO2 failed:', co2Error.message);
                }
            }

            // Refresh UI data
            refreshGameData();
        }

        return { departed: departed, needsFuel: needsFuel, totalIncome: totalIncome };
    }

    /**
     * Refresh game data after departures (At Port list, map, etc.)
     */
    function refreshGameData() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) {
                console.log('[Auto-Depart] No Pinia, skipping UI refresh');
                return;
            }

            // Refresh vessel store (At Port list)
            var vesselStore = pinia._s.get('vessel');
            if (vesselStore && vesselStore.fetchUserVessels) {
                vesselStore.fetchUserVessels();
                console.log('[Auto-Depart] Refreshed vessel store');
            }

            // Refresh user store (cash, fuel, co2)
            var userStore = pinia._s.get('user');
            if (userStore && userStore.fetchUser) {
                userStore.fetchUser();
            }

            // Refresh port store
            var portStore = pinia._s.get('port');
            if (portStore && portStore.fetchPortData) {
                portStore.fetchPortData();
            }

            // Refresh overview store
            var overviewStore = pinia._s.get('overview');
            if (overviewStore && overviewStore.fetchOverviewData) {
                overviewStore.fetchOverviewData();
            }

            // Dispatch custom event for map updates
            window.dispatchEvent(new CustomEvent('rebelship-vessels-updated'));

        } catch (e) {
            console.log('[Auto-Depart] UI refresh error:', e.message);
        }
    }

    // ============================================
    // MAIN LOOP: BUY FIRST -> THEN DEPART -> REPEAT
    // ============================================
    var loopRunning = false;

    async function runBuyDepartLoop() {
        if (loopRunning) {
            console.log('[Auto-Loop] Already running, skipping');
            return;
        }

        loopRunning = true;
        var iteration = 0;
        var MAX_ITERATIONS = 50;

        try {
            var settings = loadSettings();

            // Check if anything is enabled
            if (settings.fuelMode === 'off' && settings.co2Mode === 'off' && !settings.autoDepartEnabled) {
                console.log('[Auto-Loop] All features disabled');
                return;
            }

            while (iteration < MAX_ITERATIONS) {
                iteration++;
                console.log('[Auto-Loop] === Iteration ' + iteration + ' ===');

                // STEP 1: Fetch current state
                var bunker = await getBunkerData();
                if (!bunker) {
                    console.log('[Auto-Loop] Could not get bunker data');
                    break;
                }

                var prices = await fetchPricesAPI();
                if (!prices) {
                    console.log('[Auto-Loop] Could not get prices');
                    break;
                }

                console.log('[Auto-Loop] Bunker: Fuel=' + bunker.fuel.toFixed(0) + 't, CO2=' + bunker.co2.toFixed(0) + 't, Cash=$' + bunker.cash);
                console.log('[Auto-Loop] Prices: Fuel=$' + prices.fuelPrice + ', CO2=$' + prices.co2Price);

                // STEP 2: BUY FUEL FIRST (before departing!)
                var boughtFuel = await autoRebuyFuel(bunker, prices, settings);
                if (boughtFuel) {
                    // Refresh bunker data after purchase
                    bunker = await getBunkerData();
                    if (!bunker) break;
                }

                // STEP 3: BUY CO2
                var boughtCO2 = await autoRebuyCO2(bunker, prices, settings);
                if (boughtCO2) {
                    bunker = await getBunkerData();
                    if (!bunker) break;
                }

                // STEP 4: DEPART VESSELS (one by one, stops when fuel runs out)
                if (!settings.autoDepartEnabled) {
                    console.log('[Auto-Loop] Auto-depart disabled, done');
                    break;
                }

                var departResult = await autoDepartVessels(settings);

                if (departResult.departed === 0 && !departResult.needsFuel) {
                    console.log('[Auto-Loop] No more vessels to depart');
                    break;
                }

                if (departResult.needsFuel) {
                    console.log('[Auto-Loop] Depart stopped due to fuel, will retry after rebuy');
                    // Continue loop to rebuy and retry
                }

                // Small delay before next iteration
                await new Promise(function(resolve) { setTimeout(resolve, 500); });
            }

            if (iteration >= MAX_ITERATIONS) {
                console.log('[Auto-Loop] Reached max iterations');
            }
        } catch (err) {
            console.error('[Auto-Loop] Error:', err);
        } finally {
            loopRunning = false;
            console.log('[Auto-Loop] Finished');
        }
    }

    // Expose for Android BackgroundScriptService
    window.rebelshipRunDepartLoop = runBuyDepartLoop;

    // ============================================
    // MONITORING INTERVAL
    // ============================================
    var monitoringInterval = null;

    function startMonitoring() {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }
        console.log('[Auto-Buy] Starting monitoring (interval: ' + CHECK_INTERVAL + 'ms)');
        monitoringInterval = setInterval(runBuyDepartLoop, CHECK_INTERVAL);
        runBuyDepartLoop();
    }

    function stopMonitoring() {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
            console.log('[Auto-Buy] Stopped monitoring');
        }
    }

    // ============================================
    // UI: REBELSHIP MENU (only in non-background mode)
    // ============================================
    var REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    // Fallback: Fixed position menu button (bottom right)
    function createFixedMenu() {
        var existing = document.getElementById('rebelship-menu-fixed');
        if (existing) return existing.querySelector('.rebelship-dropdown');

        var container = document.createElement('div');
        container.id = 'rebelship-menu-fixed';
        container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;';

        var btn = document.createElement('button');
        btn.innerHTML = REBELSHIP_LOGO;
        btn.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:48px;height:48px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:50%;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        btn.title = 'RebelShip Menu';

        var dropdown = document.createElement('div');
        dropdown.className = 'rebelship-dropdown';
        dropdown.style.cssText = 'display:none;position:absolute;bottom:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-bottom:8px;';

        container.appendChild(btn);
        container.appendChild(dropdown);
        document.body.appendChild(container);

        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', function(e) {
            if (!container.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        console.log('[Auto-Buy] Fixed menu created');
        return dropdown;
    }

    function getOrCreateMobileRow() {
        var existing = document.getElementById('rebel-mobile-row');
        if (existing) return existing;

        var row = document.createElement('div');
        row.id = 'rebel-mobile-row';
        row.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;display:flex !important;flex-wrap:nowrap !important;justify-content:space-between !important;align-items:center !important;gap:4px !important;background:#1a1a2e !important;padding:4px 6px !important;font-size:14px !important;z-index:9999 !important;';
        var leftSection = document.createElement('div'); leftSection.id = 'rebel-mobile-left'; leftSection.style.cssText = 'display:flex;align-items:center;gap:4px;'; row.appendChild(leftSection); var rightSection = document.createElement('div'); rightSection.id = 'rebel-mobile-right'; rightSection.style.cssText = 'display:flex;align-items:center;gap:4px;'; row.appendChild(rightSection); document.body.appendChild(row);

        var appContainer = document.querySelector('#app') || document.body.firstElementChild;
        if (appContainer) {
            appContainer.style.marginTop = '2px';
        }

        return row;
    }

    function getOrCreateRebelShipMenu() {
        // Check for existing menu (created by this or another script)
        var menu = document.getElementById('rebelship-menu');
        if (menu) {
            return menu.querySelector('.rebelship-dropdown');
        }
        var fixedMenu = document.getElementById('rebelship-menu-fixed');
        if (fixedMenu) {
            return fixedMenu.querySelector('.rebelship-dropdown');
        }

        if (isMobile) {
            var row = getOrCreateMobileRow();
            if (!row) return null;

            var container = document.createElement('div');
            container.id = 'rebelship-menu';
            container.style.cssText = 'position:relative;display:inline-block;;';

            var btn = document.createElement('button');
            btn.id = 'rebelship-menu-btn';
            btn.innerHTML = REBELSHIP_LOGO;
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:18px;height:18px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;';
            btn.title = 'RebelShip Menu';

            var dropdown = document.createElement('div');
            dropdown.className = 'rebelship-dropdown';
            dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

            container.appendChild(btn);
            container.appendChild(dropdown);

            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
            });

            document.addEventListener('click', function(e) {
                if (!container.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });

            var rightSection = document.getElementById('rebel-mobile-right'); if (rightSection) { rightSection.appendChild(container); } else { row.appendChild(container); }
            return dropdown;
        }

        var messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) {
            console.log('[Auto-Buy] No .messaging found, using fixed position fallback');
            return createFixedMenu();
        }

        var desktopContainer = document.createElement('div');
        desktopContainer.id = 'rebelship-menu';
        desktopContainer.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:4px !important;margin-left:auto;';

        var desktopBtn = document.createElement('button');
        desktopBtn.id = 'rebelship-menu-btn';
        desktopBtn.innerHTML = REBELSHIP_LOGO;
        desktopBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        desktopBtn.title = 'RebelShip Menu';

        var desktopDropdown = document.createElement('div');
        desktopDropdown.className = 'rebelship-dropdown';
        desktopDropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

        desktopContainer.appendChild(desktopBtn);
        desktopContainer.appendChild(desktopDropdown);

        desktopBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            desktopDropdown.style.display = desktopDropdown.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', function(e) {
            if (!desktopContainer.contains(e.target)) {
                desktopDropdown.style.display = 'none';
            }
        });

        if (messagingIcon.parentNode) {
            messagingIcon.parentNode.insertBefore(desktopContainer, messagingIcon);
        }

        return desktopDropdown;
    }

    function addMenuItem(label, onClick) {
        var dropdown = getOrCreateRebelShipMenu();
        if (!dropdown) {
            setTimeout(function() { addMenuItem(label, onClick); }, 1000);
            return null;
        }

        if (dropdown.querySelector('[data-rebelship-item="' + label + '"]')) {
            return dropdown.querySelector('[data-rebelship-item="' + label + '"]');
        }

        var item = document.createElement('div');
        item.dataset.rebelshipItem = label;
        item.style.cssText = 'position:relative;';

        var itemBtn = document.createElement('div');
        itemBtn.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:13px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
        itemBtn.innerHTML = '<span>' + label + '</span>';

        itemBtn.addEventListener('mouseenter', function() { itemBtn.style.background = '#374151'; });
        itemBtn.addEventListener('mouseleave', function() { itemBtn.style.background = 'transparent'; });

        if (onClick) {
            itemBtn.addEventListener('click', function() {
                dropdown.style.display = 'none';
                onClick();
            });
        }

        item.appendChild(itemBtn);
        dropdown.appendChild(item);
        return item;
    }

    // ============================================
    // SETTINGS MODAL (UI mode only)
    // ============================================
    var SETTINGS_CSS = '\
        .autobuy-settings { padding: 20px; color: #01125d; font-family: Lato, sans-serif; font-size: 16px; height: 100%; overflow-y: auto; }\
        .autobuy-settings .columns { display: flex; gap: 16px; }\
        .autobuy-settings .column { flex: 1; min-width: 0; }\
        .autobuy-settings h3 { margin: 0 0 8px 0; font-size: 16px; font-weight: 700; color: #01125d; border-bottom: 1px solid #d1d5db; padding-bottom: 6px; }\
        .autobuy-settings .mode-select { width: 100%; height: 2.5rem; padding: 0 1rem; border: 0; border-radius: 7px; background: #ebe9ea; color: #01125d; font-size: 16px; font-family: Lato, sans-serif; cursor: pointer; box-sizing: border-box; }\
        .autobuy-settings .section { background: rgba(1,18,93,0.03); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }\
        .autobuy-settings .setting-row { display: flex; flex-direction: column; align-items: stretch; margin-bottom: 8px; }\
        .autobuy-settings .setting-label { font-size: 14px; font-weight: 700; color: #01125d; margin-bottom: 4px; }\
        .autobuy-settings input[type="number"], .autobuy-settings input.cash-input { width: 100%; height: 2.5rem; padding: 0 1rem; border: 0; border-radius: 7px; background: #ebe9ea; color: #01125d; font-size: 16px; font-family: Lato, sans-serif; text-align: center; box-sizing: border-box; }\
        .autobuy-settings .setting-info { font-size: 12px; color: #626b90; margin-top: 4px; }\
        .autobuy-settings .section-title { font-size: 12px; font-weight: 600; color: #626b90; margin-bottom: 6px; text-transform: uppercase; }\
        .autobuy-settings .checkbox-label { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; color: #01125d; cursor: pointer; padding: 0; min-height: 28px; }\
        .autobuy-settings .checkbox-label input[type="checkbox"] { width: 18px; height: 18px; accent-color: #0db8f4; cursor: pointer; }\
        .autobuy-settings .price-box { background: rgba(13,184,244,0.1); border: 1px solid rgba(13,184,244,0.3); border-radius: 8px; padding: 10px; margin-bottom: 12px; display: flex; justify-content: space-around; }\
        .autobuy-settings .price-item { text-align: center; }\
        .autobuy-settings .price-label { font-size: 12px; color: #626b90; font-weight: 600; }\
        .autobuy-settings .price-value { font-size: 18px; font-weight: 700; color: #01125d; }\
        #modal-container.autobuy-mode #bottom-controls, #modal-container.autobuy-mode #bottom-nav, #modal-container.autobuy-mode #top-nav { display: none !important; }\
    ';

    function getFuelColor(price) {
        if (price > 750) return '#ef4444';
        if (price >= 650) return '#fbbf24';
        if (price >= 500) return '#60a5fa';
        return '#4ade80';
    }

    function getCO2Color(price) {
        if (price >= 20) return '#ef4444';
        if (price >= 15) return '#fbbf24';
        if (price >= 10) return '#60a5fa';
        return '#4ade80';
    }

    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '';
        return Number(num).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    function parseFormattedNumber(str) {
        if (!str) return 0;
        return parseInt(str.replace(/,/g, ''), 10) || 0;
    }

    var titleObserver = null;
    var MODAL_TITLE = 'Auto Bunker & Depart Settings';

    function openSettingsModal() {
        var modalStore = getModalStore();
        if (!modalStore) {
            console.error('[Auto-Buy] modalStore not found');
            return;
        }

        if (titleObserver) {
            titleObserver.disconnect();
            titleObserver = null;
        }

        var settings = loadSettings();
        modalStore.open('routeResearch');

        setTimeout(function() {
            if (modalStore.modalSettings) {
                modalStore.modalSettings.title = MODAL_TITLE;
                modalStore.modalSettings.navigation = [];
                modalStore.modalSettings.controls = [];
            }

            var modalContainer = document.getElementById('modal-container');
            if (modalContainer) {
                modalContainer.classList.add('autobuy-mode');
            }

            var centralContainer = document.getElementById('central-container');
            if (!centralContainer) return;

            centralContainer.innerHTML = '\
                <div class="autobuy-settings">\
                    <div class="price-box">\
                        <div class="price-item"><div class="price-label">FUEL</div><div class="price-value" id="autobuy-fuel-price">...</div></div>\
                        <div class="price-item"><div class="price-label">CO2</div><div class="price-value" id="autobuy-co2-price">...</div></div>\
                    </div>\
                    <div class="columns">\
                        <div class="column">\
                            <h3>Fuel Auto-Rebuy</h3>\
                            <div class="section">\
                                <div class="setting-row"><label class="checkbox-label"><input type="checkbox" id="ab-fuel-enabled" ' + (settings.fuelMode !== 'off' ? 'checked' : '') + '><span>Basic Mode</span></label></div>\
                                <div id="fuel-settings-container">\
                                    <div class="setting-row"><span class="setting-label">Price Threshold</span><input type="number" id="ab-fuel-threshold" value="' + settings.fuelPriceThreshold + '" min="1"></div>\
                                    <div class="setting-row"><span class="setting-label">Min Cash to Keep</span><input type="text" id="ab-fuel-mincash" class="cash-input" value="' + formatNumber(settings.fuelMinCash) + '"></div>\
                                    <div class="setting-row" style="margin-top:8px"><label class="checkbox-label"><input type="checkbox" id="ab-fuel-intel-enabled" ' + (settings.fuelMode === 'intelligent' ? 'checked' : '') + '><span>+ Intelligent Mode</span></label></div>\
                                    <div class="section" id="fuel-intelligent-section"><div class="section-title">Intelligent Settings (buy shortfall only)</div>\
                                        <div class="setting-row"><span class="setting-label">Max Price</span><input type="number" id="ab-fuel-intel-max" value="' + settings.fuelIntelligentMaxPrice + '" min="1"></div>\
                                        <div class="setting-row"><label class="checkbox-label"><input type="checkbox" id="ab-fuel-intel-below-enabled" ' + (settings.fuelIntelligentBelowEnabled ? 'checked' : '') + '><span>Only if bunker below (t)</span></label></div>\
                                        <div class="setting-row"><input type="number" id="ab-fuel-intel-below" value="' + settings.fuelIntelligentBelow + '" min="0"></div>\
                                        <div class="setting-row"><label class="checkbox-label"><input type="checkbox" id="ab-fuel-intel-ships-enabled" ' + (settings.fuelIntelligentShipsEnabled ? 'checked' : '') + '><span>Only if ships at port</span></label></div>\
                                        <div class="setting-row"><input type="number" id="ab-fuel-intel-ships" value="' + settings.fuelIntelligentShips + '" min="1"></div>\
                                    </div>\
                                </div>\
                            </div>\
                        </div>\
                        <div class="column">\
                            <h3>CO2 Auto-Rebuy</h3>\
                            <div class="section">\
                                <div class="setting-row"><label class="checkbox-label"><input type="checkbox" id="ab-co2-enabled" ' + (settings.co2Mode !== 'off' ? 'checked' : '') + '><span>Basic Mode</span></label></div>\
                                <div id="co2-settings-container">\
                                    <div class="setting-row"><span class="setting-label">Price Threshold</span><input type="number" id="ab-co2-threshold" value="' + settings.co2PriceThreshold + '" min="1"></div>\
                                    <div class="setting-row"><span class="setting-label">Min Cash to Keep</span><input type="text" id="ab-co2-mincash" class="cash-input" value="' + formatNumber(settings.co2MinCash) + '"></div>\
                                    <div class="setting-row" style="margin-top:8px"><label class="checkbox-label"><input type="checkbox" id="ab-co2-intel-enabled" ' + (settings.co2Mode === 'intelligent' ? 'checked' : '') + '><span>+ Intelligent Mode</span></label></div>\
                                    <div class="section" id="co2-intelligent-section"><div class="section-title">Intelligent Settings (buy shortfall only)</div>\
                                        <div class="setting-row"><span class="setting-label">Max Price</span><input type="number" id="ab-co2-intel-max" value="' + settings.co2IntelligentMaxPrice + '" min="1"></div>\
                                        <div class="setting-row"><label class="checkbox-label"><input type="checkbox" id="ab-co2-intel-below-enabled" ' + (settings.co2IntelligentBelowEnabled ? 'checked' : '') + '><span>Only if bunker below (t)</span></label></div>\
                                        <div class="setting-row"><input type="number" id="ab-co2-intel-below" value="' + settings.co2IntelligentBelow + '" min="0"></div>\
                                        <div class="setting-row"><label class="checkbox-label"><input type="checkbox" id="ab-co2-intel-ships-enabled" ' + (settings.co2IntelligentShipsEnabled ? 'checked' : '') + '><span>Only if ships at port</span></label></div>\
                                        <div class="setting-row"><input type="number" id="ab-co2-intel-ships" value="' + settings.co2IntelligentShips + '" min="1"></div>\
                                    </div>\
                                    <div class="setting-row" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(34,197,94,0.2)"><label class="checkbox-label"><input type="checkbox" id="ab-avoid-negative-co2" ' + (settings.avoidNegativeCO2 ? 'checked' : '') + '><span>Avoid negative CO2 (refill after departures)</span></label></div>\
                                </div>\
                            </div>\
                        </div>\
                    </div>\
                    <div class="section"><div class="setting-row"><label class="checkbox-label"><input type="checkbox" id="ab-auto-depart" ' + (settings.autoDepartEnabled ? 'checked' : '') + '><span>Auto-Depart (depart all ships in port)</span></label></div></div>\
                    <div class="section"><div class="setting-row"><label class="checkbox-label"><input type="checkbox" id="ab-system-notifications" ' + (settings.systemNotifications ? 'checked' : '') + '><span>System Notifications (push notifications for actions)</span></label></div></div>\
                </div>';

            function updateSectionVisibility() {
                var fuelEnabled = document.getElementById('ab-fuel-enabled');
                var fuelContainer = document.getElementById('fuel-settings-container');
                if (fuelContainer) fuelContainer.style.display = fuelEnabled && fuelEnabled.checked ? 'block' : 'none';

                var fuelIntelEnabled = document.getElementById('ab-fuel-intel-enabled');
                var fuelIntelligent = document.getElementById('fuel-intelligent-section');
                if (fuelIntelligent) fuelIntelligent.style.display = fuelIntelEnabled && fuelIntelEnabled.checked ? 'block' : 'none';

                var co2Enabled = document.getElementById('ab-co2-enabled');
                var co2Container = document.getElementById('co2-settings-container');
                if (co2Container) co2Container.style.display = co2Enabled && co2Enabled.checked ? 'block' : 'none';

                var co2IntelEnabled = document.getElementById('ab-co2-intel-enabled');
                var co2Intelligent = document.getElementById('co2-intelligent-section');
                if (co2Intelligent) co2Intelligent.style.display = co2IntelEnabled && co2IntelEnabled.checked ? 'block' : 'none';
            }

            updateSectionVisibility();

            function autoSave() {
                updateSectionVisibility();

                var fuelEnabled = document.getElementById('ab-fuel-enabled');
                var fuelIntelEnabled = document.getElementById('ab-fuel-intel-enabled');
                var fuelMode = fuelEnabled && fuelEnabled.checked ? (fuelIntelEnabled && fuelIntelEnabled.checked ? 'intelligent' : 'basic') : 'off';

                var co2Enabled = document.getElementById('ab-co2-enabled');
                var co2IntelEnabled = document.getElementById('ab-co2-intel-enabled');
                var co2Mode = co2Enabled && co2Enabled.checked ? (co2IntelEnabled && co2IntelEnabled.checked ? 'intelligent' : 'basic') : 'off';

                var newSettings = {
                    fuelMode: fuelMode,
                    fuelPriceThreshold: parseInt(document.getElementById('ab-fuel-threshold').value) || DEFAULT_SETTINGS.fuelPriceThreshold,
                    fuelMinCash: parseFormattedNumber(document.getElementById('ab-fuel-mincash').value) || DEFAULT_SETTINGS.fuelMinCash,
                    fuelIntelligentMaxPrice: parseInt(document.getElementById('ab-fuel-intel-max').value) || DEFAULT_SETTINGS.fuelIntelligentMaxPrice,
                    fuelIntelligentBelowEnabled: document.getElementById('ab-fuel-intel-below-enabled') && document.getElementById('ab-fuel-intel-below-enabled').checked,
                    fuelIntelligentBelow: parseInt(document.getElementById('ab-fuel-intel-below').value) || DEFAULT_SETTINGS.fuelIntelligentBelow,
                    fuelIntelligentShipsEnabled: document.getElementById('ab-fuel-intel-ships-enabled') && document.getElementById('ab-fuel-intel-ships-enabled').checked,
                    fuelIntelligentShips: parseInt(document.getElementById('ab-fuel-intel-ships').value) || DEFAULT_SETTINGS.fuelIntelligentShips,
                    co2Mode: co2Mode,
                    co2PriceThreshold: parseInt(document.getElementById('ab-co2-threshold').value) || DEFAULT_SETTINGS.co2PriceThreshold,
                    co2MinCash: parseFormattedNumber(document.getElementById('ab-co2-mincash').value) || DEFAULT_SETTINGS.co2MinCash,
                    co2IntelligentMaxPrice: parseInt(document.getElementById('ab-co2-intel-max').value) || DEFAULT_SETTINGS.co2IntelligentMaxPrice,
                    co2IntelligentBelowEnabled: document.getElementById('ab-co2-intel-below-enabled') && document.getElementById('ab-co2-intel-below-enabled').checked,
                    co2IntelligentBelow: parseInt(document.getElementById('ab-co2-intel-below').value) || DEFAULT_SETTINGS.co2IntelligentBelow,
                    co2IntelligentShipsEnabled: document.getElementById('ab-co2-intel-ships-enabled') && document.getElementById('ab-co2-intel-ships-enabled').checked,
                    co2IntelligentShips: parseInt(document.getElementById('ab-co2-intel-ships').value) || DEFAULT_SETTINGS.co2IntelligentShips,
                    avoidNegativeCO2: document.getElementById('ab-avoid-negative-co2') && document.getElementById('ab-avoid-negative-co2').checked,
                    autoDepartEnabled: document.getElementById('ab-auto-depart') && document.getElementById('ab-auto-depart').checked,
                    systemNotifications: document.getElementById('ab-system-notifications') && document.getElementById('ab-system-notifications').checked
                };

                saveSettings(newSettings);

                if (newSettings.fuelMode !== 'off' || newSettings.co2Mode !== 'off' || newSettings.autoDepartEnabled) {
                    startMonitoring();
                } else {
                    stopMonitoring();
                }
            }

            var allInputs = centralContainer.querySelectorAll('input, select');
            for (var i = 0; i < allInputs.length; i++) {
                allInputs[i].addEventListener('change', autoSave);
            }

            // Fetch and display prices
            fetchPricesAPI().then(function(prices) {
                var fuelPriceEl = document.getElementById('autobuy-fuel-price');
                var co2PriceEl = document.getElementById('autobuy-co2-price');
                if (prices) {
                    if (fuelPriceEl && prices.fuelPrice !== null) {
                        fuelPriceEl.textContent = '$' + prices.fuelPrice;
                        fuelPriceEl.style.color = getFuelColor(prices.fuelPrice);
                    }
                    if (co2PriceEl && prices.co2Price !== null) {
                        co2PriceEl.textContent = '$' + prices.co2Price;
                        co2PriceEl.style.color = getCO2Color(prices.co2Price);
                    }
                }
            });

        }, 150);
    }

    // ============================================
    // INITIALIZATION
    // ============================================
    function requestNotificationPermission() {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().then(function(permission) {
                console.log('[Auto-Buy] Notification permission:', permission);
            });
        }
    }

    var uiInitialized = false;
    var uiRetryCount = 0;
    var MAX_UI_RETRIES = 30; // Try for 30 seconds

    function initUI() {
        if (uiInitialized) return;

        // Check if page is ready (has #app and .messaging)
        var hasApp = document.getElementById('app');
        var hasMessaging = document.querySelector('.messaging');

        console.log('[Auto-Buy] initUI check - #app:', !!hasApp, '.messaging:', !!hasMessaging, 'retry:', uiRetryCount);

        if (!hasApp || !hasMessaging) {
            uiRetryCount++;
            if (uiRetryCount < MAX_UI_RETRIES) {
                setTimeout(initUI, 1000);
                return;
            }
            console.log('[Auto-Buy] Max retries reached, page might be in background mode');
            return;
        }

        // Page is ready, add UI
        uiInitialized = true;

        // Inject CSS
        var style = document.createElement('style');
        style.textContent = SETTINGS_CSS;
        document.head.appendChild(style);

        // Add menu item
        addMenuItem(SCRIPT_NAME, openSettingsModal);
        console.log('[Auto-Buy] Menu item added successfully');
    }

    function init() {
        console.log('[Auto-Buy] Initializing v10.0...');

        // Request notification permission early
        requestNotificationPermission();

        // Start UI initialization with retry
        initUI();

        // Start monitoring based on settings
        var settings = loadSettings();
        syncSettingsToAndroid(settings);

        if (settings.fuelMode !== 'off' || settings.co2Mode !== 'off' || settings.autoDepartEnabled) {
            setTimeout(startMonitoring, 5000);
        }
    }

    // Wait for page ready - always wait 2s for Vue to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 2000);
        });
    } else {
        setTimeout(init, 2000);
    }
})();
