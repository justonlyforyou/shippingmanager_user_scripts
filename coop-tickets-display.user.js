// ==UserScript==
// @name        Shipping Manager - Co-Op Tickets Display
// @description Shows open Co-Op tickets, red dot on alliance tab when tickets available
// @version     2.3
// @author      https://github.com/justonlyforyou/
// @order       25
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    const isMobile = window.innerWidth < 1024;
    let coopElement = null;
    let allianceData = null;

    function getCoopColor(openTickets) {
        return openTickets === 0 ? '#4ade80' : '#ef4444';
    }

    function getOrCreateMobileRow() {
        var existing = document.getElementById('rebel-mobile-row');
        if (existing) return existing;

        var row = document.createElement('div');
        row.id = 'rebel-mobile-row';
        row.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;display:flex !important;flex-wrap:nowrap !important;justify-content:center !important;align-items:center !important;gap:4px !important;background:#1a1a2e !important;padding:4px 6px !important;font-size:14px !important;z-index:9999 !important;';
        document.body.appendChild(row);

        var appContainer = document.querySelector('#app') || document.body.firstElementChild;
        if (appContainer) {
            appContainer.style.marginTop = '2px';
        }
        return row;
    }

    function clickCoopTab() {
        var tabs = document.querySelectorAll('.tab');
        for (var i = 0; i < tabs.length; i++) {
            var tab = tabs[i];
            var text = tab.textContent.trim().toLowerCase();
            if (text.includes('co-op') || text === 'coop') {
                tab.click();
                return true;
            }
        }
        return false;
    }

    function openAllianceCoopTab() {
        var allianceBtn = document.getElementById('alliance-modal-btn');
        if (allianceBtn) {
            allianceBtn.click();
            setTimeout(clickCoopTab, 400);
        }
    }

    function updateAllianceTabDot(hasOpenTickets) {
        var allianceBtn = document.getElementById('alliance-modal-btn');
        if (!allianceBtn) return;

        // Check if wrapper exists (might be created by alliance-chat-notification script)
        var wrapper = document.getElementById('alliance-btn-wrapper');
        if (!wrapper) {
            wrapper = document.createElement('span');
            wrapper.id = 'alliance-btn-wrapper';
            wrapper.style.cssText = 'position:relative !important;display:inline-block !important;';
            allianceBtn.parentNode.insertBefore(wrapper, allianceBtn);
            wrapper.appendChild(allianceBtn);
        }

        var existingDot = document.getElementById('coop-notification-dot');

        if (hasOpenTickets) {
            if (!existingDot) {
                var dot = document.createElement('div');
                dot.id = 'coop-notification-dot';
                dot.style.cssText = 'position:absolute !important;top:-2px !important;left:5px !important;width:10px !important;height:10px !important;background:#ef4444 !important;border-radius:50% !important;box-shadow:0 0 6px rgba(239,68,68,0.8) !important;z-index:100 !important;pointer-events:none !important;';
                wrapper.appendChild(dot);
            }
        } else {
            if (existingDot) {
                existingDot.remove();
            }
        }
    }

    function createCoopDisplay() {
        if (coopElement) return coopElement;

        if (isMobile) {
            var row = getOrCreateMobileRow();
            if (!row) return null;

            coopElement = document.createElement('div');
            coopElement.id = 'coop-tickets-display';
            coopElement.style.cssText = 'display:flex !important;align-items:center !important;padding:0 !important;font-size:12px !important;font-weight:bold !important;cursor:pointer !important;color:#4ade80 !important;';
            coopElement.textContent = 'CoOp: ...';
            coopElement.addEventListener('click', openAllianceCoopTab);

            // Insert before menu (same as reputation-display)
            var menu = row.querySelector('#rebelship-menu');
            if (menu) {
                row.insertBefore(coopElement, menu);
            } else {
                row.appendChild(coopElement);
            }
            return coopElement;
        }

        var companyContent = document.querySelector('.companyContent');
        if (!companyContent) return null;

        coopElement = document.createElement('div');
        coopElement.id = 'coop-tickets-display';
        coopElement.style.cssText = 'display:inline-flex;align-items:center;margin-left:10px;padding:2px 8px;border-radius:4px;font-size:13px;font-weight:bold;cursor:pointer;background:#4ade80;color:#333;';
        coopElement.textContent = 'Co-Op: ...';
        coopElement.addEventListener('click', openAllianceCoopTab);

        var repDisplay = document.getElementById('reputation-display');
        if (repDisplay && repDisplay.parentNode) {
            repDisplay.parentNode.insertBefore(coopElement, repDisplay.nextSibling);
        } else {
            var stockInfo = companyContent.querySelector('.stockInfo');
            if (stockInfo && stockInfo.parentNode) {
                stockInfo.parentNode.insertBefore(coopElement, stockInfo.nextSibling);
            } else {
                companyContent.appendChild(coopElement);
            }
        }

        return coopElement;
    }

    async function fetchUserAlliance() {
        try {
            var response = await fetch('/api/alliance/get-user-alliance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });
            if (!response.ok) return null;
            var data = await response.json();
            return data?.data?.alliance || null;
        } catch (e) {
            return null;
        }
    }

    async function fetchQueuePool() {
        try {
            var response = await fetch('/api/alliance/get-queue-pool-for-alliance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });
            if (!response.ok) return null;
            var data = await response.json();
            return data?.data?.pool?.direct || [];
        } catch (e) {
            return null;
        }
    }

    async function updateCoopDisplay() {
        var pool = await fetchQueuePool();
        var openTickets = pool ? pool.length : 0;
        var maxTickets = allianceData?.benefit?.coop_boost || 0;

        updateAllianceTabDot(openTickets > 0);

        var el = document.getElementById('coop-tickets-display');
        if (!el) {
            el = createCoopDisplay();
        }

        if (el) {
            if (isMobile) {
                el.textContent = 'CoOp: ' + openTickets + '/' + maxTickets;
                el.style.color = getCoopColor(openTickets);
            } else {
                el.textContent = 'Co-Op: ' + openTickets + '/' + maxTickets;
                el.style.background = getCoopColor(openTickets);
            }
        }
    }

    async function init() {
        allianceData = await fetchUserAlliance();

        if (!allianceData || !allianceData.id) {
            console.log('[Co-Op] Not in alliance');
            return;
        }

        console.log('[Co-Op] In alliance:', allianceData.name);
        updateCoopDisplay();
        setInterval(updateCoopDisplay, 30000);
    }

    // Must run after reputation-display (3000ms on mobile)
    setTimeout(init, isMobile ? 3500 : 1000);
})();
