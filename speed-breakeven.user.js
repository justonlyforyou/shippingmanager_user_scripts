// ==UserScript==
// @name         ShippingManager - Speed Break-Even
// @namespace    https://rebelship.org/
// @description  Colors speed sliders green/red based on fuel break-even point
// @version      2.03
// @author       https://github.com/justonlyforyou/
// @order        56
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// @RequireRebelShipStorage true
// ==/UserScript==

(function() {
    'use strict';

    var SCRIPT_NAME = 'Speed Break-Even';
    var UTILIZATION = 0.85;
    var FUEL_PRICE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
    var cachedFuelPrice = null;
    var fuelPriceLoaded = false;
    var fuelPriceCacheTime = 0;
    var debounceTimer = null;
    var processing = false;
    var processedSliders = new WeakSet();
    var observer = null;

    // ============================================
    // PINIA STORE ACCESS
    // ============================================
    function getPinia() {
        try {
            var appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            var app = appEl.__vue_app__;
            return app._context.provides.pinia || app.config.globalProperties.$pinia;
        } catch (e) {
            console.error('[' + SCRIPT_NAME + '] getPinia error:', e);
            return null;
        }
    }

    function getStore(name) {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get(name);
        } catch (e) {
            console.error('[' + SCRIPT_NAME + '] getStore error:', e);
            return null;
        }
    }

    // ============================================
    // FUEL PRICE FROM DEPARTMANAGER BRIDGE STORAGE
    // ============================================
    async function loadFuelPrice() {
        try {
            if (!window.RebelShipBridge || !window.RebelShipBridge.storage) return 500;
            var result = await window.RebelShipBridge.storage.get('DepartManager', 'data', 'storage');
            if (result) {
                var parsed = JSON.parse(result);
                var settings = parsed.settings || {};
                return settings.fuelPriceThreshold || 500;
            }
        } catch (e) {
            console.error('[' + SCRIPT_NAME + '] loadFuelPrice error:', e);
        }
        return 500;
    }

    function invalidateFuelPriceCache() {
        cachedFuelPrice = null;
        fuelPriceLoaded = false;
        fuelPriceCacheTime = 0;
    }

    // ============================================
    // VESSEL DETECTION
    // ============================================
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
        } catch (e) {
            console.error('[' + SCRIPT_NAME + '] getCurrentEditingVessel error:', e);
        }
        return null;
    }

    // ============================================
    // FUEL & INCOME CALCULATIONS
    // ============================================
    function getVesselCapacity(vessel) {
        if (!vessel || !vessel.capacity_max) return 0;
        var cap = vessel.capacity_max;
        if (vessel.capacity_type === 'tanker') {
            return ((cap.fuel || 0) + (cap.crude_oil || 0)) / 74;
        }
        return (cap.dry || 0) + (cap.refrigerated || 0);
    }

    function estimateIncome(vessel) {
        if (!vessel || !vessel.capacity_max || !vessel.prices) return 0;
        var cap = vessel.capacity_max;
        var prices = vessel.prices;
        if (vessel.capacity_type === 'tanker') {
            return ((cap.crude_oil || 0) * (prices.crude_oil || 0) +
                    (cap.fuel || 0) * (prices.fuel || 0)) * UTILIZATION;
        }
        return ((cap.dry || 0) * (prices.dry || 0) +
                (cap.refrigerated || 0) * (prices.refrigerated || 0)) * UTILIZATION;
    }

    function calculateBreakEvenSpeed(vessel, fuelPrice) {
        var income = estimateIncome(vessel);
        var capacity = getVesselCapacity(vessel);
        var distance = vessel.route_distance;
        var fuelFactor = vessel.fuel_factor || 1;

        if (capacity <= 0 || !distance || distance <= 0 || fuelPrice <= 0) return null;
        if (income <= 0) return 0;

        var sqrtBE = (income * 40000) / (capacity * distance * fuelFactor * fuelPrice);
        return sqrtBE * sqrtBE;
    }

    // ============================================
    // SLIDER COLORING
    // ============================================
    function colorSlider(sliderEl, breakEvenSpeed) {
        var min = parseInt(sliderEl.min) || 5;
        var max = parseInt(sliderEl.max) || 39;
        if (min >= max || min < 0 || max > 100) return;
        var breakEvenPercent = ((breakEvenSpeed - min) / (max - min)) * 100;
        breakEvenPercent = Math.min(100, Math.max(0, breakEvenPercent));
        sliderEl.style.setProperty('background',
            'linear-gradient(to right, #22c55e ' + breakEvenPercent + '%, #ef4444 ' + breakEvenPercent + '%)',
            'important');
    }

    // ============================================
    // PROCESS SLIDERS
    // ============================================
    async function processAllSliders() {
        if (processing) return;
        processing = true;

        try {
            var appEl = document.getElementById('app');
            var sliders = (appEl || document).querySelectorAll('input[type="range"].slider');
            if (sliders.length === 0) return;

            var vessel = getCurrentEditingVessel();
            if (!vessel) return;

            for (var i = 0; i < sliders.length; i++) {
                var sliderEl = sliders[i];

                if (processedSliders.has(sliderEl)) continue;
                processedSliders.add(sliderEl);

                var sliderMax = parseInt(sliderEl.max);
                if (!sliderMax || sliderMax !== Math.round(vessel.max_speed)) continue;
                if (!vessel.prices || !vessel.capacity_max || !vessel.route_distance) continue;

                if (!fuelPriceLoaded || (Date.now() - fuelPriceCacheTime) >= FUEL_PRICE_CACHE_TTL) {
                    cachedFuelPrice = await loadFuelPrice();
                    fuelPriceLoaded = true;
                    fuelPriceCacheTime = Date.now();
                }
                if (!cachedFuelPrice) continue;

                var breakEvenSpeed = calculateBreakEvenSpeed(vessel, cachedFuelPrice);
                if (breakEvenSpeed === null) continue;

                sliderEl.classList.add('breakeven-applied');
                colorSlider(sliderEl, breakEvenSpeed);
            }
        } finally {
            processing = false;
        }
    }

    function scheduleCheck() {
        if (debounceTimer || processing) return;
        debounceTimer = setTimeout(function() {
            debounceTimer = null;
            processAllSliders();
        }, 300);
    }

    // ============================================
    // MUTATION OBSERVER
    // ============================================
    function startObserver() {
        var target = document.getElementById('app') || document.body;
        observer = new MutationObserver(function(mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) continue;
                    if ((node.matches && node.matches('input[type="range"].slider')) ||
                        (node.querySelector && node.querySelector('input[type="range"].slider'))) {
                        scheduleCheck();
                        return;
                    }
                }
            }
        });
        observer.observe(target, { childList: true, subtree: true });
    }

    // ============================================
    // INIT
    // ============================================
    function init() {
        var style = document.createElement('style');
        style.textContent =
            'input[type="range"].slider.breakeven-applied { -webkit-appearance: none; appearance: none; height: 6px; border-radius: 3px; outline: none; }' +
            'input[type="range"].slider.breakeven-applied::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #ffffff; border: 2px solid #666; cursor: pointer; }' +
            'input[type="range"].slider.breakeven-applied::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #ffffff; border: 2px solid #666; cursor: pointer; }' +
            'input[type="range"].slider.breakeven-applied::-moz-range-track { background: transparent; }';
        document.head.appendChild(style);

        // Invalidate fuel price cache on navigation (covers DepartManager settings changes)
        window.addEventListener('hashchange', invalidateFuelPriceCache);
        window.addEventListener('popstate', invalidateFuelPriceCache);

        startObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('beforeunload', function() {
        if (observer) { observer.disconnect(); observer = null; }
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    });
})();
