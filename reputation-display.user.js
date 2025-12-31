// ==UserScript==
// @name        Shipping Manager - Reputation Display
// @description Shows reputation next to company name, click to open Finance modal
// @version     3.7
// @author      joseywales - Pimped by https://github.com/justonlyforyou/
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    const API_URL = "https://shippingmanager.cc/api/user/get-user-settings";
    const isMobile = window.innerWidth < 1024;
    let reputationElement = null;

    function getReputationColor(rep) {
        if (rep >= 80) return "#8fffa1";
        if (rep >= 50) return "#fff176";
        return "#ff8a80";
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

    function createReputationLink() {
        if (reputationElement) return reputationElement;

        // Mobile: insert into mobile row
        if (isMobile) {
            var row = getOrCreateMobileRow();
            if (!row) return null;

            reputationElement = document.createElement('div');
            reputationElement.id = 'reputation-display';
            reputationElement.style.cssText = 'display:flex;align-items:center;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:bold;cursor:pointer;background:#ffdf5c;color:#333;';
            reputationElement.textContent = 'Rep: ...';

            reputationElement.addEventListener('click', () => {
                const stockInfo = document.querySelector('.stockInfo');
                if (stockInfo) {
                    stockInfo.click();
                    setTimeout(() => {
                        const marketingBtn = document.getElementById('marketing-page-btn');
                        if (marketingBtn) {
                            marketingBtn.click();
                        }
                    }, 300);
                }
            });

            var menu = row.querySelector('#rebelship-menu'); if (menu) { row.insertBefore(reputationElement, menu); } else { row.appendChild(reputationElement); }
            return reputationElement;
        }

        // Desktop: insert after stockInfo
        const companyContent = document.querySelector('.companyContent');
        if (!companyContent) return null;

        reputationElement = document.createElement('div');
        reputationElement.id = 'reputation-display';
        reputationElement.style.cssText = 'display:inline-flex;align-items:center;margin-left:10px;padding:2px 8px;border-radius:4px;font-size:13px;font-weight:bold;cursor:pointer;background:#ffdf5c;color:#333;';
        reputationElement.textContent = 'Reputation: ...';

        reputationElement.addEventListener('click', () => {
            const stockInfo = document.querySelector('.stockInfo');
            if (stockInfo) {
                stockInfo.click();
                setTimeout(() => {
                    const marketingBtn = document.getElementById('marketing-page-btn');
                    if (marketingBtn) {
                        marketingBtn.click();
                    }
                }, 300);
            }
        });

        const stockInfo = companyContent.querySelector('.stockInfo');
        if (stockInfo && stockInfo.parentNode) {
            stockInfo.parentNode.insertBefore(reputationElement, stockInfo.nextSibling);
        } else {
            companyContent.appendChild(reputationElement);
        }

        return reputationElement;
    }

    async function updateReputation() {
        try {
            const response = await fetch(API_URL, { credentials: "include" });
            if (!response.ok) return;

            const data = await response.json();
            const rep = data?.user?.reputation;

            if (rep === undefined || rep === null) return;

            let el = document.getElementById('reputation-display');
            if (!el) {
                el = createReputationLink();
            }

            if (el) {
                el.textContent = isMobile ? 'Rep: ' + rep + '%' : 'Reputation: ' + rep + '%';
                el.style.background = getReputationColor(rep);
                el.style.color = rep >= 80 ? '#333' : '#330000';
            }
        } catch (err) {
            console.error("[Reputation] Error:", err);
        }
    }

    function init() {
        if (isMobile) {
            setTimeout(() => {
                updateReputation();
                setInterval(updateReputation, 2 * 60 * 1000);
            }, 3000);
        } else {
            const companyContent = document.querySelector('.companyContent');
            if (companyContent) {
                updateReputation();
                setInterval(updateReputation, 2 * 60 * 1000);
            } else {
                setTimeout(init, 1000);
            }
        }
    }

    init();
})();
