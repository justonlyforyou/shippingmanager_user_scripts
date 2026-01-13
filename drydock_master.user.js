// ==UserScript==
// @name         ShippingManager - Auto Drydock & Route Settings Manager
// @namespace    https://rebelship.org/
// @description  Unified drydock management: bug prevention, route settings persistence, auto-drydock, pre-departure sync.
// @version     3.1
// @author       https://github.com/justonlyforyou/
// @order        29
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      true
// @background-job-required true
// ==/UserScript==

(function() {
    'use strict';

    var SCRIPT_NAME = 'Drydock Master';
    var STORAGE_KEY = 'rebelship_drydock_master';
    var CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes for Android compatibility
    var API_BASE = 'https://shippingmanager.cc/api';

    var DEFAULT_SETTINGS = {
        // Auto Drydock
        autoDrydockEnabled: false,
        autoDrydockThreshold: 150,
        autoDrydockType: 'major',
        autoDrydockSpeed: 'minimum',
        autoDrydockMinCash: 500000,
        // Notifications
        systemNotifications: true
    };

    var isMobile = window.innerWidth < 1024;

    function log(msg, level) {
        level = level || 'info';
        var prefix = '[Drydock Master]';
        if (level === 'error') {
            console.error(prefix, msg);
        } else if (level === 'warn') {
            console.warn(prefix, msg);
        } else {
            console.log(prefix, msg);
        }
    }

    log('v3.0 loaded');

    // ============================================
    // STORAGE - All data in one localStorage key
    // ============================================
    function getStorage() {
        try {
            var data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                var parsed = JSON.parse(data);
                return {
                    settings: Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {}),
                    drydockVessels: parsed.drydockVessels || {},
                    pendingRouteSettings: parsed.pendingRouteSettings || {}
                };
            }
        } catch (e) {
            log('Failed to read storage: ' + e.message, 'error');
        }
        return {
            settings: Object.assign({}, DEFAULT_SETTINGS),
            drydockVessels: {},
            pendingRouteSettings: {}
        };
    }

    function saveStorage(storage) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
            syncSettingsToAndroid(storage.settings);
        } catch (e) {
            log('Failed to save storage: ' + e.message, 'error');
        }
    }

    function getSettings() {
        return getStorage().settings;
    }

    function saveSettings(settings) {
        var storage = getStorage();
        storage.settings = settings;
        saveStorage(storage);
        log('Settings saved');
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
    // DRYDOCK VESSELS STORAGE
    // ============================================
    function saveDrydockVessel(vesselId, data) {
        var storage = getStorage();
        storage.drydockVessels[vesselId] = {
            name: data.name,
            speed: data.speed,
            guards: data.guards,
            prices: data.prices,
            hoursAtDrydock: data.hoursAtDrydock,
            routeId: data.routeId,
            originPort: data.originPort,
            destinationPort: data.destinationPort,
            status: data.status,
            savedAt: Date.now()
        };
        saveStorage(storage);
        log('Saved drydock settings for ' + data.name + ' (status: ' + data.status + ')');
    }

    function updateDrydockVesselStatus(vesselId, status) {
        var storage = getStorage();
        if (storage.drydockVessels[vesselId]) {
            storage.drydockVessels[vesselId].status = status;
            storage.drydockVessels[vesselId].updatedAt = Date.now();
            saveStorage(storage);
            log('Updated vessel ' + vesselId + ' status to: ' + status);
        }
    }

    function deleteDrydockVessel(vesselId) {
        var storage = getStorage();
        var vessel = storage.drydockVessels[vesselId];
        if (vessel) {
            delete storage.drydockVessels[vesselId];
            saveStorage(storage);
            log('Deleted drydock entry for ' + vessel.name);
        }
    }

    function getDrydockVesselsByStatus(status) {
        var storage = getStorage();
        var result = [];
        for (var id in storage.drydockVessels) {
            if (storage.drydockVessels[id].status === status) {
                result.push({ vesselId: parseInt(id), data: storage.drydockVessels[id] });
            }
        }
        return result;
    }

    function getAllDrydockVessels() {
        var storage = getStorage();
        var result = [];
        for (var id in storage.drydockVessels) {
            result.push({ vesselId: parseInt(id), data: storage.drydockVessels[id] });
        }
        return result;
    }

    // ============================================
    // PENDING ROUTE SETTINGS STORAGE
    // ============================================
    function savePendingRouteSettings(vesselId, data) {
        var storage = getStorage();
        storage.pendingRouteSettings[vesselId] = {
            name: data.name,
            speed: data.speed,
            guards: data.guards,
            prices: data.prices,
            savedAt: Date.now()
        };
        saveStorage(storage);
        log('Saved pending route settings for ' + data.name);
    }

    function getPendingRouteSettings(vesselId) {
        var storage = getStorage();
        return storage.pendingRouteSettings[vesselId] || null;
    }

    function deletePendingRouteSettings(vesselId) {
        var storage = getStorage();
        var vessel = storage.pendingRouteSettings[vesselId];
        if (vessel) {
            delete storage.pendingRouteSettings[vesselId];
            saveStorage(storage);
            log('Deleted pending route settings for ' + vessel.name);
        }
    }

    function getAllPendingRouteSettings() {
        var storage = getStorage();
        var result = [];
        for (var id in storage.pendingRouteSettings) {
            result.push({ vesselId: parseInt(id), data: storage.pendingRouteSettings[id] });
        }
        return result;
    }

    function getPendingRouteSettingsCount() {
        var storage = getStorage();
        return Object.keys(storage.pendingRouteSettings).length;
    }

    // Clean up stale pending entries (vessels that no longer exist, have no routes, or values already match)
    async function cleanupStalePendingSettings() {
        var storage = getStorage();
        var pendingIds = Object.keys(storage.pendingRouteSettings);
        if (pendingIds.length === 0) return;

        var vessels = await fetchVesselData();
        if (!vessels || vessels.length === 0) return;

        var vesselMap = new Map(vessels.map(function(v) { return [v.id, v]; }));
        var removed = 0;

        for (var i = 0; i < pendingIds.length; i++) {
            var vesselId = parseInt(pendingIds[i]);
            var vessel = vesselMap.get(vesselId);
            var pending = storage.pendingRouteSettings[vesselId];
            var pendingName = pending ? pending.name : 'Unknown';

            // Remove if vessel doesn't exist or has no route
            if (!vessel || !vessel.route_origin || !vessel.route_destination) {
                log('Removing stale pending settings for ' + pendingName + ' (vessel gone or no route)');
                delete storage.pendingRouteSettings[vesselId];
                removed++;
                continue;
            }

            // Remove if pending values match current values (already applied)
            var speedMatch = pending.speed === undefined || pending.speed === vessel.route_speed;
            var guardsMatch = pending.guards === undefined || pending.guards === vessel.route_guards;
            var pricesMatch = true;
            if (pending.prices && vessel.prices) {
                pricesMatch = (pending.prices.dry === undefined || pending.prices.dry === vessel.prices.dry) &&
                              (pending.prices.refrigerated === undefined || pending.prices.refrigerated === vessel.prices.refrigerated) &&
                              (pending.prices.fuel === undefined || pending.prices.fuel === vessel.prices.fuel) &&
                              (pending.prices.crude_oil === undefined || pending.prices.crude_oil === vessel.prices.crude_oil);
            }

            if (speedMatch && guardsMatch && pricesMatch) {
                log('Removing pending settings for ' + pendingName + ' (values already match current)');
                delete storage.pendingRouteSettings[vesselId];
                removed++;
            }
        }

        if (removed > 0) {
            saveStorage(storage);
            log('Cleaned up ' + removed + ' stale pending entries');
        }
    }

    // ============================================
    // PINIA STORE HELPERS
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
    // NOTIFICATIONS
    // ============================================
    function notify(message, type) {
        type = type || 'success';
        log(type.toUpperCase() + ': ' + message);

        // In-game toast
        var toastStore = getToastStore();
        if (toastStore) {
            try {
                if (type === 'error' && toastStore.error) {
                    toastStore.error(message);
                } else if (toastStore.success) {
                    toastStore.success(message);
                }
            } catch {
                // Ignore
            }
        }

        // System notification
        showSystemNotification(message);
    }

    function showSystemNotification(message) {
        var settings = getSettings();
        log('showSystemNotification called, systemNotifications=' + settings.systemNotifications);
        if (!settings.systemNotifications) {
            log('System notifications disabled, skipping');
            return;
        }

        // Android bridge
        if (typeof window.RebelShipNotify !== 'undefined' && window.RebelShipNotify.notify) {
            try {
                window.RebelShipNotify.notify(SCRIPT_NAME + ': ' + message);
                log('Android notification sent');
                return;
            } catch (e) {
                log('Android notification failed: ' + e.message, 'error');
            }
        }

        // Web Notification API
        log('Trying Web Notification API, permission=' + (typeof Notification !== 'undefined' ? Notification.permission : 'undefined'));
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                try {
                    new Notification(SCRIPT_NAME, {
                        body: message,
                        icon: 'https://shippingmanager.cc/favicon.ico',
                        tag: 'drydock-master'
                    });
                    log('Web notification sent');
                } catch (e) {
                    log('Web notification failed: ' + e.message, 'error');
                }
            } else if (Notification.permission !== 'denied') {
                log('Requesting notification permission...');
                Notification.requestPermission();
            } else {
                log('Notification permission denied');
            }
        } else {
            log('Web Notification API not available');
        }
    }

    // ============================================
    // API FUNCTIONS
    // ============================================
    var originalFetch = window.fetch;

    async function apiFetch(endpoint, body) {
        try {
            var response = await originalFetch(API_BASE + endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body || {})
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return await response.json();
        } catch (e) {
            log('API call failed (' + endpoint + '): ' + e.message, 'error');
            return null;
        }
    }

    async function fetchVesselData() {
        var data = await apiFetch('/vessel/get-all-user-vessels', { include_routes: true });
        if (data && data.data && data.data.user_vessels) {
            return data.data.user_vessels;
        }
        return [];
    }

    async function fetchUserData() {
        var data = await apiFetch('/user/get-user-settings', {});
        if (data && data.data) {
            return data.data;
        }
        return null;
    }

    async function updateRouteData(vesselId, speed, guards, prices) {
        var body = {
            user_vessel_id: vesselId,
            speed: speed,
            guards: guards,
            prices: prices
        };
        var data = await apiFetch('/route/update-route-data', body);
        return data && data.data && data.data.user_vessel;
    }

    async function sendToDrydock(vesselIds, speed, maintenanceType) {
        var body = {
            vessel_ids: JSON.stringify(vesselIds),
            speed: speed,
            maintenance_type: maintenanceType
        };
        var data = await apiFetch('/maintenance/do-major-drydock-maintenance-bulk', body);
        return data;
    }

    async function getMaintenanceCost(vesselIds, speed, maintenanceType) {
        var body = {
            vessel_ids: JSON.stringify(vesselIds),
            speed: speed,
            maintenance_type: maintenanceType
        };
        var data = await apiFetch('/maintenance/get', body);
        if (data && data.data) {
            return data.data;
        }
        return null;
    }

    // ============================================
    // FETCH INTERCEPTOR - Drydock Detection
    // ============================================
    window.fetch = async function() {
        var args = arguments;
        var url = args[0];
        var options = args[1];
        var urlStr = typeof url === 'string' ? url : url.toString();

        // Intercept drydock bulk request - save settings BEFORE drydock
        if (urlStr.includes('/maintenance/do-major-drydock-maintenance-bulk')) {
            await handleDrydockRequest(options);
        }

        // Intercept depart request - apply pending settings BEFORE departure
        if (urlStr.includes('/route/depart')) {
            await applyPendingSettingsBeforeDepart(options);
        }

        // Execute original fetch
        var response = await originalFetch.apply(this, args);
        var responseClone = response.clone();

        // Intercept vessel data responses - check drydock completion
        if (urlStr.includes('/vessel/get-vessels') ||
            urlStr.includes('/vessel/get-all-user-vessels') ||
            urlStr.includes('/game/index')) {
            try {
                var data = await responseClone.json();
                handleVesselDataResponse(data);
            } catch {
                // Ignore JSON parse errors
            }
        }

        return response;
    };

    async function handleDrydockRequest(options) {
        if (!options || !options.body) return;

        try {
            var body = JSON.parse(options.body);
            var vesselIds = JSON.parse(body.vessel_ids || '[]');
            if (vesselIds.length === 0) return;

            log('Drydock request detected for ' + vesselIds.length + ' vessel(s)');

            var vessels = await fetchVesselData();
            if (!vessels || vessels.length === 0) return;

            var vesselMap = new Map(vessels.map(function(v) { return [v.id, v]; }));

            for (var i = 0; i < vesselIds.length; i++) {
                var vesselId = vesselIds[i];
                var vessel = vesselMap.get(vesselId);
                if (!vessel) continue;

                // Detect bug use: no active route = fast delivery exploit
                var hasActiveRoute = (vessel.active_route && vessel.active_route.route_id) || vessel.route_id;
                var isBugUse = !hasActiveRoute;

                saveDrydockVessel(vesselId, {
                    name: vessel.name,
                    speed: vessel.route_speed || vessel.max_speed,
                    guards: vessel.route_guards || 0,
                    prices: vessel.prices || {},
                    hoursAtDrydock: vessel.hours_until_check || 0,
                    routeId: vessel.active_route ? vessel.active_route.route_id : null,
                    originPort: vessel.route_origin || vessel.current_port_code,
                    destinationPort: vessel.route_destination,
                    status: isBugUse ? 'bug_use' : 'pre_drydock'
                });

                if (isBugUse) {
                    log(vessel.name + ': Bug-use detected (no active route)');
                }
            }
        } catch (e) {
            log('Failed to process drydock request: ' + e.message, 'error');
        }
    }

    function handleVesselDataResponse(data) {
        var vessels = [];
        if (data && data.data && data.data.user_vessels) {
            vessels = data.data.user_vessels;
        } else if (data && data.vessels) {
            vessels = data.vessels;
        }
        if (vessels.length === 0) return;

        var vesselMap = new Map(vessels.map(function(v) { return [v.id, v]; }));

        // Check bug_use vessels - delete when anchored
        var bugUseVessels = getDrydockVesselsByStatus('bug_use');
        for (var i = 0; i < bugUseVessels.length; i++) {
            var bugEntry = bugUseVessels[i];
            var bugVessel = vesselMap.get(bugEntry.vesselId);
            if (!bugVessel) {
                deleteDrydockVessel(bugEntry.vesselId);
                continue;
            }
            if (bugVessel.status === 'anchor') {
                log(bugEntry.data.name + ': Bug-use complete (anchored)');
                deleteDrydockVessel(bugEntry.vesselId);
            }
        }

        // Check pre_drydock vessels - mark as past_drydock when complete
        var preDrydockVessels = getDrydockVesselsByStatus('pre_drydock');
        for (var j = 0; j < preDrydockVessels.length; j++) {
            var preEntry = preDrydockVessels[j];
            var preVessel = vesselMap.get(preEntry.vesselId);
            if (!preVessel) continue;

            // Skip if still on drydock trip or in maintenance
            if (preVessel.route_dry_operation === 1) continue;
            if (preVessel.status === 'maintenance') continue;

            // Check if hours restored (drydock complete)
            var currentHours = preVessel.hours_until_check || 0;
            var savedHours = preEntry.data.hoursAtDrydock || 0;

            if (currentHours > savedHours) {
                log(preEntry.data.name + ': Drydock complete (hours: ' + savedHours + ' -> ' + currentHours + ')');
                updateDrydockVesselStatus(preEntry.vesselId, 'past_drydock');
            }
        }

        // Check past_drydock vessels - restore when in port or anchored
        var pastDrydockVessels = getDrydockVesselsByStatus('past_drydock');
        for (var k = 0; k < pastDrydockVessels.length; k++) {
            var pastEntry = pastDrydockVessels[k];
            var pastVessel = vesselMap.get(pastEntry.vesselId);
            if (!pastVessel) continue;

            // Restore for vessels in port or anchored (both are stationary and can have settings applied)
            if ((pastVessel.status === 'port' || pastVessel.status === 'anchor') && !pastVessel.is_parked) {
                restoreDrydockSettings(pastEntry.vesselId, pastEntry.data, pastVessel);
            }
        }
    }

    async function restoreDrydockSettings(vesselId, savedData, currentVessel) {
        var needsRestore =
            savedData.speed !== currentVessel.route_speed ||
            savedData.guards !== currentVessel.route_guards ||
            JSON.stringify(savedData.prices) !== JSON.stringify(currentVessel.prices);

        if (!needsRestore) {
            log(savedData.name + ': Settings already match');
            deleteDrydockVessel(vesselId);
            return;
        }

        log(savedData.name + ': Restoring post-drydock settings');

        var success = await updateRouteData(vesselId, savedData.speed, savedData.guards, savedData.prices);
        if (success) {
            log(savedData.name + ': Settings restored');
            deleteDrydockVessel(vesselId);
            notify('Restored settings for ' + savedData.name);
        }
    }

    // ============================================
    // PRE-DEPARTURE HOOK - Apply Pending Settings
    // ============================================
    async function applyPendingSettingsBeforeDepart(options) {
        if (!options || !options.body) return;

        try {
            var body = JSON.parse(options.body);
            var vesselId = body.user_vessel_id;

            if (!vesselId) return;

            // Check for pending settings for this vessel
            var pending = getPendingRouteSettings(vesselId);
            if (!pending) return;

            log('Applying pending settings for vessel ' + vesselId + ' before departure');

            var success = await updateRouteData(vesselId, pending.speed, pending.guards, pending.prices);
            if (success) {
                log(pending.name + ': Pending settings applied before departure');
                deletePendingRouteSettings(vesselId);
            }
        } catch (e) {
            log('Failed to apply pending settings: ' + e.message, 'error');
        }
    }

    // Apply ALL pending settings for vessels in port
    async function applyAllPendingSettings() {
        var allPending = getAllPendingRouteSettings();
        if (allPending.length === 0) return 0;

        var vessels = await fetchVesselData();
        if (!vessels || vessels.length === 0) return 0;

        var vesselMap = new Map(vessels.map(function(v) { return [v.id, v]; }));
        var appliedCount = 0;

        for (var i = 0; i < allPending.length; i++) {
            var entry = allPending[i];
            var vessel = vesselMap.get(entry.vesselId);

            // Only apply if vessel is in port
            if (!vessel || vessel.status !== 'port' || vessel.is_parked) continue;

            log('Applying pending settings for ' + entry.data.name);
            var success = await updateRouteData(entry.vesselId, entry.data.speed, entry.data.guards, entry.data.prices);
            if (success) {
                deletePendingRouteSettings(entry.vesselId);
                appliedCount++;
            }

            // Small delay between API calls
            await new Promise(function(resolve) { setTimeout(resolve, 200); });
        }

        return appliedCount;
    }

    // ============================================
    // AUTO DRYDOCK LOGIC
    // ============================================
    var autoDrydockRunning = false;

    async function runAutoDrydock(manual) {
        if (autoDrydockRunning) {
            log('Auto drydock already running');
            return;
        }

        var settings = getSettings();
        if (!manual && !settings.autoDrydockEnabled) return;

        autoDrydockRunning = true;

        try {
            var vessels = await fetchVesselData();
            if (!vessels || vessels.length === 0) {
                if (manual) notify('No vessels found', 'error');
                return;
            }

            // Filter vessels that need drydock
            var threshold = settings.autoDrydockThreshold;

            // Debug: count vessels by condition
            var belowThreshold = vessels.filter(function(v) { return v.hours_until_check <= threshold; });
            var inPort = vessels.filter(function(v) { return v.status === 'port'; });
            var notParked = vessels.filter(function(v) { return !v.is_parked; });
            var noMaintenance = vessels.filter(function(v) { return !v.next_route_is_maintenance; });

            log('Vessels below ' + threshold + 'h: ' + belowThreshold.length + ', in port: ' + inPort.length + ', not parked: ' + notParked.length + ', no maintenance: ' + noMaintenance.length);

            var needsDrydock = vessels.filter(function(v) {
                return v.hours_until_check <= threshold &&
                       v.status === 'port' &&
                       !v.is_parked &&
                       !v.next_route_is_maintenance;
            });

            if (needsDrydock.length === 0) {
                log('No vessels need drydock (threshold: ' + threshold + 'h)');
                if (manual) notify('No vessels need drydock', 'success');
                return;
            }

            log(needsDrydock.length + ' vessel(s) need drydock');

            // Check cash balance
            var userData = await fetchUserData();
            if (!userData || !userData.user) {
                if (manual) notify('Could not fetch user data', 'error');
                return;
            }

            var cash = userData.user.cash;
            var minCash = settings.autoDrydockMinCash;
            var vesselIds = needsDrydock.map(function(v) { return v.id; });

            // Calculate speed value for cost check
            var costSpeedValue;
            if (settings.autoDrydockSpeed === 'maximum') {
                costSpeedValue = 'maximum';
            } else if (settings.autoDrydockSpeed === 'medium') {
                var avgSpeedForCost = Math.round((needsDrydock[0].min_speed + needsDrydock[0].max_speed) / 2);
                costSpeedValue = avgSpeedForCost;
            } else {
                costSpeedValue = 'minimum';
            }

            // Get maintenance cost
            var costData = await getMaintenanceCost(vesselIds, costSpeedValue, settings.autoDrydockType);
            if (!costData) {
                if (manual) notify('Could not get maintenance cost', 'error');
                return;
            }

            var totalCost = 0;
            if (costData.vessels) {
                for (var i = 0; i < costData.vessels.length; i++) {
                    var vCost = costData.vessels[i];
                    totalCost += (settings.autoDrydockType === 'major' ? vCost.major_cost : vCost.minor_cost) || 0;
                }
            }

            var cashAfter = cash - totalCost;
            if (cashAfter < minCash) {
                log('Insufficient funds: $' + cash + ' - $' + totalCost + ' = $' + cashAfter + ' < min $' + minCash);
                if (manual) notify('Insufficient funds for drydock', 'error');
                return;
            }

            // Save settings BEFORE drydock for all vessels
            for (var j = 0; j < needsDrydock.length; j++) {
                var vessel = needsDrydock[j];
                var hasActiveRoute = (vessel.active_route && vessel.active_route.route_id) || vessel.route_id;

                saveDrydockVessel(vessel.id, {
                    name: vessel.name,
                    speed: vessel.route_speed || vessel.max_speed,
                    guards: vessel.route_guards || 0,
                    prices: vessel.prices || {},
                    hoursAtDrydock: vessel.hours_until_check || 0,
                    routeId: vessel.active_route ? vessel.active_route.route_id : null,
                    originPort: vessel.route_origin || vessel.current_port_code,
                    destinationPort: vessel.route_destination,
                    status: hasActiveRoute ? 'pre_drydock' : 'bug_use'
                });
            }

            // Calculate speed value
            var speedValue;
            if (settings.autoDrydockSpeed === 'maximum') {
                speedValue = 'maximum';
            } else if (settings.autoDrydockSpeed === 'medium') {
                // For medium, calculate average of min_speed and max_speed from first vessel
                // The API accepts numeric speed values
                var avgSpeed = Math.round((needsDrydock[0].min_speed + needsDrydock[0].max_speed) / 2);
                speedValue = avgSpeed;
            } else {
                speedValue = 'minimum';
            }

            // Send to drydock
            var result = await sendToDrydock(vesselIds, speedValue, settings.autoDrydockType);

            if (result) {
                var vesselNames = needsDrydock.map(function(v) { return v.name; }).join(', ');
                log('Sent ' + needsDrydock.length + ' vessel(s) to drydock: ' + vesselNames);
                notify('Sent ' + needsDrydock.length + ' vessel(s) to drydock');
            }

        } catch (e) {
            log('Auto drydock error: ' + e.message, 'error');
            if (manual) notify('Error: ' + e.message, 'error');
        } finally {
            autoDrydockRunning = false;
        }
    }

    // ============================================
    // PERIODIC CHECK
    // ============================================
    async function periodicCheck() {
        log('Running periodic check...');

        // 1. Apply pending route settings for vessels in port
        var appliedCount = await applyAllPendingSettings();
        if (appliedCount > 0) {
            log('Applied pending settings for ' + appliedCount + ' vessel(s)');
        }

        // 2. Check drydock completion
        var vessels = await fetchVesselData();
        if (vessels && vessels.length > 0) {
            handleVesselDataResponse({ data: { user_vessels: vessels } });
        }

        // 3. Run auto drydock
        await runAutoDrydock(false);
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

            var mobileDropdown = document.createElement('div');
            mobileDropdown.className = 'rebelship-dropdown';
            mobileDropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

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

            var rightSection = document.getElementById('rebel-mobile-right'); if (rightSection) { rightSection.appendChild(container); } else { row.appendChild(container); }
            return mobileDropdown;
        }

        // Desktop
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
    // SETTINGS MODAL (Yard Foreman style - light theme)
    // ============================================
    function openSettingsModal() {
        var modalStore = getModalStore();
        if (!modalStore) {
            log('Modal store not found', 'error');
            return;
        }

        var settings = getSettings();
        modalStore.open('routeResearch');

        setTimeout(function() {
            if (modalStore.modalSettings) {
                modalStore.modalSettings.title = 'Drydock Master Settings';
                modalStore.modalSettings.navigation = [];
                modalStore.modalSettings.controls = [];
            }

            var centralContainer = document.getElementById('central-container');
            if (!centralContainer) return;

            var drydockVessels = getAllDrydockVessels();
            var pendingCount = getPendingRouteSettingsCount();

            centralContainer.innerHTML = '\
                <div style="padding:20px;max-width:500px;margin:0 auto;font-family:Lato,sans-serif;color:#01125d;">\
                    <div style="margin-bottom:20px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:16px;">\
                            <input type="checkbox" id="dm-enabled" ' + (settings.autoDrydockEnabled ? 'checked' : '') + '\
                                   style="width:20px;height:20px;margin-right:12px;accent-color:#0db8f4;cursor:pointer;">\
                            <span>Enable Auto Drydock</span>\
                        </label>\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;margin-left:32px;">\
                            Automatically sends vessels to drydock when hours until check drops below threshold.\
                        </div>\
                    </div>\
                    <div style="margin-bottom:16px;">\
                        <label style="display:block;font-weight:700;font-size:14px;margin-bottom:8px;">Hours Threshold</label>\
                        <select id="dm-threshold" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;">\
                            <option value="150" ' + (settings.autoDrydockThreshold === 150 ? 'selected' : '') + '>150 hours</option>\
                            <option value="100" ' + (settings.autoDrydockThreshold === 100 ? 'selected' : '') + '>100 hours</option>\
                            <option value="75" ' + (settings.autoDrydockThreshold === 75 ? 'selected' : '') + '>75 hours</option>\
                            <option value="50" ' + (settings.autoDrydockThreshold === 50 ? 'selected' : '') + '>50 hours</option>\
                            <option value="25" ' + (settings.autoDrydockThreshold === 25 ? 'selected' : '') + '>25 hours</option>\
                        </select>\
                    </div>\
                    <div style="margin-bottom:16px;">\
                        <label style="display:block;font-weight:700;font-size:14px;margin-bottom:8px;">Maintenance Type</label>\
                        <select id="dm-type" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;">\
                            <option value="major" ' + (settings.autoDrydockType === 'major' ? 'selected' : '') + '>Major (100% antifouling)</option>\
                            <option value="minor" ' + (settings.autoDrydockType === 'minor' ? 'selected' : '') + '>Minor (60% antifouling)</option>\
                        </select>\
                    </div>\
                    <div style="margin-bottom:16px;">\
                        <label style="display:block;font-weight:700;font-size:14px;margin-bottom:8px;">Drydock Speed</label>\
                        <select id="dm-speed" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;">\
                            <option value="minimum" ' + (settings.autoDrydockSpeed === 'minimum' ? 'selected' : '') + '>Minimum (slow, cheaper)</option>\
                            <option value="medium" ' + (settings.autoDrydockSpeed === 'medium' ? 'selected' : '') + '>Medium (balanced)</option>\
                            <option value="maximum" ' + (settings.autoDrydockSpeed === 'maximum' ? 'selected' : '') + '>Maximum (fast, expensive)</option>\
                        </select>\
                    </div>\
                    <div style="margin-bottom:16px;">\
                        <label style="display:block;font-weight:700;font-size:14px;margin-bottom:8px;">Minimum Cash Reserve</label>\
                        <input type="number" id="dm-mincash" value="' + settings.autoDrydockMinCash + '" min="0" step="100000"\
                               style="width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;">\
                        <div style="font-size:12px;color:#626b90;margin-top:6px;">Won\'t drydock if cash would drop below this amount.</div>\
                    </div>\
                    <div style="margin-bottom:24px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:14px;">\
                            <input type="checkbox" id="dm-notifications" ' + (settings.systemNotifications ? 'checked' : '') + '\
                                   style="width:18px;height:18px;margin-right:10px;accent-color:#0db8f4;cursor:pointer;">\
                            <span>System Notifications</span>\
                        </label>\
                    </div>\
                    <div style="background:#f3f4f6;border-radius:8px;padding:12px;margin-bottom:20px;">\
                        <div style="font-weight:700;font-size:14px;margin-bottom:8px;">Status</div>\
                        <div style="font-size:13px;color:#626b90;">\
                            <div>Drydock Tracking: <strong>' + drydockVessels.length + '</strong> vessel(s)</div>\
                            <div>Pending Route Changes: <strong>' + pendingCount + '</strong> vessel(s)</div>\
                        </div>\
                    </div>\
                    <div style="display:flex;gap:12px;justify-content:space-between;margin-top:30px;">\
                        <button id="dm-run-now" style="padding:10px 20px;background:linear-gradient(180deg,#3b82f6,#1d4ed8);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">Run Drydock Check</button>\
                        <button id="dm-route-settings" style="padding:10px 20px;background:linear-gradient(180deg,#8b5cf6,#6d28d9);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">Route Settings</button>\
                        <button id="dm-save" style="padding:10px 20px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:16px;font-weight:500;">Save</button>\
                    </div>\
                </div>';

            document.getElementById('dm-run-now').addEventListener('click', async function() {
                this.disabled = true;
                this.textContent = 'Running...';
                await runAutoDrydock(true);
                this.textContent = 'Run Drydock Check';
                this.disabled = false;
            });

            document.getElementById('dm-route-settings').addEventListener('click', function() {
                rsOpenSettingsModal();
            });

            document.getElementById('dm-save').addEventListener('click', function() {
                var newSettings = {
                    autoDrydockEnabled: document.getElementById('dm-enabled').checked,
                    autoDrydockThreshold: parseInt(document.getElementById('dm-threshold').value, 10) || 150,
                    autoDrydockType: document.getElementById('dm-type').value || 'major',
                    autoDrydockSpeed: document.getElementById('dm-speed').value || 'minimum',
                    autoDrydockMinCash: parseInt(document.getElementById('dm-mincash').value, 10) || 500000,
                    systemNotifications: document.getElementById('dm-notifications').checked
                };

                saveSettings(newSettings);
                notify('Settings saved', 'success');
                modalStore.closeAll();
            });
        }, 150);
    }

    // ============================================
    // ROUTE SETTINGS TAB (1:1 from route-settings-tab.user.js)
    // ============================================
    var rsPendingChanges = new Map();
    var rsActiveSubtab = 'cargo';
    var rsSettingsTabAdded = false;
    var rsCachedVessels = null;
    var rsCachedAutoPrices = null;

    // Try to fetch auto prices from Co-Pilot server
    async function rsFetchAutoPrices() {
        try {
            var response = await fetch('https://localhost:12346/api/analytics/route-settings', {
                method: 'GET',
                credentials: 'include'
            });
            if (!response.ok) return null;
            var data = await response.json();
            if (data && data.routeSettings) {
                // Build map of vesselId -> autoprice data
                var priceMap = {};
                data.routeSettings.forEach(function(s) {
                    priceMap[s.vesselId] = {
                        dry: s.autopriceDry,
                        refrigerated: s.autopriceRefrigerated,
                        fuel: s.autopriceFuel,
                        crude_oil: s.autopriceCrude
                    };
                });
                log('Fetched auto prices from Co-Pilot for ' + Object.keys(priceMap).length + ' vessels');
                return priceMap;
            }
        } catch (e) {
            log('Could not fetch auto prices from Co-Pilot (not running?): ' + e.message);
        }
        return null;
    }

    function rsGetAutoPrice(vesselId, key) {
        if (!rsCachedAutoPrices) return null;
        var ap = rsCachedAutoPrices[vesselId];
        if (!ap) return null;
        return ap[key];
    }

    function rsCalcPctDiff(current, auto) {
        if (auto === null || auto === undefined || auto === 0) return '-';
        if (current === null || current === undefined || current === '') return '-';
        var pct = ((current - auto) / auto * 100).toFixed(1);
        return (pct > 0 ? '+' : '') + pct + '%';
    }

    function rsEscapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function rsToGameCode(code) {
        if (!code) return '';
        var country = '';
        if (window.portsData && window.portsData[code]) {
            country = window.portsData[code].country || '';
        }
        var parts = code.split('_');
        var abbr;
        if (parts.length > 2) {
            abbr = parts.map(function(p) { return p.charAt(0).toUpperCase(); }).join('');
        } else {
            abbr = parts[0].substring(0, 3).toUpperCase();
        }
        return country ? (abbr + ' ' + country) : abbr;
    }

    function rsGetVesselsWithRoutes() {
        if (!rsCachedVessels) return [];
        return rsCachedVessels.filter(function(v) {
            return v.route_origin && v.route_destination;
        });
    }

    function rsGetHijackingRisk(vessel) {
        // Use vessel.hijacking_risk directly (current route's risk)
        if (vessel.hijacking_risk !== undefined && vessel.hijacking_risk !== null) {
            return vessel.hijacking_risk;
        }
        // Fallback: search in routes array
        if (!vessel.routes || !vessel.routes.length) return 0;
        var activeRoute = vessel.routes.find(function(r) {
            return r.origin === vessel.route_origin && r.destination === vessel.route_destination;
        });
        return activeRoute ? (activeRoute.hijacking_risk || 0) : 0;
    }

    function rsGetStatusInfo(v) {
        if (v.is_parked && v.status === 'port') {
            return { code: 'MP', tooltip: 'Moored at Port', cssClass: 'status-mp' };
        }
        if (v.is_parked && v.status === 'enroute') {
            return { code: 'ME', tooltip: 'Moored on Arrival', cssClass: 'status-me' };
        }
        if (v.status === 'anchor') {
            return { code: 'A', tooltip: 'Anchored', cssClass: 'status-a' };
        }
        if (v.status === 'enroute') {
            return { code: 'E', tooltip: 'Enroute', cssClass: 'status-e' };
        }
        if (v.status === 'port') {
            return { code: 'P', tooltip: 'In Port', cssClass: 'status-p' };
        }
        if (v.status === 'maintenance') {
            return { code: 'M', tooltip: 'Maintenance', cssClass: 'status-m' };
        }
        if (v.status === 'drydock') {
            return { code: 'D', tooltip: 'Drydock', cssClass: 'status-d' };
        }
        if (v.status === 'loading') {
            return { code: 'L', tooltip: 'Loading', cssClass: 'status-e' };
        }
        if (v.status === 'unloading') {
            return { code: 'U', tooltip: 'Unloading', cssClass: 'status-e' };
        }
        console.log('[RS] Unknown status for', v.name, ':', v.status, v);
        return { code: '?', tooltip: 'Status: ' + v.status, cssClass: '' };
    }

    function rsHandleChange(e) {
        var el = e.target;
        var vesselId = el.dataset.vesselId;
        var original = el.dataset.original;
        var value = el.value;
        var changeKey = el.dataset.changeKey;

        if (!changeKey || !vesselId) return;

        var isChanged = value !== original && value !== '';

        if (isChanged) {
            if (!rsPendingChanges.has(vesselId)) {
                rsPendingChanges.set(vesselId, {});
            }
            var numVal = parseFloat(value);
            rsPendingChanges.get(vesselId)[changeKey] = isNaN(numVal) ? null : numVal;
            el.classList.add('changed');
        } else {
            if (rsPendingChanges.has(vesselId)) {
                delete rsPendingChanges.get(vesselId)[changeKey];
                if (Object.keys(rsPendingChanges.get(vesselId)).length === 0) {
                    rsPendingChanges.delete(vesselId);
                }
            }
            el.classList.remove('changed');
        }

        rsUpdateSaveButton();
    }

    function rsUpdateSaveButton() {
        var btn = document.querySelector('.rs-save-btn');
        var statusEl = document.querySelector('.rs-status');
        if (btn) {
            var hasChanges = rsPendingChanges.size > 0;
            btn.classList.toggle('has-changes', hasChanges);
            if (statusEl && hasChanges) {
                statusEl.textContent = rsPendingChanges.size + ' vessel(s) changed';
                statusEl.className = 'rs-status';
            }
        }
    }

    async function rsSaveRouteSettings() {
        if (rsPendingChanges.size === 0) return;

        var statusEl = document.querySelector('.rs-status');
        var saveBtn = document.querySelector('.rs-save-btn');
        if (statusEl) statusEl.textContent = 'Saving...';
        if (saveBtn) saveBtn.disabled = true;

        var appliedCount = 0;
        var pendingCount = 0;
        var errorCount = 0;

        for (var entry of rsPendingChanges) {
            var vesselId = entry[0];
            var changes = entry[1];

            var vessel = rsCachedVessels.find(function(v) { return v.id === parseInt(vesselId); });
            if (!vessel) continue;

            var speed = changes.speed !== undefined ? changes.speed : vessel.route_speed;
            var guards = changes.guards !== undefined ? changes.guards : vessel.route_guards;
            var prices = {
                dry: changes.price_dry !== undefined ? changes.price_dry : (vessel.prices ? vessel.prices.dry : null),
                refrigerated: changes.price_refrigerated !== undefined ? changes.price_refrigerated : (vessel.prices ? vessel.prices.refrigerated : null),
                fuel: changes.price_fuel !== undefined ? changes.price_fuel : (vessel.prices ? vessel.prices.fuel : null),
                crude_oil: changes.price_crude !== undefined ? changes.price_crude : (vessel.prices ? vessel.prices.crude_oil : null)
            };

            // Can only apply immediately if vessel is in port and not parked
            var canApplyNow = vessel.status === 'port' && !vessel.is_parked;

            if (canApplyNow) {
                try {
                    await updateRouteData(parseInt(vesselId), speed, guards, prices);
                    appliedCount++;
                    log('Applied route settings for ' + vessel.name);
                } catch (err) {
                    log('Failed to update vessel ' + vesselId + ': ' + err.message, 'error');
                    errorCount++;
                }
            } else {
                // Save as pending - will apply at next departure
                savePendingRouteSettings(parseInt(vesselId), {
                    name: vessel.name,
                    speed: speed,
                    guards: guards,
                    prices: prices
                });
                pendingCount++;
                log('Queued pending route settings for ' + vessel.name);
            }
        }

        if (statusEl) {
            var parts = [];
            if (appliedCount > 0) parts.push(appliedCount + ' applied');
            if (pendingCount > 0) parts.push(pendingCount + ' pending');
            if (errorCount > 0) parts.push(errorCount + ' failed');
            statusEl.textContent = parts.join(', ') || 'Done';
            statusEl.className = errorCount > 0 ? 'rs-status error' : 'rs-status success';
        }

        if (appliedCount > 0 || pendingCount > 0) {
            var msg = '';
            if (appliedCount > 0) msg += appliedCount + ' applied';
            if (pendingCount > 0) msg += (msg ? ', ' : '') + pendingCount + ' pending';
            notify(msg);
        }

        rsPendingChanges.clear();
        rsUpdateSaveButton();

        document.querySelectorAll('.rs-table .changed').forEach(function(el) {
            el.classList.remove('changed');
            el.dataset.original = el.value;
        });

        try {
            var results = await Promise.all([fetchVesselData(), rsFetchAutoPrices()]);
            rsCachedVessels = results[0];
            rsCachedAutoPrices = results[1];
            rsRenderTable();
        } catch (err) {
            log('Failed to refresh vessels: ' + err.message, 'error');
        }

        if (saveBtn) saveBtn.disabled = false;
    }

    function rsRenderCargoRow(v) {
        var risk = rsGetHijackingRisk(v);
        var riskClass = risk > 0 ? 'warning' : '';
        var statusInfo = rsGetStatusInfo(v);
        var route = rsToGameCode(v.route_origin) + ' > ' + rsToGameCode(v.route_destination);

        var pricesDry = v.prices ? v.prices.dry : null;
        var pricesRef = v.prices ? v.prices.refrigerated : null;

        // Get auto prices from Co-Pilot
        var autoDry = rsGetAutoPrice(v.id, 'dry');
        var autoRef = rsGetAutoPrice(v.id, 'refrigerated');

        // Calculate % difference
        var dryPctDiff = rsCalcPctDiff(pricesDry, autoDry);
        var refPctDiff = rsCalcPctDiff(pricesRef, autoRef);

        // Check for pending settings
        var pending = getPendingRouteSettings(v.id);
        var hasPending = pending !== null;

        // Build HTML with pending indicators
        var speedHtml = '<input type="number" class="speed-input" min="1" max="' + v.max_speed + '" data-vessel-id="' + v.id + '" data-change-key="speed" data-original="' + v.route_speed + '" value="' + v.route_speed + '">';
        if (hasPending && pending.speed !== undefined && pending.speed !== v.route_speed) {
            speedHtml += '<div class="pending-value" title="Will apply at next departure">' + pending.speed + '</div>';
        }

        var dryHtml = '<input type="number" step="0.01" data-vessel-id="' + v.id + '" data-change-key="price_dry" data-original="' + (pricesDry !== null ? pricesDry : '') + '" value="' + (pricesDry !== null ? pricesDry : '') + '" placeholder="-">';
        if (hasPending && pending.prices && pending.prices.dry !== undefined && pending.prices.dry !== pricesDry) {
            dryHtml += '<div class="pending-value">' + pending.prices.dry + '</div>';
        }

        var refHtml = '<input type="number" step="0.01" data-vessel-id="' + v.id + '" data-change-key="price_refrigerated" data-original="' + (pricesRef !== null ? pricesRef : '') + '" value="' + (pricesRef !== null ? pricesRef : '') + '" placeholder="-">';
        if (hasPending && pending.prices && pending.prices.refrigerated !== undefined && pending.prices.refrigerated !== pricesRef) {
            refHtml += '<div class="pending-value">' + pending.prices.refrigerated + '</div>';
        }

        var currentGuards = parseInt(v.route_guards, 10) || 0;
        var guardsHtml = '<select data-vessel-id="' + v.id + '" data-change-key="guards" data-original="' + currentGuards + '">' +
            [0,1,2,3,4,5,6,7,8,9,10].map(function(i) { return '<option value="' + i + '"' + (i === currentGuards ? ' selected' : '') + '>' + i + '</option>'; }).join('') +
            '</select>';

        // Format auto price display
        var autoDisplay = autoDry !== null ? '$' + autoDry.toFixed(2) : '-';
        var dryPctClass = dryPctDiff !== '-' && parseFloat(dryPctDiff) > 0 ? 'pct-positive' : (dryPctDiff !== '-' && parseFloat(dryPctDiff) < 0 ? 'pct-negative' : '');
        var refPctClass = refPctDiff !== '-' && parseFloat(refPctDiff) > 0 ? 'pct-positive' : (refPctDiff !== '-' && parseFloat(refPctDiff) < 0 ? 'pct-negative' : '');

        return '<tr data-vessel-id="' + v.id + '">' +
            '<td class="status-cell"><span class="status-icon ' + statusInfo.cssClass + '" title="' + statusInfo.tooltip + '">' + statusInfo.code + '</span></td>' +
            '<td class="route-cell" title="' + rsEscapeHtml(v.route_origin) + ' - ' + rsEscapeHtml(v.route_destination) + '">' + route + '</td>' +
            '<td class="name-cell">' + rsEscapeHtml(v.name) + '</td>' +
            '<td class="num">' + speedHtml + '</td>' +
            '<td class="num max-speed">' + v.max_speed + '</td>' +
            '<td class="num auto-price">' + autoDisplay + '</td>' +
            '<td class="num">' + dryHtml + '</td>' +
            '<td class="num pct-diff ' + dryPctClass + '">' + dryPctDiff + '</td>' +
            '<td class="num">' + refHtml + '</td>' +
            '<td class="num pct-diff ' + refPctClass + '">' + refPctDiff + '</td>' +
            '<td class="num">' + guardsHtml + '</td>' +
            '<td class="num ' + riskClass + '">' + risk + '%</td>' +
        '</tr>';
    }

    function rsRenderTankerRow(v) {
        var risk = rsGetHijackingRisk(v);
        var riskClass = risk > 0 ? 'warning' : '';
        var statusInfo = rsGetStatusInfo(v);
        var route = rsToGameCode(v.route_origin) + ' > ' + rsToGameCode(v.route_destination);

        var pricesFuel = v.prices ? v.prices.fuel : null;
        var pricesCrude = v.prices ? v.prices.crude_oil : null;

        // Get auto prices from Co-Pilot
        var autoFuel = rsGetAutoPrice(v.id, 'fuel');
        var autoCrude = rsGetAutoPrice(v.id, 'crude_oil');

        // Calculate % difference
        var fuelPctDiff = rsCalcPctDiff(pricesFuel, autoFuel);
        var crudePctDiff = rsCalcPctDiff(pricesCrude, autoCrude);

        var speedHtml = '<input type="number" class="speed-input" min="1" max="' + v.max_speed + '" data-vessel-id="' + v.id + '" data-change-key="speed" data-original="' + v.route_speed + '" value="' + v.route_speed + '">';

        var fuelHtml = '<input type="number" step="0.01" data-vessel-id="' + v.id + '" data-change-key="price_fuel" data-original="' + (pricesFuel !== null ? pricesFuel : '') + '" value="' + (pricesFuel !== null ? pricesFuel : '') + '" placeholder="-">';

        var crudeHtml = '<input type="number" step="0.01" data-vessel-id="' + v.id + '" data-change-key="price_crude" data-original="' + (pricesCrude !== null ? pricesCrude : '') + '" value="' + (pricesCrude !== null ? pricesCrude : '') + '" placeholder="-">';

        var currentGuards = parseInt(v.route_guards, 10) || 0;
        var guardsHtml = '<select data-vessel-id="' + v.id + '" data-change-key="guards" data-original="' + currentGuards + '">' +
            [0,1,2,3,4,5,6,7,8,9,10].map(function(i) { return '<option value="' + i + '"' + (i === currentGuards ? ' selected' : '') + '>' + i + '</option>'; }).join('') +
            '</select>';

        // Format auto price display
        var autoDisplay = autoFuel !== null ? '$' + autoFuel.toFixed(2) : '-';
        var fuelPctClass = fuelPctDiff !== '-' && parseFloat(fuelPctDiff) > 0 ? 'pct-positive' : (fuelPctDiff !== '-' && parseFloat(fuelPctDiff) < 0 ? 'pct-negative' : '');
        var crudePctClass = crudePctDiff !== '-' && parseFloat(crudePctDiff) > 0 ? 'pct-positive' : (crudePctDiff !== '-' && parseFloat(crudePctDiff) < 0 ? 'pct-negative' : '');

        return '<tr data-vessel-id="' + v.id + '">' +
            '<td class="status-cell"><span class="status-icon ' + statusInfo.cssClass + '" title="' + statusInfo.tooltip + '">' + statusInfo.code + '</span></td>' +
            '<td class="route-cell" title="' + rsEscapeHtml(v.route_origin) + ' - ' + rsEscapeHtml(v.route_destination) + '">' + route + '</td>' +
            '<td class="name-cell">' + rsEscapeHtml(v.name) + '</td>' +
            '<td class="num">' + speedHtml + '</td>' +
            '<td class="num max-speed">' + v.max_speed + '</td>' +
            '<td class="num auto-price">' + autoDisplay + '</td>' +
            '<td class="num">' + fuelHtml + '</td>' +
            '<td class="num pct-diff ' + fuelPctClass + '">' + fuelPctDiff + '</td>' +
            '<td class="num">' + crudeHtml + '</td>' +
            '<td class="num pct-diff ' + crudePctClass + '">' + crudePctDiff + '</td>' +
            '<td class="num">' + guardsHtml + '</td>' +
            '<td class="num ' + riskClass + '">' + risk + '%</td>' +
        '</tr>';
    }

    function rsRenderTable() {
        var wrapper = document.querySelector('.rs-table-wrapper');
        if (!wrapper) return;

        var vessels = rsGetVesselsWithRoutes();
        var isCargo = rsActiveSubtab === 'cargo';

        var filtered = vessels.filter(function(v) {
            return isCargo ? v.capacity_type === 'container' : v.capacity_type === 'tanker';
        });

        if (filtered.length === 0) {
            wrapper.innerHTML = '<div class="rs-no-data">No ' + (isCargo ? 'cargo vessels' : 'tankers') + ' with active routes</div>';
            return;
        }

        var headers = isCargo
            ? '<th class="th-status" title="Status">S</th>' +
              '<th>Route</th>' +
              '<th>Vessel</th>' +
              '<th class="num">Speed</th>' +
              '<th class="num">Max</th>' +
              '<th class="num">Auto</th>' +
              '<th class="num">Dry</th>' +
              '<th class="num">%</th>' +
              '<th class="num">Ref</th>' +
              '<th class="num">%</th>' +
              '<th class="num">Grd</th>' +
              '<th class="num">Risk</th>'
            : '<th class="th-status" title="Status">S</th>' +
              '<th>Route</th>' +
              '<th>Vessel</th>' +
              '<th class="num">Speed</th>' +
              '<th class="num">Max</th>' +
              '<th class="num">Auto</th>' +
              '<th class="num">Fuel</th>' +
              '<th class="num">%</th>' +
              '<th class="num">Crude</th>' +
              '<th class="num">%</th>' +
              '<th class="num">Grd</th>' +
              '<th class="num">Risk</th>';

        var rows = filtered.map(function(v) {
            return isCargo ? rsRenderCargoRow(v) : rsRenderTankerRow(v);
        }).join('');

        wrapper.innerHTML = '<table class="rs-table"><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';

        wrapper.querySelectorAll('input, select').forEach(function(el) {
            el.addEventListener('input', rsHandleChange);
            el.addEventListener('change', rsHandleChange);
        });
    }

    function rsRenderSettingsPanel() {
        var container = document.getElementById('rs-settings-container');
        if (!container) return;

        container.innerHTML = '<div class="rs-header">' +
            '<button class="rs-subtab ' + (rsActiveSubtab === 'cargo' ? 'active' : '') + '" data-subtab="cargo">Cargo</button>' +
            '<button class="rs-subtab ' + (rsActiveSubtab === 'tanker' ? 'active' : '') + '" data-subtab="tanker">Tanker</button>' +
            '<span class="rs-status"></span>' +
            '<button class="rs-save-btn">Save</button>' +
        '</div>' +
        '<div class="rs-table-wrapper"><div class="rs-loading">Loading...</div></div>';

        container.querySelectorAll('.rs-subtab').forEach(function(btn) {
            btn.addEventListener('click', function() {
                rsActiveSubtab = btn.dataset.subtab;
                container.querySelectorAll('.rs-subtab').forEach(function(b) {
                    b.classList.toggle('active', b === btn);
                });
                rsRenderTable();
            });
        });

        container.querySelector('.rs-save-btn').addEventListener('click', rsSaveRouteSettings);

        // Fetch both vessel data and auto prices in parallel
        Promise.all([fetchVesselData(), rsFetchAutoPrices()])
            .then(function(results) {
                rsCachedVessels = results[0];
                rsCachedAutoPrices = results[1];
                rsRenderTable();
            })
            .catch(function(err) {
                var wrapper = container.querySelector('.rs-table-wrapper');
                if (wrapper) {
                    wrapper.innerHTML = '<div class="rs-error">Failed: ' + err.message + '</div>';
                }
            });
    }

    function rsOpenSettingsModal() {
        var modalStore = getModalStore();
        if (!modalStore) return;

        modalStore.open('routeResearch');
        setTimeout(rsInjectSettingsContent, 200);
    }

    function rsInjectSettingsContent() {
        var modalStore = getModalStore();
        if (modalStore && modalStore.modalSettings) {
            modalStore.modalSettings.title = 'Route Settings';
            modalStore.modalSettings.navigation = [];
            modalStore.modalSettings.controls = [];
            modalStore.modalSettings.noBackButton = true;
        }
        if (modalStore && modalStore.history) {
            modalStore.history.length = 0;
        }

        var centralContainer = document.getElementById('central-container');
        if (!centralContainer) return;

        centralContainer.innerHTML = '<div id="rs-settings-container"></div>';

        var style = document.createElement('style');
        style.textContent = '\
            #rs-settings-container { width:100%; height:100%; display:flex; flex-direction:column; background:#f5f5f5; color:#01125d; font-family:Lato,sans-serif; font-size:11px; }\
            .rs-header { display:flex; align-items:center; gap:4px; padding:4px 6px; background:#e8e8e8; border-bottom:1px solid #ccc; }\
            .rs-subtab { padding:3px 8px; background:#fff; color:#01125d; border:1px solid #ccc; border-radius:3px; cursor:pointer; font-size:10px; font-weight:600; }\
            .rs-subtab:hover { background:#ddd; }\
            .rs-subtab.active { background:#0db8f4; color:#fff; border-color:#0db8f4; }\
            .rs-save-btn { margin-left:auto; padding:3px 10px; background:#22c55e; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:10px; font-weight:600; opacity:0.4; }\
            .rs-save-btn.has-changes { opacity:1; }\
            .rs-status { font-size:9px; color:#666; margin-left:6px; }\
            .rs-status.success { color:#22c55e; }\
            .rs-status.error { color:#ef4444; }\
            .rs-table-wrapper { flex:1; overflow:auto; position:relative; z-index:0; padding-bottom:100px; }\
            .rs-table { width:100%; border-collapse:collapse; font-size:10px; position:relative; }\
            .rs-table thead { position:sticky; top:0; background:#e0e0e0; z-index:1; }\
            .rs-table th { padding:3px 2px; text-align:left; font-weight:600; color:#01125d; border-bottom:1px solid #ccc; white-space:nowrap; background:#e0e0e0; font-size:10px; }\
            .rs-table th.num, .rs-table th.th-status { text-align:center; }\
            .rs-table td { padding:1px 2px; border-bottom:1px solid #ddd; vertical-align:middle; }\
            .rs-table td.num { text-align:center; }\
            .rs-table td.max-speed { color:#666; font-size:9px; }\
            .rs-table td.auto-price { color:#666; font-size:9px; }\
            .rs-table td.pct-diff { color:#666; font-size:9px; }\
            .rs-table tr:hover { background:#e8f4fc; }\
            .rs-table .warning { color:#d97706; }\
            .rs-table .status-cell { width:22px; text-align:center; padding:1px; }\
            .rs-table .status-icon { display:inline-block; width:18px; height:14px; line-height:14px; text-align:center; font-size:8px; font-weight:700; border-radius:2px; cursor:help; }\
            .rs-table .status-icon.status-e { background:#3b82f6; color:#fff; }\
            .rs-table .status-icon.status-p { background:#22c55e; color:#fff; }\
            .rs-table .status-icon.status-a { background:#f59e0b; color:#fff; }\
            .rs-table .status-icon.status-mp, .rs-table .status-icon.status-me { background:#8b5cf6; color:#fff; }\
            .rs-table .status-icon.status-m { background:#ef4444; color:#fff; }\
            .rs-table .status-icon.status-d { background:#6366f1; color:#fff; }\
            .rs-table .route-cell { font-size:9px; white-space:nowrap; }\
            .rs-table .name-cell { max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }\
            .rs-table input[type="number"] { width:32px; padding:1px 2px; margin:0; background:#fff; border:1px solid #ccc; border-radius:2px; color:#01125d; font-size:10px; text-align:right; box-sizing:border-box; -moz-appearance:textfield; }\
            .rs-table input.speed-input { width:24px; }\
            .rs-table .pct-positive { color:#22c55e; }\
            .rs-table .pct-negative { color:#ef4444; }\
            .rs-table input[type="number"]::-webkit-outer-spin-button, .rs-table input[type="number"]::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }\
            .rs-table input[type="number"]:focus { outline:none; border-color:#0db8f4; }\
            .rs-table input.changed { background:#fef3c7; border-color:#f59e0b; }\
            .rs-table input:disabled { background:#eee; color:#999; }\
            .rs-table select { padding:1px 2px; background:#fff; border:1px solid #ccc; border-radius:2px; color:#01125d; font-size:10px; cursor:pointer; }\
            .rs-table select:focus { outline:none; border-color:#0db8f4; }\
            .rs-table select.changed { background:#fef3c7; border-color:#f59e0b; }\
            .rs-table select:disabled { background:#eee; color:#999; }\
            .rs-loading, .rs-error, .rs-no-data { padding:20px; text-align:center; color:#666; }\
            .rs-error { color:#ef4444; }\
            .rs-table .pending-value { font-size:8px; color:#8b5cf6; font-weight:600; margin-top:1px; }\
            .rs-table tr.has-pending { background:#f5f3ff; }\
        ';
        centralContainer.appendChild(style);

        rsRenderSettingsPanel();
    }

    var RS_GEAR_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>';

    function rsAddSettingsButton() {
        var bottomNav = document.getElementById('bottom-nav');
        if (!bottomNav) return false;
        if (document.getElementById('rs-settings-page-btn')) {
            log('Settings button already exists (is route-settings-tab.user.js also running?)', 'warn');
            return true;
        }
        if (!bottomNav.querySelector('#assigned-page-btn')) return false;

        var settingsBtn = document.createElement('div');
        settingsBtn.id = 'rs-settings-page-btn';
        settingsBtn.className = 'flex-centered flex-vertical';
        settingsBtn.style.cssText = 'cursor:pointer;';
        settingsBtn.innerHTML = '<div style="width:24px;height:24px;color:#94a3b8;">' + RS_GEAR_ICON + '</div><span class="modal-bottom-navigation-btn" style="font-size:12px;">Settings</span>';
        settingsBtn.addEventListener('click', rsOpenSettingsModal);
        bottomNav.appendChild(settingsBtn);
        rsSettingsTabAdded = true;
        log('Route Settings button added to Routes modal');
        return true;
    }

    function rsWatchRoutesModal() {
        log('Route Settings watcher started');
        setInterval(function() {
            var bottomNav = document.getElementById('bottom-nav');
            var hasAssigned = bottomNav && bottomNav.querySelector('#assigned-page-btn');
            if (hasAssigned && !rsSettingsTabAdded) {
                rsAddSettingsButton();
            }
            if (!hasAssigned && rsSettingsTabAdded) {
                rsSettingsTabAdded = false;
            }
        }, 500);
    }

    // ============================================
    // EXPOSE FOR ANDROID BACKGROUND SERVICE
    // ============================================
    window.rebelshipRunDrydockMaster = async function() {
        var settings = getSettings();
        if (!settings.autoDrydockEnabled) {
            return { skipped: true, reason: 'disabled' };
        }
        await periodicCheck();
        return { success: true };
    };

    // ============================================
    // MONITORING INTERVAL
    // ============================================
    var monitoringInterval = null;

    function startMonitoring() {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }
        log('Starting monitoring (interval: ' + (CHECK_INTERVAL / 1000) + 's)');
        monitoringInterval = setInterval(periodicCheck, CHECK_INTERVAL);
    }

    // ============================================
    // INITIALIZATION
    // ============================================
    function requestNotificationPermission() {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission();
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
            log('Max UI retries reached, running in background mode');
            return;
        }

        uiInitialized = true;
        addMenuItem(SCRIPT_NAME, openSettingsModal);
        log('Menu item added');
    }

    function init() {
        try {
            log('Initializing...');

            requestNotificationPermission();
            initUI();
            rsWatchRoutesModal();

            // Clean up stale pending entries on startup
            setTimeout(cleanupStalePendingSettings, 3000);

            var settings = getSettings();
            if (settings.autoDrydockEnabled) {
                setTimeout(function() {
                    startMonitoring();
                    periodicCheck();
                }, 5000);
            } else {
                // Still run periodic check for pending settings and drydock restoration
                setTimeout(periodicCheck, 5000);
                startMonitoring();
            }
        } catch (err) {
            log('init() error: ' + err.message, 'error');
        }
    }

    // Wait for page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 2000);
        });
    } else {
        setTimeout(init, 2000);
    }

})();
