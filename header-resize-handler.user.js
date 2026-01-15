// ==UserScript==
// @name        Shipping Manager - Header Resize Handler
// @description Reinitializes header elements when window is resized, custom mobile header layout
// @version     3.20
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
    var xpValueElement = null;
    var companyValueElement = null;
    var stockValueElement = null;
    var stockIconElement = null;
    var storeSubscribed = false;
    var mobileHeaderCreated = false;

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
        'rebel-mobile-header'
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

    function formatCash(value) {
        return '$' + value.toLocaleString('en-US');
    }

    function formatStockPrice(value) {
        return '$' + parseFloat(value).toFixed(2);
    }

    // Check if mobile view
    function isMobileView() {
        return window.innerWidth < 768;
    }

    // Create custom mobile header layout
    function createMobileHeader() {
        if (!isMobileView() || mobileHeaderCreated) return false;
        if (document.getElementById('rebel-mobile-header')) return false;

        var headerSubContent = document.querySelector('.headerSubContent');
        if (!headerSubContent) return false;

        // Get original elements for click forwarding
        var originalXpButton = document.querySelector('.ceo-progress-container');
        var originalStockInfo = document.querySelector('.stockInfo');
        var originalCash = document.querySelector('.contentBar.cash');

        if (!originalXpButton || !originalStockInfo) return false;

        // Hide original headerSubContent children
        headerSubContent.style.display = 'none';

        // Create new mobile header container
        var container = document.createElement('div');
        container.id = 'rebel-mobile-header';
        container.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%;padding:2px 10px;position:absolute;bottom:2px;';

        // === TOP ROW: XP + Company + Stock ===
        var topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;';

        // XP Level Button (clone visual, forward clicks)
        var xpContainer = document.createElement('div');
        xpContainer.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:4px;';
        xpContainer.title = 'Click to view XP progress';

        // XP Icon (CEO progress icon)
        var xpIcon = document.createElement('div');
        xpIcon.innerHTML = '<svg viewBox="0 0 22 16" width="18" height="13"><path d="M11 0L0 6l11 6 11-6L11 0z" fill="#ffd700"/><path d="M0 10l11 6 11-6v2l-11 6L0 12v-2z" fill="#ffb700"/></svg>';
        xpIcon.style.cssText = 'display:flex;align-items:center;';
        xpContainer.appendChild(xpIcon);

        // XP Level value
        xpValueElement = document.createElement('span');
        xpValueElement.style.cssText = 'color:#fff;font-size:12px;font-weight:800;';
        xpValueElement.textContent = '...';
        xpContainer.appendChild(xpValueElement);

        // Forward click to original XP button
        xpContainer.addEventListener('click', function() {
            if (originalXpButton) originalXpButton.click();
        });

        topRow.appendChild(xpContainer);

        // Company name
        companyValueElement = document.createElement('span');
        companyValueElement.style.cssText = 'color:#fff;font-size:13px;font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        companyValueElement.textContent = '...';
        topRow.appendChild(companyValueElement);

        // Stock info container
        var stockContainer = document.createElement('div');
        stockContainer.style.cssText = 'display:flex;align-items:center;gap:3px;cursor:pointer;';
        stockContainer.title = 'Stock price';

        // Stock icon
        stockIconElement = document.createElement('div');
        stockIconElement.innerHTML = '<svg viewBox="0 0 14 14" width="14" height="14" fill="#fff"><path d="M7 0l2 4h5l-4 3 2 5-5-3-5 3 2-5-4-3h5z"/></svg>';
        stockIconElement.style.cssText = 'display:flex;align-items:center;';
        stockContainer.appendChild(stockIconElement);

        // Stock value
        stockValueElement = document.createElement('span');
        stockValueElement.style.cssText = 'color:#fff;font-size:12px;';
        stockValueElement.textContent = '...';
        stockContainer.appendChild(stockValueElement);

        // Forward click to original stock info
        stockContainer.addEventListener('click', function() {
            if (originalStockInfo) originalStockInfo.click();
        });

        topRow.appendChild(stockContainer);

        container.appendChild(topRow);

        // === BOTTOM ROW: Cash ===
        var bottomRow = document.createElement('div');
        bottomRow.style.cssText = 'display:flex;align-items:center;justify-content:center;margin-top:1px;';

        // Cash container
        var cashContainer = document.createElement('div');
        cashContainer.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
        cashContainer.title = 'Click to view finances';

        // Cash icon
        var cashIcon = document.createElement('div');
        cashIcon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="#4ade80"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm.5 12h-1v-1h1v1zm0-2h-1V4h1v6z"/></svg>';
        cashIcon.style.cssText = 'display:flex;align-items:center;';
        cashContainer.appendChild(cashIcon);

        // Cash value
        cashValueElement = document.createElement('span');
        cashValueElement.style.cssText = 'color:#4ade80;font-size:13px;font-weight:bold;';
        cashValueElement.textContent = '...';
        cashContainer.appendChild(cashValueElement);

        // Forward click to original cash
        cashContainer.addEventListener('click', function() {
            if (originalCash) originalCash.click();
        });

        bottomRow.appendChild(cashContainer);
        container.appendChild(bottomRow);

        // Insert into header
        var shippingHeader = document.querySelector('.shippingHeader');
        if (shippingHeader) {
            shippingHeader.appendChild(container);
            mobileHeaderCreated = true;
            console.log('[HeaderResize] Mobile header created');
            return true;
        }

        return false;
    }

    // Create desktop VIP display (icon on top, value below)
    function createVipDisplay() {
        if (isMobileView()) return false;

        var originalPoints = document.querySelector('.contentBar.points');
        if (!originalPoints || document.getElementById('rebel-vip-display')) return false;
        if (!originalPoints.parentNode) return false;

        var originalIcon = originalPoints.querySelector('svg');
        var iconHtml = originalIcon ? originalIcon.outerHTML : '';

        var container = document.createElement('div');
        container.id = 'rebel-vip-display';
        container.className = 'contentBar points cursor-pointer';
        container.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 8px;';

        var iconWrapper = document.createElement('div');
        iconWrapper.innerHTML = iconHtml;
        iconWrapper.style.cssText = 'display:flex;align-items:center;justify-content:center;';
        container.appendChild(iconWrapper);

        var valueEl = document.createElement('span');
        valueEl.id = 'rebel-vip-value';
        valueEl.style.cssText = 'font-size:12px;font-weight:bold;color:#fbbf24;line-height:1.2;';
        valueEl.textContent = '...';
        container.appendChild(valueEl);

        originalPoints.parentNode.insertBefore(container, originalPoints.nextSibling);

        if (document.getElementById('rebel-vip-display')) {
            originalPoints.style.display = 'none';
        }

        container.addEventListener('click', function() {
            originalPoints.click();
        });

        vipValueElement = valueEl;
        console.log('[HeaderResize] VIP display created');
        return true;
    }

    // Create desktop Cash display
    function createCashDisplay() {
        if (isMobileView()) return false;

        var originalCash = document.querySelector('.contentBar.cash');
        var stockInfo = document.querySelector('.stockInfo');
        if (!originalCash || !stockInfo || document.getElementById('rebel-cash-display')) return false;
        if (!stockInfo.parentNode) return false;

        var originalIcon = originalCash.querySelector('svg');
        var iconHtml = originalIcon ? originalIcon.outerHTML : '';

        var container = document.createElement('div');
        container.id = 'rebel-cash-display';
        container.className = 'contentBar cash cursor-pointer';
        container.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;';

        var iconWrapper = document.createElement('div');
        iconWrapper.innerHTML = iconHtml;
        iconWrapper.style.cssText = 'display:flex;align-items:center;justify-content:center;';
        container.appendChild(iconWrapper);

        var valueEl = document.createElement('span');
        valueEl.id = 'rebel-cash-value';
        valueEl.style.cssText = 'font-weight:bold;color:#4ade80;';
        valueEl.textContent = '...';
        container.appendChild(valueEl);

        stockInfo.parentNode.insertBefore(container, stockInfo.nextSibling);

        if (document.getElementById('rebel-cash-display')) {
            originalCash.style.display = 'none';
        }

        container.addEventListener('click', function() {
            originalCash.click();
        });

        cashValueElement = valueEl;
        console.log('[HeaderResize] Cash display created');
        return true;
    }

    function updateDisplayValues() {
        var userStore = getUserStore();

        if (userStore && userStore.user) {
            var user = userStore.user;

            // VIP Points (desktop)
            if (vipValueElement && user.points !== undefined) {
                vipValueElement.textContent = formatPoints(user.points);
            }

            // Cash
            if (cashValueElement && user.cash !== undefined) {
                cashValueElement.textContent = formatCash(user.cash);
            }

            // XP Level (mobile)
            if (xpValueElement && user.ceo_level !== undefined) {
                xpValueElement.textContent = 'Lv.' + user.ceo_level;
            }

            // Company name (mobile)
            if (companyValueElement && user.company_name) {
                companyValueElement.textContent = user.company_name;
            }
        }

        // Stock price (from user store)
        if (userStore && userStore.user) {
            var userData = userStore.user;
            if (stockValueElement && userData.stock_value !== undefined) {
                stockValueElement.textContent = formatStockPrice(userData.stock_value);

                // Update color based on trend
                var trend = userData.stock_trend;
                if (trend === 'up') {
                    stockValueElement.style.color = '#44d375';
                    if (stockIconElement) stockIconElement.querySelector('svg').setAttribute('fill', '#44d375');
                } else if (trend === 'down') {
                    stockValueElement.style.color = '#e73d41';
                    if (stockIconElement) stockIconElement.querySelector('svg').setAttribute('fill', '#e73d41');
                } else {
                    stockValueElement.style.color = '#fff';
                    if (stockIconElement) stockIconElement.querySelector('svg').setAttribute('fill', '#fff');
                }
            }
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
        console.log('[HeaderResize] Subscribed to user store for updates');
    }

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
        if (isMobileView()) {
            createMobileHeader();
        } else {
            createVipDisplay();
            createCashDisplay();
        }

        updateDisplayValues();
        subscribeToStore();
        adjustHeaderSpacing();
    }

    function removeHeaderElements() {
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
        var headerSubContent = document.querySelector('.headerSubContent');
        if (headerSubContent) headerSubContent.style.display = '';

        var chartWrapper = document.querySelector('.content.chart.cursor-pointer .chartWrapper');
        if (chartWrapper) chartWrapper.style.display = '';

        var ledWrapper = document.querySelector('.content.led.cursor-pointer .ledWrapper');
        if (ledWrapper) ledWrapper.style.display = '';

        var originalPoints = document.querySelector('.contentBar.points');
        if (originalPoints) originalPoints.style.display = '';

        var originalCash = document.querySelector('.contentBar.cash');
        if (originalCash) originalCash.style.display = '';

        // Reset element references
        vipValueElement = null;
        cashValueElement = null;
        xpValueElement = null;
        companyValueElement = null;
        stockValueElement = null;
        stockIconElement = null;
        mobileHeaderCreated = false;
    }

    function resetScriptFlags() {
        window._bunkerPriceReset = true;
        window.dispatchEvent(new CustomEvent('rebelship-header-resize'));
        console.log('[HeaderResize] Dispatched rebelship-header-resize event');
    }

    function handleResize() {
        var newWidth = window.innerWidth;

        if (newWidth === lastWidth) {
            return;
        }

        console.log('[HeaderResize] Width changed: ' + lastWidth + ' -> ' + newWidth);
        lastWidth = newWidth;

        removeHeaderElements();
        resetScriptFlags();

        setTimeout(initCustomDisplays, 100);
    }

    function debouncedResize() {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        resizeTimeout = setTimeout(handleResize, DEBOUNCE_MS);
    }

    function init() {
        var headerSubContent = document.querySelector('.headerSubContent');

        if (headerSubContent) {
            initCustomDisplays();
        } else {
            setTimeout(init, 500);
        }
    }

    window.addEventListener('resize', debouncedResize);
    init();

    console.log('[HeaderResize] Initialized v3.20 - custom mobile header layout');
})();
