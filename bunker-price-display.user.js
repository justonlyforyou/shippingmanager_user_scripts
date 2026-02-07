// ==UserScript==
// @name         ShippingManager - Bunker Price Display
// @namespace    http://tampermonkey.net/
// @version      3.21
// @description  Shows current fuel and CO2 bunker prices with fill levels
// @author       https://github.com/justonlyforyou/
// @order        53
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==

(function() {
    'use strict';

    const API_URL = "https://shippingmanager.cc/api/bunker/get-prices";

    let fuelPriceElement = null;
    let co2PriceElement = null;
    let fuelFillElement = null;
    let co2FillElement = null;
    let storeUnsubscribe = null;
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 10;

    function findCurrentPrice(prices) {
        const now = new Date();
        const utcHours = now.getUTCHours();
        const utcMinutes = now.getUTCMinutes();

        // Direct index calculation: each hour has 2 slots (:00 and :30)
        const slotIndex = utcHours * 2 + (utcMinutes < 30 ? 0 : 1);

        // Return price at calculated index, fallback to first price if out of bounds
        return prices[slotIndex] || prices[0];
    }

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

    function getFuelFillColor(percent) {
        // Game uses 30% threshold for "low fuel" warning
        if (percent <= 30) return '#ef4444';  // red
        return '#4ade80';  // green
    }

    function getCO2FillColor(percent) {
        // Game: positive = green, zero/negative = red
        if (percent <= 0) return '#ef4444';  // red
        return '#4ade80';  // green
    }

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

    function getBunkerFillLevels() {
        var userStore = getUserStore();
        if (!userStore || !userStore.user || !userStore.settings) return null;

        var fuel = userStore.user.fuel;
        var co2 = userStore.user.co2;
        var maxFuel = userStore.settings.max_fuel;
        var maxCO2 = userStore.settings.max_co2;

        if (!maxFuel || !maxCO2) return null;

        return {
            fuelPercent: Math.round((fuel / maxFuel) * 100),
            co2Percent: Math.round((co2 / maxCO2) * 100)
        };
    }

    /**
     * Create 3-line bunker display:
     * Line 1: "Fuel" or "CO2"
     * Line 2: Fill level %
     * Line 3: Price
     */
    function createBunkerBlock(container, type) {
        // Hide original content
        var wrapper = container.querySelector('.chartWrapper') || container.querySelector('.ledWrapper');
        if (wrapper) wrapper.style.display = 'none';

        // Create 3-line block
        var block = document.createElement('div');
        block.id = 'bunker-' + type + '-block';
        block.style.cssText = 'display:flex;flex-direction:column;align-items:center;line-height:1.2;';

        // Line 1: Label
        var label = document.createElement('span');
        label.style.cssText = 'color:#9ca3af;font-size:12px;';
        label.textContent = type === 'fuel' ? 'Fuel' : 'CO2';
        block.appendChild(label);

        // Line 2: Fill %
        var fill = document.createElement('span');
        fill.id = 'bunker-' + type + '-fill';
        fill.style.cssText = 'font-weight:bold;font-size:12px;';
        fill.textContent = '...%';
        block.appendChild(fill);

        // Line 3: Price
        var price = document.createElement('span');
        price.id = 'bunker-' + type + '-price';
        price.style.cssText = 'font-size:12px;font-weight:bold;';
        price.textContent = '';
        block.appendChild(price);

        container.appendChild(block);

        return { fill: fill, price: price };
    }

    function insertPriceDisplays() {
        var chartElement = document.querySelector('.content.chart.cursor-pointer');
        var ledElement = document.querySelector('.content.led.cursor-pointer');

        if (chartElement && !fuelFillElement) {
            var fuelBlock = createBunkerBlock(chartElement, 'fuel');
            fuelFillElement = fuelBlock.fill;
            fuelPriceElement = fuelBlock.price;
        }

        if (ledElement && !co2FillElement) {
            var co2Block = createBunkerBlock(ledElement, 'co2');
            co2FillElement = co2Block.fill;
            co2PriceElement = co2Block.price;
        }

        return fuelFillElement && co2FillElement;
    }

    async function updatePrices() {
        try {
            var response = await fetch(API_URL, { credentials: "include" });
            if (!response.ok) return;

            var data = await response.json();
            var prices = data && data.data && data.data.prices;
            if (!prices || prices.length === 0) return;

            var discountedFuel = data && data.data && data.data.discounted_fuel;
            var discountedCo2 = data && data.data && data.data.discounted_co2;

            var fuelPrice, co2Price;
            if (discountedFuel !== undefined) {
                fuelPrice = discountedFuel;
            } else {
                fuelPrice = findCurrentPrice(prices).fuel_price;
            }

            if (discountedCo2 !== undefined) {
                co2Price = discountedCo2;
            } else {
                co2Price = findCurrentPrice(prices).co2_price;
            }

            if (!fuelFillElement || !co2FillElement) {
                if (!insertPriceDisplays()) return;
            }

            // Update prices
            if (fuelPriceElement && fuelPrice !== undefined) {
                fuelPriceElement.textContent = '$' + fuelPrice + '/t';
                fuelPriceElement.style.color = getFuelColor(fuelPrice);
            }
            if (co2PriceElement && co2Price !== undefined) {
                co2PriceElement.textContent = '$' + co2Price + '/t';
                co2PriceElement.style.color = getCO2Color(co2Price);
            }

            // Update fill levels
            updateFillLevels();
        } catch (err) {
            console.error("[BunkerPrice] Error:", err);
        }
    }

    // Subscribe to Pinia store changes - updates immediately like the game does
    function subscribeToStore() {
        var userStore = getUserStore();
        if (!userStore) {
            // Use MutationObserver to wait for Pinia instead of polling
            waitForPinia();
            return;
        }

        // Unsubscribe from previous subscription if exists
        if (storeUnsubscribe) {
            storeUnsubscribe();
        }

        // Subscribe to user store mutations and store unsubscribe function
        storeUnsubscribe = userStore.$subscribe(function() {
            updateFillLevels();
        });
    }

    // Wait for Pinia to become available using MutationObserver
    function waitForPinia() {
        var app = document.getElementById('app');
        if (!app) {
            console.error('[BunkerPrice] #app not found, cannot wait for Pinia');
            return;
        }

        var observer = new MutationObserver(function() {
            var userStore = getUserStore();
            if (userStore) {
                observer.disconnect();
                subscribeToStore();
            }
        });

        observer.observe(app, { childList: true, subtree: true });
    }

    // Update fill levels (both desktop and mobile use same elements now)
    function updateFillLevels() {
        var fillLevels = getBunkerFillLevels();
        if (!fillLevels) return;

        if (fuelFillElement) {
            fuelFillElement.textContent = fillLevels.fuelPercent + '%';
            fuelFillElement.style.color = getFuelFillColor(fillLevels.fuelPercent);
        }
        if (co2FillElement) {
            co2FillElement.textContent = fillLevels.co2Percent + '%';
            co2FillElement.style.color = getCO2FillColor(fillLevels.co2Percent);
        }
    }

    /**
     * Calculate ms until next price update time (:00:45 or :30:45)
     * Prices change at :00 and :30, we fetch 45 seconds after
     */
    function getMsUntilNextPriceUpdate() {
        var now = new Date();
        var minutes = now.getMinutes();
        var seconds = now.getSeconds();
        var ms = now.getMilliseconds();

        var targetMinute, targetSecond = 45;

        if (minutes < 30) {
            // Next update at :30:45
            targetMinute = 30;
        } else {
            // Next update at :00:45 (next hour)
            targetMinute = 60; // Will wrap to 0
        }

        var currentTotalSeconds = minutes * 60 + seconds;
        var targetTotalSeconds = targetMinute * 60 + targetSecond;

        var diffSeconds = targetTotalSeconds - currentTotalSeconds;
        if (diffSeconds <= 0) {
            // Already past target, go to next slot
            diffSeconds += 30 * 60; // Add 30 minutes
        }

        return diffSeconds * 1000 - ms;
    }

    /**
     * Schedule next price update at :00:45 or :30:45
     * Android background job compatible - uses setTimeout
     */
    function schedulePriceUpdate() {
        var delay = getMsUntilNextPriceUpdate();
        var nextUpdate = new Date(Date.now() + delay);
        console.log('[BunkerPrice] Next update at ' + nextUpdate.toLocaleTimeString() + ' (in ' + Math.round(delay / 1000) + 's)');

        setTimeout(function() {
            updatePrices();
            schedulePriceUpdate(); // Schedule next
        }, delay);
    }

    function resetElements() {
        fuelPriceElement = null;
        co2PriceElement = null;
        fuelFillElement = null;
        co2FillElement = null;
        initRetryCount = 0;

        // Unsubscribe from store on cleanup
        if (storeUnsubscribe) {
            storeUnsubscribe();
            storeUnsubscribe = null;
        }
    }

    function init() {
        if (insertPriceDisplays()) {
            updatePrices();
            // Schedule updates at :00:45 and :30:45 (Android compatible)
            schedulePriceUpdate();
            // Subscribe to store for instant fill level updates
            subscribeToStore();
        } else {
            initRetryCount++;
            if (initRetryCount < MAX_INIT_RETRIES) {
                setTimeout(init, 1000);
            } else {
                console.error('[BunkerPrice] Init failed after ' + MAX_INIT_RETRIES + ' attempts');
            }
        }
    }

    // Debounce helper for resize listener
    var resizeDebounceTimer = null;
    function debounceResize(callback, delay) {
        if (resizeDebounceTimer) {
            clearTimeout(resizeDebounceTimer);
        }
        resizeDebounceTimer = setTimeout(callback, delay);
    }

    // Listen for header resize event to reinitialize
    window.addEventListener('rebelship-header-resize', function() {
        resetElements();
        debounceResize(function() {
            if (insertPriceDisplays()) {
                updatePrices();
            } else {
                console.log('[BunkerPrice] Reinit failed after resize');
            }
        }, 300);
    });

    init();
})();
