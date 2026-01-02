// ==UserScript==
// @name         ShippingManager - Auto Bunker & Depart
// @namespace    http://tampermonkey.net/
// @version      7.8
// @description  Auto-buy fuel/CO2 and auto-depart vessels - works in background mode via direct API
// @author       https://github.com/justonlyforyou/
// @order        20
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// @background-job-required true
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_NAME = 'Auto Bunker & Depart';
    const STORAGE_KEY = 'rebelship_autobuy_settings';
    const CHECK_INTERVAL = 10000;
    const API_BASE = 'https://shippingmanager.cc/api';

    const DEFAULT_SETTINGS = {
        fuelMode: 'off',
        fuelPriceThreshold: 500,
        fuelMinCash: 1000000,
        fuelIntelligentMaxPrice: 500,
        fuelEmergencyBelow: 500,
        fuelEmergencyShips: 5,
        fuelEmergencyMaxPrice: 600,
        co2Mode: 'off',
        co2PriceThreshold: 10,
        co2MinCash: 1000000,
        co2IntelligentMaxPrice: 10,
        co2EmergencyBelow: 500,
        co2EmergencyShips: 5,
        co2EmergencyMaxPrice: 12,
        autoDepartEnabled: false
    };

    const isMobile = window.innerWidth < 1024;
    const isAndroidApp = typeof window.RebelShipBridge !== 'undefined';

    // Check background mode dynamically (not at load time)
    function isBackgroundMode() {
        return !document.getElementById('app') || !document.querySelector('.messaging');
    }

    console.log('[Auto-Buy] v7.7 - Android:', isAndroidApp);

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
        } catch (e) {
            return null;
        }
    }

    function getVesselStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('vessel');
        } catch (e) {
            return null;
        }
    }

    function getModalStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('modal');
        } catch (e) {
            return null;
        }
    }

    function getToastStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('toast');
        } catch (e) {
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

        // 2. Android bridge notification
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
                console.log('[Auto-Buy] Android notification sent');
            } catch (e) {
                console.log('[Auto-Buy] Android notification failed:', e.message);
            }
        }

        // 3. Web Notification API (desktop/system)
        showSystemNotification(message, type);
    }

    // Legacy wrapper for compatibility
    function showToast(message, type) {
        notify(message, type, 'general');
    }

    /**
     * Show system notification via Web Notification API
     */
    function showSystemNotification(message, type) {
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
            var n = new Notification('Auto Bunker & Depart', {
                body: message,
                tag: tag,
                requireInteraction: false
            });
            console.log('[Auto-Buy] System notification created');
        } catch (e) {
            console.log('[Auto-Buy] System notification failed:', e.message);
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
    // VESSEL CALCULATIONS
    // ============================================
    function getVesselCapacity(vessel) {
        if (!vessel || !vessel.capacity_max) return 0;
        var cap = vessel.capacity_max;
        if (vessel.capacity_type === 'tanker') {
            return ((cap.fuel || 0) + (cap.crude_oil || 0)) / 74;
        }
        return (cap.dry || 0) + (cap.refrigerated || 0);
    }

    function calculateFuelConsumption(vessel, distance, speed) {
        var capacity = getVesselCapacity(vessel);
        if (capacity <= 0 || distance <= 0 || speed <= 0) return 0;
        var fuelFactor = vessel.fuel_factor || 1;
        var fuelKg = (capacity / 2000) * distance * Math.sqrt(speed) / 20 * fuelFactor;
        return fuelKg / 1000;
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

    async function getVesselsAtPortCount() {
        var vesselStore = getVesselStore();
        if (vesselStore && vesselStore.userVessels) {
            return vesselStore.userVessels.filter(function(v) {
                return v.status === 'port';
            }).length;
        }

        var vessels = await fetchVesselsAPI();
        return vessels.filter(function(v) {
            return v.status === 'port';
        }).length;
    }

    async function calculateTotalFuelNeeded() {
        var vessels = await getVesselsReadyToDepart();
        var totalFuel = 0;
        for (var i = 0; i < vessels.length; i++) {
            var vessel = vessels[i];
            var distance = vessel.route_distance;
            var speed = vessel.route_speed || vessel.max_speed;
            var fuelNeeded = vessel.route_fuel_required || vessel.fuel_required;
            if (!fuelNeeded) {
                fuelNeeded = calculateFuelConsumption(vessel, distance, speed) * 1000;
            }
            totalFuel += fuelNeeded || 0;
        }
        return totalFuel / 1000;
    }

    // ============================================
    // AUTO-REBUY LOGIC (API-based)
    // ============================================
    async function autoRebuyFuel(bunker, prices, settings) {
        if (settings.fuelMode === 'off') return false;

        var fuelPrice = prices.fuelPrice;
        if (!fuelPrice) return false;

        var fuelSpace = bunker.maxFuel - bunker.fuel;
        var availableCash = Math.max(0, bunker.cash - settings.fuelMinCash);
        var amountToBuy = 0;
        var reason = '';

        // BASIC: buy when price <= threshold
        if (fuelPrice <= settings.fuelPriceThreshold) {
            var maxAffordable = Math.floor(availableCash / fuelPrice);
            amountToBuy = Math.min(fuelSpace, maxAffordable);
            reason = 'Basic: price $' + fuelPrice + ' <= $' + settings.fuelPriceThreshold;
        }

        // INTELLIGENT: buy based on vessel needs
        if (amountToBuy === 0 && settings.fuelMode === 'intelligent') {
            if (fuelPrice <= settings.fuelIntelligentMaxPrice) {
                var fuelNeeded = await calculateTotalFuelNeeded();
                var shortfall = Math.ceil(fuelNeeded - bunker.fuel);
                if (shortfall > 0) {
                    var maxAfford = Math.floor(availableCash / fuelPrice);
                    amountToBuy = Math.min(shortfall, fuelSpace, maxAfford);
                    reason = 'Intelligent: shortfall ' + shortfall + 't';
                }
            }
        }

        // EMERGENCY: buy when bunker critically low
        if (amountToBuy === 0 && settings.fuelMode === 'emergency') {
            var shipsAtPort = await getVesselsAtPortCount();
            console.log('[Auto-Buy] EMERGENCY CHECK - Fuel: ' + bunker.fuel + 't, Threshold: ' + settings.fuelEmergencyBelow + 't, Ships: ' + shipsAtPort);
            if (bunker.fuel <= settings.fuelEmergencyBelow &&
                shipsAtPort >= settings.fuelEmergencyShips &&
                fuelPrice <= settings.fuelEmergencyMaxPrice) {
                var maxAffordEmerg = Math.floor(availableCash / fuelPrice);
                amountToBuy = Math.min(fuelSpace, maxAffordEmerg);
                reason = 'EMERGENCY: bunker ' + bunker.fuel.toFixed(0) + 't <= ' + settings.fuelEmergencyBelow + 't';
            }
        }

        if (amountToBuy > 0) {
            console.log('[Auto-Buy] Fuel: ' + reason + ', buying ' + amountToBuy.toFixed(0) + 't @ $' + fuelPrice);
            var result = await purchaseFuelAPI(amountToBuy, fuelPrice);
            return result.success;
        }

        return false;
    }

    async function autoRebuyCO2(bunker, prices, settings) {
        if (settings.co2Mode === 'off') return false;

        var co2Price = prices.co2Price;
        if (!co2Price) return false;

        var co2Space = bunker.maxCO2 - bunker.co2;
        var availableCash = Math.max(0, bunker.cash - settings.co2MinCash);
        var amountToBuy = 0;
        var reason = '';

        // BASIC
        if (co2Price <= settings.co2PriceThreshold) {
            var maxAffordable = Math.floor(availableCash / co2Price);
            amountToBuy = Math.min(co2Space, maxAffordable);
            reason = 'Basic: price $' + co2Price + ' <= $' + settings.co2PriceThreshold;
        }

        // INTELLIGENT
        if (amountToBuy === 0 && settings.co2Mode === 'intelligent') {
            if (co2Price <= settings.co2IntelligentMaxPrice && co2Space > 0) {
                var maxAfford = Math.floor(availableCash / co2Price);
                amountToBuy = Math.min(co2Space, maxAfford);
                reason = 'Intelligent: refilling';
            }
        }

        // EMERGENCY
        if (amountToBuy === 0 && settings.co2Mode === 'emergency') {
            var shipsAtPort = await getVesselsAtPortCount();
            if (bunker.co2 <= settings.co2EmergencyBelow &&
                shipsAtPort >= settings.co2EmergencyShips &&
                co2Price <= settings.co2EmergencyMaxPrice) {
                var maxAffordEmerg = Math.floor(availableCash / co2Price);
                amountToBuy = Math.min(co2Space, maxAffordEmerg);
                reason = 'EMERGENCY: bunker ' + bunker.co2.toFixed(0) + 't <= ' + settings.co2EmergencyBelow + 't';
            }
        }

        if (amountToBuy > 0) {
            console.log('[Auto-Buy] CO2: ' + reason + ', buying ' + amountToBuy.toFixed(0) + 't @ $' + co2Price);
            var result = await purchaseCO2API(amountToBuy, co2Price);
            return result.success;
        }

        return false;
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
        if (!fuelNeeded) {
            var distance = vessel.route_distance;
            var speed = vessel.route_speed || vessel.max_speed;
            fuelNeeded = calculateFuelConsumption(vessel, distance, speed) * 1000;
        }
        fuelNeeded = fuelNeeded / 1000; // Convert to tons

        // Check if we have enough fuel
        if (bunker.fuel < fuelNeeded) {
            console.log('[Auto-Depart] Not enough fuel for ' + vessel.name + ': have ' + bunker.fuel.toFixed(0) + 't, need ' + fuelNeeded.toFixed(0) + 't');
            return { success: false, needsFuel: true, fuelShortfall: fuelNeeded - bunker.fuel };
        }

        // Depart via API
        var speed = vessel.route_speed || vessel.max_speed;
        var result = await departVesselAPI(vessel.id, speed, 0);

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

                // STEP 4: CHECK FUEL THRESHOLD BEFORE DEPARTING
                // Only depart if we have enough fuel in bunker
                var readyVessels = await getVesselsReadyToDepart();
                if (readyVessels.length > 0 && settings.autoDepartEnabled) {
                    var totalFuelNeeded = await calculateTotalFuelNeeded();
                    if (bunker.fuel < totalFuelNeeded) {
                        console.log('[Auto-Loop] Not enough fuel! Have: ' + bunker.fuel.toFixed(0) + 't, Need: ' + totalFuelNeeded.toFixed(0) + 't');

                        // Try emergency buy if fuel mode is enabled
                        if (settings.fuelMode !== 'off') {
                            console.log('[Auto-Loop] Attempting emergency fuel buy...');
                            var emergencyBuy = await purchaseFuelAPI(Math.min(bunker.maxFuel - bunker.fuel, totalFuelNeeded - bunker.fuel + 100), prices.fuelPrice);
                            if (!emergencyBuy.success) {
                                console.log('[Auto-Loop] Cannot buy fuel, stopping');
                                showToast('Auto-depart stopped: not enough fuel', 'error');
                                break;
                            }
                            bunker = await getBunkerData();
                            if (!bunker) break;
                        } else {
                            console.log('[Auto-Loop] Fuel mode off, cannot buy');
                            break;
                        }
                    }
                }

                // STEP 5: DEPART VESSELS
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
    var REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    function getOrCreateMobileRow() {
        var existing = document.getElementById('rebel-mobile-row');
        if (existing) return existing;

        var row = document.createElement('div');
        row.id = 'rebel-mobile-row';
        row.style.cssText = 'position:fixed;top:0;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:10px;background:#1a1a2e;padding:4px 6px;font-size:14px;z-index:9999;';
        document.body.appendChild(row);

        var appContainer = document.querySelector('#app') || document.body.firstElementChild;
        if (appContainer) {
            appContainer.style.marginTop = '2px';
        }

        return row;
    }

    function getOrCreateRebelShipMenu() {
        var menu = document.getElementById('rebelship-menu');
        if (menu) {
            return menu.querySelector('.rebelship-dropdown');
        }

        if (isMobile) {
            var row = getOrCreateMobileRow();
            if (!row) return null;

            var container = document.createElement('div');
            container.id = 'rebelship-menu';
            container.style.cssText = 'position:relative;display:inline-block;margin-left:auto;';

            var btn = document.createElement('button');
            btn.id = 'rebelship-menu-btn';
            btn.innerHTML = REBELSHIP_LOGO;
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:18px;height:18px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;';
            btn.title = 'RebelShip Menu';

            var dropdown = document.createElement('div');
            dropdown.className = 'rebelship-dropdown';
            dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

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

            row.appendChild(container);
            return dropdown;
        }

        var messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) return null;

        var container = document.createElement('div');
        container.id = 'rebelship-menu';
        container.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:10px;margin-left:auto;';

        var btn = document.createElement('button');
        btn.id = 'rebelship-menu-btn';
        btn.innerHTML = REBELSHIP_LOGO;
        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        btn.title = 'RebelShip Menu';

        var dropdown = document.createElement('div');
        dropdown.className = 'rebelship-dropdown';
        dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

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

        if (messagingIcon.parentNode) {
            messagingIcon.parentNode.insertBefore(container, messagingIcon);
        }

        return dropdown;
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
        .autobuy-settings { padding: 8px 8px 20px 8px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 16px; height: 100%; overflow-y: auto; }\
        .autobuy-settings .columns { display: flex; gap: 12px; }\
        .autobuy-settings .column { flex: 1; min-width: 0; }\
        .autobuy-settings h3 { margin: 0 0 2px 0; font-size: 16px; font-weight: 600; color: #93c5fd; border-bottom: 1px solid #4b5563; padding-bottom: 2px; }\
        .autobuy-settings .mode-select { width: 100%; padding: 8px; border: 1px solid #4b5563; border-radius: 4px; background: #1f2937; color: #fff; font-size: 16px; cursor: pointer; box-sizing: border-box; }\
        .autobuy-settings .section { background: rgba(255,255,255,0.05); border-radius: 6px; padding: 4px 8px; margin-bottom: 2px; }\
        .autobuy-settings .setting-row { display: flex; flex-direction: column; align-items: stretch; margin-bottom: 4px; }\
        .autobuy-settings .setting-label { font-size: 13px; color: #9ca3af; margin-bottom: 2px; }\
        .autobuy-settings input[type="number"], .autobuy-settings input.cash-input { width: 100%; padding: 6px 8px; border: 1px solid #4b5563; border-radius: 4px; background: #1f2937; color: #fff; font-size: 15px; text-align: right; box-sizing: border-box; }\
        .autobuy-settings .setting-info { font-size: 12px; color: #9ca3af; margin-top: 2px; font-style: italic; }\
        .autobuy-settings .section-title { font-size: 12px; font-weight: 600; color: #d1d5db; margin-bottom: 2px; text-transform: uppercase; }\
        .autobuy-settings .checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: bold; color: #f3f4f6; cursor: pointer; padding: 0; min-height: 26px; }\
        .autobuy-settings .checkbox-label input[type="checkbox"] { width: 18px; height: 18px; accent-color: #22c55e; cursor: pointer; }\
        .autobuy-settings .price-box { background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 4px; padding: 4px; margin-bottom: 4px; display: flex; justify-content: space-around; }\
        .autobuy-settings .price-item { text-align: center; }\
        .autobuy-settings .price-label { font-size: 12px; color: #d1d5db; }\
        .autobuy-settings .price-value { font-size: 16px; font-weight: 600; color: #fff; }\
        #modal-container.autobuy-mode, #modal-container.autobuy-mode #modal-content, #modal-container.autobuy-mode #central-container { background: #1e2235 !important; }\
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
                                    <div class="setting-row" style="margin-top:8px"><span class="setting-label">Additional Mode</span>\
                                        <select id="ab-fuel-addmode" class="mode-select">\
                                            <option value="off" ' + (settings.fuelMode === 'basic' || settings.fuelMode === 'off' ? 'selected' : '') + '>OFF</option>\
                                            <option value="emergency" ' + (settings.fuelMode === 'emergency' ? 'selected' : '') + '>Emergency</option>\
                                            <option value="intelligent" ' + (settings.fuelMode === 'intelligent' ? 'selected' : '') + '>Intelligent</option>\
                                        </select>\
                                    </div>\
                                    <div class="section" id="fuel-intelligent-section"><div class="section-title">+ Intelligent Settings</div>\
                                        <div class="setting-row"><span class="setting-label">Max Price</span><input type="number" id="ab-fuel-intel-max" value="' + settings.fuelIntelligentMaxPrice + '" min="1"></div>\
                                    </div>\
                                    <div class="section" id="fuel-emergency-section"><div class="section-title">+ Emergency Settings</div>\
                                        <div class="setting-row"><span class="setting-label">Below (t)</span><input type="number" id="ab-fuel-emerg-below" value="' + settings.fuelEmergencyBelow + '" min="0"></div>\
                                        <div class="setting-row"><span class="setting-label">Ships at Port</span><input type="number" id="ab-fuel-emerg-ships" value="' + settings.fuelEmergencyShips + '" min="1"></div>\
                                        <div class="setting-row"><span class="setting-label">Max Price</span><input type="number" id="ab-fuel-emerg-max" value="' + settings.fuelEmergencyMaxPrice + '" min="1"></div>\
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
                                    <div class="setting-row" style="margin-top:8px"><span class="setting-label">Additional Mode</span>\
                                        <select id="ab-co2-addmode" class="mode-select">\
                                            <option value="off" ' + (settings.co2Mode === 'basic' || settings.co2Mode === 'off' ? 'selected' : '') + '>OFF</option>\
                                            <option value="emergency" ' + (settings.co2Mode === 'emergency' ? 'selected' : '') + '>Emergency</option>\
                                            <option value="intelligent" ' + (settings.co2Mode === 'intelligent' ? 'selected' : '') + '>Intelligent</option>\
                                        </select>\
                                    </div>\
                                    <div class="section" id="co2-intelligent-section"><div class="section-title">+ Intelligent Settings</div>\
                                        <div class="setting-row"><span class="setting-label">Max Price</span><input type="number" id="ab-co2-intel-max" value="' + settings.co2IntelligentMaxPrice + '" min="1"></div>\
                                    </div>\
                                    <div class="section" id="co2-emergency-section"><div class="section-title">+ Emergency Settings</div>\
                                        <div class="setting-row"><span class="setting-label">Below (t)</span><input type="number" id="ab-co2-emerg-below" value="' + settings.co2EmergencyBelow + '" min="0"></div>\
                                        <div class="setting-row"><span class="setting-label">Ships at Port</span><input type="number" id="ab-co2-emerg-ships" value="' + settings.co2EmergencyShips + '" min="1"></div>\
                                        <div class="setting-row"><span class="setting-label">Max Price</span><input type="number" id="ab-co2-emerg-max" value="' + settings.co2EmergencyMaxPrice + '" min="1"></div>\
                                    </div>\
                                </div>\
                            </div>\
                        </div>\
                    </div>\
                    <div class="section"><div class="setting-row"><label class="checkbox-label"><input type="checkbox" id="ab-auto-depart" ' + (settings.autoDepartEnabled ? 'checked' : '') + '><span>Auto-Depart (depart all ships in port)</span></label></div></div>\
                </div>';

            function updateSectionVisibility() {
                var fuelEnabled = document.getElementById('ab-fuel-enabled');
                var fuelContainer = document.getElementById('fuel-settings-container');
                if (fuelContainer) fuelContainer.style.display = fuelEnabled && fuelEnabled.checked ? 'block' : 'none';

                var fuelAddMode = document.getElementById('ab-fuel-addmode');
                var fuelIntelligent = document.getElementById('fuel-intelligent-section');
                var fuelEmergency = document.getElementById('fuel-emergency-section');
                if (fuelIntelligent) fuelIntelligent.style.display = fuelAddMode && fuelAddMode.value === 'intelligent' ? 'block' : 'none';
                if (fuelEmergency) fuelEmergency.style.display = fuelAddMode && fuelAddMode.value === 'emergency' ? 'block' : 'none';

                var co2Enabled = document.getElementById('ab-co2-enabled');
                var co2Container = document.getElementById('co2-settings-container');
                if (co2Container) co2Container.style.display = co2Enabled && co2Enabled.checked ? 'block' : 'none';

                var co2AddMode = document.getElementById('ab-co2-addmode');
                var co2Intelligent = document.getElementById('co2-intelligent-section');
                var co2Emergency = document.getElementById('co2-emergency-section');
                if (co2Intelligent) co2Intelligent.style.display = co2AddMode && co2AddMode.value === 'intelligent' ? 'block' : 'none';
                if (co2Emergency) co2Emergency.style.display = co2AddMode && co2AddMode.value === 'emergency' ? 'block' : 'none';
            }

            updateSectionVisibility();

            function autoSave() {
                updateSectionVisibility();

                var fuelEnabled = document.getElementById('ab-fuel-enabled');
                var fuelAddMode = document.getElementById('ab-fuel-addmode');
                var fuelMode = fuelEnabled && fuelEnabled.checked ? (fuelAddMode && fuelAddMode.value !== 'off' ? fuelAddMode.value : 'basic') : 'off';

                var co2Enabled = document.getElementById('ab-co2-enabled');
                var co2AddMode = document.getElementById('ab-co2-addmode');
                var co2Mode = co2Enabled && co2Enabled.checked ? (co2AddMode && co2AddMode.value !== 'off' ? co2AddMode.value : 'basic') : 'off';

                var newSettings = {
                    fuelMode: fuelMode,
                    fuelPriceThreshold: parseInt(document.getElementById('ab-fuel-threshold').value) || DEFAULT_SETTINGS.fuelPriceThreshold,
                    fuelMinCash: parseFormattedNumber(document.getElementById('ab-fuel-mincash').value) || DEFAULT_SETTINGS.fuelMinCash,
                    fuelIntelligentMaxPrice: parseInt(document.getElementById('ab-fuel-intel-max').value) || DEFAULT_SETTINGS.fuelIntelligentMaxPrice,
                    fuelEmergencyBelow: parseInt(document.getElementById('ab-fuel-emerg-below').value) || DEFAULT_SETTINGS.fuelEmergencyBelow,
                    fuelEmergencyShips: parseInt(document.getElementById('ab-fuel-emerg-ships').value) || DEFAULT_SETTINGS.fuelEmergencyShips,
                    fuelEmergencyMaxPrice: parseInt(document.getElementById('ab-fuel-emerg-max').value) || DEFAULT_SETTINGS.fuelEmergencyMaxPrice,
                    co2Mode: co2Mode,
                    co2PriceThreshold: parseInt(document.getElementById('ab-co2-threshold').value) || DEFAULT_SETTINGS.co2PriceThreshold,
                    co2MinCash: parseFormattedNumber(document.getElementById('ab-co2-mincash').value) || DEFAULT_SETTINGS.co2MinCash,
                    co2IntelligentMaxPrice: parseInt(document.getElementById('ab-co2-intel-max').value) || DEFAULT_SETTINGS.co2IntelligentMaxPrice,
                    co2EmergencyBelow: parseInt(document.getElementById('ab-co2-emerg-below').value) || DEFAULT_SETTINGS.co2EmergencyBelow,
                    co2EmergencyShips: parseInt(document.getElementById('ab-co2-emerg-ships').value) || DEFAULT_SETTINGS.co2EmergencyShips,
                    co2EmergencyMaxPrice: parseInt(document.getElementById('ab-co2-emerg-max').value) || DEFAULT_SETTINGS.co2EmergencyMaxPrice,
                    autoDepartEnabled: document.getElementById('ab-auto-depart') && document.getElementById('ab-auto-depart').checked
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

    function init() {
        console.log('[Auto-Buy] Initializing v7.1...');

        // Request notification permission early
        requestNotificationPermission();

        // Inject CSS (only if in UI mode)
        if (!isBackgroundMode()) {
            var style = document.createElement('style');
            style.textContent = SETTINGS_CSS;
            document.head.appendChild(style);

            // Add menu item
            addMenuItem(SCRIPT_NAME, openSettingsModal);
            console.log('[Auto-Buy] Menu item added');
        }

        // Start monitoring based on settings
        var settings = loadSettings();
        syncSettingsToAndroid(settings);

        if (settings.fuelMode !== 'off' || settings.co2Mode !== 'off' || settings.autoDepartEnabled) {
            setTimeout(startMonitoring, isBackgroundMode() ? 1000 : 5000);
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
