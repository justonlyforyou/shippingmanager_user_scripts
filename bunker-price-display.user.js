// ==UserScript==
// @name         ShippingManager - Bunker Price Display
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Shows current fuel and CO2 bunker prices - Desktop and Mobile
// @author       https://github.com/justonlyforyou/
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
    let mobileRow = null;

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

    function insertDesktop() {
        var chartElement = document.querySelector('.content.chart.cursor-pointer');
        if (chartElement && !fuelPriceElement) {
            fuelPriceElement = document.createElement('span');
            fuelPriceElement.id = 'bunker-fuel-price';
            fuelPriceElement.style.cssText = 'margin-left:8px;font-weight:bold;font-size:13px;';
            fuelPriceElement.textContent = '...';
            chartElement.parentNode.insertBefore(fuelPriceElement, chartElement.nextSibling);
        }

        var ledElement = document.querySelector('.content.led.cursor-pointer');
        if (ledElement && !co2PriceElement) {
            co2PriceElement = document.createElement('span');
            co2PriceElement.id = 'bunker-co2-price';
            co2PriceElement.style.cssText = 'margin-left:8px;font-weight:bold;font-size:13px;';
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
        row.style.cssText = 'position:fixed;top:0;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:10px;background:#1a1a2e;padding:4px 6px;font-size:14px;z-index:9999;';

        document.body.appendChild(row);

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
            mobileRow = row;
            return true;
        }

        mobileRow = row;

        var fuelBox = document.createElement('div');
        fuelBox.style.cssText = 'display:flex;align-items:center;gap:5px;';
        var fuelLabel = document.createElement('span');
        fuelLabel.style.color = '#aaa';
        fuelLabel.textContent = 'Fuel:';
        fuelBox.appendChild(fuelLabel);
        fuelPriceElement = document.createElement('span');
        fuelPriceElement.id = 'bunker-fuel-mobile';
        fuelPriceElement.style.fontWeight = 'bold';
        fuelPriceElement.textContent = '...';
        fuelBox.appendChild(fuelPriceElement);

        var co2Box = document.createElement('div');
        co2Box.style.cssText = 'display:flex;align-items:center;gap:5px;';
        var co2Label = document.createElement('span');
        co2Label.style.color = '#aaa';
        co2Label.textContent = 'CO2:';
        co2Box.appendChild(co2Label);
        co2PriceElement = document.createElement('span');
        co2PriceElement.id = 'bunker-co2-mobile';
        co2PriceElement.style.fontWeight = 'bold';
        co2PriceElement.textContent = '...';
        co2Box.appendChild(co2PriceElement);

        row.insertBefore(co2Box, row.firstChild);
        row.insertBefore(fuelBox, row.firstChild);

        return true;
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

            if (fuelPriceElement && fuelPrice !== undefined) {
                fuelPriceElement.textContent = '$' + fuelPrice + '/t';
                fuelPriceElement.style.color = getFuelColor(fuelPrice);
            }

            if (co2PriceElement && co2Price !== undefined) {
                co2PriceElement.textContent = '$' + co2Price + '/t';
                co2PriceElement.style.color = getCO2Color(co2Price);
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
