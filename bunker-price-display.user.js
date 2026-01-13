// ==UserScript==
// @name         ShippingManager - Bunker Price Display
// @namespace    http://tampermonkey.net/
// @version     3.10
// @description  Shows current fuel and CO2 bunker prices with fill levels
// @author       https://github.com/justonlyforyou/
// @order        22
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==

(function() {
    'use strict';

    const API_URL = "https://shippingmanager.cc/api/bunker/get-prices";
    const isMobile = window.innerWidth < 1024;

    let fuelPriceElement = null;
    let co2PriceElement = null;
    let fuelFillElement = null;
    let co2FillElement = null;

    function findCurrentPrice(prices) {
        const now = new Date();
        const utcHours = now.getUTCHours();
        const utcMinutes = now.getUTCMinutes();
        const currentSlot = utcMinutes < 30
            ? String(utcHours).padStart(2, '0') + ':00'
            : String(utcHours).padStart(2, '0') + ':30';
        const match = prices.find(function(p) { return p.time === currentSlot; });
        return match || prices[0];
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

    function insertDesktop() {
        var chartElement = document.querySelector('.content.chart.cursor-pointer');
        if (chartElement && !fuelPriceElement) {
            // Fill percentage LEFT of icon
            fuelFillElement = document.createElement('span');
            fuelFillElement.id = 'bunker-fuel-fill';
            fuelFillElement.style.cssText = 'margin-right:-5px !important;font-weight:bold !important;font-size:13px !important;';
            fuelFillElement.textContent = '...';
            chartElement.parentNode.insertBefore(fuelFillElement, chartElement);

            // Price RIGHT of icon
            fuelPriceElement = document.createElement('span');
            fuelPriceElement.id = 'bunker-fuel-price';
            fuelPriceElement.style.cssText = 'margin-left:-5px !important;font-weight:bold !important;font-size:13px !important;';
            fuelPriceElement.textContent = '...';
            chartElement.parentNode.insertBefore(fuelPriceElement, chartElement.nextSibling);
        }

        var ledElement = document.querySelector('.content.led.cursor-pointer');
        if (ledElement && !co2PriceElement) {
            // Fill percentage LEFT of icon
            co2FillElement = document.createElement('span');
            co2FillElement.id = 'bunker-co2-fill';
            co2FillElement.style.cssText = 'margin-right:-5px !important;font-weight:bold !important;font-size:13px !important;';
            co2FillElement.textContent = '...';
            ledElement.parentNode.insertBefore(co2FillElement, ledElement);

            // Price RIGHT of icon
            co2PriceElement = document.createElement('span');
            co2PriceElement.id = 'bunker-co2-price';
            co2PriceElement.style.cssText = 'margin-left:-5px !important;font-weight:bold !important;font-size:13px !important;';
            co2PriceElement.textContent = '...';
            ledElement.parentNode.insertBefore(co2PriceElement, ledElement.nextSibling);
        }

        return fuelPriceElement && co2PriceElement;
    }

    // Get or create shared mobile row (fixed at top)
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

    function insertMobile() {
        var row = getOrCreateMobileRow();
        if (!row) return false;

        if (document.getElementById('bunker-fuel-mobile')) {
            fuelPriceElement = document.getElementById('bunker-fuel-mobile');
            co2PriceElement = document.getElementById('bunker-co2-mobile');
            return true;
        }

        // Mobile: Only prices in top bar (no fill % here)
        // Fuel: Label | Price
        var fuelBox = document.createElement('div');
        fuelBox.style.cssText = 'display:flex !important;align-items:center !important;gap:5px !important;font-size:13px !important;';
        var fuelLabel = document.createElement('span');
        fuelLabel.style.cssText = 'color:#aaa !important;';
        fuelLabel.textContent = 'Fuel:';
        fuelBox.appendChild(fuelLabel);
        fuelPriceElement = document.createElement('span');
        fuelPriceElement.id = 'bunker-fuel-mobile';
        fuelPriceElement.style.cssText = 'font-weight:bold !important;';
        fuelPriceElement.textContent = '...';
        fuelBox.appendChild(fuelPriceElement);

        // CO2: Label | Price
        var co2Box = document.createElement('div');
        co2Box.style.cssText = 'display:flex !important;align-items:center !important;gap:5px !important;font-size:13px !important;';
        var co2Label = document.createElement('span');
        co2Label.style.cssText = 'color:#aaa !important;';
        co2Label.textContent = 'CO2:';
        co2Box.appendChild(co2Label);
        co2PriceElement = document.createElement('span');
        co2PriceElement.id = 'bunker-co2-mobile';
        co2PriceElement.style.cssText = 'font-weight:bold !important;';
        co2PriceElement.textContent = '...';
        co2Box.appendChild(co2PriceElement);

        row.insertBefore(co2Box, row.firstChild);
        row.insertBefore(fuelBox, row.firstChild);

        // Mobile: Overlay % text on bunker circles
        insertMobileBunkerOverlays();

        return true;
    }

    // Mobile: Replace bunker circles with percentage text
    function insertMobileBunkerOverlays() {
        if (!isMobile) return; // Only on mobile

        // Structure:
        // <div class="content chart cursor-pointer"> <- has click handler
        //   <div class="chartWrapper">
        //     <div class="chart"><svg>...</svg></div>
        //   </div>
        // </div>

        var fuelContainer = document.querySelector('.content.chart.cursor-pointer');
        var co2Container = document.querySelector('.content.led.cursor-pointer');

        if (fuelContainer && !document.getElementById('bunker-fuel-overlay')) {
            // Hide the chartWrapper inside
            var chartWrapper = fuelContainer.querySelector('.chartWrapper');
            if (chartWrapper) chartWrapper.style.cssText = 'display:none !important;';

            // Create percentage text (click already works on parent)
            fuelFillElement = document.createElement('span');
            fuelFillElement.id = 'bunker-fuel-overlay';
            fuelFillElement.style.cssText = 'font-weight:bold !important;font-size:13px !important;color:#4ade80 !important;';
            fuelFillElement.textContent = '...%';
            fuelContainer.appendChild(fuelFillElement);
        }

        if (co2Container && !document.getElementById('bunker-co2-overlay')) {
            // Hide the ledWrapper inside
            var ledWrapper = co2Container.querySelector('.ledWrapper');
            if (ledWrapper) ledWrapper.style.cssText = 'display:none !important;';

            // Create percentage text (click already works on parent)
            co2FillElement = document.createElement('span');
            co2FillElement.id = 'bunker-co2-overlay';
            co2FillElement.style.cssText = 'font-weight:bold !important;font-size:13px !important;color:#4ade80 !important;';
            co2FillElement.textContent = '...%';
            co2Container.appendChild(co2FillElement);
        }
    }

    function insertPriceDisplays() {
        if (isMobile) {
            return insertMobile();
        } else {
            return insertDesktop();
        }
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

            if (!fuelPriceElement || !co2PriceElement) {
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

            // Update fill levels from Pinia
            var fillLevels = getBunkerFillLevels();
            if (fillLevels) {
                // Desktop: update fill elements
                if (fuelFillElement) {
                    fuelFillElement.textContent = fillLevels.fuelPercent + '%';
                    fuelFillElement.style.color = getFuelFillColor(fillLevels.fuelPercent);
                }
                if (co2FillElement) {
                    co2FillElement.textContent = fillLevels.co2Percent + '%';
                    co2FillElement.style.color = getCO2FillColor(fillLevels.co2Percent);
                }

                // Mobile: update overlay elements (try to find them if not set)
                if (isMobile) {
                    var fuelOverlay = document.getElementById('bunker-fuel-overlay');
                    var co2Overlay = document.getElementById('bunker-co2-overlay');

                    if (!fuelOverlay || !co2Overlay) {
                        insertMobileBunkerOverlays();
                        fuelOverlay = document.getElementById('bunker-fuel-overlay');
                        co2Overlay = document.getElementById('bunker-co2-overlay');
                    }

                    if (fuelOverlay) {
                        fuelOverlay.textContent = fillLevels.fuelPercent + '%';
                        fuelOverlay.style.color = getFuelFillColor(fillLevels.fuelPercent);
                    }
                    if (co2Overlay) {
                        co2Overlay.textContent = fillLevels.co2Percent + '%';
                        co2Overlay.style.color = getCO2FillColor(fillLevels.co2Percent);
                    }
                }
            }
        } catch (err) {
            console.error("[BunkerPrice] Error:", err);
        }
    }

    function init() {
        if (insertPriceDisplays()) {
            updatePrices();
            setInterval(updatePrices, 30000);
        } else {
            setTimeout(init, 1000);
        }
    }

    init();
})();
