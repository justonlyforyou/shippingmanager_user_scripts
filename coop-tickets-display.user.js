// ==UserScript==
// @name        Shipping Manager - Auto Co-Op & Co-Op Header Display
// @description Shows open Co-Op tickets, auto-sends COOP vessels to alliance members
// @version     5.14
// @author      https://github.com/justonlyforyou/
// @order       20
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// @background-job-required true
// ==/UserScript==

(function() {
    'use strict';

    var SCRIPT_NAME = 'CoOp';
    var STORAGE_KEY = 'rebelship_coop_settings';
    var coopElement = null;
    var coopValueElement = null;
    var isProcessing = false;

    // Settings
    var settings = {
        autoSendEnabled: false,
        systemNotifications: false
    };

    // ========== SETTINGS ==========
    function loadSettings() {
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                var parsed = JSON.parse(saved);
                settings = { ...settings, ...parsed };
            }
        } catch (e) {
            console.error('[Co-Op] Failed to load settings:', e);
        }
        return settings;
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            syncSettingsToAndroid();
        } catch (e) {
            console.error('[Co-Op] Failed to save settings:', e);
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
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            ...options
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    }

    async function fetchCoopData() {
        var data = await fetchWithCookie('https://shippingmanager.cc/api/coop/get-coop-data', {
            method: 'POST',
            body: JSON.stringify({})
        });
        return data;
    }

    async function fetchContacts() {
        var data = await fetchWithCookie('https://shippingmanager.cc/api/contact/get-contacts', {
            method: 'POST',
            body: JSON.stringify({})
        });
        return data;
    }

    async function fetchMemberSettings() {
        try {
            var data = await fetchWithCookie('https://shippingmanager.cc/api/alliance/get-member-settings', {
                method: 'POST',
                body: JSON.stringify({})
            });
            return data;
        } catch (e) {
            console.warn('[Co-Op] Failed to fetch member settings:', e.message);
            return { data: [] };
        }
    }

    async function sendCoopVessels(userId, vesselCount) {
        var data = await fetchWithCookie('https://shippingmanager.cc/api/route/depart-coop', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, vessels: vesselCount })
        });
        return data;
    }

    // ========== AUTO COOP LOGIC ==========
    async function runAutoCoop(manual) {
        if (isProcessing) {
            return { skipped: true, reason: 'processing' };
        }
        if (!manual && !settings.autoSendEnabled) {
            return { skipped: true, reason: 'disabled' };
        }

        isProcessing = true;
        var result = { totalSent: 0, totalRequested: 0, results: [] };

        try {
            log('Starting Auto-COOP distribution...');

            // Fetch all data in parallel
            var [coopData, contactData, memberSettings] = await Promise.all([
                fetchCoopData(),
                fetchContacts(),
                fetchMemberSettings()
            ]);

            var available = coopData.data?.coop?.available;
            var members = coopData.data?.members_coop;
            var allianceContacts = contactData.data?.alliance_contacts || [];
            var settingsData = memberSettings.data || [];

            if (available === 0) {
                log('No COOP tickets available');
                return result;
            }

            log('Available COOP vessels: ' + available);

            // Build company name map
            var companyNameMap = {};
            allianceContacts.forEach(function(c) { companyNameMap[c.id] = c.company_name; });
            if (coopData.user?.id && coopData.user?.company_name) {
                companyNameMap[coopData.user.id] = coopData.user.company_name;
            }

            // Build settings map
            var settingsMap = {};
            settingsData.forEach(function(s) { settingsMap[s.user_id] = s; });

            // Filter eligible members (can receive COOP)
            var eligibleMembers = members.filter(function(member) {
                if (member.total_vessels === 0) return false;

                // Check fuel (less than 10t = 10000kg)
                var fuelTons = member.fuel / 1000;
                if (fuelTons < 10) return false;

                // Check time restrictions
                var userSettings = settingsMap[member.user_id];
                if (userSettings && userSettings.restrictions?.time_range_enabled) {
                    var startHour = userSettings.restrictions.time_restriction_arr[0];
                    var endHour = userSettings.restrictions.time_restriction_arr[1];
                    var now = new Date();
                    var currentHour = now.getUTCHours();
                    var effectiveEndHour = endHour === 0 ? 24 : endHour;

                    var inTimeRange = false;
                    if (startHour < effectiveEndHour) {
                        inTimeRange = currentHour >= startHour && currentHour < effectiveEndHour;
                    } else {
                        inTimeRange = currentHour >= startHour || currentHour < endHour;
                    }

                    if (!inTimeRange) return false;
                }

                return true;
            });

            if (eligibleMembers.length === 0) {
                log('No eligible members found');
                return result;
            }

            // Sort by total_vessels DESC (largest fleets first)
            eligibleMembers.sort(function(a, b) { return b.total_vessels - a.total_vessels; });

            log('Found ' + eligibleMembers.length + ' eligible members');

            // Send to each member
            var currentAvailable = available;
            for (var i = 0; i < eligibleMembers.length && currentAvailable > 0; i++) {
                var member = eligibleMembers[i];
                var maxToSend = Math.min(currentAvailable, member.total_vessels);
                var companyName = companyNameMap[member.user_id] || 'User ' + member.user_id;

                log('Sending ' + maxToSend + ' vessels to ' + companyName + '...');

                try {
                    var sendResult = await sendCoopVessels(member.user_id, maxToSend);

                    if (sendResult.error) {
                        log('Failed: ' + sendResult.error);
                        result.results.push({ company_name: companyName, error: sendResult.error });
                    } else {
                        var departed = sendResult.data?.vessels_departed || 0;
                        result.totalRequested += maxToSend;
                        result.totalSent += departed;
                        currentAvailable -= departed;

                        result.results.push({
                            company_name: companyName,
                            requested: maxToSend,
                            departed: departed
                        });

                        log('Sent ' + departed + '/' + maxToSend + ' to ' + companyName);
                    }

                    // Small delay between sends
                    await new Promise(function(r) { setTimeout(r, 500); });

                } catch (e) {
                    log('Error sending to ' + companyName + ': ' + e.message);
                    result.results.push({ company_name: companyName, error: e.message });
                }
            }

            log('Distribution complete: ' + result.totalSent + '/' + result.totalRequested + ' vessels');

            if (result.totalSent > 0) {
                showToast('CoOp: Sent ' + result.totalSent + ' vessels to ' + result.results.filter(function(r) { return r.departed > 0; }).length + ' members', 'success');
            } else if (result.totalRequested > 0) {
                showToast('CoOp: All sends failed', 'error');
            }

            return result;

        } catch (e) {
            log('Error: ' + e.message);
            showToast('CoOp Error: ' + e.message, 'error');
            return { error: e.message };
        } finally {
            isProcessing = false;
        }
    }

    // ========== LOGGING & NOTIFICATIONS ==========
    function log(message) {
        console.log('[' + SCRIPT_NAME + '] ' + message);
    }

    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    function sendSystemNotification(title, message) {
        if (!settings.systemNotifications) return;

        // Android bridge
        if (typeof window.RebelShipNotify !== 'undefined' && window.RebelShipNotify.notify) {
            try {
                window.RebelShipNotify.notify(title + ': ' + message);
                return;
            } catch { }
        }

        // Web Notification API
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                try {
                    new Notification(title, { body: message, icon: 'https://shippingmanager.cc/favicon.ico', tag: 'coop' });
                } catch { }
            } else if (Notification.permission === 'default') {
                Notification.requestPermission().then(function(permission) {
                    if (permission === 'granted') {
                        new Notification(title, { body: message, icon: 'https://shippingmanager.cc/favicon.ico', tag: 'coop' });
                    }
                });
            }
        }
    }

    function showToast(message, type) {
        // In-game toast
        var toastStore = getToastStore();
        if (toastStore) {
            if (type === 'error' && toastStore.error) toastStore.error(message);
            else if (type === 'warning' && toastStore.warning) toastStore.warning(message);
            else if (toastStore.success) toastStore.success(message);
        }

        // System notification
        sendSystemNotification(SCRIPT_NAME, message);
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

    // ========== PINIA STORES ==========
    function getStores() {
        try {
            var appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            var app = appEl.__vue_app__;
            var pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return null;
            return {
                allianceStore: pinia._s.get('alliance'),
                coopStore: pinia._s.get('coop'),
                modalStore: pinia._s.get('modal')
            };
        } catch {
            return null;
        }
    }

    // Cache for coop data from API
    var coopCache = { available: 0, cap: 0, lastFetch: 0 };

    async function refreshCoopCache() {
        try {
            var data = await fetchCoopData();
            if (data && data.data && data.data.coop) {
                coopCache.available = data.data.coop.available;
                // coop_boost takes priority over cap (alliance benefit)
                coopCache.cap = data.data.coop.coop_boost || data.data.coop.cap;
                coopCache.lastFetch = Date.now();
            }
        } catch {
            // Ignore fetch errors, use cached data
        }
        return coopCache;
    }

    // ========== UI: DISPLAY ==========

    // Click Co-op tab (index 1): Overview, Co-op, Chat, Settings
    function clickCoopTab() {
        var topNav = document.querySelector('#top-nav');
        if (!topNav) return false;
        var tabs = topNav.querySelectorAll('.tab.flex-centered');
        if (tabs.length >= 2) {
            var tab = tabs[1];
            // Delay click to let Vue finish mounting, prevents game JS error
            setTimeout(function() {
                var event = new window.MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                tab.dispatchEvent(event);
            }, 500);
            return true;
        }
        return false;
    }

    function openAllianceCoopTab() {
        var allianceBtn = document.getElementById('alliance-modal-btn');
        if (allianceBtn) {
            allianceBtn.click();
            // Wait for #top-nav to appear, then click after modal is stable
            var attempts = 0;
            var maxAttempts = 20;
            var checkInterval = setInterval(function() {
                attempts++;
                if (clickCoopTab()) {
                    clearInterval(checkInterval);
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                }
            }, 150);
        }
    }

    function updateAllianceTabDot(hasOpenTickets) {
        var allianceBtn = document.getElementById('alliance-modal-btn');
        if (!allianceBtn) return;
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
        } else if (existingDot) {
            existingDot.remove();
        }
    }

    /**
     * Create 2-line coop display (like bunker):
     * Line 1: "CO-OP"
     * Line 2: available/max (red if available > 0)
     * Works with game's original CO2 display OR our bunker-price-display
     */
    function createCoopDisplay() {
        if (coopElement) return coopElement;

        // Find CO2 container - this is always present whether bunker script runs or not
        var co2Container = document.querySelector('.content.led.cursor-pointer');
        if (!co2Container || !co2Container.parentNode) {
            log('CO2 container not found, retrying...');
            return null;
        }

        // Create container
        coopElement = document.createElement('div');
        coopElement.id = 'coop-tickets-display';
        coopElement.style.cssText = 'display:flex;flex-direction:column;align-items:center;line-height:1.2;cursor:pointer;margin-left:8px;';
        coopElement.addEventListener('click', openAllianceCoopTab);

        // Line 1: Label
        var label = document.createElement('span');
        label.style.cssText = 'display:block;color:#9ca3af;';
        label.textContent = 'CO-OP';
        coopElement.appendChild(label);

        // Line 2: Value (available/max)
        coopValueElement = document.createElement('span');
        coopValueElement.id = 'coop-tickets-value';
        coopValueElement.style.cssText = 'display:block;font-weight:bold;font-size:13px;';
        coopValueElement.textContent = '.../...';
        coopElement.appendChild(coopValueElement);

        // Insert after CO2 container (works with game or bunker-price-display)
        co2Container.parentNode.insertBefore(coopElement, co2Container.nextSibling);
        log('COOP display created');

        return coopElement;
    }

    var coopDisplayRetries = 0;

    async function updateCoopDisplay() {
        await refreshCoopCache();
        var available = coopCache.available;
        var cap = coopCache.cap;

        // Hide if no coop data (not in alliance)
        if (cap === 0) {
            if (coopElement) coopElement.style.display = 'none';
            return;
        }

        updateAllianceTabDot(available > 0);

        if (!coopElement) createCoopDisplay();
        if (!coopElement) {
            // Retry a few times if element not created yet
            coopDisplayRetries++;
            if (coopDisplayRetries < 10) {
                setTimeout(updateCoopDisplay, 2000);
            }
            return;
        }

        coopElement.style.display = '';
        if (coopValueElement) {
            coopValueElement.textContent = available + '/' + cap;
            // Red if available > 0 (tickets waiting), green if 0
            coopValueElement.style.color = available > 0 ? '#ef4444' : '#4ade80';
        }
    }

    // ========== UI: REBELSHIP MENU ==========
    var REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    function getOrCreateRebelShipMenu() {
        // Check if menu already exists
        var menu = document.getElementById('rebelship-menu');
        if (menu) {
            var dropdown = menu.querySelector('.rebelship-dropdown');
            if (dropdown) return dropdown;
        }

        // Check if another script is creating the menu
        if (window._rebelshipMenuCreating) {
            return null; // Let addMenuItem retry later
        }

        // Set lock
        window._rebelshipMenuCreating = true;

        // Double-check after setting lock
        menu = document.getElementById('rebelship-menu');
        if (menu) {
            window._rebelshipMenuCreating = false;
            return menu.querySelector('.rebelship-dropdown');
        }

        var messagingIcon = document.querySelector('div.messaging.cursor-pointer') || document.querySelector('.messaging');
        if (!messagingIcon || !messagingIcon.parentNode) {
            window._rebelshipMenuCreating = false;
            return null;
        }

        var container = document.createElement('div');
        container.id = 'rebelship-menu';
        container.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:4px !important;';
        var btn = document.createElement('button');
        btn.id = 'rebelship-menu-btn';
        btn.innerHTML = REBELSHIP_LOGO;
        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        btn.title = 'RebelShip Menu';
        var dropdown = document.createElement('div');
        dropdown.className = 'rebelship-dropdown';
        dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';
        container.appendChild(btn);
        container.appendChild(dropdown);
        btn.addEventListener('click', function(e) { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; });
        document.addEventListener('click', function(e) { if (!container.contains(e.target)) dropdown.style.display = 'none'; });
        messagingIcon.parentNode.insertBefore(container, messagingIcon);

        window._rebelshipMenuCreating = false;
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

    // ========== UI: SETTINGS MODAL ==========
    function openSettingsModal() {
        var stores = getStores();
        var modalStore = stores ? stores.modalStore : null;
        if (!modalStore) { log('modalStore not found'); return; }

        modalStore.open('routeResearch');

        setTimeout(function() {
            if (modalStore.modalSettings) {
                modalStore.modalSettings.title = 'CoOp Settings';
                modalStore.modalSettings.navigation = [];
                modalStore.modalSettings.controls = [];
            }

            var centralContainer = document.getElementById('central-container');
            if (!centralContainer) return;

            centralContainer.innerHTML = '\
                <div style="padding:20px;max-width:400px;margin:0 auto;font-family:Lato,sans-serif;color:#01125d;">\
                    <div style="margin-bottom:20px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:16px;">\
                            <input type="checkbox" id="fh-auto-send" ' + (settings.autoSendEnabled ? 'checked' : '') + '\
                                   style="width:20px;height:20px;margin-right:12px;accent-color:#0db8f4;cursor:pointer;">\
                            <span>Auto-Send COOP Vessels</span>\
                        </label>\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;margin-left:32px;">\
                            Automatically distribute available COOP vessels to alliance members (largest fleets first)\
                        </div>\
                    </div>\
                    <div style="margin-bottom:24px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:14px;">\
                            <input type="checkbox" id="fh-notifications" ' + (settings.systemNotifications ? 'checked' : '') + '\
                                   style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;cursor:pointer;">\
                            <span>System Notifications</span>\
                        </label>\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;margin-left:28px;">\
                            Send push notifications when COOP vessels are distributed\
                        </div>\
                    </div>\
                    <div style="display:flex;gap:12px;justify-content:space-between;margin-top:30px;">\
                        <button id="fh-run-now" style="padding:10px 24px;background:linear-gradient(180deg,#3b82f6,#1d4ed8);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">Run Now</button>\
                        <button id="fh-save" style="padding:10px 24px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:16px;font-weight:500;">Save</button>\
                    </div>\
                </div>';

            document.getElementById('fh-run-now').addEventListener('click', async function() {
                this.disabled = true;
                this.textContent = 'Running...';
                await runAutoCoop(true);
                this.textContent = 'Run Now';
                this.disabled = false;
            });

            document.getElementById('fh-save').addEventListener('click', function() {
                settings.autoSendEnabled = document.getElementById('fh-auto-send').checked;
                settings.systemNotifications = document.getElementById('fh-notifications').checked;
                if (settings.systemNotifications) {
                    requestNotificationPermission();
                }
                saveSettings();
                log('Settings saved: autoSend=' + settings.autoSendEnabled + ', notifications=' + settings.systemNotifications);
                showToast('CoOp settings saved', 'success');
                modalStore.closeAll();
            });
        }, 150);
    }

    // ========== SCHEDULER ==========
    // Run every 15 minutes (compatible with Android background service)
    var RUN_INTERVAL = 15 * 60 * 1000;

    function scheduledRun() {
        if (!settings.autoSendEnabled) return;
        log('Scheduled run triggered');
        runAutoCoop(false);
    }

    // ========== INITIALIZATION ==========
    var uiInitialized = false;
    var uiRetryCount = 0;

    function initUI() {
        if (uiInitialized) return;
        var hasApp = document.getElementById('app');
        var hasMessaging = document.querySelector('.messaging');
        if (!hasApp || !hasMessaging) {
            uiRetryCount++;
            if (uiRetryCount < 30) { setTimeout(initUI, 1000); return; }
            log('Max UI retries reached');
            return;
        }
        uiInitialized = true;
        addMenuItem('Auto CO-OP', openSettingsModal);
        log('Menu item added');
    }

    function init() {
        log('Initializing v5.8...');
        loadSettings();
        initUI();
        updateCoopDisplay();

        // Update display every 15 minutes (Android background job compatible)
        setInterval(updateCoopDisplay, RUN_INTERVAL);

        // Run auto-send every 15 minutes
        setInterval(scheduledRun, RUN_INTERVAL);

        // Initial run after 30 seconds
        setTimeout(scheduledRun, 30000);

        log('Scheduler active - display + auto-send every 15 minutes');
    }

    // Expose for Android BackgroundScriptService
    window.rebelshipRunAutoCoop = async function() {
        loadSettings();
        if (!settings.autoSendEnabled) return { skipped: true, reason: 'disabled' };
        return await runAutoCoop();
    };

    // Listen for header resize event to reinitialize display
    window.addEventListener('rebelship-header-resize', function() {
        log('Header resize detected, reinitializing display...');
        coopElement = null;
        coopValueElement = null;
        coopDisplayRetries = 0;
        setTimeout(updateCoopDisplay, 250);
    });

    // Wait for page ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 2000); });
    } else {
        setTimeout(init, 1000);
    }
})();
