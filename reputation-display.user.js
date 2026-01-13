// ==UserScript==
// @name        Shipping Manager - Auto Reputation & Reputation Header Display
// @description Shows reputation in header, auto-renews campaigns when expired
// @version     5.5
// @author      joseywales - Pimped by https://github.com/justonlyforyou/
// @order       20
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    var SCRIPT_NAME = 'Auto Reputation';
    var STORAGE_KEY = 'rebelship_reputation_settings';
    var isMobile = window.innerWidth < 1024;
    var reputationElement = null;
    var isProcessing = false;

    // ========== SETTINGS ==========
    var settings = {
        autoRenewalEnabled: false,
        minCash: 0,
        systemNotifications: false
    };

    function loadSettings() {
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                var parsed = JSON.parse(saved);
                settings = { ...settings, ...parsed };
            }
        } catch (e) {
            console.error('[Reputation] Failed to load settings:', e);
        }
        return settings;
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            syncSettingsToAndroid();
        } catch (e) {
            console.error('[Reputation] Failed to save settings:', e);
        }
    }

    function syncSettingsToAndroid() {
        if (typeof window.RebelShipBridge !== 'undefined' && window.RebelShipBridge.syncSettings) {
            try {
                window.RebelShipBridge.syncSettings(STORAGE_KEY, JSON.stringify(settings));
            } catch {
                // Ignore sync errors
            }
        }
    }

    // ========== API FUNCTIONS ==========
    async function fetchWithCookie(url, options) {
        var response = await fetch(url, {
            ...options,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        return response.json();
    }

    async function fetchUserSettings() {
        return fetchWithCookie('https://shippingmanager.cc/api/user/get-user-settings', {
            method: 'GET'
        });
    }

    async function fetchCampaigns() {
        return fetchWithCookie('https://shippingmanager.cc/api/marketing-campaign/get-marketing', {
            method: 'POST',
            body: JSON.stringify({})
        });
    }

    async function activateCampaign(campaignId) {
        return fetchWithCookie('https://shippingmanager.cc/api/marketing-campaign/activate-marketing-campaign', {
            method: 'POST',
            body: JSON.stringify({ campaign_id: campaignId })
        });
    }

    // ========== AUTO RENEWAL LOGIC ==========
    async function runAutoRenewal(manual) {
        if (isProcessing) {
            log('Already processing, skipping');
            return { skipped: true };
        }

        if (!manual && !settings.autoRenewalEnabled) {
            return { skipped: true };
        }

        isProcessing = true;
        log('Starting auto campaign renewal...');

        try {
            var campaignData = await fetchCampaigns();
            if (!campaignData || !campaignData.data) {
                log('Failed to fetch campaigns');
                return { error: 'Failed to fetch campaigns' };
            }

            var activeCampaigns = campaignData.data.active_campaigns || [];
            var availableCampaigns = campaignData.data.marketing_campaigns || [];

            log('Active campaigns: ' + activeCampaigns.length + ', Available: ' + availableCampaigns.length);

            // Check which types are active
            var activeCampaignTypes = {};
            activeCampaigns.forEach(function(c) {
                activeCampaignTypes[c.option_name] = true;
            });

            // Find types that need renewal
            var allPossibleTypes = ['reputation', 'awareness', 'green'];
            var typesToRenew = allPossibleTypes.filter(function(type) {
                return !activeCampaignTypes[type];
            });

            log('Types needing renewal: ' + (typesToRenew.join(', ') || 'none'));

            if (typesToRenew.length === 0) {
                log('All campaign types are active');
                if (manual) {
                    showToast('All campaigns active', 'success');
                    sendSystemNotification('Auto Reputation', 'All campaigns already active');
                }
                return { renewed: [] };
            }

            // Get current cash
            var userSettings = await fetchUserSettings();
            var currentCash = userSettings.user ? userSettings.user.cash : 0;

            if (currentCash < settings.minCash) {
                log('Cash ' + currentCash + ' below minimum ' + settings.minCash);
                if (manual) {
                    showToast('Cash below minimum: $' + currentCash.toLocaleString(), 'warning');
                    sendSystemNotification('Auto Reputation', 'Cash $' + currentCash.toLocaleString() + ' below minimum $' + settings.minCash.toLocaleString());
                }
                return { skipped: true, reason: 'low_cash' };
            }

            var renewed = [];

            for (var i = 0; i < typesToRenew.length; i++) {
                var type = typesToRenew[i];

                // Find best affordable campaign of this type
                var campaignsOfType = availableCampaigns
                    .filter(function(c) { return c.option_name === type && c.price <= currentCash; })
                    .sort(function(a, b) { return b.price - a.price; });

                if (campaignsOfType.length > 0) {
                    var campaign = campaignsOfType[0];

                    try {
                        await activateCampaign(campaign.id);
                        renewed.push({
                            type: type,
                            name: campaign.name,
                            price: campaign.price,
                            duration: campaign.campaign_duration
                        });
                        currentCash -= campaign.price;
                        log('Renewed "' + campaign.name + '" - Cost: $' + campaign.price.toLocaleString());
                    } catch (e) {
                        log('Failed to renew ' + type + ': ' + e.message);
                    }
                } else {
                    log('No affordable ' + type + ' campaigns');
                }
            }

            if (renewed.length > 0) {
                var summary = renewed.map(function(r) { return r.name; }).join(', ');
                var totalCost = renewed.reduce(function(sum, r) { return sum + r.price; }, 0);

                showToast('Renewed ' + renewed.length + ' campaign(s): ' + summary, 'success');

                if (settings.systemNotifications || manual) {
                    sendSystemNotification('Campaigns Renewed', renewed.length + ' campaign(s) renewed - $' + totalCost.toLocaleString());
                }
            } else if (manual) {
                // Manual run but nothing could be renewed (not enough cash for any campaign)
                showToast('No campaigns could be renewed (not enough cash)', 'warning');
            }

            return { renewed: renewed };

        } catch (e) {
            log('Error: ' + e.message);
            showToast('Renewal Error: ' + e.message, 'error');
            return { error: e.message };
        } finally {
            isProcessing = false;
        }
    }

    // ========== LOGGING & NOTIFICATIONS ==========
    function log(message) {
        console.log('[' + SCRIPT_NAME + '] ' + message);
    }

    function getToastStore() {
        try {
            var appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            var app = appEl.__vue_app__;
            var pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('toast');
        } catch {
            return null;
        }
    }

    function getStores() {
        try {
            var appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            var app = appEl.__vue_app__;
            var pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return null;
            return {
                modalStore: pinia._s.get('modal')
            };
        } catch {
            return null;
        }
    }

    function showToast(message, type) {
        var toastStore = getToastStore();
        if (toastStore && toastStore.add) {
            toastStore.add({ message: message, type: type || 'info' });
        } else {
            log('Toast: ' + message);
        }
    }

    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    function sendSystemNotification(title, message) {
        if (typeof window.RebelShipNotify !== 'undefined' && window.RebelShipNotify.notify) {
            try {
                window.RebelShipNotify.notify(title + ': ' + message);
                return;
            } catch { }
        }

        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                try {
                    new Notification(title, { body: message, icon: 'https://shippingmanager.cc/favicon.ico', tag: 'reputation' });
                } catch { }
            } else if (Notification.permission === 'default') {
                Notification.requestPermission().then(function(permission) {
                    if (permission === 'granted') {
                        new Notification(title, { body: message, icon: 'https://shippingmanager.cc/favicon.ico', tag: 'reputation' });
                    }
                });
            }
        }
    }

    // ========== UI: DISPLAY ==========
    function getReputationColor(rep) {
        if (rep >= 80) return '#4ade80';
        if (rep >= 50) return '#fbbf24';
        return '#ef4444';
    }

    function getOrCreateMobileRow() {
        var existing = document.getElementById('rebel-mobile-row');
        if (existing) return existing;

        var row = document.createElement('div');
        row.id = 'rebel-mobile-row';
        row.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;display:flex !important;flex-wrap:nowrap !important;justify-content:space-between !important;align-items:center !important;gap:4px !important;background:#1a1a2e !important;padding:4px 6px !important;font-size:14px !important;z-index:9999 !important;';
        var leftSection = document.createElement('div'); leftSection.id = 'rebel-mobile-left'; leftSection.style.cssText = 'display:flex;align-items:center;gap:4px;'; row.appendChild(leftSection); var rightSection = document.createElement('div'); rightSection.id = 'rebel-mobile-right'; rightSection.style.cssText = 'display:flex;align-items:center;gap:4px;'; row.appendChild(rightSection); document.body.appendChild(row);
        var appContainer = document.querySelector('#app') || document.body.firstElementChild;
        if (appContainer) appContainer.style.marginTop = '2px';
        return row;
    }

    function openFinanceMarketing() {
        var stockInfo = document.querySelector('.stockInfo');
        if (stockInfo) {
            stockInfo.click();
            setTimeout(function() {
                var marketingBtn = document.getElementById('marketing-page-btn');
                if (marketingBtn) {
                    marketingBtn.click();
                }
            }, 300);
        }
    }

    function createReputationDisplay() {
        if (reputationElement) return reputationElement;

        if (isMobile) {
            var row = getOrCreateMobileRow();
            if (!row) return null;
            reputationElement = document.createElement('div');
            reputationElement.id = 'reputation-display';
            reputationElement.style.cssText = 'display:flex !important;align-items:center !important;padding:0 !important;font-size:13px !important;font-weight:bold !important;cursor:pointer !important;color:#fbbf24 !important;';
            reputationElement.textContent = 'Rep: ...';
            reputationElement.addEventListener('click', openFinanceMarketing);
            var leftSection = document.getElementById('rebel-mobile-left');
            if (leftSection) leftSection.appendChild(reputationElement);
            else row.appendChild(reputationElement);
            return reputationElement;
        }

        var companyContent = document.querySelector('.companyContent');
        if (!companyContent) return null;
        reputationElement = document.createElement('span');
        reputationElement.id = 'reputation-display';
        reputationElement.style.cssText = 'margin-left:4px !important;font-size:13px !important;cursor:pointer;color:#fbbf24;text-decoration:underline;';
        reputationElement.textContent = 'Rep: ...';
        reputationElement.addEventListener('click', openFinanceMarketing);

        var stockInfo = companyContent.querySelector('.stockInfo');
        if (stockInfo && stockInfo.parentNode) {
            stockInfo.parentNode.insertBefore(reputationElement, stockInfo.nextSibling);
        } else {
            companyContent.appendChild(reputationElement);
        }
        return reputationElement;
    }

    function updateReputationDisplay(rep) {
        var el = document.getElementById('reputation-display');
        if (!el) {
            el = createReputationDisplay();
        }
        if (el) {
            el.textContent = isMobile ? 'Rep: ' + rep + '%' : 'Rep: ' + rep + '%';
            el.style.color = getReputationColor(rep);
        }
    }

    // ========== UI: REBELSHIP MENU ==========
    var REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    function getOrCreateRebelShipMenu() {
        var menu = document.getElementById('rebelship-menu');
        if (menu) {
            var dropdown = menu.querySelector('.rebelship-dropdown');
            if (dropdown) return dropdown;
        }
        if (isMobile) {
            var row = getOrCreateMobileRow();
            if (!row) return null;
            var container = document.createElement('div');
            container.id = 'rebelship-menu';
            container.style.cssText = 'position:relative;display:inline-block;;';
            var btn = document.createElement('button');
            btn.id = 'rebelship-menu-btn';
            btn.innerHTML = REBELSHIP_LOGO;
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:18px;height:18px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;';
            btn.title = 'RebelShip Menu';
            dropdown = document.createElement('div');
            dropdown.className = 'rebelship-dropdown';
            dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';
            container.appendChild(btn);
            container.appendChild(dropdown);
            btn.addEventListener('click', function(e) { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; });
            document.addEventListener('click', function(e) { if (!container.contains(e.target)) dropdown.style.display = 'none'; });
            var rightSection = document.getElementById('rebel-mobile-right'); if (rightSection) { rightSection.appendChild(container); } else { row.appendChild(container); }
            return dropdown;
        }
        var messagingIcon = document.querySelector('div.messaging.cursor-pointer') || document.querySelector('.messaging');
        if (!messagingIcon) return null;
        container = document.createElement('div');
        container.id = 'rebelship-menu';
        container.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:4px !important;margin-left:auto;';
        btn = document.createElement('button');
        btn.id = 'rebelship-menu-btn';
        btn.innerHTML = REBELSHIP_LOGO;
        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        btn.title = 'RebelShip Menu';
        dropdown = document.createElement('div');
        dropdown.className = 'rebelship-dropdown';
        dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';
        container.appendChild(btn);
        container.appendChild(dropdown);
        btn.addEventListener('click', function(e) { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; });
        document.addEventListener('click', function(e) { if (!container.contains(e.target)) dropdown.style.display = 'none'; });
        if (!messagingIcon.parentNode) return null;
        messagingIcon.parentNode.insertBefore(container, messagingIcon);
        return dropdown;
    }

    function addMenuItem(label, onClick) {
        var dropdown = getOrCreateRebelShipMenu();
        if (!dropdown) { setTimeout(function() { addMenuItem(label, onClick); }, 1000); return null; }
        if (dropdown.querySelector('[data-rebelship-item="' + label + '"]')) return dropdown.querySelector('[data-rebelship-item="' + label + '"]');
        var item = document.createElement('div');
        item.dataset.rebelshipItem = label;
        item.style.cssText = 'position:relative;';
        var itemBtn = document.createElement('div');
        itemBtn.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:13px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
        itemBtn.innerHTML = '<span>' + label + '</span>';
        itemBtn.addEventListener('mouseenter', function() { itemBtn.style.background = '#374151'; });
        itemBtn.addEventListener('mouseleave', function() { itemBtn.style.background = 'transparent'; });
        if (onClick) itemBtn.addEventListener('click', onClick);
        item.appendChild(itemBtn);
        dropdown.appendChild(item);
        return item;
    }

    // ========== UI: SETTINGS MODAL (Game Modal) ==========
    function openSettingsModal() {
        var stores = getStores();
        var modalStore = stores ? stores.modalStore : null;
        if (!modalStore) { log('modalStore not found'); return; }

        modalStore.open('routeResearch');

        setTimeout(function() {
            if (modalStore.modalSettings) {
                modalStore.modalSettings.title = 'Auto Reputation Settings';
                modalStore.modalSettings.navigation = [];
                modalStore.modalSettings.controls = [];
            }

            var centralContainer = document.getElementById('central-container');
            if (!centralContainer) return;

            centralContainer.innerHTML = '\
                <div style="padding:20px;max-width:400px;margin:0 auto;font-family:Lato,sans-serif;color:#01125d;">\
                    <div style="margin-bottom:20px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:16px;">\
                            <input type="checkbox" id="rep-auto-renewal" ' + (settings.autoRenewalEnabled ? 'checked' : '') + '\
                                   style="width:20px;height:20px;margin-right:12px;accent-color:#0db8f4;cursor:pointer;">\
                            <span>Auto-Renew Campaigns</span>\
                        </label>\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;margin-left:32px;">\
                            Automatically renews reputation, awareness, and green campaigns when they expire. Buys the most expensive campaign you can afford while respecting your minimum cash balance.\
                        </div>\
                    </div>\
                    <div style="margin-bottom:20px;">\
                        <label style="display:block;font-weight:700;font-size:14px;margin-bottom:8px;">Minimum Cash Balance</label>\
                        <input type="number" id="rep-min-cash" value="' + settings.minCash + '"\
                               style="width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;" placeholder="0">\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;">\
                            Only renew campaigns if cash balance is above this amount\
                        </div>\
                    </div>\
                    <div style="margin-bottom:24px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:14px;">\
                            <input type="checkbox" id="rep-notifications" ' + (settings.systemNotifications ? 'checked' : '') + '\
                                   style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;cursor:pointer;">\
                            <span>System Notifications</span>\
                        </label>\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;margin-left:28px;">\
                            Send push notifications when campaigns are renewed\
                        </div>\
                    </div>\
                    <div style="display:flex;gap:12px;justify-content:space-between;margin-top:30px;">\
                        <button id="rep-run-now" style="padding:10px 24px;background:linear-gradient(180deg,#3b82f6,#1d4ed8);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">Run Now</button>\
                        <button id="rep-save" style="padding:10px 24px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:16px;font-weight:500;">Save</button>\
                    </div>\
                </div>';

            document.getElementById('rep-run-now').addEventListener('click', async function() {
                this.disabled = true;
                this.textContent = 'Running...';
                await runAutoRenewal(true);
                this.textContent = 'Run Now';
                this.disabled = false;
            });

            document.getElementById('rep-save').addEventListener('click', function() {
                settings.autoRenewalEnabled = document.getElementById('rep-auto-renewal').checked;
                settings.minCash = parseInt(document.getElementById('rep-min-cash').value, 10) || 0;
                settings.systemNotifications = document.getElementById('rep-notifications').checked;
                if (settings.systemNotifications) {
                    requestNotificationPermission();
                }
                saveSettings();
                log('Settings saved: autoRenewal=' + settings.autoRenewalEnabled + ', minCash=' + settings.minCash + ', notifications=' + settings.systemNotifications);
                showToast('Reputation settings saved', 'success');
                modalStore.closeAll();
            });
        }, 150);
    }

    // ========== MAIN UPDATE LOOP ==========
    async function updateReputation() {
        try {
            var data = await fetchUserSettings();
            var rep = data && data.user ? data.user.reputation : null;

            if (rep !== null && rep !== undefined) {
                updateReputationDisplay(rep);
            }

            // Check for auto renewal
            if (settings.autoRenewalEnabled) {
                var campaignData = await fetchCampaigns();
                if (campaignData && campaignData.data) {
                    var activeCampaigns = campaignData.data.active_campaigns || [];
                    var activeCampaignTypes = {};
                    activeCampaigns.forEach(function(c) {
                        activeCampaignTypes[c.option_name] = true;
                    });

                    var allTypes = ['reputation', 'awareness', 'green'];
                    var missingTypes = allTypes.filter(function(t) { return !activeCampaignTypes[t]; });

                    if (missingTypes.length > 0) {
                        log('Missing campaign types: ' + missingTypes.join(', ') + ' - triggering renewal');
                        await runAutoRenewal(false);
                    }
                }
            }
        } catch (e) {
            console.error('[Reputation] Error:', e);
        }
    }

    // ========== INIT ==========
    var uiInitialized = false;

    function initUI() {
        if (uiInitialized) return;
        var hasApp = document.getElementById('app');
        if (!hasApp) {
            setTimeout(initUI, 500);
            return;
        }
        uiInitialized = true;
        addMenuItem('Auto Reputation', openSettingsModal);
        log('Menu item added');
    }

    function init() {
        loadSettings();
        initUI();

        // Initial update with delay
        setTimeout(function() {
            updateReputation();
            // Check every 2 minutes
            setInterval(updateReputation, 2 * 60 * 1000);
        }, isMobile ? 3000 : 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 2000); });
    } else {
        setTimeout(init, 2000);
    }
})();
