// ==UserScript==
// @name         Shipping Manager - Auto Repair
// @namespace    https://rebelship.org/
// @version      2.19
// @description  Auto-repair vessels when wear reaches threshold
// @author       https://github.com/justonlyforyou/
// @order        21
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// @background-job-required true
// ==/UserScript==

(function() {
    'use strict';

    // ========== CONFIGURATION ==========
    const SCRIPT_NAME = 'Yard Foreman';
    const STORAGE_KEY = 'rebelship_yard_foreman_settings';
    const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes (background service minimum)

    // ========== STATE ==========
    let settings = {
        enabled: false,
        wearThreshold: 5,      // Repair when wear >= this %
        minCashAfterRepair: 0,  // Keep at least this much cash
        notifyIngame: true,    // Show in-game toast notifications
        notifySystem: false    // Send system/push notifications
    };
    let monitorInterval = null;
    let isProcessing = false;

    // ========== DIRECT API FUNCTIONS ==========
    async function fetchWithCookie(url, options = {}) {
        const mergedHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers
        };
        const response = await fetch(url, {
            credentials: 'include',
            ...options,
            headers: mergedHeaders
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    }

    async function fetchVessels() {
        const data = await fetchWithCookie('https://shippingmanager.cc/api/vessel/get-all-user-vessels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ include_routes: false })
        });
        return data.data?.user_vessels || [];
    }

    async function fetchMaintenanceCost(vesselIds) {
        const data = await fetchWithCookie('https://shippingmanager.cc/api/maintenance/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vessel_ids: JSON.stringify(vesselIds) })
        });
        let totalCost = 0;
        const vessels = data.data?.vessels || [];
        for (const vessel of vessels) {
            const wearMaintenance = vessel.maintenance_data?.find(m => m.type === 'wear');
            if (wearMaintenance) {
                // Use discounted_price if available (subsidy applied), otherwise regular price
                const cost = wearMaintenance.discounted_price || wearMaintenance.price || 0;
                totalCost += cost;
            }
        }
        return { vessels, totalCost, cash: data.user?.cash || 0 };
    }

    async function bulkRepairVessels(vesselIds) {
        const data = await fetchWithCookie('https://shippingmanager.cc/api/maintenance/do-wear-maintenance-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vessel_ids: JSON.stringify(vesselIds) })
        });
        return {
            success: data.success,
            count: vesselIds.length,
            totalCost: data.data?.total_cost || 0
        };
    }

    function getUserCash() {
        try {
            const appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            const app = appEl.__vue_app__;
            const pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return null;
            const userStore = pinia._s.get('user');
            return userStore?.cash || userStore?.user?.cash || null;
        } catch {
            return null;
        }
    }

    // ========== CORE LOGIC ==========
    async function runRepairCheck() {
        if (!settings.enabled || isProcessing) {
            return { skipped: true, reason: !settings.enabled ? 'disabled' : 'processing' };
        }

        isProcessing = true;
        const result = {
            checked: true,
            vesselsFound: 0,
            vesselsRepaired: 0,
            totalCost: 0,
            error: null
        };

        try {
            // 1. Fetch vessels
            const vessels = await fetchVessels();

            // 2. Filter by wear threshold
            const vesselsNeedingRepair = vessels.filter(v =>
                v.wear >= settings.wearThreshold &&
                v.status !== 'maintenance' &&
                v.status !== 'sailing'
            );

            result.vesselsFound = vesselsNeedingRepair.length;

            if (vesselsNeedingRepair.length === 0) {
                log(`No vessels need repair (threshold: ${settings.wearThreshold}%)`);
                return result;
            }

            log(`Found ${vesselsNeedingRepair.length} vessels with wear >= ${settings.wearThreshold}%`);

            // 3. Get repair cost and check cash
            const vesselIds = vesselsNeedingRepair.map(v => v.id);
            const costData = await fetchMaintenanceCost(vesselIds);

            // Get cash from Pinia or API response
            const cash = getUserCash() || costData.cash || 0;
            log(`Repair cost: $${costData.totalCost.toLocaleString()} | Cash: $${cash.toLocaleString()}`);

            // 4. Check if we can afford it
            if (settings.minCashAfterRepair > 0) {
                const cashAfterRepair = cash - costData.totalCost;
                if (cashAfterRepair < settings.minCashAfterRepair) {
                    log(`Cannot repair: would leave $${cashAfterRepair.toLocaleString()}, need $${settings.minCashAfterRepair.toLocaleString()}`);
                    result.error = 'insufficient_funds';
                    return result;
                }
            }

            // 5. Execute repair
            const repairResult = await bulkRepairVessels(vesselIds);
            result.vesselsRepaired = repairResult.count;
            result.totalCost = costData.totalCost;

            // Show toast notification
            const toastMessage = `Repaired ${repairResult.count} vessels for $${result.totalCost.toLocaleString()}`;
            log(toastMessage);
            showToast(toastMessage);

            return result;

        } catch (error) {
            log(`Error: ${error.message}`, 'error');
            result.error = error.message;
            return result;
        } finally {
            isProcessing = false;
        }
    }

    // ========== SETTINGS ==========
    function loadSettings() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                settings = { ...settings, ...parsed };
            }
        } catch {
            log('Failed to load settings', 'error');
        }
        return settings;
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            syncSettingsToAndroid();
        } catch {
            log('Failed to save settings', 'error');
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

    // ========== MONITORING ==========
    function startMonitoring() {
        if (monitorInterval) {
            clearInterval(monitorInterval);
        }
        monitorInterval = setInterval(runRepairCheck, CHECK_INTERVAL_MS);
        log('Monitoring started (15 min interval)');
        // Run immediately on start
        runRepairCheck();
    }

    function stopMonitoring() {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
        log('Monitoring stopped');
    }

    // ========== LOGGING & NOTIFICATIONS ==========
    function log(message, level = 'info') {
        const prefix = `[${SCRIPT_NAME}]`;
        if (level === 'error') {
            console.error(prefix, message);
        } else {
            console.log(prefix, message);
        }
    }

    function sendSystemNotification(title, message) {
        if (!settings.notifySystem) return;

        // 1. Android bridge notification
        if (typeof window.RebelShipNotify !== 'undefined' && window.RebelShipNotify.notify) {
            try {
                window.RebelShipNotify.notify(title + ': ' + message);
                log('System notification sent');
                return;
            } catch (e) {
                log('System notification failed: ' + e.message, 'error');
            }
        }

        // 2. Web Notification API fallback
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                try {
                    new Notification(title, {
                        body: message,
                        icon: 'https://shippingmanager.cc/favicon.ico',
                        tag: 'yard-foreman'
                    });
                    log('Web notification sent');
                } catch (e) {
                    log('Web notification failed: ' + e.message, 'error');
                }
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(function(permission) {
                    if (permission === 'granted') {
                        sendSystemNotification(title, message);
                    }
                });
            }
        }
    }

    // ========== UI: REBELSHIP MENU ==========
    // RebelShip Menu Logo SVG
    const REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    // Wait for messaging icon using MutationObserver
    function waitForMessagingIcon(callback) {
        let messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');

        if (messagingIcon) {
            callback(messagingIcon);
            return;
        }

        const observer = new MutationObserver((mutations, obs) => {
            let icon = document.querySelector('div.messaging.cursor-pointer');
            if (!icon) icon = document.querySelector('.messaging');
            if (icon) {
                obs.disconnect();
                callback(icon);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Timeout fallback after 5 seconds
        setTimeout(() => observer.disconnect(), 5000);
    }

    // Get or create RebelShip menu
    function getOrCreateRebelShipMenu(callback) {
        // Check if dropdown already exists (it's in document.body now)
        let existingDropdown = document.getElementById('rebelship-dropdown');
        if (existingDropdown) {
            if (callback) callback(existingDropdown);
            return existingDropdown;
        }

        // Check if another script is creating the menu
        if (window._rebelshipMenuCreating) {
            setTimeout(() => getOrCreateRebelShipMenu(callback), 100);
            return null;
        }
        window._rebelshipMenuCreating = true;

        // Double-check after lock
        existingDropdown = document.getElementById('rebelship-dropdown');
        if (existingDropdown) {
            window._rebelshipMenuCreating = false;
            if (callback) callback(existingDropdown);
            return existingDropdown;
        }

        // Use MutationObserver to wait for messaging icon
        waitForMessagingIcon((messagingIcon) => {
            // Double-check dropdown wasn't created while waiting
            let dropdown = document.getElementById('rebelship-dropdown');
            if (dropdown) {
                window._rebelshipMenuCreating = false;
                if (callback) callback(dropdown);
                return;
            }

            const container = document.createElement('div');
            container.id = 'rebelship-menu';
            container.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:4px !important;z-index:999999;';

            const btn = document.createElement('button');
            btn.id = 'rebelship-menu-btn';
            btn.innerHTML = REBELSHIP_LOGO;
            btn.title = 'RebelShip Menu';

            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';

            dropdown = document.createElement('div');
            dropdown.id = 'rebelship-dropdown';
            dropdown.className = 'rebelship-dropdown';
            dropdown.style.cssText = 'display:none;position:fixed;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

            container.appendChild(btn);
            document.body.appendChild(dropdown);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (dropdown.style.display === 'block') {
                    dropdown.style.display = 'none';
                } else {
                    const rect = btn.getBoundingClientRect();
                    dropdown.style.top = (rect.bottom + 4) + 'px';
                    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
                    dropdown.style.display = 'block';
                }
            });

            document.addEventListener('click', (e) => {
                if (!container.contains(e.target) && !dropdown.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });

            if (messagingIcon.parentNode) {
                messagingIcon.parentNode.insertBefore(container, messagingIcon);
            }

            window._rebelshipMenuCreating = false;
            console.log('[RebelShip] Menu created successfully');
            if (callback) callback(dropdown);
        });

        return null;
    }

    // Add menu item to RebelShip menu
    function addMenuItem(label, onClick, scriptOrder) {
        function doAddItem(dropdown) {
            // Check if item already exists
            if (dropdown.querySelector(`[data-rebelship-item="${label}"]`)) {
                return dropdown.querySelector(`[data-rebelship-item="${label}"]`);
            }

            const item = document.createElement('div');
            item.dataset.rebelshipItem = label;
            item.dataset.order = scriptOrder;
            item.style.cssText = 'position:relative;';

            const itemBtn = document.createElement('div');
            itemBtn.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:13px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
            itemBtn.innerHTML = '<span>' + label + '</span>';

            itemBtn.addEventListener('mouseenter', () => itemBtn.style.background = '#374151');
            itemBtn.addEventListener('mouseleave', () => itemBtn.style.background = 'transparent');

            if (onClick) {
                itemBtn.addEventListener('click', onClick);
            }

            item.appendChild(itemBtn);

            // Insert in sorted order by scriptOrder
            const items = dropdown.querySelectorAll('[data-rebelship-item]');
            let insertBefore = null;
            for (let i = 0; i < items.length; i++) {
                const existingOrder = parseInt(items[i].dataset.order, 10);
                if (scriptOrder < existingOrder) {
                    insertBefore = items[i];
                    break;
                }
            }
            if (insertBefore) {
                dropdown.insertBefore(item, insertBefore);
            } else {
                dropdown.appendChild(item);
            }

            return item;
        }

        const dropdown = document.getElementById('rebelship-dropdown');
        if (dropdown) {
            return doAddItem(dropdown);
        }

        // Use callback-based approach
        getOrCreateRebelShipMenu((dd) => doAddItem(dd));
        return null;
    }

    // ========== UI: PINIA STORES ==========
    function getPinia() {
        try {
            const appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            const app = appEl.__vue_app__;
            return app._context.provides.pinia || app.config.globalProperties.$pinia;
        } catch {
            return null;
        }
    }

    function getModalStore() {
        try {
            const pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('modal');
        } catch {
            log('Failed to get modalStore', 'error');
            return null;
        }
    }

    function getToastStore() {
        try {
            const pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('toast');
        } catch {
            return null;
        }
    }

    function showToast(message, type = 'success') {
        // 1. In-game toast (Pinia) - if enabled
        if (settings.notifyIngame) {
            const toastStore = getToastStore();
            if (toastStore) {
                try {
                    if (type === 'error' && toastStore.error) {
                        toastStore.error(message);
                    } else if (toastStore.success) {
                        toastStore.success(message);
                    }
                    log('Toast shown: ' + message);
                } catch (err) {
                    log('Toast error: ' + err.message, 'error');
                }
            }
        }

        // 2. System notification (if enabled)
        sendSystemNotification(SCRIPT_NAME, message);
    }

    function openSettingsModal() {
        const modalStore = getModalStore();
        if (!modalStore) {
            log('modalStore not found', 'error');
            return;
        }

        // Open routeResearch modal
        modalStore.open('routeResearch');

        // Wait for modal to render, then replace content
        setTimeout(() => {
            // Change title and remove controls
            if (modalStore.modalSettings) {
                modalStore.modalSettings.title = 'Auto Repair Settings';
                modalStore.modalSettings.navigation = [];
                modalStore.modalSettings.controls = [];
            }

            const centralContainer = document.getElementById('central-container');
            if (!centralContainer) {
                log('central-container not found', 'error');
                return;
            }

            // Build settings form using game-native styling
            centralContainer.innerHTML = `
                <div style="padding:20px;max-width:400px;margin:0 auto;font-family:Lato,sans-serif;color:#01125d;">
                    <div style="margin-bottom:20px;">
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:16px;">
                            <input type="checkbox" id="yf-enabled" ${settings.enabled ? 'checked' : ''}
                                   style="width:20px;height:20px;margin-right:12px;accent-color:#0db8f4;cursor:pointer;">
                            <span>Enable Auto-Repair</span>
                        </label>
                    </div>

                    <div style="margin-bottom:20px;">
                        <label style="display:block;margin-bottom:8px;font-size:14px;font-weight:700;color:#01125d;">
                            Wear Threshold (%)
                        </label>
                        <input type="number" id="yf-threshold" min="1" max="99" value="${settings.wearThreshold}"
                               class="redesign" style="width:100%;height:2.5rem;padding:0 1rem;background:#ebe9ea;border:0;border-radius:7px;color:#01125d;font-size:16px;font-family:Lato,sans-serif;text-align:center;box-sizing:border-box;">
                        <div style="font-size:12px;color:#626b90;margin-top:6px;">
                            Repair vessels when wear reaches this percentage (1-99)
                        </div>
                    </div>

                    <div style="margin-bottom:20px;">
                        <label style="display:block;margin-bottom:8px;font-size:14px;font-weight:700;color:#01125d;">
                            Minimum Cash Balance
                        </label>
                        <input type="number" id="yf-mincash" min="0" step="1000" value="${settings.minCashAfterRepair}"
                               class="redesign" style="width:100%;height:2.5rem;padding:0 1rem;background:#ebe9ea;border:0;border-radius:7px;color:#01125d;font-size:16px;font-family:Lato,sans-serif;text-align:center;box-sizing:border-box;">
                        <div style="font-size:12px;color:#626b90;margin-top:6px;">
                            Keep at least this much cash after repairs
                        </div>
                    </div>

                    <div style="margin-bottom:24px;">
                        <div style="font-weight:700;font-size:14px;margin-bottom:12px;color:#01125d;">Notifications</div>
                        <div style="display:flex;gap:24px;">
                            <label style="display:flex;align-items:center;cursor:pointer;">
                                <input type="checkbox" id="yf-notify-ingame" ${settings.notifyIngame ? 'checked' : ''}
                                       style="width:18px;height:18px;margin-right:8px;accent-color:#0db8f4;cursor:pointer;">
                                <span style="font-size:13px;">Ingame</span>
                            </label>
                            <label style="display:flex;align-items:center;cursor:pointer;">
                                <input type="checkbox" id="yf-notify-system" ${settings.notifySystem ? 'checked' : ''}
                                       style="width:18px;height:18px;margin-right:8px;accent-color:#0db8f4;cursor:pointer;">
                                <span style="font-size:13px;">System</span>
                            </label>
                        </div>
                    </div>

                    <div style="display:flex;gap:12px;justify-content:space-between;margin-top:30px;">
                        <button id="yf-cancel" class="btn btn-secondary" style="padding:10px 24px;background:linear-gradient(90deg,#d7d8db,#95969b);border:0;border-radius:6px;color:#393939;cursor:pointer;font-size:16px;font-weight:500;font-family:Lato,sans-serif;">
                            Cancel
                        </button>
                        <button id="yf-save" class="btn btn-green" style="padding:10px 24px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:16px;font-weight:500;font-family:Lato,sans-serif;">
                            Save
                        </button>
                    </div>
                </div>
            `;

            // Event handlers
            document.getElementById('yf-cancel').addEventListener('click', () => {
                modalStore.closeAll();
            });

            document.getElementById('yf-save').addEventListener('click', () => {
                const enabled = document.getElementById('yf-enabled').checked;
                const threshold = parseInt(document.getElementById('yf-threshold').value, 10);
                const minCash = parseInt(document.getElementById('yf-mincash').value, 10);
                const notifyIngame = document.getElementById('yf-notify-ingame').checked;
                const notifySystem = document.getElementById('yf-notify-system').checked;

                // Validate
                if (isNaN(threshold) || threshold < 1 || threshold > 99) {
                    alert('Wear threshold must be between 1 and 99');
                    return;
                }
                if (isNaN(minCash) || minCash < 0) {
                    alert('Minimum cash must be 0 or greater');
                    return;
                }

                // Update settings
                const wasEnabled = settings.enabled;
                settings.enabled = enabled;
                settings.wearThreshold = threshold;
                settings.minCashAfterRepair = minCash;
                settings.notifyIngame = notifyIngame;
                settings.notifySystem = notifySystem;
                saveSettings();

                // Start/stop monitoring based on enabled state
                if (enabled && !wasEnabled) {
                    startMonitoring();
                } else if (!enabled && wasEnabled) {
                    stopMonitoring();
                }

                log(`Settings saved: threshold=${threshold}%, minCash=$${minCash}, enabled=${enabled}`);
                showToast('Auto Repair settings saved');
                modalStore.closeAll();
            });
        }, 150);
    }

    // ========== INITIALIZATION ==========
    let uiInitialized = false;
    let uiRetryCount = 0;
    const MAX_UI_RETRIES = 30; // Try for 30 seconds

    function initUI() {
        if (uiInitialized) return;

        // Check if page is ready (has #app and .messaging)
        const hasApp = document.getElementById('app');
        const hasMessaging = document.querySelector('.messaging');

        if (!hasApp || !hasMessaging) {
            uiRetryCount++;
            if (uiRetryCount < MAX_UI_RETRIES) {
                setTimeout(initUI, 1000);
                return;
            }
            log('Max UI retries reached, running in background mode');
            return;
        }

        // Page is ready, add menu item
        uiInitialized = true;
        addMenuItem('Auto Repair', openSettingsModal, 21);
        log('Menu item added');
    }

    function init() {
        log('Initializing...');
        loadSettings();

        // Start UI initialization with retry
        initUI();

        // Start monitoring based on settings (works in both browser and background)
        if (settings.enabled) {
            setTimeout(startMonitoring, 3000);
        }
    }

    // Expose for Android BackgroundScriptService
    window.rebelshipRunYardForeman = async function() {
        loadSettings();
        if (!settings.enabled) {
            return { skipped: true, reason: 'disabled' };
        }
        return await runRepairCheck();
    };

    // Wait for page ready - wait 2s for Vue to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 2000);
        });
    } else {
        setTimeout(init, 2000);
    }
})();
