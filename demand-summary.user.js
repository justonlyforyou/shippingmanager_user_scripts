// ==UserScript==
// @name         Shipping Manager - Demand Summary
// @namespace    https://rebelship.org/
// @description  Shows port demand with vessel capacity allocation overview
// @version      4.12
// @author       https://github.com/justonlyforyou/
// @order        25
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==

/* global MutationObserver */
(function() {
    'use strict';

    const SCRIPT_NAME = 'Demand Summary';
    const STORAGE_KEY = 'rebelship_demand_cache';
    const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
    const API_BASE = 'https://shippingmanager.cc/api';

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

    // ========== CACHE MANAGEMENT ==========
    function loadCache() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch {
            log('Failed to load cache', 'error');
        }
        return null;
    }

    function saveCache(data) {
        try {
            const cacheData = {
                timestamp: Date.now(),
                ports: data
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheData));
            return true;
        } catch {
            log('Failed to save cache', 'error');
            return false;
        }
    }

    function canCollect() {
        const cache = loadCache();
        if (!cache || !cache.timestamp) return true;
        const elapsed = Date.now() - cache.timestamp;
        return elapsed >= COOLDOWN_MS;
    }

    function getTimeUntilNextCollect() {
        const cache = loadCache();
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

    function getRefreshButtonHtmlSmall(id) {
        const disabled = !canCollect() || isCollecting ? ' disabled' : '';
        const style = canCollect() && !isCollecting ? 'background:#129c00;cursor:pointer;' : 'background:#9ca3af;cursor:not-allowed;';
        return '<button id="' + id + '" style="padding:2px 8px;' + style + 'border:0;border-radius:3px;color:#fff;font-size:10px;"' + disabled + '>' + getRefreshButtonText() + '</button>';
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
    async function fetchAllPortCodes() {
        // Get port codes from game store or API
        const gameStore = getGameStore();
        if (gameStore && gameStore.ports && gameStore.ports.length > 0) {
            return gameStore.ports.map(p => p.code);
        }

        // Fallback: fetch from API
        const response = await fetch(API_BASE + '/game/index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({})
        });

        if (!response.ok) {
            throw new Error('Failed to fetch game index');
        }

        const data = await response.json();
        if (!data.data || !data.data.ports) {
            throw new Error('No ports in game index');
        }

        return data.data.ports.map(p => p.code);
    }

    async function fetchPortsDemand(portCodes) {
        // Fetch in batches of 50 to avoid request size issues
        const BATCH_SIZE = 50;
        const allPorts = [];

        for (let i = 0; i < portCodes.length; i += BATCH_SIZE) {
            const batch = portCodes.slice(i, i + BATCH_SIZE);

            const response = await fetch(API_BASE + '/port/get-ports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ port_code: batch })
            });

            if (!response.ok) {
                throw new Error('Failed to fetch ports batch ' + (i / BATCH_SIZE + 1));
            }

            const data = await response.json();
            if (data.data && data.data.port) {
                allPorts.push(...data.data.port);
            }

            // Small delay between batches
            if (i + BATCH_SIZE < portCodes.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        return allPorts;
    }

    function getPortLastUpdated(portCode) {
        const cache = loadCache();
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

    // ========== UI: REBELSHIP MENU ==========
    const REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    function getOrCreateRebelShipMenu() {
        var menu = document.getElementById('rebelship-menu');
        if (menu) return menu.querySelector('.rebelship-dropdown');

        if (window._rebelshipMenuCreating) return null;
        window._rebelshipMenuCreating = true;

        menu = document.getElementById('rebelship-menu');
        if (menu) { window._rebelshipMenuCreating = false; return menu.querySelector('.rebelship-dropdown'); }

        var messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) { window._rebelshipMenuCreating = false; return null; }

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
        btn.addEventListener('click', function(e) { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; });
        document.addEventListener('click', function(e) { if (!container.contains(e.target)) dropdown.style.display = 'none'; });

        if (messagingIcon.parentNode) messagingIcon.parentNode.insertBefore(container, messagingIcon);

        window._rebelshipMenuCreating = false;
        return dropdown;
    }

    function addMenuItem(label, onClick) {
        const dropdown = getOrCreateRebelShipMenu();
        if (!dropdown) {
            setTimeout(function() { addMenuItem(label, onClick); }, 1000);
            return null;
        }

        if (dropdown.querySelector('[data-rebelship-item="' + label + '"]')) {
            return dropdown.querySelector('[data-rebelship-item="' + label + '"]');
        }

        const item = document.createElement('div');
        item.dataset.rebelshipItem = label;
        item.style.cssText = 'position:relative;';

        const itemBtn = document.createElement('div');
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

    // ========== MODAL ==========
    let isCollecting = false;
    let currentSortColumn = 'currentTEU'; // default sort column
    let currentSortOrder = 'desc'; // 'desc' or 'asc'
    let currentFilter = 'all';
    let activeModalContainer = null;
    let savedScrollPosition = 0;
    let pendingReturn = false;

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

    // ========== HOVER TOOLTIP ==========
    let tooltipElement = null;
    let tooltipTimeout = null;

    function createTooltip() {
        if (tooltipElement) return tooltipElement;

        tooltipElement = document.createElement('div');
        tooltipElement.id = 'demand-tooltip';
        tooltipElement.style.cssText = 'position:fixed;display:none;background:#1f2937;border:1px solid #374151;border-radius:6px;padding:12px;min-width:200px;max-width:300px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-size:12px;color:#fff;pointer-events:auto;';
        document.body.appendChild(tooltipElement);
        return tooltipElement;
    }

    function showTooltipForPort(portCode, rowElement) {
        const cache = loadCache();
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

        // Vessels section - always show
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

        html += '<div style="margin-top:4px;"><span style="color:#fbbf24;">Departing:</span></div>';
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
        html += getRefreshButtonHtml('tooltip-refresh-btn');

        tooltip.innerHTML = html;

        // Position tooltip near the row
        // First show it off-screen to measure actual height
        tooltip.style.visibility = 'hidden';
        tooltip.style.display = 'block';
        var tooltipHeight = tooltip.offsetHeight;
        var tooltipWidth = tooltip.offsetWidth;
        tooltip.style.visibility = 'visible';

        var rect = rowElement.getBoundingClientRect();
        var left = rect.right + 10;
        var top = rect.top;

        // Keep tooltip horizontally in viewport
        if (left + tooltipWidth > window.innerWidth) {
            left = rect.left - tooltipWidth - 10;
        }
        if (left < 10) left = 10;

        // Keep tooltip vertically in viewport
        // If tooltip would go below viewport, flip it above the row or cap it
        if (top + tooltipHeight > window.innerHeight - 10) {
            // Try positioning above the row
            var topAbove = rect.bottom - tooltipHeight;
            if (topAbove >= 10) {
                top = topAbove;
            } else {
                // Can't fit above either, position at bottom of viewport
                top = window.innerHeight - tooltipHeight - 10;
            }
        }
        if (top < 10) top = 10;

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';

        // Attach refresh button handler
        const refreshBtn = document.getElementById('tooltip-refresh-btn');
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

        // Close current modal and open port modal
        modalStore.closeAll(0);
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
        const modalStore = getModalStore();
        if (!modalStore) {
            log('Modal store not found', 'error');
            return;
        }

        // Check if game is locked
        const globalStore = getStore('global');
        if (globalStore && globalStore.isGameLocked) {
            log('Game is locked, cannot open modal', 'error');
            return;
        }

        pendingReturn = false;
        log('Opening routeResearch modal');
        modalStore.open('routeResearch');

        setTimeout(function() {
            log('Injecting demand content, title before: ' + (modalStore.modalSettings ? modalStore.modalSettings.title : 'N/A'));
            injectDemandContent();
            log('Title after inject: ' + (modalStore.modalSettings ? modalStore.modalSettings.title : 'N/A'));
        }, 200);
    }

    function injectDemandContent() {
        const modalStore = getModalStore();
        if (modalStore && modalStore.modalSettings) {
            modalStore.modalSettings.title = 'Demand Summary';
            modalStore.modalSettings.navigation = [];
            modalStore.modalSettings.controls = [];
            modalStore.modalSettings.noBackButton = true;
        }
        // Clear history to prevent back arrow in header
        if (modalStore && modalStore.history) {
            modalStore.history.length = 0;
        }

        const centralContainer = document.getElementById('central-container');
        if (!centralContainer) {
            log('central-container not found', 'error');
            return;
        }

        // Make container fill modal height
        centralContainer.style.height = '100%';
        centralContainer.style.overflow = 'hidden';

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

    function renderModalContent(container) {
        activeModalContainer = container;
        const cache = loadCache();
        const hasCache = cache && cache.ports && cache.ports.length > 0;
        const canCollectNow = canCollect();
        const cooldownRemaining = getTimeUntilNextCollect();
        const vesselsByDest = getVesselsByDestination();

        let html = '<div style="padding:20px 2px;font-family:Lato,sans-serif;color:#01125d;height:100%;display:flex;flex-direction:column;box-sizing:border-box;">';

        // Header with last collect time and buttons
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">';
        html += '<div style="font-size:12px;color:#626b90;">';
        html += 'Last collected: ' + formatTimestamp(cache ? cache.timestamp : null);
        html += '</div>';

        html += '<div style="display:flex;gap:8px;">';
        if (canCollectNow) {
            html += '<button id="demand-collect-btn" style="padding:8px 16px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:500;font-family:Lato,sans-serif;">';
            html += isCollecting ? 'Collecting...' : 'Collect Demand';
            html += '</button>';
        } else {
            const mins = Math.ceil(cooldownRemaining / 60000);
            html += '<button disabled style="padding:8px 16px;background:#9ca3af;border:0;border-radius:6px;color:#fff;font-size:14px;font-weight:500;font-family:Lato,sans-serif;cursor:not-allowed;">';
            html += 'Wait ' + mins + ' min';
            html += '</button>';
        }
        html += '</div>';
        html += '</div>';

        if (!hasCache) {
            html += '<div style="text-align:center;padding:40px;color:#626b90;">';
            html += '<p style="font-size:16px;margin-bottom:10px;">No demand data cached yet.</p>';
            html += '<p style="font-size:13px;">Click "Collect Demand" to fetch demand for all 360 ports.</p>';
            html += '</div>';
        } else {
            // Summary
            const portsWithVessels = cache.ports.filter(p => vesselsByDest[p.code]);
            html += '<div style="margin-bottom:16px;font-size:13px;color:#626b90;">';
            html += cache.ports.length + ' ports cached | ' + portsWithVessels.length + ' ports with vessels en route';
            html += '</div>';

            // Filter tabs
            html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">';
            html += '<button class="demand-filter-btn" data-filter="all" style="padding:6px 12px;background:' + (currentFilter === 'all' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">All</button>';
            html += '<button class="demand-filter-btn" data-filter="vessels" style="padding:6px 12px;background:' + (currentFilter === 'vessels' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">With Vessels</button>';
            html += '<button class="demand-filter-btn" data-filter="novessels" style="padding:6px 12px;background:' + (currentFilter === 'novessels' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">No Vessels</button>';
            html += '<button class="demand-filter-btn" data-filter="container" style="padding:6px 12px;background:' + (currentFilter === 'container' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">Container</button>';
            html += '<button class="demand-filter-btn" data-filter="tanker" style="padding:6px 12px;background:' + (currentFilter === 'tanker' ? '#0db8f4' : '#374151') + ';border:0;border-radius:4px;color:#fff;font-size:12px;cursor:pointer;">Tanker</button>';
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
                    hideTooltip();
                    openPortModal(portCode);
                }
            });
        });

        // Row hover handlers for tooltip
        const portRows = document.querySelectorAll('.demand-port-row');
        portRows.forEach(function(row) {
            row.addEventListener('mouseenter', function() {
                if (tooltipTimeout) {
                    clearTimeout(tooltipTimeout);
                    tooltipTimeout = null;
                }
                const portCode = row.dataset.port;
                if (portCode) {
                    showTooltipForPort(portCode, row);
                }
            });

            row.addEventListener('mouseleave', function() {
                hideTooltipDelayed();
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
                return sortOrder === 'desc' ? ' ▼' : ' ▲';
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
        html += '<th class="demand-sort-header" data-column="containerVessels" style="padding:4px 4px;border-bottom:2px solid #9ca3af;text-align:center;white-space:nowrap;cursor:pointer;" title="Container Vessels">📦' + sortIcon('containerVessels') + '</th>';
        html += '<th class="demand-sort-header" data-column="tankerVessels" style="padding:4px 4px;border-bottom:2px solid #9ca3af;text-align:center;white-space:nowrap;cursor:pointer;" title="Tanker Vessels">🛢️' + sortIcon('tankerVessels') + '</th>';
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

            saveCache(ports);
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
        addMenuItem('Demand Summary', openDemandModal);
        setupBackButtonInterceptor();
        log('Menu item added');
    }

    function init() {
        log('Initializing...');
        initUI();
        initMapMarkerHover();
        initPortPopupEnhancement();
    }

    // ========== MAP MARKER HOVER ==========
    // Show demand tooltip when hovering over port markers on harbor map

    function initMapMarkerHover() {
        // Delegate hover events for port marker icons
        document.addEventListener('mouseenter', function(e) {
            const marker = e.target;
            if (!marker.classList || !marker.classList.contains('leaflet-marker-icon')) return;

            // Check if it's a port icon
            const src = marker.getAttribute('src');
            if (!src || !src.includes('porticon')) return;

            // Find the port code via Leaflet layer matching
            const portCode = getPortCodeFromMarker(marker);
            if (portCode) {
                showMapTooltip(portCode, marker);
            }
        }, true);

        document.addEventListener('mouseleave', function(e) {
            const marker = e.target;
            if (!marker.classList || !marker.classList.contains('leaflet-marker-icon')) return;

            const src = marker.getAttribute('src');
            if (!src || !src.includes('porticon')) return;

            hideTooltipDelayed();
        }, true);
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
        const cache = loadCache();
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

        // Vessels section - always show
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

        html += '<div style="margin-top:4px;"><span style="color:#fbbf24;">Departing:</span></div>';
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

        // Position tooltip near the marker
        const rect = markerElement.getBoundingClientRect();
        const tooltipWidth = 250;
        let left = rect.right + 10;
        let top = rect.top - 50;

        // Keep tooltip in viewport
        if (left + tooltipWidth > window.innerWidth) {
            left = rect.left - tooltipWidth - 10;
        }
        if (top + 200 > window.innerHeight) {
            top = window.innerHeight - 220;
        }
        if (top < 10) top = 10;

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
        tooltip.style.display = 'block';

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

    // ========== PORT POPUP ENHANCEMENT ==========
    // Instead of hover tooltip, enhance the game's existing port popup with demand info

    function initPortPopupEnhancement() {
        // Watch for port popup appearing
        const observer = new MutationObserver(function() {
            const portPopup = document.querySelector('#popover .port-popup');
            if (portPopup && !portPopup.dataset.demandEnhanced) {
                portPopup.dataset.demandEnhanced = '1';
                enhancePortPopup(portPopup);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    function enhancePortPopup(portPopup) {
        // Get port name from popup header
        const headerSpan = portPopup.closest('#popover').querySelector('.popup_header span');
        if (!headerSpan) return;

        const portName = headerSpan.textContent.trim().toLowerCase().replace(/\s+/g, '_');
        if (!portName) return;

        const cache = loadCache();
        if (!cache || !cache.ports) return;

        const port = cache.ports.find(function(p) { return p.code === portName; });
        if (!port) return;

        // Check if we already added our section
        if (portPopup.querySelector('.demand-info-section')) return;

        const demand = port.demand || {};
        const consumed = port.consumed || {};
        const containerDemand = demand.container || {};
        const containerConsumed = consumed.container || {};
        const tankerDemand = demand.tanker || {};
        const tankerConsumed = consumed.tanker || {};

        const lastUpdated = getPortLastUpdated(portName);

        // Create demand info section
        const section = document.createElement('div');
        section.className = 'demand-info-section';
        section.style.cssText = 'background:#1e3a5f;margin:5px 10px;padding:8px;border-radius:4px;font-size:11px;color:#fff;';

        let html = '<div style="font-weight:bold;margin-bottom:6px;color:#3b82f6;display:flex;justify-content:space-between;align-items:center;">';
        html += '<span>Remaining Demand</span>';
        html += getRefreshButtonHtmlSmall('popup-refresh-demand');
        html += '</div>';

        // Container
        if (containerDemand.dry || containerDemand.refrigerated) {
            const dryRemain = Math.max(0, (containerDemand.dry || 0) - (containerConsumed.dry || 0));
            const refRemain = Math.max(0, (containerDemand.refrigerated || 0) - (containerConsumed.refrigerated || 0));
            html += '<div style="margin-bottom:4px;">';
            html += '<span style="color:#9ca3af;">Container:</span> ';
            html += 'Dry ' + formatNumber(dryRemain) + ' | Ref ' + formatNumber(refRemain) + ' TEU';
            html += '</div>';
        }

        // Tanker
        if (tankerDemand.fuel || tankerDemand.crude_oil) {
            const fuelRemain = Math.max(0, (tankerDemand.fuel || 0) - (tankerConsumed.fuel || 0));
            const crudeRemain = Math.max(0, (tankerDemand.crude_oil || 0) - (tankerConsumed.crude_oil || 0));
            html += '<div style="margin-bottom:4px;">';
            html += '<span style="color:#9ca3af;">Tanker:</span> ';
            html += 'Fuel ' + formatNumber(fuelRemain) + ' | Crude ' + formatNumber(crudeRemain) + ' BBL';
            html += '</div>';
        }

        // Last updated
        html += '<div style="color:#6b7280;font-size:10px;margin-top:4px;">';
        html += 'Updated: ' + formatTimestamp(lastUpdated);
        html += '</div>';

        section.innerHTML = html;

        // Insert after popup_image
        const popupData = portPopup.querySelector('.popup_data');
        if (popupData) {
            popupData.insertBefore(section, popupData.firstChild);
        }

        // Refresh button handler
        const refreshBtn = document.getElementById('popup-refresh-demand');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async function(e) {
                e.stopPropagation();
                await refreshAllPorts();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 2000);
        });
    } else {
        setTimeout(init, 2000);
    }
})();
