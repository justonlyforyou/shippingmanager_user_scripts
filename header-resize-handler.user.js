// ==UserScript==
// @name        Shipping Manager - Header Resize Handler
// @description Reinitializes header elements when window is resized, reorganizes VIP Points and Cash display
// @version     3.18
// @author      https://github.com/justonlyforyou/
// @order       1
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @enabled     true
// ==/UserScript==
/* globals CustomEvent */

(function() {
    'use strict';

    var DEBOUNCE_MS = 500;
    var resizeTimeout = null;
    var lastWidth = window.innerWidth;

    // Custom display elements
    var vipValueElement = null;
    var cashValueElement = null;
    var storeSubscribed = false;

    // IDs of userscript header elements to remove on resize
    var HEADER_ELEMENT_IDS = [
        'bunker-fuel-block',
        'bunker-co2-block',
        'coop-tickets-display',
        'reputation-display',
        'rebelship-menu',
        'morale-smiley-display',
        'rebel-vip-display',
        'rebel-cash-display',
        'rebel-cash-wrapper'
    ];

    // Classes of userscript elements to remove
    var HEADER_ELEMENT_CLASSES = [
        'rebel-premium-header'
    ];

    // Pinia store access
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

    function formatPoints(value) {
        if (value >= 1000000) {
            return (value / 1000000).toFixed(1) + 'M';
        } else if (value >= 1000) {
            return (value / 1000).toFixed(1) + 'K';
        }
        return String(value);
    }

    // Create vertical VIP Points display (icon on top, value below)
    function createVipDisplay() {
        var originalPoints = document.querySelector('.contentBar.points');
        if (!originalPoints || document.getElementById('rebel-vip-display')) return false;

        // Check if parent exists before proceeding
        if (!originalPoints.parentNode) return false;

        // Get the icon SVG from original
        var originalIcon = originalPoints.querySelector('svg');
        var iconHtml = originalIcon ? originalIcon.outerHTML : '';

        // Create vertical layout container
        var container = document.createElement('div');
        container.id = 'rebel-vip-display';
        container.className = 'contentBar points cursor-pointer';
        container.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 8px;';

        // Icon on top
        var iconWrapper = document.createElement('div');
        iconWrapper.innerHTML = iconHtml;
        iconWrapper.style.cssText = 'display:flex;align-items:center;justify-content:center;';
        container.appendChild(iconWrapper);

        // Value below
        var valueEl = document.createElement('span');
        valueEl.id = 'rebel-vip-value';
        valueEl.style.cssText = 'font-size:12px;font-weight:bold;color:#fbbf24;line-height:1.2;';
        valueEl.textContent = '...';
        container.appendChild(valueEl);

        // Insert after original - only hide original AFTER successful insert
        originalPoints.parentNode.insertBefore(container, originalPoints.nextSibling);

        // Only hide original if container was successfully added to DOM
        if (document.getElementById('rebel-vip-display')) {
            originalPoints.style.display = 'none';
        }

        // Copy click handler
        container.addEventListener('click', function() {
            originalPoints.click();
        });

        vipValueElement = valueEl;

        console.log('[HeaderResize] VIP display created');
        return true;
    }

    // Check if mobile view
    function isMobileView() {
        return window.innerWidth < 768;
    }

    // Create Cash display and move it next to company name/stock info
    function createCashDisplay() {
        var originalCash = document.querySelector('.contentBar.cash');
        var stockInfo = document.querySelector('.stockInfo');
        if (!originalCash || !stockInfo || document.getElementById('rebel-cash-display')) return false;

        // Check if parent exists before proceeding
        if (!stockInfo.parentNode) return false;

        // Get the icon SVG from original
        var originalIcon = originalCash.querySelector('svg');
        var iconHtml = originalIcon ? originalIcon.outerHTML : '';

        // Create cash display with icon and full amount
        var container = document.createElement('div');
        container.id = 'rebel-cash-display';
        container.className = 'contentBar cash cursor-pointer';

        // Mobile: display below with line break, Desktop: inline
        if (isMobileView()) {
            container.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;width:100%;margin-top:4px;';
        } else {
            container.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;';
        }

        // Icon
        var iconWrapper = document.createElement('div');
        iconWrapper.innerHTML = iconHtml;
        iconWrapper.style.cssText = 'display:flex;align-items:center;justify-content:center;';
        container.appendChild(iconWrapper);

        // Value (full amount like the game shows)
        var valueEl = document.createElement('span');
        valueEl.id = 'rebel-cash-value';
        valueEl.style.cssText = 'font-weight:bold;color:#4ade80;';
        valueEl.textContent = '...';
        container.appendChild(valueEl);

        // Mobile: wrap stockInfo and cash in a flex container for proper line break
        if (isMobileView()) {
            var wrapper = document.createElement('div');
            wrapper.id = 'rebel-cash-wrapper';
            wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;';

            // Insert wrapper before stockInfo
            stockInfo.parentNode.insertBefore(wrapper, stockInfo);

            // Move stockInfo into wrapper
            wrapper.appendChild(stockInfo);

            // Add cash display below stockInfo
            wrapper.appendChild(container);
        } else {
            // Desktop: Insert after stockInfo
            stockInfo.parentNode.insertBefore(container, stockInfo.nextSibling);
        }

        // Only hide original if container was successfully added to DOM
        if (document.getElementById('rebel-cash-display')) {
            originalCash.style.display = 'none';
        }

        // Copy click handler
        container.addEventListener('click', function() {
            originalCash.click();
        });

        cashValueElement = valueEl;

        console.log('[HeaderResize] Cash display created (mobile: ' + isMobileView() + ')');
        return true;
    }

    function updateDisplayValues() {
        var userStore = getUserStore();
        if (!userStore || !userStore.user) return;

        var points = userStore.user.points;
        var cash = userStore.user.cash;

        if (vipValueElement && points !== undefined) {
            vipValueElement.textContent = formatPoints(points);
        }

        if (cashValueElement && cash !== undefined) {
            // Full amount with $ and thousand separators like the game shows
            cashValueElement.textContent = '$' + cash.toLocaleString('en-US');
        }
    }

    function subscribeToStore() {
        if (storeSubscribed) return;

        var userStore = getUserStore();
        if (!userStore) {
            setTimeout(subscribeToStore, 1000);
            return;
        }

        userStore.$subscribe(function() {
            updateDisplayValues();
        });

        storeSubscribed = true;
        console.log('[HeaderResize] Subscribed to user store for VIP/Cash updates');
    }

    // Add spacing between header rows
    function adjustHeaderSpacing() {
        var headerMainContent = document.querySelector('.headerMainContent');
        var headerSubContent = document.querySelector('.headerSubContent');

        if (headerMainContent && headerSubContent) {
            headerMainContent.style.setProperty('margin-top', '-1px', 'important');
            headerSubContent.style.setProperty('padding-top', '3px', 'important');
        }
    }

    setInterval(adjustHeaderSpacing, 1000);

    function initCustomDisplays() {
        var vipCreated = createVipDisplay();
        var cashCreated = createCashDisplay();

        if (vipCreated || cashCreated) {
            updateDisplayValues();
            subscribeToStore();
        }

        adjustHeaderSpacing();
    }

    function removeHeaderElements() {
        // First: unwrap stockInfo from mobile wrapper if exists
        var cashWrapper = document.getElementById('rebel-cash-wrapper');
        if (cashWrapper) {
            var stockInfo = cashWrapper.querySelector('.stockInfo');
            if (stockInfo && cashWrapper.parentNode) {
                cashWrapper.parentNode.insertBefore(stockInfo, cashWrapper);
            }
        }

        // Remove by ID
        HEADER_ELEMENT_IDS.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.remove();
                console.log('[HeaderResize] Removed #' + id);
            }
        });

        // Remove by class
        HEADER_ELEMENT_CLASSES.forEach(function(cls) {
            document.querySelectorAll('.' + cls).forEach(function(el) {
                el.remove();
            });
        });

        // Restore hidden original elements
        var chartWrapper = document.querySelector('.content.chart.cursor-pointer .chartWrapper');
        if (chartWrapper) chartWrapper.style.display = '';

        var ledWrapper = document.querySelector('.content.led.cursor-pointer .ledWrapper');
        if (ledWrapper) ledWrapper.style.display = '';

        // Restore original VIP and Cash displays
        var originalPoints = document.querySelector('.contentBar.points');
        if (originalPoints) originalPoints.style.display = '';

        var originalCash = document.querySelector('.contentBar.cash');
        if (originalCash) originalCash.style.display = '';

        // Reset headerSubContent margin
        var headerSubContent = document.querySelector('.headerSubContent');
        if (headerSubContent) headerSubContent.style.marginTop = '';

        // Reset element references
        vipValueElement = null;
        cashValueElement = null;
    }

    function resetScriptFlags() {
        // Reset flags that scripts use to track initialization
        // This allows them to re-initialize on their next interval tick

        // Bunker price display uses element references
        window._bunkerPriceReset = true;

        // Dispatch custom event for scripts to listen to
        window.dispatchEvent(new CustomEvent('rebelship-header-resize'));

        console.log('[HeaderResize] Dispatched rebelship-header-resize event');
    }

    function handleResize() {
        var newWidth = window.innerWidth;

        // Only trigger on width changes (ignore height-only changes)
        if (newWidth === lastWidth) {
            return;
        }

        console.log('[HeaderResize] Width changed: ' + lastWidth + ' -> ' + newWidth);
        lastWidth = newWidth;

        removeHeaderElements();
        resetScriptFlags();

        // Reinitialize custom displays after a short delay
        setTimeout(initCustomDisplays, 100);
    }

    function debouncedResize() {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        resizeTimeout = setTimeout(handleResize, DEBOUNCE_MS);
    }

    function init() {
        var pointsBar = document.querySelector('.contentBar.points');
        var stockInfo = document.querySelector('.stockInfo');

        if (pointsBar && stockInfo) {
            initCustomDisplays();
        } else {
            setTimeout(init, 500);
        }
    }

    // Listen for resize
    window.addEventListener('resize', debouncedResize);

    // Initialize on load
    init();

    console.log('[HeaderResize] Initialized - watching for window resize, VIP/Cash display active');
})();
