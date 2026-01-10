// ==UserScript==
// @name        Shipping Manager - Auto Expand Advanced Settings
// @description Automatically expands "Advanced" menus and shows price difference from auto price
// @version     1.7
// @author      https://github.com/justonlyforyou/
// @order       20
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @enabled     true
// ==/UserScript==
/* globals MutationObserver */

(function() {
    'use strict';

    if (window._autoExpandAdvancedActive) return;
    window._autoExpandAdvancedActive = true;

    // ============================================
    // PART 1: AUTO EXPAND ADVANCED SETTINGS
    // ============================================

    function expandIfCollapsed(element) {
        var svg = element.querySelector('svg');
        if (!svg) return;
        var style = svg.getAttribute('style');
        if (style && style.indexOf('rotate: 0deg') !== -1) {
            element.click();
        }
    }

    function expandAll() {
        var bars = document.querySelectorAll('.customBlackBar');
        bars.forEach(function(bar) {
            expandIfCollapsed(bar);
        });
    }

    // ============================================
    // PART 2: SHOW PRICE DIFFERENCE FROM AUTO-PRICE
    // ============================================

    var autoPricesCache = {};
    var lastRouteKey = null;

    function parsePrice(priceStr) {
        if (!priceStr) return null;
        var match = priceStr.match(/[\d.]+/);
        return match ? parseFloat(match[0]) : null;
    }

    function calcDiffPercent(current, base) {
        if (!base || base === 0) return 0;
        return Math.round(((current - base) / base) * 100);
    }

    function getCargoType(cargoEl) {
        var typeP = cargoEl.querySelector('.type p');
        if (typeP) return typeP.textContent.trim().toLowerCase();
        return null;
    }

    function updateDiffBadge(priceSpan, diffPercent) {
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
     * Get Pinia instance
     */
    function getPinia() {
        try {
            var app = document.querySelector('#app');
            if (!app || !app.__vue_app__) return null;
            return app.__vue_app__._context.provides.pinia || app.__vue_app__.config.globalProperties.$pinia;
        } catch {
            return null;
        }
    }

    /**
     * Extract route_id from vessel object
     * Vessel has routes[] array with route_id, or active_route.route_id
     */
    function extractRouteId(vessel) {
        if (!vessel) return null;
        // Check active_route first
        if (vessel.active_route && vessel.active_route.route_id) {
            return vessel.active_route.route_id;
        }
        // Check routes array
        if (vessel.routes && vessel.routes.length > 0 && vessel.routes[0].route_id) {
            return vessel.routes[0].route_id;
        }
        return null;
    }

    /**
     * Get route_id and user_vessel_id from Vue/Pinia state
     * The game stores selected vessel in routeStore.selectedVessel
     * Vessel structure: { id: number, routes: [{ route_id: number }], active_route: { route_id: number } }
     */
    function getRouteInfo() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;

            // Primary: Try route store - this is where selectedVessel is stored
            var routeStore = pinia._s.get('route');
            if (routeStore && routeStore.selectedVessel) {
                var sv = routeStore.selectedVessel;
                var routeId = extractRouteId(sv);
                if (sv.id && routeId) {
                    return { route_id: routeId, user_vessel_id: sv.id };
                }
            }

            // Secondary: Try global store - may have trackedVessel
            var globalStore = pinia._s.get('global');
            if (globalStore && globalStore.trackedVessel) {
                var tv = globalStore.trackedVessel;
                var tvRouteId = extractRouteId(tv);
                if (tv.id && tvRouteId) {
                    return { route_id: tvRouteId, user_vessel_id: tv.id };
                }
            }

            // Fallback: Search all stores for selectedVessel or vessel with routes
            var found = null;
            pinia._s.forEach(function(store) {
                if (found) return;
                try {
                    var props = ['selectedVessel', 'vessel', 'userVessel', 'trackedVessel'];
                    for (var i = 0; i < props.length; i++) {
                        var obj = store[props[i]];
                        if (obj && obj.id) {
                            var rId = extractRouteId(obj);
                            if (rId) {
                                found = { route_id: rId, user_vessel_id: obj.id };
                                return;
                            }
                        }
                    }
                } catch {}
            });

            if (found) return found;

        } catch {
            // Silently fail
        }
        return null;
    }

    /**
     * Fetch auto-price from API
     */
    async function fetchAutoPrice(routeId, vesselId) {
        var cacheKey = routeId + '_' + vesselId;

        // Clear cache if route changed
        if (lastRouteKey && lastRouteKey !== cacheKey) {
            autoPricesCache = {};
        }
        lastRouteKey = cacheKey;

        if (autoPricesCache[cacheKey]) {
            return autoPricesCache[cacheKey];
        }

        try {
            var response = await fetch('/api/demand/auto-price', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    route_id: routeId,
                    user_vessel_id: vesselId
                })
            });

            if (!response.ok) return null;

            var data = await response.json();
            if (data.data) {
                autoPricesCache[cacheKey] = data.data;
                return data.data;
            }
        } catch {
            // Silently fail
        }
        return null;
    }

    /**
     * Update price diff badges with actual auto-price comparison
     */
    async function updatePriceDiffs() {
        var changePriceEls = document.querySelectorAll('.changePrice');
        if (changePriceEls.length === 0) return;

        var routeInfo = getRouteInfo();
        if (!routeInfo) return;

        var autoPrices = await fetchAutoPrice(routeInfo.route_id, routeInfo.user_vessel_id);
        if (!autoPrices) return;

        changePriceEls.forEach(function(changePriceEl) {
            var cargos = changePriceEl.querySelectorAll('.cargo');
            cargos.forEach(function(cargo) {
                var cargoType = getCargoType(cargo);
                var priceSpan = cargo.querySelector('.priceSelector .greenText');
                if (!cargoType || !priceSpan) return;

                var currentPrice = parsePrice(priceSpan.textContent);
                var autoPrice = null;

                // Map cargo type to auto-price field
                if (cargoType === 'crude oil') {
                    autoPrice = autoPrices.crude_oil || autoPrices.crude;
                } else if (cargoType === 'fuel') {
                    autoPrice = autoPrices.fuel;
                } else if (cargoType === 'dry') {
                    autoPrice = autoPrices.dry;
                } else if (cargoType === 'refrigerated') {
                    autoPrice = autoPrices.refrigerated || autoPrices.ref;
                }

                if (currentPrice && autoPrice) {
                    var diff = calcDiffPercent(currentPrice, autoPrice);
                    updateDiffBadge(priceSpan, diff);
                }
            });
        });
    }

    function hookPriceButtons() {
        var buttons = document.querySelectorAll('.priceSelector button');
        buttons.forEach(function(btn) {
            if (btn.dataset.autoPriceHooked) return;
            btn.dataset.autoPriceHooked = 'true';
            btn.addEventListener('click', function() {
                setTimeout(updatePriceDiffs, 150);
            });
        });

        var resetBtns = document.querySelectorAll('.resetButton');
        resetBtns.forEach(function(btn) {
            if (btn.dataset.autoPriceHooked) return;
            btn.dataset.autoPriceHooked = 'true';
            btn.addEventListener('click', function() {
                // Clear cache on reset so we refetch
                autoPricesCache = {};
                setTimeout(updatePriceDiffs, 200);
            });
        });
    }

    // ============================================
    // MAIN LOOP
    // ============================================

    function mainLoop() {
        expandAll();

        // Only run price diff if changePrice elements exist
        if (document.querySelector('.changePrice')) {
            hookPriceButtons();
            updatePriceDiffs();
        }
    }

    setTimeout(mainLoop, 1000);
    setTimeout(mainLoop, 2000);
    setTimeout(mainLoop, 3500);
    setInterval(mainLoop, 2500);

    var observer = new MutationObserver(function(mutations) {
        var shouldRun = false;
        mutations.forEach(function(mutation) {
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
                // Also check for route/departure modals
                if (node.classList && (node.classList.contains('route_advanced') || node.classList.contains('advancedContent'))) {
                    shouldRun = true;
                }
            });
        });
        if (shouldRun) {
            setTimeout(mainLoop, 200);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
