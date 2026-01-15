// ==UserScript==
// @name         ShippingManager - Auto Happy Staff
// @namespace    http://tampermonkey.net/
// @description  Automatically manages staff salaries to maintain crew and management morale at target levels
// @version      1.16
// @author       https://github.com/justonlyforyou/
// @order        25
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// @background-job-required true
// ==/UserScript==
/* globals GM_info */

(function() {
    'use strict';

    var SCRIPT_NAME = 'Auto Happy Staff';
    var STORAGE_KEY = 'rebelship_autohappy_settings';
    var CHECK_INTERVAL = 15 * 60 * 1000; // Check every 15 minutes (Android compatible)
    var API_BASE = 'https://shippingmanager.cc/api';

    var DEFAULT_SETTINGS = {
        enabled: false,
        targetMorale: 100,
        systemNotifications: false,
        // Smiley thresholds (percentage)
        happyThreshold: 75,
        neutralThreshold: 50,
        sadThreshold: 35,
        badThreshold: 25
    };

    // Staff type classifications
    var CREW_TYPES = ['captain', 'first_officer', 'boatswain', 'technical_officer'];
    var MANAGEMENT_TYPES = ['cfo', 'coo', 'cmo', 'cto'];

    // Header display elements
    var moraleDisplayElement = null;
    var crewSmileyElement = null;
    var managementSmileyElement = null;
    var displayRetries = 0;

    console.log('[Auto Happy Staff] v' + GM_info.script.version + ' loaded');

    // ============================================
    // HEADER SMILEY DISPLAY
    // ============================================

    // Captain hat SVG (for management) - lighter blue for visibility
    var CAPTAIN_HAT_SVG = '<svg viewBox="0 0 24 12" width="18" height="9" style="position:absolute;top:-6px;left:50%;transform:translateX(-50%);"><path d="M4 10 L12 2 L20 10 L18 10 L12 5 L6 10 Z" fill="#4a7ab5"/><path d="M3 10 L21 10 L21 12 L3 12 Z" fill="#4a7ab5"/><circle cx="12" cy="7" r="2" fill="#ffd700"/></svg>';

    // Sailor hat SVG (for crew) - classic white sailor cap with blue band
    var SAILOR_HAT_SVG = '<svg viewBox="0 0 20 10" width="16" height="8" style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);"><path d="M4 9 L4 6 Q10 3 16 6 L16 9 Z" fill="#ffffff" stroke="#1e3a5f" stroke-width="0.5"/><path d="M4 7 L16 7 L16 8 L4 8 Z" fill="#1e3a5f"/><ellipse cx="10" cy="9" rx="7" ry="1.5" fill="#ffffff" stroke="#1e3a5f" stroke-width="0.5"/></svg>';

    /**
     * Generate a smiley face based on morale percentage with configurable thresholds
     * @param {number} percentage - Morale percentage (0-100)
     * @param {string} hatType - 'captain' or 'sailor'
     * @param {Object} thresholds - Custom thresholds from settings
     * @returns {string} HTML string for smiley with hat
     */
    function generateHeaderSmiley(percentage, hatType, thresholds) {
        var t = thresholds;
        var faceColor = '';
        var glowColor = '';

        // Determine face color based on thresholds
        if (percentage >= t.happyThreshold) {
            faceColor = '#fbbf24'; // Gold/yellow - happy
            glowColor = 'rgba(251,191,36,0.6)';
        } else if (percentage >= t.neutralThreshold) {
            faceColor = '#e5e7eb'; // Light gray - neutral
            glowColor = '';
        } else if (percentage >= t.sadThreshold) {
            faceColor = '#9ca3af'; // Gray - sad
            glowColor = '';
        } else if (percentage >= t.badThreshold) {
            faceColor = '#f87171'; // Light red - bad
            glowColor = '';
        } else {
            faceColor = '#ef4444'; // Red - critical
            glowColor = 'rgba(239,68,68,0.6)';
        }

        // Calculate mouth curve - stronger expression based on percentage
        var mouthPath = '';
        if (percentage >= 70) {
            // Big smile - happy
            var smileCurve = 3 + Math.round((percentage - 70) / 30 * 3); // 3-6px curve down
            mouthPath = 'M5 11 Q9 ' + (11 + smileCurve) + ' 13 11';
        } else if (percentage >= 50) {
            // Slight smile
            var slightSmile = Math.round((percentage - 50) / 20 * 3); // 0-3px curve
            mouthPath = 'M6 12 Q9 ' + (12 + slightSmile) + ' 12 12';
        } else if (percentage >= 35) {
            // Neutral to slight frown
            var slightFrown = Math.round((50 - percentage) / 15 * 2); // 0-2px curve up
            mouthPath = 'M6 12 Q9 ' + (12 - slightFrown) + ' 12 12';
        } else if (percentage >= 20) {
            // Sad frown
            var sadCurve = 2 + Math.round((35 - percentage) / 15 * 3); // 2-5px curve up
            mouthPath = 'M5 13 Q9 ' + (13 - sadCurve) + ' 13 13';
        } else {
            // Very sad / angry - strong frown
            mouthPath = 'M5 14 Q9 8 13 14';
        }

        var hatSvg = hatType === 'captain' ? CAPTAIN_HAT_SVG : SAILOR_HAT_SVG;
        var boxShadow = glowColor ? 'box-shadow:0 0 6px ' + glowColor + ';' : '';

        return '<div style="position:relative;display:inline-block;width:18px;height:18px;">' +
            hatSvg +
            '<svg viewBox="0 0 18 18" width="18" height="18">' +
            '<circle cx="9" cy="9" r="8" fill="' + faceColor + '" style="' + boxShadow + '"/>' +
            '<circle cx="6" cy="7" r="1.5" fill="#1f2937"/>' +
            '<circle cx="12" cy="7" r="1.5" fill="#1f2937"/>' +
            '<path d="' + mouthPath + '" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
            '</svg></div>';
    }

    /**
     * Create the morale display in the header
     */
    function createMoraleDisplay() {
        if (moraleDisplayElement) return moraleDisplayElement;

        // Find insertion point - after coop or reputation display, or after CO2 container
        var coopDisplay = document.getElementById('coop-tickets-display');
        var repDisplay = document.getElementById('reputation-display');
        var insertAfter = repDisplay || coopDisplay;

        if (!insertAfter) {
            // Fall back to CO2 container
            insertAfter = document.querySelector('.content.led.cursor-pointer');
        }

        if (!insertAfter || !insertAfter.parentNode) {
            return null;
        }

        // Create container
        moraleDisplayElement = document.createElement('div');
        moraleDisplayElement.id = 'morale-smiley-display';
        moraleDisplayElement.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:8px;cursor:pointer;';
        moraleDisplayElement.title = 'Staff Morale - Click to open settings';
        moraleDisplayElement.addEventListener('click', openSettingsModal);

        // Management smiley container (with captain hat)
        var mgmtContainer = document.createElement('div');
        mgmtContainer.style.cssText = 'display:flex;flex-direction:column;align-items:center;line-height:1;';
        var mgmtLabel = document.createElement('span');
        mgmtLabel.style.cssText = 'color:#9ca3af;margin-bottom:3px;';
        mgmtLabel.textContent = 'Mgmt';
        managementSmileyElement = document.createElement('div');
        managementSmileyElement.id = 'mgmt-smiley';
        managementSmileyElement.innerHTML = generateHeaderSmiley(100, 'captain', loadSettings());
        mgmtContainer.appendChild(mgmtLabel);
        mgmtContainer.appendChild(managementSmileyElement);

        // Crew smiley container (with sailor hat)
        var crewContainer = document.createElement('div');
        crewContainer.style.cssText = 'display:flex;flex-direction:column;align-items:center;line-height:1;';
        var crewLabel = document.createElement('span');
        crewLabel.style.cssText = 'color:#9ca3af;margin-bottom:3px;';
        crewLabel.textContent = 'Crew';
        crewSmileyElement = document.createElement('div');
        crewSmileyElement.id = 'crew-smiley';
        crewSmileyElement.innerHTML = generateHeaderSmiley(100, 'sailor', loadSettings());
        crewContainer.appendChild(crewLabel);
        crewContainer.appendChild(crewSmileyElement);

        moraleDisplayElement.appendChild(mgmtContainer);
        moraleDisplayElement.appendChild(crewContainer);

        // Insert after target element
        insertAfter.parentNode.insertBefore(moraleDisplayElement, insertAfter.nextSibling);
        console.log('[Auto Happy Staff] Morale display created in header');

        return moraleDisplayElement;
    }

    /**
     * Update the header smiley display with current morale values
     */
    async function updateMoraleDisplay() {
        var staffData = await fetchStaffData();
        if (!staffData || !staffData.info) {
            return;
        }

        var crewMorale = staffData.info.crew ? Math.round(parseFloat(staffData.info.crew.percentage)) : 0;
        var managementMorale = staffData.info.management ? Math.round(parseFloat(staffData.info.management.percentage)) : 0;
        var settings = loadSettings();

        if (!moraleDisplayElement) {
            createMoraleDisplay();
        }

        if (!moraleDisplayElement) {
            displayRetries++;
            if (displayRetries < 10) {
                setTimeout(updateMoraleDisplay, 2000);
            }
            return;
        }

        var thresholds = {
            happyThreshold: settings.happyThreshold,
            neutralThreshold: settings.neutralThreshold,
            sadThreshold: settings.sadThreshold,
            badThreshold: settings.badThreshold
        };

        if (managementSmileyElement) {
            managementSmileyElement.innerHTML = generateHeaderSmiley(managementMorale, 'captain', thresholds);
            managementSmileyElement.title = 'Management: ' + managementMorale + '%';
        }

        if (crewSmileyElement) {
            crewSmileyElement.innerHTML = generateHeaderSmiley(crewMorale, 'sailor', thresholds);
            crewSmileyElement.title = 'Crew: ' + crewMorale + '%';
        }

        console.log('[Auto Happy Staff] Display updated - Crew: ' + crewMorale + '%, Management: ' + managementMorale + '%');
    }

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
                console.log('[Auto Happy Staff] System notification sent');
                return;
            } catch (e) {
                console.log('[Auto Happy Staff] System notification failed: ' + e.message);
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

            // Raise salaries for staff with low morale - keep raising until target is reached
            var MAX_RAISES_PER_STAFF = 50; // Safety limit to prevent infinite loops

            for (var i = 0; i < staffToAdjust.length; i++) {
                var staff = staffToAdjust[i];
                var currentMorale = Math.round(staff.morale);
                var raiseCount = 0;

                console.log('[Auto Happy Staff] Starting raises for ' + staff.type + ' (current morale: ' + currentMorale + '%, target: ' + effectiveTarget + '%)');

                // Keep raising until morale reaches target or max raises hit
                while (currentMorale < effectiveTarget && raiseCount < MAX_RAISES_PER_STAFF) {
                    var result = await raiseSalary(staff.type);

                    if (result && result.data && result.data.staff) {
                        var newMorale = Math.round(result.data.staff.morale);
                        var newSalary = result.data.staff.salary;
                        raiseCount++;
                        raisedCount++;

                        console.log('[Auto Happy Staff] ' + staff.type + ' raise #' + raiseCount + ': $' + newSalary + ' (morale: ' + currentMorale + '% -> ' + newMorale + '%)');

                        // Check if morale actually increased
                        if (newMorale <= currentMorale) {
                            console.log('[Auto Happy Staff] ' + staff.type + ' morale not increasing, stopping raises');
                            break;
                        }

                        currentMorale = newMorale;
                    } else {
                        console.log('[Auto Happy Staff] ' + staff.type + ' raise failed, stopping');
                        break;
                    }

                    // Delay between API calls to not hammer the server
                    await new Promise(function(resolve) { setTimeout(resolve, 500); });
                }

                if (currentMorale >= effectiveTarget) {
                    console.log('[Auto Happy Staff] ' + staff.type + ' reached target morale: ' + currentMorale + '%');
                } else {
                    console.log('[Auto Happy Staff] ' + staff.type + ' stopped at morale: ' + currentMorale + '% (raises: ' + raiseCount + ')');
                }
            }

            // Fetch updated data to get new morale levels
            var updatedData = await fetchStaffData();
            if (updatedData && updatedData.info) {
                var newCrew = Math.round(parseFloat(updatedData.info.crew ? updatedData.info.crew.percentage : 0));
                var newManagement = Math.round(parseFloat(updatedData.info.management ? updatedData.info.management.percentage : 0));

                if (raisedCount > 0) {
                    var summary = 'Salaries adjusted. Crew: ' + newCrew + '%, Mgmt: ' + newManagement + '%';
                    notify(summary, 'success');
                    console.log('[Auto Happy Staff] ' + summary);
                } else if (manual) {
                    notify('Crew: ' + newCrew + '%, Mgmt: ' + newManagement + '%', 'success');
                }

                // Update header smileys with new morale values
                updateMoraleDisplay();
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

    function getOrCreateRebelShipMenu() {
        // Check if menu already exists
        var menu = document.getElementById('rebelship-menu');
        if (menu) {
            return menu.querySelector('.rebelship-dropdown');
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

        var messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) {
            window._rebelshipMenuCreating = false;
            return null;
        }

        var container = document.createElement('div');
        container.id = 'rebelship-menu';
        container.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:4px !important;';

        var btn = document.createElement('button');
        btn.id = 'rebelship-menu-btn';
        btn.innerHTML = REBELSHIP_LOGO;
        btn.title = 'RebelShip Menu';

        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';

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

        if (messagingIcon.parentNode) {
            messagingIcon.parentNode.insertBefore(container, messagingIcon);
        }

        window._rebelshipMenuCreating = false;
        return dropdown;
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
                <div style="padding:20px;max-width:450px;margin:0 auto;font-family:Lato,sans-serif;color:#01125d;">\
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
                    <div style="margin-bottom:20px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:14px;">\
                            <input type="checkbox" id="ah-notifications" ' + (currentSettings.systemNotifications ? 'checked' : '') + '\
                                   style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;cursor:pointer;">\
                            <span>System Notifications</span>\
                        </label>\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;margin-left:28px;">\
                            Send push notifications when salaries are raised\
                        </div>\
                    </div>\
                    <div style="margin-bottom:20px;padding:15px;background:#f0f4f8;border-radius:8px;">\
                        <label style="display:block;font-weight:700;font-size:14px;margin-bottom:12px;text-align:center;">Smiley Thresholds (Header Display)</label>\
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">\
                            <div style="text-align:center;">\
                                <label style="font-size:12px;color:#626b90;">Happy (yellow)</label>\
                                <div style="display:flex;align-items:center;justify-content:center;gap:4px;">\
                                    <input type="number" id="ah-happy-threshold" value="' + currentSettings.happyThreshold + '" min="0" max="100"\
                                           style="width:60px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center;">\
                                    <span style="font-size:12px;">%+</span>\
                                </div>\
                            </div>\
                            <div style="text-align:center;">\
                                <label style="font-size:12px;color:#626b90;">Neutral (gray)</label>\
                                <div style="display:flex;align-items:center;justify-content:center;gap:4px;">\
                                    <input type="number" id="ah-neutral-threshold" value="' + currentSettings.neutralThreshold + '" min="0" max="100"\
                                           style="width:60px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center;">\
                                    <span style="font-size:12px;">%+</span>\
                                </div>\
                            </div>\
                            <div style="text-align:center;">\
                                <label style="font-size:12px;color:#626b90;">Sad (dark gray)</label>\
                                <div style="display:flex;align-items:center;justify-content:center;gap:4px;">\
                                    <input type="number" id="ah-sad-threshold" value="' + currentSettings.sadThreshold + '" min="0" max="100"\
                                           style="width:60px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center;">\
                                    <span style="font-size:12px;">%+</span>\
                                </div>\
                            </div>\
                            <div style="text-align:center;">\
                                <label style="font-size:12px;color:#626b90;">Bad (red)</label>\
                                <div style="display:flex;align-items:center;justify-content:center;gap:4px;">\
                                    <input type="number" id="ah-bad-threshold" value="' + currentSettings.badThreshold + '" min="0" max="100"\
                                           style="width:60px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px;text-align:center;">\
                                    <span style="font-size:12px;">%+</span>\
                                </div>\
                            </div>\
                        </div>\
                        <div style="font-size:11px;color:#626b90;margin-top:8px;text-align:center;">\
                            Below Bad threshold = Critical (glowing red)\
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
                    systemNotifications: document.getElementById('ah-notifications').checked,
                    happyThreshold: parseInt(document.getElementById('ah-happy-threshold').value, 10) || 75,
                    neutralThreshold: parseInt(document.getElementById('ah-neutral-threshold').value, 10) || 50,
                    sadThreshold: parseInt(document.getElementById('ah-sad-threshold').value, 10) || 35,
                    badThreshold: parseInt(document.getElementById('ah-bad-threshold').value, 10) || 25
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

                // Update display immediately with new thresholds
                updateMoraleDisplay();

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

        // Initialize morale display in header (always active)
        setTimeout(function() {
            createMoraleDisplay();
            updateMoraleDisplay();
            // Update display every 15 minutes
            setInterval(updateMoraleDisplay, CHECK_INTERVAL);
        }, 3000);

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

    // Listen for header resize event to reinitialize display
    window.addEventListener('rebelship-header-resize', function() {
        console.log('[Auto Happy Staff] Header resize detected, reinitializing display...');
        moraleDisplayElement = null;
        crewSmileyElement = null;
        managementSmileyElement = null;
        displayRetries = 0;
        setTimeout(function() {
            createMoraleDisplay();
            updateMoraleDisplay();
        }, 450);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 2000);
        });
    } else {
        setTimeout(init, 2000);
    }
})();
