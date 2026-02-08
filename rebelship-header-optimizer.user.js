// ==UserScript==
// @name        ShippingManager - Rebelship Header Optimizer
// @description Important script to handle all the Rebelship UI header elements for all scripts.
// @version     3.87
// @author      https://github.com/justonlyforyou/
// @order       999
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @grant       none
// @enabled     false
// ==/UserScript==
/* globals CustomEvent */

(function() {
    'use strict';

    var MAX_RETRIES = 20;

    var vipValueElement = null;
    var cashValueElement = null;
    var anchorValueElement = null;
    var storeSubscribed = false;
    var headerCreated = false;

    var activeObservers = [];
    var subscribeRetries = 0;
    var initRetries = 0;

    // IDs of userscript header elements to remove on resize
    var HEADER_ELEMENT_IDS = [
        'bunker-fuel-block',
        'bunker-co2-block',
        'coop-tickets-display',
        'reputation-display',
        'morale-smiley-display',
        'rebel-vip-display',
        'rebel-cash-display',
        'rebel-mobile-header',
        'rebel-stock-display'
    ];

    var HEADER_ELEMENT_CLASSES = [
        'rebel-premium-header'
    ];

    // ============================================
    // CSS Injection
    // ============================================
    function injectCSS() {
        if (document.getElementById('rebel-mobile-css')) return;
        var style = document.createElement('style');
        style.id = 'rebel-mobile-css';
        style.textContent = [
            // Header height: single-row on desktop ≥1440px, two-row (mobile) below
            '@media (min-width: 1440px) { .shippingHeader { height: 47px !important; max-height: 47px !important; min-height: 47px !important; position: relative !important; } }',
            '@media (max-width: 1439px) { .shippingHeader { height: 89px !important; max-height: 89px !important; min-height: 89px !important; position: relative !important; } }',
            // Row 1: left-align all utility items in headerMainContent
            '.shippingHeader .headerMainContent { justify-content: flex-start !important; align-items: center !important; gap: 5px !important; max-width: unset !important; padding: 2px 10px 8px !important; margin: 0 !important; width: 100% !important; }',
            // Uniform font size for all elements in row 1
            '.shippingHeader .headerMainContent * { font-size: 12px !important; }',
            // Remove auto-margin from CO2 LED that pushes items apart
            '.shippingHeader .headerMainContent .content.led { margin-right: 0 !important; }',
            // Remove margin-left from script-injected header elements (gap handles spacing)
            '.shippingHeader .headerMainContent > * { margin-left: 0 !important; }',
            // Hide desktop/mobile company+stock sections (recreated in row 2)
            '.companyContent { display: none !important; }',
            '.headerSubContent { display: none !important; }',
            // Hide points and cash badges (recreated in row 2)
            '.contentBar.points { display: none !important; }',
            '.contentBar.cash { display: none !important; }',
            // Hide chart/LED wrappers (bunker-price-display replaces them)
            '.chartWrapper { display: none !important; }',
            '.ledWrapper { display: none !important; }',
            // Force countdown box always above buttons in port menu
            '.countdownBox { order: -1 !important; width: 100% !important; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ============================================
    // Pinia store access
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
        } catch {
            return null;
        }
    }

    function getVesselStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('vessel');
        } catch {
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

    // ============================================
    // Header Layout (2 rows, used on desktop + mobile)
    // Row 1 (top): fuel, co2, coop, rep, morale, cart, inbox, settings
    // Row 2 (bottom): XP, company, points, cash, anchor | stock
    // ============================================
    function createHeader() {
        if (headerCreated) return false;
        if (document.getElementById('rebel-mobile-header')) return false;

        var companyContent = document.querySelector('.companyContent') || document.querySelector('.headerSubContent');
        if (!companyContent) return false;

        var isCompact = window.innerWidth >= 1440;

        var originalXpButton = document.querySelector('.ceo-progress-container');
        var originalStockInfo = document.querySelector('.stockInfo');
        var originalCash = document.querySelector('.contentBar.cash');
        var originalPoints = document.querySelector('.contentBar.points');

        // Font sizes: smaller in compact mode so everything fits in one row
        var mainFontSize = isCompact ? '12px' : '13px';
        var smallFontSize = isCompact ? '11px' : '12px';

        // -- Build shared elements --

        // XP progress icon
        var xpClone = null;
        if (originalXpButton) {
            xpClone = originalXpButton.cloneNode(true);
            xpClone.style.cssText = 'cursor:pointer;margin-right:-4px;';
            xpClone.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                originalXpButton.click();
            });

            var xpDebounce = null;
            var xpObserver = new MutationObserver(function() {
                if (xpDebounce) clearTimeout(xpDebounce);
                xpDebounce = setTimeout(function() {
                    while (xpClone.firstChild) xpClone.removeChild(xpClone.firstChild);
                    for (var i = 0; i < originalXpButton.childNodes.length; i++) {
                        xpClone.appendChild(originalXpButton.childNodes[i].cloneNode(true));
                    }
                }, 200);
            });
            xpObserver.observe(originalXpButton, { childList: true, subtree: true, characterData: true });
            activeObservers.push(xpObserver);
        }

        // Company name
        var companyClone = null;
        var companyNameEl = companyContent.querySelector('p.cursor-pointer');
        if (companyNameEl) {
            companyClone = companyNameEl.cloneNode(true);
            companyClone.style.cssText = 'color:#ffffff;font-weight:bold;cursor:pointer;margin:0;font-size:' + mainFontSize + ';position:relative;top:2px;';
            companyClone.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                companyNameEl.click();
            });
        }

        // VIP Points
        var vipContainer = null;
        if (originalPoints) {
            vipContainer = document.createElement('div');
            vipContainer.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';

            var vipIcon = originalPoints.querySelector('svg');
            if (vipIcon) {
                var vipIconClone = vipIcon.cloneNode(true);
                vipIconClone.setAttribute('width', '14');
                vipIconClone.setAttribute('height', '14');
                vipContainer.appendChild(vipIconClone);
            }

            vipValueElement = document.createElement('span');
            vipValueElement.style.cssText = 'color:#fbbf24;font-size:' + mainFontSize + ';font-weight:bold;';
            vipValueElement.textContent = '...';
            vipContainer.appendChild(vipValueElement);

            vipContainer.addEventListener('click', function() {
                originalPoints.click();
            });
        }

        // Cash
        var cashContainer = document.createElement('div');
        cashContainer.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';

        if (originalCash) {
            var cashIcon = originalCash.querySelector('svg');
            if (cashIcon) {
                var cashIconClone = cashIcon.cloneNode(true);
                cashIconClone.setAttribute('width', '14');
                cashIconClone.setAttribute('height', '14');
                cashContainer.appendChild(cashIconClone);
            }
        }

        cashValueElement = document.createElement('span');
        cashValueElement.style.cssText = 'color:#4ade80;font-size:' + mainFontSize + ';font-weight:bold;';
        cashValueElement.textContent = '...';
        cashContainer.appendChild(cashValueElement);

        cashContainer.addEventListener('click', function() {
            if (originalCash) originalCash.click();
        });

        // Anchor points display
        var anchorContainer = document.createElement('div');
        anchorContainer.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:' + smallFontSize + ';margin-right:8px;';
        var anchorIcon = document.createElement('span');
        anchorIcon.textContent = '\u2693';
        anchorContainer.appendChild(anchorIcon);
        anchorValueElement = document.createElement('span');
        anchorValueElement.style.cssText = 'color:#60a5fa;font-weight:bold;';
        anchorValueElement.textContent = '...';
        anchorContainer.appendChild(anchorValueElement);

        // Stock display
        var stockRow = null;
        if (originalStockInfo) {
            stockRow = document.createElement('div');
            stockRow.id = 'rebel-stock-display';
            stockRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:' + smallFontSize + ';';
            stockRow.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                originalStockInfo.click();
            });

            var userStore = getUserStore();
            var stockTrend = userStore && userStore.user ? userStore.user.stock_trend : null;
            var trendColor = getTrendColor(stockTrend);

            var stockValues = extractStockValues(originalStockInfo);
            var originalSvg = originalStockInfo.querySelector('svg');

            var stockPrice = document.createElement('span');
            stockPrice.style.cssText = 'font-weight:bold;color:' + trendColor + ';';
            stockPrice.textContent = stockValues[0] ? stockValues[0] : '...';
            stockRow.appendChild(stockPrice);

            var stockDiff = document.createElement('span');
            stockDiff.style.cssText = 'color:' + trendColor + ';';
            stockDiff.textContent = stockValues[1] ? stockValues[1] : '';
            stockRow.appendChild(stockDiff);

            var stockPercent = document.createElement('span');
            stockPercent.style.cssText = 'color:' + trendColor + ';';
            stockPercent.textContent = stockValues[2] ? stockValues[2] : '';
            stockRow.appendChild(stockPercent);

            if (originalSvg) {
                var svgClone = originalSvg.cloneNode(true);
                applySvgStyle(svgClone, trendColor);
                stockRow.appendChild(svgClone);
            }

            // Observer to keep stock updated
            var lastStockText = originalStockInfo.textContent.trim();
            var stockDebounce = null;
            var stockObserver = new MutationObserver(function() {
                if (stockDebounce) clearTimeout(stockDebounce);
                stockDebounce = setTimeout(function() {
                    var newText = originalStockInfo.textContent.trim();
                    if (newText === lastStockText) return;
                    lastStockText = newText;

                    var newValues = extractStockValues(originalStockInfo);
                    var newSvg = originalStockInfo.querySelector('svg');
                    var newUserStore = getUserStore();
                    var newStockTrend = newUserStore && newUserStore.user ? newUserStore.user.stock_trend : null;
                    var newTrendColor = getTrendColor(newStockTrend);

                    stockPrice.textContent = newValues[0] ? newValues[0] : '...';
                    stockPrice.style.color = newTrendColor;
                    stockDiff.textContent = newValues[1] ? newValues[1] : '';
                    stockDiff.style.color = newTrendColor;
                    stockPercent.textContent = newValues[2] ? newValues[2] : '';
                    stockPercent.style.color = newTrendColor;

                    if (newSvg) {
                        var existingSvg = stockRow.querySelector('svg');
                        var svgCloneNew = newSvg.cloneNode(true);
                        applySvgStyle(svgCloneNew, newTrendColor);
                        if (existingSvg) {
                            existingSvg.parentNode.replaceChild(svgCloneNew, existingSvg);
                        } else {
                            stockRow.appendChild(svgCloneNew);
                        }
                    }
                }, 200);
            });
            stockObserver.observe(originalStockInfo, { childList: true, subtree: true, characterData: true });
            activeObservers.push(stockObserver);
        }

        // -- Layout: compact (single row) vs normal (two rows) --

        if (isCompact) {
            // Single row: insert info elements as inline-flex wrapper before existing headerMainContent children
            var inlineWrapper = document.createElement('div');
            inlineWrapper.id = 'rebel-mobile-header';
            inlineWrapper.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-right:8px;';

            if (xpClone) inlineWrapper.appendChild(xpClone);
            if (companyClone) inlineWrapper.appendChild(companyClone);
            if (vipContainer) inlineWrapper.appendChild(vipContainer);
            inlineWrapper.appendChild(cashContainer);
            inlineWrapper.appendChild(anchorContainer);
            if (stockRow) inlineWrapper.appendChild(stockRow);

            var headerMainContent = document.querySelector('.headerMainContent');
            if (headerMainContent) {
                headerMainContent.insertBefore(inlineWrapper, headerMainContent.firstChild);
                headerCreated = true;
                return true;
            }
            return false;
        } else {
            // Two rows: Row 2 positioned at bottom of header
            var row2 = document.createElement('div');
            row2.id = 'rebel-mobile-header';
            row2.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:2px 9px;position:absolute;bottom:2px;left:0;width:100%;';

            // Sub-row 1: XP, Company, Points, Cash
            var infoRow = document.createElement('div');
            infoRow.style.cssText = 'display:flex;flex-wrap:nowrap;align-items:center;gap:8px;';

            if (xpClone) infoRow.appendChild(xpClone);
            if (companyClone) infoRow.appendChild(companyClone);
            if (vipContainer) infoRow.appendChild(vipContainer);
            infoRow.appendChild(cashContainer);

            row2.appendChild(infoRow);

            // Sub-row 2: Anchor + Stock
            var bottomLine = document.createElement('div');
            bottomLine.style.cssText = 'display:flex;align-items:center;gap:0;';
            bottomLine.appendChild(anchorContainer);
            if (stockRow) bottomLine.appendChild(stockRow);
            row2.appendChild(bottomLine);

            // Insert row 2 into header
            var shippingHeader = document.querySelector('.shippingHeader');
            if (shippingHeader) {
                shippingHeader.appendChild(row2);
                headerCreated = true;
                return true;
            }
            return false;
        }
    }


    // ============================================
    // Helpers
    // ============================================
    function extractStockValues(stockInfoEl) {
        var values = [];
        var textNodes = stockInfoEl.querySelectorAll('span, p, div');
        for (var i = 0; i < textNodes.length; i++) {
            var text = textNodes[i].textContent.trim();
            if (textNodes[i].children.length === 0 && text.length > 0) {
                values.push(text);
            }
        }
        if (values.length === 0) {
            var fullText = stockInfoEl.textContent.trim();
            var matches = fullText.match(/[\$\d.,]+|[\+\-]?[\d.]+%/g);
            if (matches) values = matches;
        }
        return values;
    }

    function getTrendColor(stockTrend) {
        if (stockTrend === 'down') return '#ef4444';
        if (stockTrend === 'up') return '#4ade80';
        return '#ffffff';
    }

    function applySvgStyle(svgEl, color) {
        svgEl.style.width = '10px';
        svgEl.style.height = '10px';
        svgEl.style.fill = color;
        var paths = svgEl.querySelectorAll('path, polygon, circle, rect');
        for (var i = 0; i < paths.length; i++) {
            paths[i].style.fill = color;
        }
    }

    // ============================================
    // Store subscription
    // ============================================
    function updateDisplayValues() {
        var userStore = getUserStore();
        if (userStore && userStore.user) {
            var user = userStore.user;
            if (vipValueElement && user.points !== undefined) {
                vipValueElement.textContent = formatPoints(user.points);
            }
            if (cashValueElement && user.cash !== undefined) {
                cashValueElement.textContent = formatCash(user.cash);
            }
        }
        if (anchorValueElement && userStore && userStore.settings) {
            var maxAnchor = userStore.settings.anchor_points || 0;
            var vesselStore = getVesselStore();
            var totalVessels = 0;
            if (vesselStore && vesselStore.userVessels) {
                totalVessels = vesselStore.userVessels.length;
            }
            var freeAnchor = maxAnchor - totalVessels;
            if (freeAnchor < 0) freeAnchor = 0;
            anchorValueElement.textContent = freeAnchor + '/' + maxAnchor;
        }
    }

    function subscribeToStore() {
        if (storeSubscribed || subscribeRetries >= MAX_RETRIES) return;
        subscribeRetries++;

        var userStore = getUserStore();
        if (!userStore) {
            setTimeout(subscribeToStore, 1000);
            return;
        }

        userStore.$subscribe(function() {
            updateDisplayValues();
        });

        var vesselStore = getVesselStore();
        if (vesselStore) {
            vesselStore.$subscribe(function() {
                updateDisplayValues();
            });
        }

        storeSubscribed = true;
    }

    // ============================================
    // Reset (for resize event)
    // ============================================
    function removeHeaderElements() {
        for (var i = 0; i < activeObservers.length; i++) {
            activeObservers[i].disconnect();
        }
        activeObservers = [];

        for (var j = 0; j < HEADER_ELEMENT_IDS.length; j++) {
            var el = document.getElementById(HEADER_ELEMENT_IDS[j]);
            if (el) el.remove();
        }

        for (var k = 0; k < HEADER_ELEMENT_CLASSES.length; k++) {
            var els = document.querySelectorAll('.' + HEADER_ELEMENT_CLASSES[k]);
            for (var l = 0; l < els.length; l++) els[l].remove();
        }

        vipValueElement = null;
        cashValueElement = null;
        anchorValueElement = null;
        headerCreated = false;
    }

    function handleResize() {
        removeHeaderElements();
        window._bunkerPriceReset = true;
        window.dispatchEvent(new CustomEvent('rebelship-header-resize'));
        var retries = 0;
        function tryCreate() {
            if (createHeader()) {
                updateDisplayValues();
                subscribeToStore();
            } else if (retries < 5) {
                retries++;
                setTimeout(tryCreate, 200);
            }
        }
        setTimeout(tryCreate, 300);
    }

    var resizeTimeout = null;
    var lastWidth = window.innerWidth;
    function debouncedResize() {
        var newWidth = window.innerWidth;
        if (newWidth === lastWidth) return;
        lastWidth = newWidth;
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(handleResize, 500);
    }

    // ============================================
    // Init
    // ============================================
    function init() {
        if (initRetries >= MAX_RETRIES) return;

        var headerReady = document.querySelector('.companyContent') || document.querySelector('.headerSubContent');

        if (headerReady) {
            injectCSS();
            createHeader();
            updateDisplayValues();
            subscribeToStore();
        } else {
            initRetries++;
            setTimeout(init, 500);
        }
    }

    window.addEventListener('resize', debouncedResize);

    window.addEventListener('beforeunload', function() {
        for (var i = 0; i < activeObservers.length; i++) activeObservers[i].disconnect();
        activeObservers = [];
        if (resizeTimeout) clearTimeout(resizeTimeout);
    });

    init();
})();
