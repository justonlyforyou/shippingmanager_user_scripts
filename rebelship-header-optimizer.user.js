// ==UserScript==
// @name        Shipping Manager - Rebelship Header Optimizer
// @description Important script to handle all the Rebelship UI header elements for all scripts.
// @version     3.47
// @author      https://github.com/justonlyforyou/
// @order       1000
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @grant       none
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
        'rebel-mobile-header',
        'rebel-mobile-right',
        'rebel-stock-display'
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

    // Check if mobile view
    function isMobileView() {
        return window.innerWidth < 768;
    }

    // Position Cart Button and RebelShip Menu to the right on mobile
    function positionMobileRightElements() {
        if (!isMobileView()) return;

        var cartBtn = document.getElementById('rebelship-cart-btn');
        var rebelMenu = document.getElementById('rebelship-menu');

        if (!cartBtn && !rebelMenu) return;

        // Find or create the right-side container in headerMainContent
        var rightContainer = document.getElementById('rebel-mobile-right');
        if (!rightContainer) {
            var headerMainContent = document.querySelector('.headerMainContent');
            if (!headerMainContent) return;

            rightContainer = document.createElement('div');
            rightContainer.id = 'rebel-mobile-right';
            headerMainContent.appendChild(rightContainer);
        }
        // Always update styles
        rightContainer.style.cssText = 'display:flex;align-items:center;gap:4px;position:absolute;right:8px;top:50%;transform:translateY(calc(-50% + 20px));z-index:100;';

        // Move cart button to right container if not already there
        if (cartBtn && cartBtn.parentNode !== rightContainer) {
            rightContainer.appendChild(cartBtn);
        }

        // Move rebelship menu to right container if not already there
        if (rebelMenu && rebelMenu.parentNode !== rightContainer) {
            rebelMenu.style.marginLeft = '-2px';
            rightContainer.appendChild(rebelMenu);
        }
    }

    // MutationObserver to catch when other scripts add elements
    var mobileObserver = null;
    function startMobileObserver() {
        if (mobileObserver || !isMobileView()) return;

        mobileObserver = new MutationObserver(function() {
            positionMobileRightElements();
        });

        mobileObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial positioning
        positionMobileRightElements();
        console.log('[HeaderResize] Mobile observer started');
    }

    function stopMobileObserver() {
        if (mobileObserver) {
            mobileObserver.disconnect();
            mobileObserver = null;
        }
        // Remove the right container
        var rightContainer = document.getElementById('rebel-mobile-right');
        if (rightContainer) rightContainer.remove();
    }

    // Create custom mobile header layout
    function createMobileHeader() {
        if (!isMobileView() || mobileHeaderCreated) return false;
        if (document.getElementById('rebel-mobile-header')) return false;

        var headerSubContent = document.querySelector('.headerSubContent');
        if (!headerSubContent) return false;

        // Get original elements
        var originalXpButton = document.querySelector('.ceo-progress-container');
        var originalStockInfo = document.querySelector('.stockInfo');
        var originalCash = document.querySelector('.contentBar.cash');
        var originalPoints = document.querySelector('.contentBar.points');

        if (!originalXpButton || !originalStockInfo) return false;

        // Hide original cash and points in headerMainContent
        if (originalCash) originalCash.style.display = 'none';
        if (originalPoints) originalPoints.style.display = 'none';

        // Hide original headerSubContent
        headerSubContent.style.display = 'none';

        // Create new mobile header container
        var container = document.createElement('div');
        container.id = 'rebel-mobile-header';
        container.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%;padding:2px 10px;position:absolute;bottom:2px;';

        // === TOP ROW: XP (original) + Company ===
        var topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:2px;margin-left:-15px;';

        // Clone the ORIGINAL XP button and keep it updated
        var xpClone = originalXpButton.cloneNode(true);
        xpClone.style.cssText = 'cursor:pointer;';
        xpClone.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            originalXpButton.click();
        });
        topRow.appendChild(xpClone);

        // Observer to keep XP clone updated
        var xpObserver = new MutationObserver(function() {
            xpClone.innerHTML = originalXpButton.innerHTML;
        });
        xpObserver.observe(originalXpButton, { childList: true, subtree: true, characterData: true });

        // Get company name from headerSubContent (it's a p.cursor-pointer element)
        var companyNameEl = headerSubContent.querySelector('p.cursor-pointer');
        if (companyNameEl) {
            var companyClone = companyNameEl.cloneNode(true);
            companyClone.style.cssText = 'color:#ffffff !important;font-weight:bold;cursor:pointer;margin:0;';
            companyClone.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                companyNameEl.click();
            });
            topRow.appendChild(companyClone);
        }

        // Build 3-line stock display - LEFT in container (sub-header row)
        var stockBlock = document.createElement('div');
        stockBlock.id = 'rebel-stock-display';
        stockBlock.style.cssText = 'display:flex;flex-direction:column;align-items:center;text-align:center;line-height:1.2;cursor:pointer;position:absolute;left:5px;top:6px;min-width:50px;';
        stockBlock.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            originalStockInfo.click();
        });

        // Extract all values from original stockInfo
        var stockValues = [];
        var allTextNodes = originalStockInfo.querySelectorAll('span, p, div');
        allTextNodes.forEach(function(el) {
            var text = el.textContent.trim();
            // Only direct text, not nested
            if (el.children.length === 0 && text && text.length > 0) {
                stockValues.push(text);
            }
        });
        // Fallback: get all text content and split
        if (stockValues.length === 0) {
            var fullText = originalStockInfo.textContent.trim();
            // Try to extract dollar amounts and percentages
            var matches = fullText.match(/[\$\d.,]+|[\+\-]?[\d.]+%/g);
            if (matches) {
                stockValues = matches;
            }
        }
        console.log('[HeaderResize] Stock values:', stockValues);

        // Get trend color from Pinia store (stock_trend: "up" or "down")
        var originalSvg = originalStockInfo.querySelector('svg');
        var userStore = getUserStore();
        var stockTrend = userStore && userStore.user ? userStore.user.stock_trend : null;
        var trendColor = '#ffffff';
        if (stockTrend === 'down') {
            trendColor = '#ef4444';
        } else if (stockTrend === 'up') {
            trendColor = '#4ade80';
        }
        console.log('[HeaderResize] Stock trend:', stockTrend, '-> color:', trendColor);

        // Line 1: Main value (same color as trend)
        var line1 = document.createElement('span');
        line1.style.cssText = 'font-weight:bold;font-size:12px;color:' + trendColor + ';text-align:center;width:100%;';
        line1.textContent = stockValues[0] || '...';
        stockBlock.appendChild(line1);

        // Line 2: Change value
        var line2 = document.createElement('span');
        line2.style.cssText = 'font-size:12px;color:' + trendColor + ';text-align:center;width:100%;';
        line2.textContent = stockValues[1] || '';
        stockBlock.appendChild(line2);

        // Line 3: Percent + original SVG
        var line3 = document.createElement('div');
        line3.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:2px;font-size:12px;color:' + trendColor + ';width:100%;';
        var percentText = document.createElement('span');
        percentText.textContent = stockValues[2] || '';
        line3.appendChild(percentText);
        if (originalSvg) {
            var svgClone = originalSvg.cloneNode(true);
            svgClone.style.width = '10px';
            svgClone.style.height = '10px';
            svgClone.style.fill = trendColor;
            // Set fill on all paths inside SVG
            var paths = svgClone.querySelectorAll('path, polygon, circle, rect');
            paths.forEach(function(p) { p.style.fill = trendColor; });
            line3.appendChild(svgClone);
        }
        stockBlock.appendChild(line3);

        container.appendChild(stockBlock);

        // Observer to keep Stock updated
        var stockObserver = new MutationObserver(function() {
            // Re-extract values
            var newValues = [];
            var newTextNodes = originalStockInfo.querySelectorAll('span, p, div');
            newTextNodes.forEach(function(el) {
                var text = el.textContent.trim();
                if (el.children.length === 0 && text && text.length > 0) {
                    newValues.push(text);
                }
            });
            if (newValues.length === 0) {
                var newFullText = originalStockInfo.textContent.trim();
                var newMatches = newFullText.match(/[\$\d.,]+|[\+\-]?[\d.]+%/g);
                if (newMatches) newValues = newMatches;
            }

            // Re-check trend color from Pinia store
            var newSvg = originalStockInfo.querySelector('svg');
            var newUserStore = getUserStore();
            var newStockTrend = newUserStore && newUserStore.user ? newUserStore.user.stock_trend : null;
            var newTrendColor = '#ffffff';
            if (newStockTrend === 'down') {
                newTrendColor = '#ef4444';
            } else if (newStockTrend === 'up') {
                newTrendColor = '#4ade80';
            }

            // Update display
            line1.textContent = newValues[0] || '...';
            line1.style.color = newTrendColor;
            line2.textContent = newValues[1] || '';
            line2.style.color = newTrendColor;
            percentText.textContent = newValues[2] || '';
            line3.style.color = newTrendColor;

            // Update SVG with proper colors
            if (newSvg) {
                var existingSvg = line3.querySelector('svg');
                var svgCloneNew = newSvg.cloneNode(true);
                svgCloneNew.style.width = '10px';
                svgCloneNew.style.height = '10px';
                svgCloneNew.style.fill = newTrendColor;
                var pathsNew = svgCloneNew.querySelectorAll('path, polygon, circle, rect');
                pathsNew.forEach(function(p) { p.style.fill = newTrendColor; });

                if (existingSvg) {
                    existingSvg.replaceWith(svgCloneNew);
                } else {
                    line3.appendChild(svgCloneNew);
                }
            }
        });
        stockObserver.observe(originalStockInfo, { childList: true, subtree: true, characterData: true });

        container.appendChild(topRow);

        // === BOTTOM ROW: VIP Points + Cash ===
        var bottomRow = document.createElement('div');
        bottomRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;margin-top:1px;margin-left:-15px;';

        // VIP Points container
        if (originalPoints) {
            var vipContainer = document.createElement('div');
            vipContainer.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';

            // Get VIP icon from original
            var vipIcon = originalPoints.querySelector('svg');
            if (vipIcon) {
                var vipIconClone = vipIcon.cloneNode(true);
                vipIconClone.setAttribute('width', '14');
                vipIconClone.setAttribute('height', '14');
                vipContainer.appendChild(vipIconClone);
            }

            // VIP value
            vipValueElement = document.createElement('span');
            vipValueElement.style.cssText = 'color:#fbbf24;font-size:12px;font-weight:bold;';
            vipValueElement.textContent = '...';
            vipContainer.appendChild(vipValueElement);

            // Forward click to original
            vipContainer.addEventListener('click', function() {
                originalPoints.click();
            });

            bottomRow.appendChild(vipContainer);
        }

        // Cash container
        var cashContainer = document.createElement('div');
        cashContainer.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';

        // Get cash icon from original
        if (originalCash) {
            var cashIcon = originalCash.querySelector('svg');
            if (cashIcon) {
                var cashIconClone = cashIcon.cloneNode(true);
                cashIconClone.setAttribute('width', '14');
                cashIconClone.setAttribute('height', '14');
                cashContainer.appendChild(cashIconClone);
            }
        }

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

            // VIP Points
            if (vipValueElement && user.points !== undefined) {
                vipValueElement.textContent = formatPoints(user.points);
            }

            // Cash
            if (cashValueElement && user.cash !== undefined) {
                cashValueElement.textContent = formatCash(user.cash);
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
            startMobileObserver();
        } else {
            stopMobileObserver();
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

    console.log('[HeaderResize] v3.47');
})();
