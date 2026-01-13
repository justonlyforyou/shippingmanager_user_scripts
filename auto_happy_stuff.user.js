// ==UserScript==
// @name         ShippingManager - Auto Happy Staff
// @namespace    http://tampermonkey.net/
// @description  Automatically manages staff salaries to maintain crew and management morale at target levels
// @version     1.7
// @author       https://github.com/justonlyforyou/
// @order        25
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// @background-job-required true
// ==/UserScript==

(function() {
    'use strict';

    var SCRIPT_NAME = 'Auto Happy Staff';
    var STORAGE_KEY = 'rebelship_autohappy_settings';
    var CHECK_INTERVAL = 15 * 60 * 1000; // Check every 15 minutes (Android compatible)
    var API_BASE = 'https://shippingmanager.cc/api';

    var DEFAULT_SETTINGS = {
        enabled: false,
        targetMorale: 100,
        systemNotifications: false
    };

    // Staff type classifications
    var CREW_TYPES = ['captain', 'first_officer', 'boatswain', 'technical_officer'];
    var MANAGEMENT_TYPES = ['cfo', 'coo', 'cmo', 'cto'];

    var isMobile = window.innerWidth < 1024;

    console.log('[Auto Happy Staff] v1.0 loaded');

    // ============================================
    // SETTINGS STORAGE
    // ============================================
    function loadSettings() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                var parsed = JSON.parse(stored);
                var result = {};
                for (var key in DEFAULT_SETTINGS) {
                    result[key] = parsed[key] !== undefined ? parsed[key] : DEFAULT_SETTINGS[key];
                }
                return result;
            }
        } catch (e) {
            console.error('[Auto Happy Staff] Failed to load settings:', e);
        }
        var defaults = {};
        for (var k in DEFAULT_SETTINGS) {
            defaults[k] = DEFAULT_SETTINGS[k];
        }
        return defaults;
    }

    function saveSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            syncSettingsToAndroid(settings);
            console.log('[Auto Happy Staff] Settings saved:', settings);
        } catch (e) {
            console.error('[Auto Happy Staff] Failed to save settings:', e);
        }
    }

    function syncSettingsToAndroid(settings) {
        if (typeof window.RebelShipBridge !== 'undefined' && window.RebelShipBridge.syncSettings) {
            try {
                window.RebelShipBridge.syncSettings(STORAGE_KEY, JSON.stringify(settings));
            } catch {
                // Ignore sync errors
            }
        }
    }

    // ============================================
    // PINIA STORE HELPERS
    // ============================================
    function getPinia() {
        var app = document.getElementById('app');
        if (!app || !app.__vue_app__) return null;
        return app.__vue_app__.config.globalProperties.$pinia;
    }

    function getModalStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('modal');
        } catch {
            return null;
        }
    }

    function getToastStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('toast');
        } catch {
            return null;
        }
    }

    // ============================================
    // NOTIFICATIONS
    // ============================================
    function notify(message, type) {
        console.log('[Auto Happy Staff] ' + type.toUpperCase() + ': ' + message);

        // In-game toast
        var toastStore = getToastStore();
        if (toastStore) {
            if (type === 'error' && toastStore.error) {
                toastStore.error(message);
            } else if (toastStore.success) {
                toastStore.success(message);
            }
        }

        // System notification
        showSystemNotification(message);
    }

    function showSystemNotification(message) {
        var currentSettings = loadSettings();
        if (!currentSettings.systemNotifications) {
            return;
        }

        // 1. Android bridge notification
        if (typeof window.RebelShipNotify !== 'undefined' && window.RebelShipNotify.notify) {
            try {
                window.RebelShipNotify.notify(SCRIPT_NAME + ': ' + message);
                console.log('[Auto Happy Staff] Android notification sent');
                return;
            } catch (e) {
                console.log('[Auto Happy Staff] Android notification failed: ' + e.message);
            }
        }

        // 2. Web Notification API fallback
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                try {
                    new Notification(SCRIPT_NAME, {
                        body: message,
                        icon: 'https://shippingmanager.cc/favicon.ico',
                        tag: 'autohappy'
                    });
                    console.log('[Auto Happy Staff] Web notification sent');
                } catch (e) {
                    console.log('[Auto Happy Staff] Web notification failed: ' + e.message);
                }
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(function(permission) {
                    if (permission === 'granted') {
                        showSystemNotification(message);
                    }
                });
            }
        }
    }

    // ============================================
    // API FUNCTIONS
    // ============================================
    async function fetchStaffData() {
        try {
            var response = await fetch(API_BASE + '/staff/get-user-staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var data = await response.json();
            if (!data.data) {
                console.error('[Auto Happy Staff] Invalid staff response');
                return null;
            }

            return data.data;
        } catch (e) {
            console.error('[Auto Happy Staff] fetchStaffData failed:', e);
            return null;
        }
    }

    async function raiseSalary(staffType) {
        try {
            var response = await fetch(API_BASE + '/staff/raise-salary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ type: staffType })
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var data = await response.json();
            return data;
        } catch (e) {
            console.error('[Auto Happy Staff] raiseSalary failed for ' + staffType + ':', e);
            return null;
        }
    }

    // ============================================
    // MAIN LOGIC
    // ============================================
    var isRunning = false;

    async function checkAndAdjustMorale(manual) {
        if (isRunning) {
            console.log('[Auto Happy Staff] Already running, skipping');
            if (manual) notify('Already running, please wait', 'error');
            return;
        }

        var settings = loadSettings();
        // Skip enabled check if manual run
        if (!manual && !settings.enabled) {
            return;
        }

        isRunning = true;

        try {
            var staffData = await fetchStaffData();
            if (!staffData || !staffData.info) {
                console.log('[Auto Happy Staff] No staff data available');
                if (manual) notify('No staff data available', 'error');
                return;
            }

            // Round up: 99.90% = 100% (game floating point handling)
            var crewMorale = staffData.info.crew ? Math.round(parseFloat(staffData.info.crew.percentage)) : undefined;
            var managementMorale = staffData.info.management ? Math.round(parseFloat(staffData.info.management.percentage)) : undefined;
            var targetMorale = settings.targetMorale;
            // 99% counts as 100% - accept 1% tolerance for 100% target
            var effectiveTarget = targetMorale === 100 ? 99 : targetMorale;

            console.log('[Auto Happy Staff] Check: Crew=' + crewMorale + '%, Management=' + managementMorale + '%, Target=' + targetMorale + '% (effective: ' + effectiveTarget + '%)');

            if (crewMorale === undefined || managementMorale === undefined) {
                console.log('[Auto Happy Staff] Morale data not available');
                if (manual) notify('Morale data not available', 'error');
                return;
            }

            // Check if both morale levels are already at or above target
            if (crewMorale >= effectiveTarget && managementMorale >= effectiveTarget) {
                console.log('[Auto Happy Staff] Both crew and management morale are at or above target');
                if (manual) notify('Morale OK! Crew: ' + crewMorale + '%, Management: ' + managementMorale + '%', 'success');
                return;
            }

            var staffToAdjust = [];
            var raisedCount = 0;

            // Check crew morale
            if (crewMorale < effectiveTarget && staffData.staff) {
                var crewStaff = staffData.staff.filter(function(s) {
                    return CREW_TYPES.indexOf(s.type) !== -1 && s.morale !== undefined;
                });
                staffToAdjust = staffToAdjust.concat(crewStaff);
                console.log('[Auto Happy Staff] Crew morale below target: ' + crewMorale + '% < ' + effectiveTarget + '%');
            }

            // Check management morale
            if (managementMorale < effectiveTarget && staffData.staff) {
                var managementStaff = staffData.staff.filter(function(s) {
                    return MANAGEMENT_TYPES.indexOf(s.type) !== -1 && s.morale !== undefined;
                });
                staffToAdjust = staffToAdjust.concat(managementStaff);
                console.log('[Auto Happy Staff] Management morale below target: ' + managementMorale + '% < ' + effectiveTarget + '%');
            }

            if (staffToAdjust.length === 0) {
                console.log('[Auto Happy Staff] No staff needs salary adjustment');
                if (manual) notify('No salary adjustment needed', 'success');
                return;
            }

            // Raise salaries for staff with low morale
            for (var i = 0; i < staffToAdjust.length; i++) {
                var staff = staffToAdjust[i];
                console.log('[Auto Happy Staff] Raising salary for ' + staff.type + ' (current morale: ' + Math.round(staff.morale) + '%)');

                var result = await raiseSalary(staff.type);
                if (result && result.data && result.data.staff) {
                    var newSalary = result.data.staff.salary;
                    var newMorale = result.data.staff.morale;
                    console.log('[Auto Happy Staff] ' + staff.type + ' salary raised to $' + newSalary + ' (morale: ' + newMorale + '%)');
                    raisedCount++;
                }

                // Small delay between API calls
                await new Promise(function(resolve) { setTimeout(resolve, 300); });
            }

            // Fetch updated data to get new morale levels
            var updatedData = await fetchStaffData();
            if (updatedData && updatedData.info) {
                var newCrew = Math.round(parseFloat(updatedData.info.crew ? updatedData.info.crew.percentage : 0));
                var newManagement = Math.round(parseFloat(updatedData.info.management ? updatedData.info.management.percentage : 0));
                if (raisedCount > 0) {
                    notify('Raised ' + raisedCount + ' salaries. Crew: ' + newCrew + '%, Management: ' + newManagement + '%', 'success');
                } else if (manual) {
                    notify('Crew: ' + newCrew + '%, Management: ' + newManagement + '%', 'success');
                }
            }

        } catch (err) {
            console.error('[Auto Happy Staff] Error:', err);
            if (manual) notify('Error: ' + err.message, 'error');
        } finally {
            isRunning = false;
        }
    }

    // ============================================
    // MONITORING INTERVAL
    // ============================================
    var monitoringInterval = null;

    function startMonitoring() {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }
        console.log('[Auto Happy Staff] Starting monitoring (interval: ' + CHECK_INTERVAL + 'ms)');
        monitoringInterval = setInterval(checkAndAdjustMorale, CHECK_INTERVAL);
        // Run immediately
        checkAndAdjustMorale();
    }

    function stopMonitoring() {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
            console.log('[Auto Happy Staff] Stopped monitoring');
        }
    }

    // ============================================
    // UI: REBELSHIP MENU
    // ============================================
    var REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    function getOrCreateMobileRow() {
        var existing = document.getElementById('rebel-mobile-row');
        if (existing) return existing;

        var row = document.createElement('div');
        row.id = 'rebel-mobile-row';
        row.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;display:flex !important;flex-wrap:nowrap !important;justify-content:space-between !important;align-items:center !important;gap:4px !important;background:#1a1a2e !important;padding:4px 6px !important;font-size:14px !important;z-index:9999 !important;';
        var leftSection = document.createElement('div'); leftSection.id = 'rebel-mobile-left'; leftSection.style.cssText = 'display:flex;align-items:center;gap:4px;'; row.appendChild(leftSection); var rightSection = document.createElement('div'); rightSection.id = 'rebel-mobile-right'; rightSection.style.cssText = 'display:flex;align-items:center;gap:4px;'; row.appendChild(rightSection); document.body.appendChild(row);

        var appContainer = document.querySelector('#app') || document.body.firstElementChild;
        if (appContainer) {
            appContainer.style.marginTop = '2px';
        }

        return row;
    }

    function getOrCreateRebelShipMenu() {
        var menu = document.getElementById('rebelship-menu');
        if (menu) {
            return menu.querySelector('.rebelship-dropdown');
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

            var dropdown = document.createElement('div');
            dropdown.className = 'rebelship-dropdown';
            dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

            container.appendChild(btn);
            container.appendChild(dropdown);

            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
            });

            document.addEventListener('click', function(e) {
                if (!container.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });

            var rightSection = document.getElementById('rebel-mobile-right'); if (rightSection) { rightSection.appendChild(container); } else { row.appendChild(container); }
            return dropdown;
        }

        var messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) return null;

        var desktopContainer = document.createElement('div');
        desktopContainer.id = 'rebelship-menu';
        desktopContainer.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:4px !important;margin-left:auto;';

        var desktopBtn = document.createElement('button');
        desktopBtn.id = 'rebelship-menu-btn';
        desktopBtn.innerHTML = REBELSHIP_LOGO;
        desktopBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        desktopBtn.title = 'RebelShip Menu';

        var desktopDropdown = document.createElement('div');
        desktopDropdown.className = 'rebelship-dropdown';
        desktopDropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

        desktopContainer.appendChild(desktopBtn);
        desktopContainer.appendChild(desktopDropdown);

        desktopBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            desktopDropdown.style.display = desktopDropdown.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', function(e) {
            if (!desktopContainer.contains(e.target)) {
                desktopDropdown.style.display = 'none';
            }
        });

        if (messagingIcon.parentNode) {
            messagingIcon.parentNode.insertBefore(desktopContainer, messagingIcon);
        }

        return desktopDropdown;
    }

    function addMenuItem(label, onClick) {
        var dropdown = getOrCreateRebelShipMenu();
        if (!dropdown) {
            setTimeout(function() { addMenuItem(label, onClick); }, 1000);
            return null;
        }

        if (dropdown.querySelector('[data-rebelship-item="' + label + '"]')) {
            return dropdown.querySelector('[data-rebelship-item="' + label + '"]');
        }

        var item = document.createElement('div');
        item.dataset.rebelshipItem = label;
        item.style.cssText = 'position:relative;';

        var itemBtn = document.createElement('div');
        itemBtn.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:13px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
        itemBtn.innerHTML = '<span>' + label + '</span>';

        itemBtn.addEventListener('mouseenter', function() { itemBtn.style.background = '#374151'; });
        itemBtn.addEventListener('mouseleave', function() { itemBtn.style.background = 'transparent'; });

        if (onClick) {
            itemBtn.addEventListener('click', function() {
                dropdown.style.display = 'none';
                onClick();
            });
        }

        item.appendChild(itemBtn);
        dropdown.appendChild(item);
        return item;
    }

    // ============================================
    // SETTINGS MODAL
    // ============================================
    function openSettingsModal() {
        var modalStore = getModalStore();
        if (!modalStore) {
            console.error('[Auto Happy Staff] modalStore not found');
            return;
        }

        var currentSettings = loadSettings();
        modalStore.open('routeResearch');

        setTimeout(function() {
            if (modalStore.modalSettings) {
                modalStore.modalSettings.title = 'Auto Happy Staff Settings';
                modalStore.modalSettings.navigation = [];
                modalStore.modalSettings.controls = [];
            }

            var centralContainer = document.getElementById('central-container');
            if (!centralContainer) return;

            centralContainer.innerHTML = '\
                <div style="padding:20px;max-width:400px;margin:0 auto;font-family:Lato,sans-serif;color:#01125d;">\
                    <div style="margin-bottom:20px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:16px;">\
                            <input type="checkbox" id="ah-enabled" ' + (currentSettings.enabled ? 'checked' : '') + '\
                                   style="width:20px;height:20px;margin-right:12px;accent-color:#0db8f4;cursor:pointer;">\
                            <span>Enable Auto Happy Staff</span>\
                        </label>\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;margin-left:32px;">\
                            Automatically raises staff salaries when crew or management morale drops below the target level.\
                        </div>\
                    </div>\
                    <div style="margin-bottom:20px;">\
                        <label style="display:block;font-weight:700;font-size:14px;margin-bottom:8px;">Target Morale</label>\
                        <select id="ah-target-morale" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;">\
                            <option value="100" ' + (currentSettings.targetMorale === 100 ? 'selected' : '') + '>100%</option>\
                            <option value="90" ' + (currentSettings.targetMorale === 90 ? 'selected' : '') + '>90%</option>\
                            <option value="80" ' + (currentSettings.targetMorale === 80 ? 'selected' : '') + '>80%</option>\
                            <option value="70" ' + (currentSettings.targetMorale === 70 ? 'selected' : '') + '>70%</option>\
                            <option value="60" ' + (currentSettings.targetMorale === 60 ? 'selected' : '') + '>60%</option>\
                        </select>\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;">\
                            Minimum happiness level to maintain for crew and management\
                        </div>\
                    </div>\
                    <div style="margin-bottom:24px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:14px;">\
                            <input type="checkbox" id="ah-notifications" ' + (currentSettings.systemNotifications ? 'checked' : '') + '\
                                   style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;cursor:pointer;">\
                            <span>System Notifications</span>\
                        </label>\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;margin-left:28px;">\
                            Send push notifications when salaries are raised\
                        </div>\
                    </div>\
                    <div style="display:flex;gap:12px;justify-content:space-between;margin-top:30px;">\
                        <button id="ah-run-now" style="padding:10px 24px;background:linear-gradient(180deg,#3b82f6,#1d4ed8);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">Run Now</button>\
                        <button id="ah-save" style="padding:10px 24px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:16px;font-weight:500;">Save</button>\
                    </div>\
                </div>';

            document.getElementById('ah-run-now').addEventListener('click', async function() {
                this.disabled = true;
                this.textContent = 'Running...';
                await checkAndAdjustMorale(true);
                this.textContent = 'Run Now';
                this.disabled = false;
            });

            document.getElementById('ah-save').addEventListener('click', function() {
                var newSettings = {
                    enabled: document.getElementById('ah-enabled').checked,
                    targetMorale: parseInt(document.getElementById('ah-target-morale').value, 10) || 100,
                    systemNotifications: document.getElementById('ah-notifications').checked
                };

                if (newSettings.systemNotifications) {
                    requestNotificationPermission();
                }

                saveSettings(newSettings);

                if (newSettings.enabled) {
                    startMonitoring();
                } else {
                    stopMonitoring();
                }

                notify('Settings saved', 'success');
                modalStore.closeAll();
            });
        }, 150);
    }

    // ============================================
    // INITIALIZATION
    // ============================================
    function requestNotificationPermission() {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().then(function(permission) {
                console.log('[Auto Happy Staff] Notification permission:', permission);
            });
        }
    }

    var uiInitialized = false;
    var uiRetryCount = 0;
    var MAX_UI_RETRIES = 30;

    function initUI() {
        if (uiInitialized) return;

        var hasApp = document.getElementById('app');
        var hasMessaging = document.querySelector('.messaging');

        if (!hasApp || !hasMessaging) {
            uiRetryCount++;
            if (uiRetryCount < MAX_UI_RETRIES) {
                setTimeout(initUI, 1000);
                return;
            }
            console.log('[Auto Happy Staff] Max retries reached, page might be in background mode');
            return;
        }

        uiInitialized = true;

        // Add menu item
        addMenuItem(SCRIPT_NAME, openSettingsModal);
        console.log('[Auto Happy Staff] Menu item added successfully');
    }

    function init() {
        console.log('[Auto Happy Staff] Initializing...');

        requestNotificationPermission();
        initUI();

        var settings = loadSettings();
        if (settings.enabled) {
            setTimeout(startMonitoring, 5000);
        }
    }

    // Expose for Android BackgroundScriptService
    window.rebelshipRunAutoHappyStaff = async function() {
        var settings = loadSettings();
        if (!settings.enabled) {
            return { skipped: true, reason: 'disabled' };
        }
        await checkAndAdjustMorale();
        return { success: true };
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 2000);
        });
    } else {
        setTimeout(init, 2000);
    }
})();
