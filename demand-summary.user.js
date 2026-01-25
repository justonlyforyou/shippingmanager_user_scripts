// ==UserScript==
// @name         ShippingManager - Demand Summary
// @namespace    https://rebelship.org/
// @description  Shows port demand with vessel capacity allocation overview
// @version      4.47
// @author       https://github.com/justonlyforyou/
// @order        9
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @RequireRebelShipMenu true
// @enabled      false
// ==/UserScript==

/* global addMenuItem */
(function() {
    'use strict';

    const SCRIPT_NAME = 'DemandSummary';
    const STORE_NAME = 'data';
    const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
    const API_BASE = 'https://shippingmanager.cc/api';

    // ========== REBELSHIPBRIDGE STORAGE ==========
    async function dbGet(key) {
        try {
            var result = await window.RebelShipBridge.storage.get(SCRIPT_NAME, STORE_NAME, key);
            if (result) {
                return JSON.parse(result);
            }
            return null;
        } catch (e) {
            console.error('[' + SCRIPT_NAME + '] dbGet error:', e);
            return null;
        }
    }

    async function dbSet(key, value) {
        try {
            await window.RebelShipBridge.storage.set(SCRIPT_NAME, STORE_NAME, key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.error('[' + SCRIPT_NAME + '] dbSet error:', e);
            return false;
        }
    }

    // Get storage key for demand cache
    function getStorageKey() {
        return 'demandCache';
    }

    // ========== LOGGING ==========
    function log(msg, level) {
        const prefix = '[' + SCRIPT_NAME + '] ';
        if (level === 'error') {
            console.error(prefix + msg);
        } else {
            console.log(prefix + msg);
        }
    }

    // ========== PINIA STORE ACCESS ==========
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

    function getStore(name) {
        try {
            const pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get(name);
        } catch {
            return null;
        }
    }

    function getModalStore() { return getStore('modal'); }
    function getToastStore() { return getStore('toast'); }
    function getVesselStore() { return getStore('vessel'); }
    function getGameStore() { return getStore('game'); }

    function showToast(message, type) {
        type = type || 'success';
        const toastStore = getToastStore();
        if (toastStore) {
            try {
                if (type === 'error' && toastStore.error) {
                    toastStore.error(message);
                } else if (toastStore.success) {
                    toastStore.success(message);
                }
            } catch {
                log('Toast error', 'error');
            }
        }
    }

    // ========== CACHE MANAGEMENT (INDEXEDDB) ==========
    // In-memory cache for sync access (loaded on init)
    let cachedData = null;

    async function loadCache() {
        try {
            const saved = await dbGet(getStorageKey());
            if (saved) {
                cachedData = saved;
                return saved;
            }
        } catch (e) {
            log('Failed to load cache: ' + e.message, 'error');
        }
        return null;
    }

    // Sync version for functions that can't be async (uses in-memory cache)
    function loadCacheSync() {
        return cachedData;
    }

    async function saveCache(data) {
        try {
            const cacheData = {
                timestamp: Date.now(),
                ports: data
            };
            await dbSet(getStorageKey(), cacheData);
            cachedData = cacheData;
            return true;
        } catch (e) {
            log('Failed to save cache: ' + e.message, 'error');
            return false;
        }
    }

    function canCollect() {
        const cache = loadCacheSync();
        if (!cache || !cache.timestamp) return true;
        const elapsed = Date.now() - cache.timestamp;
        return elapsed >= COOLDOWN_MS;
    }

    function getTimeUntilNextCollect() {
        const cache = loadCacheSync();
        if (!cache || !cache.timestamp) return 0;
        const elapsed = Date.now() - cache.timestamp;
        const remaining = COOLDOWN_MS - elapsed;
        return remaining > 0 ? remaining : 0;
    }

    function formatCooldownTime(ms) {
        const mins = Math.ceil(ms / 60000);
        return mins + ' min';
    }

    function getRefreshButtonText() {
        if (isCollecting) return 'Collecting...';
        if (!canCollect()) return 'Wait ' + formatCooldownTime(getTimeUntilNextCollect());
        return 'Refresh All';
    }

    function getRefreshButtonStyle() {
        const canRefresh = canCollect() && !isCollecting;
        if (canRefresh) {
            return 'background:linear-gradient(180deg,#46ff33,#129c00);cursor:pointer;';
        }
        return 'background:#9ca3af;cursor:not-allowed;';
    }

    function getRefreshButtonHtml(id) {
        const disabled = !canCollect() || isCollecting ? ' disabled' : '';
        return '<button id="' + id + '" style="margin-top:8px;width:100%;padding:6px 12px;' + getRefreshButtonStyle() + 'border:0;border-radius:4px;color:#fff;font-size:11px;font-weight:500;"' + disabled + '>' + getRefreshButtonText() + '</button>';
    }

    async function refreshAllPorts() {
        if (isCollecting) return;
        if (!canCollect()) {
            showToast('Please wait ' + formatCooldownTime(getTimeUntilNextCollect()), 'error');
            return;
        }
        await collectDemand();
    }

    // ========== API FUNCTIONS ==========
    async function fetchAllPortCodes(maxRetries) {
        // Get port codes from game store or API
        const gameStore = getGameStore();
        if (gameStore && gameStore.ports && gameStore.ports.length > 0) {
            return gameStore.ports.map(p => p.code);
        }

        // Fallback: fetch from API with retry
        maxRetries = maxRetries ?? 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(API_BASE + '/game/index', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({})
                });

                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }

                const data = await response.json();
                if (!data.data || !data.data.ports) {
                    throw new Error('No ports in game index');
                }

                return data.data.ports.map(p => p.code);
            } catch (e) {
                lastError = e;
                log('fetchAllPortCodes attempt ' + attempt + '/' + maxRetries + ' failed: ' + e.message);
                if (attempt < maxRetries) {
                    const delay = attempt * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    async function fetchPortsDemand(portCodes, maxRetries) {
        // Fetch in batches of 50 to avoid request size issues
        const BATCH_SIZE = 50;
        const allPorts = [];
        maxRetries = maxRetries ?? 3;

        for (let i = 0; i < portCodes.length; i += BATCH_SIZE) {
            const batch = portCodes.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            let lastError;
            let success = false;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const response = await fetch(API_BASE + '/port/get-ports', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ port_code: batch })
                    });

                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }

                    const data = await response.json();
                    if (data.data && data.data.port) {
                        allPorts.push(...data.data.port);
                    }
                    success = true;
                    break;
                } catch (e) {
                    lastError = e;
                    log('fetchPortsDemand batch ' + batchNum + ' attempt ' + attempt + '/' + maxRetries + ' failed: ' + e.message);
                    if (attempt < maxRetries) {
                        const delay = attempt * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }

            if (!success) {
                throw new Error('Failed to fetch ports batch ' + batchNum + ': ' + lastError.message);
            }

            // Small delay between batches
            if (i + BATCH_SIZE < portCodes.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        return allPorts;
    }

    function getPortLastUpdated(portCode) {
        const cache = loadCacheSync();
        if (!cache) return null;
        if (cache.portTimestamps && cache.portTimestamps[portCode]) {
            return cache.portTimestamps[portCode];
        }
        return cache.timestamp;
    }

    function getVesselsByPort() {
        const vesselStore = getVesselStore();
        if (!vesselStore || !vesselStore.userVessels) return {};

        const result = {};

        function ensurePort(portCode) {
            if (!result[portCode]) {
                result[portCode] = {
                    // Destination (vessels heading TO this port)
                    destContainerCount: 0,
                    destTankerCount: 0,
                    destContainerCapacity: 0,
                    destTankerCapacity: 0,
                    // Origin (vessels departing FROM this port)
                    originContainerCount: 0,
                    originTankerCount: 0,
                    originContainerCapacity: 0,
                    originTankerCapacity: 0
                };
            }
        }

        function getCapacity(vessel) {
            const cap = vessel.capacity || {};
            const capMax = vessel.capacity_max || {};
            if (vessel.capacity_type === 'container') {
                return (cap.dry || capMax.dry || 0) + (cap.refrigerated || capMax.refrigerated || 0);
            } else if (vessel.capacity_type === 'tanker') {
                return (cap.fuel || capMax.fuel || 0) + (cap.crude_oil || capMax.crude_oil || 0);
            }
            return 0;
        }

        for (const vessel of vesselStore.userVessels) {
            const dest = vessel.route_destination;
            const origin = vessel.route_origin;
            const capacity = getCapacity(vessel);
            const isContainer = vessel.capacity_type === 'container';
            const isTanker = vessel.capacity_type === 'tanker';

            // Track destination
            if (dest) {
                ensurePort(dest);
                if (isContainer) {
                    result[dest].destContainerCount++;
                    result[dest].destContainerCapacity += capacity;
                } else if (isTanker) {
                    result[dest].destTankerCount++;
                    result[dest].destTankerCapacity += capacity;
                }
            }

            // Track origin
            if (origin) {
                ensurePort(origin);
                if (isContainer) {
                    result[origin].originContainerCount++;
                    result[origin].originContainerCapacity += capacity;
                } else if (isTanker) {
                    result[origin].originTankerCount++;
                    result[origin].originTankerCapacity += capacity;
                }
            }
        }

        return result;
    }

    // Legacy wrapper for table display
    function getVesselsByDestination() {
        const byPort = getVesselsByPort();
        const result = {};
        for (const portCode in byPort) {
            const p = byPort[portCode];
            result[portCode] = {
                containerCount: p.destContainerCount,
                tankerCount: p.destTankerCount,
                containerCapacity: p.destContainerCapacity,
                tankerCapacity: p.destTankerCapacity
            };
        }
        return result;
    }

    // ========== MOBILE ZOOM ==========
    let originalViewport = null;

    function enableMobileZoom() {
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
            originalViewport = viewport.getAttribute('content');
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
        }
    }

    function restoreViewport() {
        if (originalViewport !== null) {
            const viewport = document.querySelector('meta[name="viewport"]');
            if (viewport) {
                viewport.setAttribute('content', originalViewport);
            }
            originalViewport = null;
        }
    }

    // ========== MODAL ==========
    let isCollecting = false;
    let currentSortColumn = 'currentTEU'; // default sort column
    let currentSortOrder = 'desc'; // 'desc' or 'asc'
    let currentFilter = 'all';
    let activeModalContainer = null;
    let savedScrollPosition = 0;
    let pendingReturn = false;
    let isDemandModalOpen = false;
    let modalListenerAttached = false;

    function formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    function capitalizePortName(code) {
        return code.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    }

    function formatTimestamp(ts) {
        if (!ts) return 'Never';
        const date = new Date(ts);
        return date.toLocaleString();
    }

    // ========== CUSTOM MODAL (Game-style) ==========
    function injectDemandModalStyles() {
        if (document.getElementById('demand-modal-styles')) return;

        const style = document.createElement('style');
        style.id = 'demand-modal-styles';
        style.textContent = [
            '@keyframes demand-fade-in{0%{opacity:0}to{opacity:1}}',
            '@keyframes demand-fade-out{0%{opacity:1}to{opacity:0}}',
            '@keyframes demand-drop-down{0%{transform:translateY(-10px)}to{transform:translateY(0)}}',
            '@keyframes demand-push-up{0%{transform:translateY(0)}to{transform:translateY(-10px)}}',
            '#demand-modal-wrapper{align-items:flex-start;display:flex;height:100vh;justify-content:center;left:0;overflow:hidden;position:absolute;top:0;width:100vw;z-index:9999}',
            '#demand-modal-wrapper #demand-modal-background{animation:demand-fade-in .15s linear forwards;background-color:rgba(0,0,0,.5);height:100%;left:0;opacity:0;position:absolute;top:0;width:100%}',
            '#demand-modal-wrapper.hide #demand-modal-background{animation:demand-fade-out .15s linear forwards}',
            '#demand-modal-wrapper #demand-modal-content-wrapper{animation:demand-drop-down .15s linear forwards,demand-fade-in .15s linear forwards;height:100%;max-width:460px;opacity:0;position:relative;width:1140px;z-index:9001}',
            '#demand-modal-wrapper.hide #demand-modal-content-wrapper{animation:demand-push-up .15s linear forwards,demand-fade-out .15s linear forwards}',
            '@media screen and (min-width:1200px){#demand-modal-wrapper #demand-modal-content-wrapper{max-width:460px}}',
            '@media screen and (min-width:992px) and (max-width:1199px){#demand-modal-wrapper #demand-modal-content-wrapper{max-width:460px}}',
            '@media screen and (min-width:769px) and (max-width:991px){#demand-modal-wrapper #demand-modal-content-wrapper{max-width:460px}}',
            '@media screen and (max-width:768px){#demand-modal-wrapper #demand-modal-content-wrapper{max-width:100%}}',
            '#demand-modal-wrapper #demand-modal-container{background-color:#fff;height:100vh;overflow:hidden;position:absolute;width:100%}',
            '#demand-modal-container .modal-header{align-items:center;background:#626b90;border-radius:0;color:#fff;display:flex;height:31px;justify-content:space-between;text-align:left;width:100%;border:0!important;padding:0 .5rem!important}',
            '#demand-modal-container .header-title{font-weight:700;text-transform:uppercase;width:90%}',
            '#demand-modal-container .header-icon{cursor:pointer;height:1.2rem;margin:0 .5rem}',
            '#demand-modal-container .header-icon.closeModal{height:19px;width:19px}',
            '#demand-modal-container #demand-modal-content{height:calc(100% - 31px);max-width:inherit;overflow:hidden;display:flex;flex-direction:column}',
            '#demand-modal-container #demand-central-container{background-color:#e9effd;margin:0;overflow-x:hidden;overflow-y:auto;width:100%;flex:1;padding:0}',
            '#demand-modal-wrapper.hide{pointer-events:none}'
        ].join('');
        document.head.appendChild(style);
    }

    function closeDemandModal() {
        if (!isDemandModalOpen) return;
        log('Closing modal');
        isDemandModalOpen = false;
        restoreViewport();
        const modalWrapper = document.getElementById('demand-modal-wrapper');
        if (modalWrapper) {
            modalWrapper.classList.add('hide');
        }
    }

    function setupDemandModalWatcher() {
        if (modalListenerAttached) return;
        modalListenerAttached = true;

        window.addEventListener('rebelship-menu-click', function() {
            if (isDemandModalOpen) {
                log('RebelShip menu clicked, closing modal');
                closeDemandModal();
            }
        });
    }

    // ========== HOVER TOOLTIP ==========
    let tooltipElement = null;
    let tooltipTimeout = null;
    let longPressTimer = null;
    const LONG_PRESS_DURATION = 500;

    function createTooltip() {
        if (tooltipElement) return tooltipElement;

        tooltipElement = document.createElement('div');
        tooltipElement.id = 'demand-tooltip';
        tooltipElement.style.cssText = 'position:fixed;display:none;background:#1f2937;border:1px solid #374151;border-radius:6px;padding:12px;min-width:200px;max-width:300px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-size:12px;color:#fff;pointer-events:auto;';
        document.body.appendChild(tooltipElement);
        return tooltipElement;
    }

    function hideTooltip() {
        if (tooltipElement) {
            tooltipElement.style.display = 'none';
        }
    }

    function hideTooltipDelayed() {
        tooltipTimeout = setTimeout(function() {
            hideTooltip();
        }, 200);
    }

    function exportToCSV(ports, vesselsByDest) {
        if (!ports || ports.length === 0) {
            showToast('No data to export', 'error');
            return;
        }

        // CSV header
        const headers = [
            'Port',
            'Max TEU',
            'Current TEU',
            'Max BBL',
            'Current BBL',
            'Dry Demand',
            'Dry Consumed',
            'Refrigerated Demand',
            'Refrigerated Consumed',
            'Fuel Demand',
            'Fuel Consumed',
            'Crude Oil Demand',
            'Crude Oil Consumed',
            'Container Vessels',
            'Container Capacity',
            'Tanker Vessels',
            'Tanker Capacity'
        ];

        const rows = [headers.join(',')];

        for (const port of ports) {
            const demand = port.demand || {};
            const consumed = port.consumed || {};
            const containerDemand = demand.container || {};
            const containerConsumed = consumed.container || {};
            const tankerDemand = demand.tanker || {};
            const tankerConsumed = consumed.tanker || {};
            const vessels = vesselsByDest[port.code] || {};

            const maxTEU = (containerDemand.dry || 0) + (containerDemand.refrigerated || 0);
            const currentTEU = Math.max(0, maxTEU - (containerConsumed.dry || 0) - (containerConsumed.refrigerated || 0));
            const maxBBL = (tankerDemand.fuel || 0) + (tankerDemand.crude_oil || 0);
            const currentBBL = Math.max(0, maxBBL - (tankerConsumed.fuel || 0) - (tankerConsumed.crude_oil || 0));

            const row = [
                capitalizePortName(port.code),
                maxTEU,
                currentTEU,
                maxBBL,
                currentBBL,
                containerDemand.dry || 0,
                containerConsumed.dry || 0,
                containerDemand.refrigerated || 0,
                containerConsumed.refrigerated || 0,
                tankerDemand.fuel || 0,
                tankerConsumed.fuel || 0,
                tankerDemand.crude_oil || 0,
                tankerConsumed.crude_oil || 0,
                vessels.containerCount || 0,
                vessels.containerCapacity || 0,
                vessels.tankerCount || 0,
                vessels.tankerCapacity || 0
            ];

            rows.push(row.join(','));
        }

        const csvContent = rows.join('\n');
        const blob = new window.Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = 'demand-summary-' + new Date().toISOString().slice(0, 10) + '.csv';
        link.click();

        window.URL.revokeObjectURL(url);
        showToast('CSV exported', 'success');
    }

    function openPortModal(portCode) {
        const modalStore = getModalStore();
        if (!modalStore) {
            log('Modal store not found', 'error');
            return;
        }

        log('Opening port modal for: ' + portCode);

        // Save scroll position for when user returns
        const listContainer = document.getElementById('demand-port-list');
        if (listContainer) {
            savedScrollPosition = listContainer.scrollTop;
            log('Saved scroll position: ' + savedScrollPosition);
        }
        pendingReturn = true;

        // Close our custom modal (hide it, don't remove)
        isDemandModalOpen = false;
        const demandWrapper = document.getElementById('demand-modal-wrapper');
        if (demandWrapper) {
            demandWrapper.classList.add('hide');
        }
        restoreViewport();

        // Open game's port modal
        setTimeout(function() {
            try {
                modalStore.open('port', {
                    componentProps: {
                        port_code: portCode
                    }
                });
                log('Port modal open called');
            } catch (err) {
                log('Error opening port modal: ' + err.message, 'error');
            }
        }, 200);
    }

    function openDemandModal() {
        // Close any open game modal first
        const modalStore = getModalStore();
        if (modalStore && modalStore.closeAll) {
            modalStore.closeAll();
        }

        pendingReturn = false;
        injectDemandModalStyles();

        const existing = document.getElementById('demand-modal-wrapper');
        if (existing) {
            const contentCheck = existing.querySelector('#demand-central-container');
            if (contentCheck) {
                existing.classList.remove('hide');
                isDemandModalOpen = true;
                enableMobileZoom();
                renderModalContent(contentCheck);
                return;
            }
            existing.remove();
        }

        const headerEl = document.querySelector('header');
        const headerHeight = headerEl ? headerEl.offsetHeight : 89;

        const modalWrapper = document.createElement('div');
        modalWrapper.id = 'demand-modal-wrapper';

        const modalBackground = document.createElement('div');
        modalBackground.id = 'demand-modal-background';
        modalBackground.onclick = function() { closeDemandModal(); };

        const modalContentWrapper = document.createElement('div');
        modalContentWrapper.id = 'demand-modal-content-wrapper';

        const modalContainer = document.createElement('div');
        modalContainer.id = 'demand-modal-container';
        modalContainer.className = 'font-lato';
        modalContainer.style.top = headerHeight + 'px';
        modalContainer.style.height = 'calc(100vh - ' + headerHeight + 'px)';
        modalContainer.style.maxHeight = 'calc(100vh - ' + headerHeight + 'px)';

        const modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';

        const headerTitle = document.createElement('span');
        headerTitle.className = 'header-title';
        headerTitle.textContent = 'Demand Summary';

        const closeIcon = document.createElement('img');
        closeIcon.className = 'header-icon closeModal';
        closeIcon.src = '/images/icons/close_icon_new.svg';
        closeIcon.onclick = function() { closeDemandModal(); };
        closeIcon.onerror = function() {
            this.style.display = 'none';
            const fallback = document.createElement('span');
            fallback.textContent = 'X';
            fallback.style.cssText = 'cursor:pointer;font-weight:bold;padding:0 .5rem;';
            fallback.onclick = function() { closeDemandModal(); };
            this.parentNode.appendChild(fallback);
        };

        modalHeader.appendChild(headerTitle);
        modalHeader.appendChild(closeIcon);

        const modalContent = document.createElement('div');
        modalContent.id = 'demand-modal-content';

        const centralContainer = document.createElement('div');
        centralContainer.id = 'demand-central-container';

        modalContent.appendChild(centralContainer);
        modalContainer.appendChild(modalHeader);
        modalContainer.appendChild(modalContent);
        modalContentWrapper.appendChild(modalContainer);
        modalWrapper.appendChild(modalBackground);
        modalWrapper.appendChild(modalContentWrapper);
        document.body.appendChild(modalWrapper);

        isDemandModalOpen = true;
        enableMobileZoom();
        renderModalContent(centralContainer);

        // Restore scroll position if returning from port modal
        if (pendingReturn && savedScrollPosition > 0) {
            setTimeout(function() {
                const listContainer = document.getElementById('demand-port-list');
                if (listContainer) {
                    listContainer.scrollTop = savedScrollPosition;
                }
                pendingReturn = false;
            }, 50);
        }
    }

    // Intercept Back button clicks to return to our demand summary
    function setupBackButtonInterceptor() {
        document.addEventListener('click', function(e) {
            if (!pendingReturn) return;

            // Check if clicked on Back button in bottom controls
            // Back button uses .light-blue class (language-independent)
            var target = e.target;
            var controlBtn = target.closest('#bottom-controls .control-btn');
            var isBackBtn = controlBtn && controlBtn.classList.contains('light-blue');

            if (isBackBtn) {
                e.preventDefault();
                e.stopPropagation();
                log('Back button intercepted, returning to Demand Summary');
                pendingReturn = false;
                openDemandModal();
            }
        }, true);
    }

    async function renderModalContent(container) {
        activeModalContainer = container;
        const cache = loadCacheSync();
        const hasCache = cache && cache.ports && cache.ports.length > 0;
        const canCollectNow = canCollect();
        const cooldownRemaining = getTimeUntilNextCollect();
        const vesselsByDest = getVesselsByDestination();

        let html = '<div id="demand-summary-wrapper" data-rebelship-modal="demand-summary" style="padding:8px 2px;font-family:Lato,sans-serif;color:#01125d;height:100%;display:flex;flex-direction:column;box-sizing:border-box;">';

        // Header with last collect time
        html += '<div style="font-size:11px;color:#626b90;margin-bottom:2px;text-align:center;">';
        html += 'Last collected: ' + formatTimestamp(cache ? cache.timestamp : null);
        html += '</div>';

        if (!hasCache) {
            html += '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:40px;color:#626b90;">';
            html += '<p style="font-size:16px;margin-bottom:10px;">No demand data cached yet.</p>';
            html += '<p style="font-size:13px;margin-bottom:20px;">Click "Collect Demand" to fetch demand for all 360 ports.</p>';
            html += '<button id="demand-collect-btn" style="padding:10px 20px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:4px;color:#fff;font-size:14px;cursor:pointer;font-weight:bold;">' + (isCollecting ? 'Collecting...' : 'Collect Demand') + '</button>';
            html += '</div>';
        } else {
            // Summary
            const portsWithVessels = cache.ports.filter(p => vesselsByDest[p.code]);
            html += '<div style="margin-bottom:6px;font-size:11px;color:#626b90;text-align:center;">';
            html += cache.ports.length + ' ports cached | ' + portsWithVessels.length + ' ports with vessels en route';
            html += '</div>';

            // Filter tabs
            html += '<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center;justify-content:center;">';
            html += '<button class="demand-filter-btn" data-filter="all" style="padding:6px 12px;background:' + (currentFilter === 'all' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">All</button>';
            html += '<button class="demand-filter-btn" data-filter="vessels" style="padding:6px 12px;background:' + (currentFilter === 'vessels' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">With Vessels</button>';
            html += '<button class="demand-filter-btn" data-filter="novessels" style="padding:6px 12px;background:' + (currentFilter === 'novessels' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">No Vessels</button>';
            html += '<button class="demand-filter-btn" data-filter="container" style="padding:6px 12px;background:' + (currentFilter === 'container' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">Container</button>';
            html += '<button class="demand-filter-btn" data-filter="tanker" style="padding:6px 12px;background:' + (currentFilter === 'tanker' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">Tanker</button>';
            if (canCollectNow) {
                html += '<button id="demand-collect-btn" style="padding:6px 12px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">' + (isCollecting ? 'Collecting...' : 'Collect Demand') + '</button>';
            } else {
                const mins = Math.ceil(cooldownRemaining / 60000);
                html += '<button disabled style="padding:6px 12px;background:#9ca3af;border:0;border-radius:4px;color:#fff;font-size:12px;cursor:not-allowed;">Wait ' + mins + ' min</button>';
            }
            html += '<button id="demand-export-btn" style="padding:6px 12px;background:linear-gradient(180deg,#3b82f6,#1d4ed8);border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">Export</button>';
            html += '</div>';

            // Port list - fills remaining height
            html += '<div id="demand-port-list" style="flex:1;overflow-y:auto;min-height:0;">';
            html += renderPortList(cache.ports, vesselsByDest, currentFilter, currentSortColumn, currentSortOrder);
            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;

        // Event handlers
        const collectBtn = document.getElementById('demand-collect-btn');
        if (collectBtn) {
            collectBtn.addEventListener('click', async function() {
                if (isCollecting) return;
                await collectDemand();
                renderModalContent(container);
            });
        }

        const exportBtn = document.getElementById('demand-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                exportToCSV(cache.ports, vesselsByDest);
            });
        }

        // Filter buttons
        const filterBtns = container.querySelectorAll('.demand-filter-btn');
        filterBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                filterBtns.forEach(function(b) { b.style.background = '#374151'; });
                btn.style.background = '#0db8f4';

                currentFilter = btn.dataset.filter;
                const listContainer = document.getElementById('demand-port-list');
                if (listContainer && cache && cache.ports) {
                    listContainer.innerHTML = renderPortList(cache.ports, vesselsByDest, currentFilter, currentSortColumn, currentSortOrder);
                    attachSortHandlers(cache.ports, vesselsByDest);
                }
            });
        });

        // Attach sort handlers to column headers
        attachSortHandlers(cache.ports, vesselsByDest);
    }

    function attachSortHandlers(ports, vesselsByDest) {
        const headers = document.querySelectorAll('.demand-sort-header');
        headers.forEach(function(header) {
            header.addEventListener('click', function() {
                const column = header.dataset.column;
                if (currentSortColumn === column) {
                    currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
                } else {
                    currentSortColumn = column;
                    currentSortOrder = 'desc';
                }
                const listContainer = document.getElementById('demand-port-list');
                if (listContainer && ports) {
                    listContainer.innerHTML = renderPortList(ports, vesselsByDest, currentFilter, currentSortColumn, currentSortOrder);
                    attachSortHandlers(ports, vesselsByDest);
                }
            });
        });

        // Port link click handlers
        const portLinks = document.querySelectorAll('.demand-port-link');
        portLinks.forEach(function(link) {
            link.addEventListener('click', function() {
                const portCode = link.dataset.port;
                if (portCode) {
                    openPortModal(portCode);
                }
            });
        });
    }

    function renderPortList(ports, vesselsByDest, filter, sortColumn, sortOrder) {
        // Helper to get sort value for a port
        function getSortValue(port, column) {
            const demand = port.demand || {};
            const consumed = port.consumed || {};
            const containerDemand = demand.container || {};
            const containerConsumed = consumed.container || {};
            const tankerDemand = demand.tanker || {};
            const tankerConsumed = consumed.tanker || {};
            const vessels = vesselsByDest[port.code];

            const maxTEU = (containerDemand.dry || 0) + (containerDemand.refrigerated || 0);
            const currentTEU = Math.max(0, maxTEU - (containerConsumed.dry || 0) - (containerConsumed.refrigerated || 0));
            const maxBBL = (tankerDemand.fuel || 0) + (tankerDemand.crude_oil || 0);
            const currentBBL = Math.max(0, maxBBL - (tankerConsumed.fuel || 0) - (tankerConsumed.crude_oil || 0));

            switch (column) {
                case 'port': return port.code;
                case 'maxTEU': return maxTEU;
                case 'currentTEU': return currentTEU;
                case 'maxBBL': return maxBBL;
                case 'currentBBL': return currentBBL;
                case 'containerVessels': return vessels ? vessels.containerCount : 0;
                case 'tankerVessels': return vessels ? vessels.tankerCount : 0;
                default: return currentTEU;
            }
        }

        // Sort ports
        const sortedPorts = ports.slice().sort(function(a, b) {
            const aVal = getSortValue(a, sortColumn);
            const bVal = getSortValue(b, sortColumn);
            if (sortColumn === 'port') {
                // String comparison for port names
                if (sortOrder === 'asc') {
                    return aVal.localeCompare(bVal);
                }
                return bVal.localeCompare(aVal);
            }
            // Numeric comparison
            if (sortOrder === 'asc') {
                return aVal - bVal;
            }
            return bVal - aVal;
        });

        // Filter ports
        const filteredPorts = [];
        for (const port of sortedPorts) {
            const vessels = vesselsByDest[port.code];
            const demand = port.demand || {};
            const consumed = port.consumed || {};
            const containerDemand = demand.container || {};
            const containerConsumed = consumed.container || {};
            const tankerDemand = demand.tanker || {};
            const tankerConsumed = consumed.tanker || {};

            // Max = total demand
            const maxTEU = (containerDemand.dry || 0) + (containerDemand.refrigerated || 0);
            const maxBBL = (tankerDemand.fuel || 0) + (tankerDemand.crude_oil || 0);

            // Current = max - consumed
            const currentTEU = Math.max(0, maxTEU - (containerConsumed.dry || 0) - (containerConsumed.refrigerated || 0));
            const currentBBL = Math.max(0, maxBBL - (tankerConsumed.fuel || 0) - (tankerConsumed.crude_oil || 0));

            const hasContainer = currentTEU > 0;
            const hasTanker = currentBBL > 0;

            if (filter === 'vessels' && !vessels) continue;
            if (filter === 'novessels' && vessels) continue;
            if (filter === 'container' && !hasContainer) continue;
            if (filter === 'tanker' && !hasTanker) continue;

            filteredPorts.push({
                port: port,
                maxTEU: maxTEU,
                currentTEU: currentTEU,
                maxBBL: maxBBL,
                currentBBL: currentBBL,
                containerVessels: vessels ? vessels.containerCount : 0,
                tankerVessels: vessels ? vessels.tankerCount : 0
            });
        }

        if (filteredPorts.length === 0) {
            return '<div style="text-align:center;padding:20px;color:#626b90;">No ports match this filter.</div>';
        }

        // Sort icon helper
        function sortIcon(column) {
            if (sortColumn === column) {
                return sortOrder === 'desc' ? ' v' : ' ^';
            }
            return '';
        }

        // Table header
        let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
        html += '<thead style="position:sticky;top:0;background:#d1d5db;z-index:10;">';
        html += '<tr style="text-align:left;">';
        html += '<th class="demand-sort-header" data-column="port" style="padding:4px 4px;border-bottom:2px solid #9ca3af;text-align:left;white-space:nowrap;cursor:pointer;">Port' + sortIcon('port') + '</th>';
        html += '<th class="demand-sort-header" data-column="maxTEU" style="padding:4px 4px;border-bottom:2px solid #9ca3af;text-align:right;white-space:nowrap;cursor:pointer;">Max TEU' + sortIcon('maxTEU') + '</th>';
        html += '<th class="demand-sort-header" data-column="currentTEU" style="padding:4px 4px;border-bottom:2px solid #9ca3af;text-align:right;white-space:nowrap;cursor:pointer;">Cur TEU' + sortIcon('currentTEU') + '</th>';
        html += '<th class="demand-sort-header" data-column="maxBBL" style="padding:4px 4px;border-bottom:2px solid #9ca3af;text-align:right;white-space:nowrap;cursor:pointer;">Max BBL' + sortIcon('maxBBL') + '</th>';
        html += '<th class="demand-sort-header" data-column="currentBBL" style="padding:4px 4px;border-bottom:2px solid #9ca3af;text-align:right;white-space:nowrap;cursor:pointer;">Cur BBL' + sortIcon('currentBBL') + '</th>';
        html += '<th class="demand-sort-header" data-column="containerVessels" style="padding:4px 4px;border-bottom:2px solid #9ca3af;text-align:center;white-space:nowrap;cursor:pointer;" title="Container Vessels"><img src="/images/icons/departure_notification/container_yellow.svg" alt="Container" style="width:16px;height:16px;vertical-align:middle;">' + sortIcon('containerVessels') + '</th>';
        html += '<th class="demand-sort-header" data-column="tankerVessels" style="padding:4px 4px;border-bottom:2px solid #9ca3af;text-align:center;white-space:nowrap;cursor:pointer;" title="Tanker Vessels"><img src="/images/icons/departure_notification/oil_icon.svg" alt="Tanker" style="width:16px;height:16px;vertical-align:middle;">' + sortIcon('tankerVessels') + '</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (let i = 0; i < filteredPorts.length; i++) {
            const item = filteredPorts[i];
            const port = item.port;
            const rowBg = i % 2 === 0 ? '#f3f4f6' : '#fff';

            html += '<tr class="demand-port-row" data-port="' + port.code + '" style="background:' + rowBg + ';">';
            html += '<td style="padding:3px 4px;border-bottom:1px solid #e5e7eb;text-align:left;">';
            html += '<span class="demand-port-link" data-port="' + port.code + '" style="cursor:pointer;color:#3b82f6;text-decoration:underline;">';
            html += capitalizePortName(port.code);
            html += '</span></td>';

            html += '<td style="padding:3px 4px;border-bottom:1px solid #e5e7eb;text-align:right;">';
            html += item.maxTEU > 0 ? formatNumber(item.maxTEU) : '-';
            html += '</td>';

            html += '<td style="padding:3px 4px;border-bottom:1px solid #e5e7eb;text-align:right;">';
            html += item.currentTEU > 0 ? formatNumber(item.currentTEU) : '-';
            html += '</td>';

            html += '<td style="padding:3px 4px;border-bottom:1px solid #e5e7eb;text-align:right;">';
            html += item.maxBBL > 0 ? formatNumber(item.maxBBL) : '-';
            html += '</td>';

            html += '<td style="padding:3px 4px;border-bottom:1px solid #e5e7eb;text-align:right;">';
            html += item.currentBBL > 0 ? formatNumber(item.currentBBL) : '-';
            html += '</td>';

            html += '<td style="padding:3px 4px;border-bottom:1px solid #e5e7eb;text-align:center;">';
            html += item.containerVessels > 0 ? item.containerVessels : '-';
            html += '</td>';

            html += '<td style="padding:3px 4px;border-bottom:1px solid #e5e7eb;text-align:center;">';
            html += item.tankerVessels > 0 ? item.tankerVessels : '-';
            html += '</td>';

            html += '</tr>';
        }

        html += '</tbody>';
        html += '</table>';

        return html;
    }

    async function collectDemand() {
        if (isCollecting) return;
        if (!canCollect()) {
            showToast('Please wait before collecting again', 'error');
            return;
        }

        isCollecting = true;
        log('Starting demand collection...');

        try {
            showToast('Fetching port codes...', 'success');
            const portCodes = await fetchAllPortCodes();
            log('Found ' + portCodes.length + ' ports');

            showToast('Collecting demand for ' + portCodes.length + ' ports...', 'success');
            const ports = await fetchPortsDemand(portCodes);
            log('Collected demand for ' + ports.length + ' ports');

            await saveCache(ports);
            showToast('Demand collected for ' + ports.length + ' ports', 'success');

            // Refresh modal if still open
            if (activeModalContainer) {
                renderModalContent(activeModalContainer);
            }

        } catch (err) {
            log('Collection failed: ' + err.message, 'error');
            showToast('Failed to collect demand: ' + err.message, 'error');
        } finally {
            isCollecting = false;
            // Refresh modal to update button state
            if (activeModalContainer) {
                renderModalContent(activeModalContainer);
            }
        }
    }

    // ========== INITIALIZATION ==========
    let uiInitialized = false;
    let uiRetryCount = 0;
    const MAX_UI_RETRIES = 30;

    function initUI() {
        if (uiInitialized) return;

        const hasApp = document.getElementById('app');
        const hasMessaging = document.querySelector('.messaging');

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
        setupBackButtonInterceptor();
    }

    async function init() {
        log('Initializing...');

        // Register menu immediately - no DOM needed for IPC call
        addMenuItem('Demand Summary', openDemandModal, 12);
        initUI();

        // Load cache into memory for sync access
        await loadCache();

        setupDemandModalWatcher();
        initMapMarkerHover();

        log('Script loaded');
    }

    // ========== MAP MARKER HOVER ==========
    // Show demand tooltip when hovering over port markers on harbor map

    function initMapMarkerHover() {
        function isPortMarker(el) {
            if (!el || !el.classList || !el.classList.contains('leaflet-marker-icon')) return false;
            const src = el.getAttribute('src');
            return src && src.includes('porticon');
        }

        // Desktop: mouse hover
        document.addEventListener('mouseenter', function(e) {
            if (!isPortMarker(e.target)) return;
            const portCode = getPortCodeFromMarker(e.target);
            if (portCode) {
                showMapTooltip(portCode, e.target);
            }
        }, true);

        document.addEventListener('mouseleave', function(e) {
            if (!isPortMarker(e.target)) return;
            hideTooltipDelayed();
        }, true);

        // Mobile: long-press (500ms)
        document.addEventListener('touchstart', function(e) {
            const marker = e.target;
            if (!isPortMarker(marker)) return;

            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }

            longPressTimer = setTimeout(function() {
                const portCode = getPortCodeFromMarker(marker);
                if (portCode) {
                    showMapTooltip(portCode, marker);
                }
                longPressTimer = null;
            }, LONG_PRESS_DURATION);
        }, true);

        document.addEventListener('touchend', function(e) {
            if (!isPortMarker(e.target)) return;
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, true);

        document.addEventListener('touchmove', function() {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }, true);

        // Close tooltip when tapping elsewhere
        document.addEventListener('touchstart', function(e) {
            if (tooltipElement && tooltipElement.style.display === 'block') {
                if (!tooltipElement.contains(e.target) && !isPortMarker(e.target)) {
                    hideTooltip();
                }
            }
        }, false);
    }

    function getLeafletMap() {
        // Get Leaflet map from mapStore (stored as mapStore.map = this.map in game code)
        try {
            const mapStore = getStore('mapStore');
            if (mapStore && mapStore.map) {
                return mapStore.map;
            }
        } catch {
            // Ignore
        }
        return null;
    }

    function getPortCodeFromMarker(markerElement) {
        const map = getLeafletMap();
        if (!map) return null;

        try {
            // Iterate through map._layers to find the one with this icon
            let foundCode = null;
            const layers = map._layers;
            for (var layerId in layers) {
                if (foundCode) break;
                var layer = layers[layerId];
                if (layer._icon === markerElement && layer.options && layer.options.port) {
                    foundCode = layer.options.port.code;
                }
            }
            return foundCode;
        } catch {
            return null;
        }
    }

    function showMapTooltip(portCode, markerElement) {
        const cache = loadCacheSync();
        if (!cache || !cache.ports) return;

        const port = cache.ports.find(function(p) { return p.code === portCode; });
        if (!port) return;

        const tooltip = createTooltip();
        const demand = port.demand || {};
        const consumed = port.consumed || {};
        const containerDemand = demand.container || {};
        const containerConsumed = consumed.container || {};
        const tankerDemand = demand.tanker || {};
        const tankerConsumed = consumed.tanker || {};
        const vesselsByPort = getVesselsByPort();
        const vessels = vesselsByPort[portCode] || {};

        const lastUpdated = getPortLastUpdated(portCode);

        let html = '<div style="font-weight:bold;font-size:14px;margin-bottom:8px;color:#3b82f6;">' + capitalizePortName(portCode) + '</div>';

        // Container demand
        if (containerDemand.dry || containerDemand.refrigerated) {
            html += '<div style="margin-bottom:6px;">';
            html += '<div style="color:#9ca3af;font-size:10px;margin-bottom:2px;">CONTAINER DEMAND</div>';
            if (containerDemand.dry) {
                const dryRemain = Math.max(0, containerDemand.dry - (containerConsumed.dry || 0));
                html += '<div>Dry: ' + formatNumber(dryRemain) + ' / ' + formatNumber(containerDemand.dry) + ' TEU</div>';
            }
            if (containerDemand.refrigerated) {
                const refRemain = Math.max(0, containerDemand.refrigerated - (containerConsumed.refrigerated || 0));
                html += '<div>Ref: ' + formatNumber(refRemain) + ' / ' + formatNumber(containerDemand.refrigerated) + ' TEU</div>';
            }
            html += '</div>';
        }

        // Tanker demand
        if (tankerDemand.fuel || tankerDemand.crude_oil) {
            html += '<div style="margin-bottom:6px;">';
            html += '<div style="color:#9ca3af;font-size:10px;margin-bottom:2px;">TANKER DEMAND</div>';
            if (tankerDemand.fuel) {
                const fuelRemain = Math.max(0, tankerDemand.fuel - (tankerConsumed.fuel || 0));
                html += '<div>Fuel: ' + formatNumber(fuelRemain) + ' / ' + formatNumber(tankerDemand.fuel) + ' BBL</div>';
            }
            if (tankerDemand.crude_oil) {
                const crudeRemain = Math.max(0, tankerDemand.crude_oil - (tankerConsumed.crude_oil || 0));
                html += '<div>Crude: ' + formatNumber(crudeRemain) + ' / ' + formatNumber(tankerDemand.crude_oil) + ' BBL</div>';
            }
            html += '</div>';
        }

        // Vessels section
        const hasDestVessels = vessels.destContainerCount || vessels.destTankerCount;
        const hasOriginVessels = vessels.originContainerCount || vessels.originTankerCount;
        html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #374151;">';
        html += '<div style="color:#9ca3af;font-size:10px;margin-bottom:4px;">YOUR VESSELS</div>';

        html += '<div style="margin-bottom:4px;"><span style="color:#4ade80;">Arriving:</span></div>';
        if (hasDestVessels) {
            if (vessels.destContainerCount) {
                html += '<div style="margin-left:12px;">' + vessels.destContainerCount + ' cargo (' + formatNumber(vessels.destContainerCapacity) + ' TEU)</div>';
            }
            if (vessels.destTankerCount) {
                html += '<div style="margin-left:12px;">' + vessels.destTankerCount + ' tanker (' + formatNumber(vessels.destTankerCapacity) + ' BBL)</div>';
            }
        } else {
            html += '<div style="margin-left:12px;">0</div>';
        }

        html += '<div style="margin-top:4px;"><span style="color:#f59e0b;">Departing:</span></div>';
        if (hasOriginVessels) {
            if (vessels.originContainerCount) {
                html += '<div style="margin-left:12px;">' + vessels.originContainerCount + ' cargo (' + formatNumber(vessels.originContainerCapacity) + ' TEU)</div>';
            }
            if (vessels.originTankerCount) {
                html += '<div style="margin-left:12px;">' + vessels.originTankerCount + ' tanker (' + formatNumber(vessels.originTankerCapacity) + ' BBL)</div>';
            }
        } else {
            html += '<div style="margin-left:12px;">0</div>';
        }
        html += '</div>';

        // Last updated
        html += '<div style="color:#9ca3af;font-size:10px;margin-top:8px;padding-top:8px;border-top:1px solid #374151;">';
        html += 'Updated: ' + formatTimestamp(lastUpdated);
        html += '</div>';

        // Refresh button (refreshes ALL ports with 5min cooldown)
        html += getRefreshButtonHtml('map-tooltip-refresh-btn');

        tooltip.innerHTML = html;

        // Position tooltip - measure actual size first
        tooltip.style.visibility = 'hidden';
        tooltip.style.display = 'block';
        const tooltipWidth = tooltip.offsetWidth;
        const tooltipHeight = tooltip.offsetHeight;
        tooltip.style.visibility = 'visible';

        const rect = markerElement.getBoundingClientRect();
        const padding = 10;
        let left, top;

        // Horizontal: prefer right of marker, fallback to left
        if (rect.right + padding + tooltipWidth <= window.innerWidth) {
            left = rect.right + padding;
        } else if (rect.left - padding - tooltipWidth >= 0) {
            left = rect.left - padding - tooltipWidth;
        } else {
            left = Math.max(padding, Math.min(window.innerWidth - tooltipWidth - padding, rect.left));
        }

        // Vertical: center on marker, but keep in viewport
        top = rect.top + (rect.height / 2) - (tooltipHeight / 2);
        if (top < padding) {
            top = padding;
        } else if (top + tooltipHeight > window.innerHeight - padding) {
            top = window.innerHeight - tooltipHeight - padding;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';

        // Attach refresh button handler
        const refreshBtn = document.getElementById('map-tooltip-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async function(e) {
                e.stopPropagation();
                hideTooltip();
                await refreshAllPorts();
            });
        }

        // Keep tooltip visible when hovering over it
        tooltip.addEventListener('mouseenter', function() {
            if (tooltipTimeout) {
                clearTimeout(tooltipTimeout);
                tooltipTimeout = null;
            }
        });

        tooltip.addEventListener('mouseleave', function() {
            hideTooltip();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
