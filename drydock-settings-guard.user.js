// ==UserScript==
// @name         Shipping Manager - Drydock Route Settings Keeper
// @namespace    https://rebelship.org/
// @version      1.1
// @description  Prevents drydock bug by saving and restoring route settings (speed, guards, prices) after drydock
// @author       https://github.com/justonlyforyou/
// @order        10
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-start
// @enabled      true
// ==/UserScript==

(function() {
    'use strict';

    var SCRIPT_NAME = 'Drydock Guard';
    var STORAGE_KEY = 'drydock_settings_guard';
    var API_BASE = 'https://shippingmanager.cc/api';
    var CHECK_INTERVAL = 30000; // Check every 30 seconds

    function log(msg, level) {
        level = level || 'info';
        var prefix = '[Drydock Guard]';
        if (level === 'error') {
            console.error(prefix, msg);
        } else if (level === 'warn') {
            console.warn(prefix, msg);
        } else {
            console.log(prefix, msg);
        }
    }

    // ============================================
    // LOCAL STORAGE CACHE
    // ============================================
    function getCache() {
        try {
            var data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : { vessels: {} };
        } catch (e) {
            log('Failed to read cache: ' + e.message, 'error');
            return { vessels: {} };
        }
    }

    function saveCache(cache) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
        } catch (e) {
            log('Failed to save cache: ' + e.message, 'error');
        }
    }

    function saveVesselSettings(vesselId, settings) {
        var cache = getCache();
        cache.vessels[vesselId] = {
            name: settings.name,
            speed: settings.speed,
            guards: settings.guards,
            prices: settings.prices,
            hoursAtDrydock: settings.hoursAtDrydock,
            routeId: settings.routeId,
            originPort: settings.originPort,
            destinationPort: settings.destinationPort,
            status: settings.status,
            savedAt: Date.now()
        };
        saveCache(cache);
        log('Saved settings for vessel ' + vesselId + ' (' + settings.name + '): speed=' + settings.speed + ', guards=' + settings.guards + ', status=' + settings.status);
    }

    function updateVesselStatus(vesselId, status) {
        var cache = getCache();
        if (cache.vessels[vesselId]) {
            cache.vessels[vesselId].status = status;
            cache.vessels[vesselId].updatedAt = Date.now();
            saveCache(cache);
            log('Updated vessel ' + vesselId + ' status to: ' + status);
        }
    }

    function deleteVesselSettings(vesselId) {
        var cache = getCache();
        var vessel = cache.vessels[vesselId];
        if (vessel) {
            delete cache.vessels[vesselId];
            saveCache(cache);
            log('Deleted settings for vessel ' + vesselId + ' (' + vessel.name + ')');
        }
    }

    function getVesselsByStatus(status) {
        var cache = getCache();
        var result = [];
        for (var id in cache.vessels) {
            if (cache.vessels[id].status === status) {
                result.push({ vesselId: parseInt(id), ...cache.vessels[id] });
            }
        }
        return result;
    }

    function getAllTrackedVessels() {
        var cache = getCache();
        var result = [];
        for (var id in cache.vessels) {
            result.push({ vesselId: parseInt(id), ...cache.vessels[id] });
        }
        return result;
    }

    // ============================================
    // API INTERCEPTOR
    // ============================================
    var originalFetch = window.fetch;

    window.fetch = async function() {
        var args = arguments;
        var url = args[0];
        var options = args[1];
        var urlStr = typeof url === 'string' ? url : url.toString();

        // Intercept drydock bulk request
        if (urlStr.includes('/maintenance/do-major-drydock-maintenance-bulk')) {
            await handleDrydockRequest(options);
        }

        // Execute original fetch
        var response = await originalFetch.apply(this, args);

        // Clone response for our processing (can only read body once)
        var responseClone = response.clone();

        // Intercept vessel data responses
        if (urlStr.includes('/vessel/get-vessels') || urlStr.includes('/game/index')) {
            try {
                var data = await responseClone.json();
                handleVesselDataResponse(data);
            } catch {
                // Ignore JSON parse errors
            }
        }

        return response;
    };

    // ============================================
    // DRYDOCK REQUEST HANDLER
    // ============================================
    async function handleDrydockRequest(options) {
        if (!options || !options.body) return;

        try {
            var body = JSON.parse(options.body);
            var vesselIds = JSON.parse(body.vessel_ids || '[]');

            if (vesselIds.length === 0) return;

            log('Drydock request detected for ' + vesselIds.length + ' vessel(s): ' + vesselIds.join(', '));

            // Fetch current vessel data before drydock
            var vesselData = await fetchVesselData();
            if (!vesselData) return;

            var vesselMap = new Map(vesselData.map(function(v) { return [v.id, v]; }));

            for (var i = 0; i < vesselIds.length; i++) {
                var vesselId = vesselIds[i];
                var vessel = vesselMap.get(vesselId);
                if (!vessel) {
                    log('Vessel ' + vesselId + ' not found in current data', 'warn');
                    continue;
                }

                // Detect bug use: no active route = fast delivery exploit
                var hasActiveRoute = (vessel.active_route && vessel.active_route.route_id) || vessel.route_id;
                var isBugUse = !hasActiveRoute;

                var settings = {
                    name: vessel.name,
                    speed: vessel.route_speed || vessel.max_speed,
                    guards: vessel.route_guards || 0,
                    prices: vessel.prices || {},
                    hoursAtDrydock: vessel.hours_until_check || 0,
                    routeId: vessel.active_route ? vessel.active_route.route_id : null,
                    originPort: vessel.route_origin || vessel.current_port_code,
                    destinationPort: vessel.route_destination,
                    status: isBugUse ? 'bug_use' : 'pre_drydock'
                };

                saveVesselSettings(vesselId, settings);

                if (isBugUse) {
                    log('Bug-use detected for ' + vessel.name + ': No active route (fast delivery exploit)');
                }
            }
        } catch (e) {
            log('Failed to process drydock request: ' + e.message, 'error');
        }
    }

    // ============================================
    // VESSEL DATA RESPONSE HANDLER
    // ============================================
    function handleVesselDataResponse(data) {
        var vessels = (data && data.data && data.data.user_vessels) || (data && data.vessels) || [];
        if (vessels.length === 0) return;

        var vesselMap = new Map(vessels.map(function(v) { return [v.id, v]; }));

        // Check bug_use vessels
        var bugUseVessels = getVesselsByStatus('bug_use');
        for (var i = 0; i < bugUseVessels.length; i++) {
            var saved = bugUseVessels[i];
            var vessel = vesselMap.get(saved.vesselId);
            if (!vessel) {
                log('Bug-use vessel ' + saved.vesselId + ' (' + saved.name + ') not found - deleting entry');
                deleteVesselSettings(saved.vesselId);
                continue;
            }

            if (vessel.status === 'anchor') {
                log(vessel.name + ': Bug-use complete (now anchored), deleting entry');
                deleteVesselSettings(saved.vesselId);
            }
        }

        // Check pre_drydock vessels
        var preDrydockVessels = getVesselsByStatus('pre_drydock');
        for (var j = 0; j < preDrydockVessels.length; j++) {
            var savedPre = preDrydockVessels[j];
            var vesselPre = vesselMap.get(savedPre.vesselId);
            if (!vesselPre) {
                log('Vessel ' + savedPre.vesselId + ' (' + savedPre.name + ') not found in game data', 'warn');
                continue;
            }

            // Skip if still on drydock trip
            if (vesselPre.route_dry_operation === 1) {
                continue;
            }

            // Skip if in maintenance
            if (vesselPre.status === 'maintenance') {
                continue;
            }

            // Check if hours restored (drydock complete)
            var currentHours = vesselPre.hours_until_check || 0;
            var savedHours = savedPre.hoursAtDrydock || 0;

            if (currentHours > savedHours) {
                log(vesselPre.name + ': Drydock complete (hours: ' + savedHours + ' -> ' + currentHours + '), marking as past_drydock');
                updateVesselStatus(savedPre.vesselId, 'past_drydock');
            }
        }

        // Check past_drydock vessels - restore settings when in port
        var pastDrydockVessels = getVesselsByStatus('past_drydock');
        for (var k = 0; k < pastDrydockVessels.length; k++) {
            var savedPost = pastDrydockVessels[k];
            var vesselPost = vesselMap.get(savedPost.vesselId);
            if (!vesselPost) continue;

            // Only restore when vessel is in port and ready to depart
            if (vesselPost.status === 'port' && !vesselPost.is_parked) {
                restoreVesselSettings(savedPost.vesselId, savedPost, vesselPost);
            }
        }
    }

    // ============================================
    // RESTORE VESSEL SETTINGS
    // ============================================
    async function restoreVesselSettings(vesselId, savedSettings, currentVessel) {
        var needsRestore =
            savedSettings.speed !== currentVessel.route_speed ||
            savedSettings.guards !== currentVessel.route_guards ||
            JSON.stringify(savedSettings.prices) !== JSON.stringify(currentVessel.prices);

        if (!needsRestore) {
            log(savedSettings.name + ': Settings already match, deleting entry');
            deleteVesselSettings(vesselId);
            return;
        }

        log(savedSettings.name + ': Restoring post-drydock settings (speed: ' + savedSettings.speed + ' vs ' + currentVessel.route_speed + ', guards: ' + savedSettings.guards + ' vs ' + currentVessel.route_guards + ')');

        try {
            var response = await fetch(API_BASE + '/route/update-route-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    user_vessel_id: vesselId,
                    speed: savedSettings.speed,
                    guards: savedSettings.guards,
                    prices: savedSettings.prices
                })
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var data = await response.json();
            if (data.data && data.data.user_vessel) {
                log(savedSettings.name + ': Settings restored successfully');
                deleteVesselSettings(vesselId);
                showNotification('Drydock Guard: Restored settings for ' + savedSettings.name);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (e) {
            log(savedSettings.name + ': Failed to restore settings: ' + e.message, 'error');
            // Keep entry for retry
        }
    }

    // ============================================
    // FETCH VESSEL DATA
    // ============================================
    async function fetchVesselData() {
        try {
            var response = await originalFetch(API_BASE + '/vessel/get-vessels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });

            if (!response.ok) return null;

            var data = await response.json();
            return (data && data.vessels) || (data && data.data && data.data.user_vessels) || [];
        } catch (e) {
            log('Failed to fetch vessel data: ' + e.message, 'error');
            return null;
        }
    }

    // ============================================
    // PINIA STORE ACCESS
    // ============================================
    function getPinia() {
        try {
            var appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            var app = appEl.__vue_app__;
            return app._context.provides.pinia || app.config.globalProperties.$pinia;
        } catch {
            return null;
        }
    }

    function getStore(name) {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get(name);
        } catch {
            return null;
        }
    }

    function getModalStore() { return getStore('modal'); }
    function getToastStore() { return getStore('toast'); }

    // ============================================
    // NOTIFICATION
    // ============================================
    function showNotification(message, type) {
        type = type || 'success';
        var toastStore = getToastStore();
        if (toastStore) {
            try {
                if (type === 'error' && toastStore.error) {
                    toastStore.error(message);
                } else if (toastStore.success) {
                    toastStore.success(message);
                }
                return;
            } catch {
                // Fallback to console
            }
        }
        log(message);
    }

    // ============================================
    // PERIODIC CHECK
    // ============================================
    async function periodicCheck() {
        var cache = getCache();
        var hasEntries = Object.keys(cache.vessels).length > 0;

        if (!hasEntries) return;

        log('Running periodic check...');

        var vesselData = await fetchVesselData();
        if (vesselData && vesselData.length > 0) {
            handleVesselDataResponse({ vessels: vesselData });
        }
    }

    // ============================================
    // UI: REBELSHIP MENU
    // ============================================
    var isMobile = window.innerWidth < 1024;
    var REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

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
            container.style.cssText = 'position:relative;display:inline-block;margin-left:auto;';

            var btn = document.createElement('button');
            btn.id = 'rebelship-menu-btn';
            btn.innerHTML = REBELSHIP_LOGO;
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:18px;height:18px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;';
            btn.title = 'RebelShip Menu';

            var mobileDropdown = document.createElement('div');
            mobileDropdown.className = 'rebelship-dropdown';
            mobileDropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

            container.appendChild(btn);
            container.appendChild(mobileDropdown);

            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                mobileDropdown.style.display = mobileDropdown.style.display === 'block' ? 'none' : 'block';
            });

            document.addEventListener('click', function(e) {
                if (!container.contains(e.target)) {
                    mobileDropdown.style.display = 'none';
                }
            });

            row.appendChild(container);
            return mobileDropdown;
        }

        // Desktop
        var messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) return null;

        var desktopContainer = document.createElement('div');
        desktopContainer.id = 'rebelship-menu';
        desktopContainer.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:10px;margin-left:auto;';

        var desktopBtn = document.createElement('button');
        desktopBtn.id = 'rebelship-menu-btn';
        desktopBtn.innerHTML = REBELSHIP_LOGO;
        desktopBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        desktopBtn.title = 'RebelShip Menu';

        var desktopDropdown = document.createElement('div');
        desktopDropdown.className = 'rebelship-dropdown';
        desktopDropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

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
    // MODAL UI
    // ============================================
    function formatTimestamp(ts) {
        if (!ts) return 'Never';
        var date = new Date(ts);
        return date.toLocaleString();
    }

    function getStatusColor(status) {
        switch (status) {
            case 'pre_drydock': return '#fbbf24'; // Yellow - waiting for drydock
            case 'bug_use': return '#f87171'; // Red - bug use detected
            case 'past_drydock': return '#4ade80'; // Green - ready to restore
            default: return '#9ca3af';
        }
    }

    function getStatusLabel(status) {
        switch (status) {
            case 'pre_drydock': return 'In Drydock';
            case 'bug_use': return 'Bug Use';
            case 'past_drydock': return 'Ready to Restore';
            default: return status;
        }
    }

    function openDrydockGuardModal() {
        var modalStore = getModalStore();
        if (!modalStore) {
            log('Modal store not found', 'error');
            return;
        }

        log('Opening Drydock Guard modal');
        modalStore.open('routeResearch');

        setTimeout(function() {
            if (modalStore.modalSettings) {
                modalStore.modalSettings.title = 'Drydock Guard - Tracked Vessels';
                modalStore.modalSettings.navigation = [];
                modalStore.modalSettings.controls = [];
                modalStore.modalSettings.noBackButton = true;
            }
            if (modalStore.history) {
                modalStore.history.length = 0;
            }

            var centralContainer = document.getElementById('central-container');
            if (!centralContainer) {
                log('central-container not found', 'error');
                return;
            }

            centralContainer.style.height = '100%';
            centralContainer.style.overflow = 'hidden';

            renderModalContent(centralContainer);
        }, 200);
    }

    function renderModalContent(container) {
        var vessels = getAllTrackedVessels();

        var html = '<div style="padding:20px 10px;font-family:Lato,sans-serif;color:#01125d;height:100%;display:flex;flex-direction:column;box-sizing:border-box;">';

        // Header with count and clear button
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">';
        html += '<div style="font-size:14px;color:#626b90;">';
        html += 'Tracking <strong>' + vessels.length + '</strong> vessel(s)';
        html += '</div>';

        html += '<div style="display:flex;gap:8px;">';
        html += '<button id="drydock-refresh-btn" style="padding:8px 16px;background:linear-gradient(180deg,#3b82f6,#1d4ed8);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:13px;font-weight:500;">Refresh</button>';
        if (vessels.length > 0) {
            html += '<button id="drydock-clear-btn" style="padding:8px 16px;background:linear-gradient(180deg,#ef4444,#b91c1c);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:13px;font-weight:500;">Clear All</button>';
        }
        html += '</div>';
        html += '</div>';

        if (vessels.length === 0) {
            html += '<div style="text-align:center;padding:40px;color:#626b90;">';
            html += '<p style="font-size:16px;margin-bottom:10px;">No vessels being tracked.</p>';
            html += '<p style="font-size:13px;">When you send vessels to drydock, their settings will be saved here and restored automatically after drydock.</p>';
            html += '</div>';
        } else {
            // Status legend
            html += '<div style="display:flex;gap:16px;margin-bottom:12px;font-size:11px;">';
            html += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#fbbf24;margin-right:4px;"></span>In Drydock</span>';
            html += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f87171;margin-right:4px;"></span>Bug Use</span>';
            html += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#4ade80;margin-right:4px;"></span>Ready to Restore</span>';
            html += '</div>';

            // Vessel list
            html += '<div id="drydock-vessel-list" style="flex:1;overflow-y:auto;min-height:0;">';
            html += renderVesselList(vessels);
            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;

        // Event handlers
        var refreshBtn = document.getElementById('drydock-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async function() {
                await periodicCheck();
                renderModalContent(container);
                showNotification('Refreshed vessel status');
            });
        }

        var clearBtn = document.getElementById('drydock-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                if (confirm('Clear all tracked vessels? This cannot be undone.')) {
                    localStorage.removeItem(STORAGE_KEY);
                    renderModalContent(container);
                    showNotification('Cleared all tracked vessels');
                }
            });
        }

        attachRowHandlers(container);
    }

    function renderVesselList(vessels) {
        if (vessels.length === 0) {
            return '<div style="text-align:center;padding:20px;color:#626b90;">No vessels tracked.</div>';
        }

        // Sort by status priority: past_drydock first, then pre_drydock, then bug_use
        var statusOrder = { 'past_drydock': 0, 'pre_drydock': 1, 'bug_use': 2 };
        vessels.sort(function(a, b) {
            return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
        });

        var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '<thead style="position:sticky;top:0;background:#d1d5db;z-index:10;">';
        html += '<tr style="text-align:left;">';
        html += '<th style="padding:6px 8px;border-bottom:2px solid #9ca3af;">Vessel</th>';
        html += '<th style="padding:6px 8px;border-bottom:2px solid #9ca3af;">Status</th>';
        html += '<th style="padding:6px 8px;border-bottom:2px solid #9ca3af;text-align:center;">Speed</th>';
        html += '<th style="padding:6px 8px;border-bottom:2px solid #9ca3af;text-align:center;">Guards</th>';
        html += '<th style="padding:6px 8px;border-bottom:2px solid #9ca3af;">Route</th>';
        html += '<th style="padding:6px 8px;border-bottom:2px solid #9ca3af;">Saved</th>';
        html += '<th style="padding:6px 8px;border-bottom:2px solid #9ca3af;text-align:center;">Actions</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var i = 0; i < vessels.length; i++) {
            var v = vessels[i];
            var rowBg = i % 2 === 0 ? '#f3f4f6' : '#fff';
            var statusColor = getStatusColor(v.status);

            html += '<tr class="drydock-vessel-row" data-vessel-id="' + v.vesselId + '" style="background:' + rowBg + ';">';

            // Vessel name
            html += '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-weight:500;">' + (v.name || 'Unknown') + '</td>';

            // Status badge
            html += '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">';
            html += '<span style="display:inline-block;padding:2px 8px;background:' + statusColor + ';color:#fff;border-radius:10px;font-size:10px;font-weight:500;">' + getStatusLabel(v.status) + '</span>';
            html += '</td>';

            // Speed
            html += '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">' + (v.speed || '-') + '</td>';

            // Guards
            html += '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">' + (v.guards || 0) + '</td>';

            // Route
            var route = (v.originPort || '?') + ' -> ' + (v.destinationPort || '?');
            html += '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#626b90;">' + route + '</td>';

            // Saved timestamp
            html += '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#9ca3af;">' + formatTimestamp(v.savedAt) + '</td>';

            // Actions
            html += '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">';
            html += '<button class="drydock-delete-btn" data-vessel-id="' + v.vesselId + '" style="padding:4px 8px;background:#ef4444;border:0;border-radius:4px;color:#fff;cursor:pointer;font-size:10px;" title="Remove from tracking">X</button>';
            html += '</td>';

            html += '</tr>';
        }

        html += '</tbody>';
        html += '</table>';

        return html;
    }

    function attachRowHandlers(container) {
        var deleteBtns = container.querySelectorAll('.drydock-delete-btn');
        deleteBtns.forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var vesselId = parseInt(btn.dataset.vesselId);
                if (vesselId) {
                    deleteVesselSettings(vesselId);
                    renderModalContent(container);
                    showNotification('Removed vessel from tracking');
                }
            });
        });
    }

    // ============================================
    // DEBUG: View cache contents
    // ============================================
    window.drydockGuardDebug = {
        getCache: getCache,
        clearCache: function() {
            localStorage.removeItem(STORAGE_KEY);
            log('Cache cleared');
        },
        listVessels: function() {
            var cache = getCache();
            var rows = [];
            for (var id in cache.vessels) {
                var v = cache.vessels[id];
                rows.push({
                    id: id,
                    name: v.name,
                    status: v.status,
                    speed: v.speed,
                    guards: v.guards,
                    hoursAtDrydock: v.hoursAtDrydock
                });
            }
            console.table(rows);
        }
    };

    // ============================================
    // INITIALIZE
    // ============================================
    log('Script loaded - intercepting drydock requests');

    // Start periodic check after page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setInterval(periodicCheck, CHECK_INTERVAL);
        });
    } else {
        setInterval(periodicCheck, CHECK_INTERVAL);
    }

    // Run initial check after a delay
    setTimeout(periodicCheck, 5000);

    // UI initialization
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
            log('Max UI retries reached');
            return;
        }

        uiInitialized = true;
        addMenuItem(SCRIPT_NAME, openDrydockGuardModal);
        log('Menu item added');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initUI, 2000);
        });
    } else {
        setTimeout(initUI, 2000);
    }

})();
