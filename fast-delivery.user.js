// ==UserScript==
// @name         Shipping Manager - Fast Delivery
// @namespace    https://rebelship.org/
// @version      1.6
// @description  Fast delivery for built vessels via drydock exploit
// @author       https://github.com/justonlyforyou/
// @order        24
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==
/* globals CustomEvent, MutationObserver */

(function() {
    'use strict';

    const API_BASE = 'https://shippingmanager.cc/api';

    function log(msg) {
        console.log('[Fast Delivery] ' + msg);
    }

    // State
    let selectedVessels = new Set();
    let vesselDataMap = new Map(); // Maps vessel ID to vessel data
    let isProcessing = false;

    // ============================================
    // PINIA STORE ACCESS
    // ============================================
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

    function getVesselStore() {
        try {
            const pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('vessel');
        } catch {
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

    function getModalStore() {
        try {
            const pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('modal');
        } catch {
            return null;
        }
    }

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
            } catch (err) {
                log('Toast error: ' + err.message);
            }
        }
    }

    // ============================================
    // API FUNCTIONS
    // ============================================
    async function fetchDrydockStatus(vesselIds) {
        // POST /api/maintenance/get - returns maintenance_data with drydock costs
        const response = await fetch(API_BASE + '/maintenance/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                vessel_ids: JSON.stringify(vesselIds)
            })
        });
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        const data = await response.json();

        // Extract drydock_minor costs from maintenance_data
        let totalCost = 0;
        const vessels = data.data?.vessels || [];
        for (const vessel of vessels) {
            const drydockMinor = vessel.maintenance_data?.find(m => m.type === 'drydock_minor');
            if (drydockMinor) {
                totalCost += drydockMinor.discounted_price || drydockMinor.price || 0;
            }
        }

        return {
            vessels: vessels,
            totalCost: totalCost,
            cash: data.user?.cash || 0
        };
    }

    async function triggerBulkDrydock(vesselIds) {
        // POST /api/maintenance/do-major-drydock-maintenance-bulk
        const response = await fetch(API_BASE + '/maintenance/do-major-drydock-maintenance-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                vessel_ids: JSON.stringify(vesselIds),
                speed: 'minimum',
                maintenance_type: 'minor'
            })
        });
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        return response.json();
    }

    // ============================================
    // GET BUILT VESSELS IN PENDING
    // ============================================
    function getBuiltPendingVessels() {
        const vesselStore = getVesselStore();
        if (!vesselStore || !vesselStore.userVessels) return [];

        // Filter for pending vessels that have delivery_price (built vessels)
        return vesselStore.userVessels.filter(v =>
            v.status === 'pending' && v.delivery_price !== null && v.delivery_price > 0
        );
    }

    // ============================================
    // UI INJECTION
    // ============================================
    function isPendingTab() {
        const header = document.querySelector('#notifications-vessels-listing .header-text .text-center');
        if (!header) return false;
        const headerText = header.textContent.trim().toLowerCase();
        return headerText.includes('pending');
    }

    function injectCheckboxes() {
        if (!isPendingTab()) {
            // Remove checkboxes if not in pending tab
            document.querySelectorAll('.fast-delivery-checkbox').forEach(cb => cb.remove());
            selectedVessels.clear();
            return;
        }

        const vesselList = document.querySelector('#notifications-vessels-listing .vesselList');
        if (!vesselList) return;

        const builtVessels = getBuiltPendingVessels();
        const builtVesselNames = new Set(builtVessels.map(v => v.name));

        // Store vessel data for later use
        builtVessels.forEach(v => vesselDataMap.set(v.id, v));

        const vesselRows = vesselList.querySelectorAll('.vesselRow');
        vesselRows.forEach(row => {
            const nameEl = row.querySelector('.vesselName .nameValue');
            if (!nameEl) return;
            const vesselName = nameEl.textContent.trim();

            const existingCheckbox = row.querySelector('.fast-delivery-checkbox');

            // Only show checkbox for built vessels (have delivery_price)
            if (!builtVesselNames.has(vesselName)) {
                if (existingCheckbox) existingCheckbox.remove();
                return;
            }

            // Skip if already has checkbox
            if (existingCheckbox) return;

            // Find vessel ID from name
            const vessel = builtVessels.find(v => v.name === vesselName);
            if (!vessel) return;

            // Create checkbox wrapper
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.className = 'fast-delivery-checkbox';
            checkboxWrapper.style.cssText = 'position: absolute; left: 8px; top: 50%; transform: translateY(-50%); z-index: 10;';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer; accent-color: #f59e0b;';

            checkbox.addEventListener('change', function(e) {
                e.stopPropagation();
                if (checkbox.checked) {
                    selectedVessels.add(vessel.id);
                } else {
                    selectedVessels.delete(vessel.id);
                }
                updateButtonStates();
            });

            checkbox.addEventListener('click', function(e) {
                e.stopPropagation();
            });

            checkboxWrapper.appendChild(checkbox);

            // Make row position relative for absolute positioning
            row.style.position = 'relative';
            row.style.paddingLeft = '40px';

            row.insertBefore(checkboxWrapper, row.firstChild);
        });
    }

    function injectButtons() {
        const existing = document.getElementById('fast-delivery-buttons');

        if (!isPendingTab()) {
            if (existing) existing.remove();
            return;
        }

        // Check if any built vessels exist in pending
        const builtVessels = getBuiltPendingVessels();
        if (builtVessels.length === 0) {
            if (existing) existing.remove();
            return;
        }

        if (existing) return;

        // Find the button container (buttonWrapper in pending tab)
        let container = document.querySelector('#notifications-vessels-listing .buttonWrapper');
        if (!container) {
            // Try without the parent selector
            container = document.querySelector('.buttonWrapper');
            log('Fallback buttonWrapper found: ' + !!container);
        }
        if (!container) {
            log('No buttonWrapper found');
            return;
        }

        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'fast-delivery-buttons';
        buttonContainer.style.cssText = 'grid-column: 1 / -1; width: 100%; display: flex; gap: 4px; padding: 0; box-sizing: border-box; margin-bottom: 4px;';

        // All button
        const allBtn = createButton('All', function() {
            selectAll(true);
        });
        allBtn.id = 'fast-delivery-all-btn';

        // None button
        const noneBtn = createButton('None', function() {
            selectAll(false);
        });
        noneBtn.id = 'fast-delivery-none-btn';

        // Fast Delivery button
        const fastBtn = createButton('Fast Delivery', function() {
            processSelectedVessels();
        });
        fastBtn.id = 'fast-delivery-btn';
        fastBtn.disabled = true;
        fastBtn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';

        buttonContainer.appendChild(allBtn);
        buttonContainer.appendChild(noneBtn);
        buttonContainer.appendChild(fastBtn);

        // Insert at TOP of container
        container.insertBefore(buttonContainer, container.firstChild);

        log('Buttons injected');
    }

    function createButton(text, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-depart btn-block default light-blue';
        btn.style.cssText = 'flex: 1;';

        const btnContent = document.createElement('div');
        btnContent.className = 'btn-content-wrapper fit-btn-text';
        btnContent.style.fontSize = '14px';
        btnContent.textContent = text;

        btn.appendChild(btnContent);
        btn.addEventListener('click', onClick);

        return btn;
    }

    function updateButtonStates() {
        const fastBtn = document.getElementById('fast-delivery-btn');
        const hasSelection = selectedVessels.size > 0;

        if (fastBtn) {
            fastBtn.disabled = !hasSelection || isProcessing;
            fastBtn.style.opacity = fastBtn.disabled ? '0.5' : '1';
            fastBtn.style.cursor = fastBtn.disabled ? 'not-allowed' : 'pointer';
        }
    }

    // ============================================
    // SELECTION FUNCTIONS
    // ============================================
    function selectAll(select) {
        const checkboxes = document.querySelectorAll('.fast-delivery-checkbox input[type="checkbox"]');
        const builtVessels = getBuiltPendingVessels();

        checkboxes.forEach(cb => {
            cb.checked = select;
        });

        if (select) {
            builtVessels.forEach(v => selectedVessels.add(v.id));
        } else {
            selectedVessels.clear();
        }

        updateButtonStates();
        log('Selection: ' + selectedVessels.size + ' vessels');
    }

    // ============================================
    // PROCESS VESSELS - SHOW CONFIRMATION MODAL
    // ============================================
    async function processSelectedVessels() {
        if (selectedVessels.size === 0) {
            showToast('No vessels selected', 'error');
            return;
        }

        if (isProcessing) return;

        isProcessing = true;
        updateButtonStates();

        const vesselIds = Array.from(selectedVessels);

        try {
            // Fetch drydock cost
            const drydockStatus = await fetchDrydockStatus(vesselIds);
            const totalCost = drydockStatus.totalCost || 0;
            const cash = drydockStatus.cash || 0;

            // Show confirmation modal
            showConfirmationModal(vesselIds, totalCost, cash);
        } catch (err) {
            log('Error fetching drydock status: ' + err.message);
            showToast('Failed to get drydock cost: ' + err.message, 'error');
            isProcessing = false;
            updateButtonStates();
        }
    }

    // ============================================
    // CONFIRMATION MODAL (using routeResearch like forecast/auto-repair)
    // ============================================
    function showConfirmationModal(vesselIds, totalCost, cash) {
        const modalStore = getModalStore();
        if (!modalStore) {
            log('Modal store not found');
            isProcessing = false;
            updateButtonStates();
            return;
        }

        const vesselCount = vesselIds.length;
        const canAfford = cash >= totalCost;

        // Open routeResearch modal
        modalStore.open('routeResearch');

        setTimeout(() => {
            // Change title
            if (modalStore.modalSettings) {
                modalStore.modalSettings.title = 'Fast Delivery';
                modalStore.modalSettings.navigation = [];
                modalStore.modalSettings.controls = [];
            }

            const centralContainer = document.getElementById('central-container');
            if (!centralContainer) {
                log('central-container not found');
                isProcessing = false;
                updateButtonStates();
                return;
            }

            // Build confirmation using game-native styling (same as yard-foreman)
            centralContainer.innerHTML = `
                <div style="padding:20px;max-width:400px;margin:0 auto;font-family:Lato,sans-serif;color:#01125d;">
                    <div style="margin-bottom:16px;font-size:14px;color:#626b90;line-height:1.5;">
                        By triggering drydock immediately after build, delivery time is reduced to 60 minutes (the drydock duration).
                        This is a known game exploit.
                    </div>

                    <div style="background:#ebe9ea;border-radius:8px;padding:16px;margin-bottom:16px;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
                            <span style="font-size:14px;color:#626b90;">Vessels</span>
                            <span style="font-size:14px;font-weight:700;color:#01125d;">${vesselCount}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
                            <span style="font-size:14px;color:#626b90;">Total Drydock Cost</span>
                            <span style="font-size:14px;font-weight:700;color:#01125d;">$${totalCost.toLocaleString()}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="font-size:14px;color:#626b90;">Your Cash</span>
                            <span style="font-size:14px;font-weight:700;color:#01125d;">$${cash.toLocaleString()}</span>
                        </div>
                    </div>

                    ${!canAfford ? `
                        <div style="background:#fee2e2;border-radius:8px;padding:12px;margin-bottom:16px;color:#dc2626;font-size:13px;font-weight:500;">
                            Not enough cash to afford drydock!
                        </div>
                    ` : ''}

                    <div style="display:flex;gap:12px;justify-content:center;margin-top:24px;">
                        <button id="fast-delivery-cancel" style="padding:10px 24px;background:linear-gradient(90deg,#d7d8db,#95969b);border:0;border-radius:6px;color:#393939;cursor:pointer;font-size:16px;font-weight:500;font-family:Lato,sans-serif;">
                            Cancel
                        </button>
                        <button id="fast-delivery-confirm" ${!canAfford ? 'disabled' : ''} style="padding:10px 24px;background:${canAfford ? 'linear-gradient(180deg,#f59e0b,#d97706)' : '#9ca3af'};border:0;border-radius:6px;color:#fff;cursor:${canAfford ? 'pointer' : 'not-allowed'};font-size:16px;font-weight:500;font-family:Lato,sans-serif;opacity:${canAfford ? '1' : '0.6'};">
                            Activate Fast Delivery
                        </button>
                    </div>
                </div>
            `;

            // Event handlers
            document.getElementById('fast-delivery-cancel').addEventListener('click', () => {
                modalStore.closeAll();
                isProcessing = false;
                updateButtonStates();
            });

            document.getElementById('fast-delivery-confirm').addEventListener('click', async () => {
                if (!canAfford) return;
                await executeFastDelivery(vesselIds);
                modalStore.closeAll();
            });
        }, 150);
    }

    async function executeFastDelivery(vesselIds) {
        try {
            log('Triggering fast delivery for ' + vesselIds.length + ' vessels');
            const result = await triggerBulkDrydock(vesselIds);

            if (result.data && result.data.success) {
                const msg = vesselIds.length === 1
                    ? 'Fast delivery activated - vessel will arrive in 60 minutes'
                    : `Fast delivery activated - ${vesselIds.length} vessels will arrive in 60 minutes`;
                showToast(msg, 'success');
                log(msg);

                // Trigger refresh
                window.dispatchEvent(new CustomEvent('drydock-completed'));
                refreshVesselList();
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (err) {
            log('Fast delivery failed: ' + err.message);
            showToast('Fast delivery failed: ' + err.message, 'error');
        } finally {
            selectedVessels.clear();
            isProcessing = false;
            updateButtonStates();
        }
    }

    function refreshVesselList() {
        const vesselStore = getVesselStore();
        if (vesselStore && vesselStore.fetchUserVessels) {
            vesselStore.fetchUserVessels().then(() => {
                log('Refreshed vessel list');
                setTimeout(() => {
                    injectCheckboxes();
                    updateButtonStates();
                }, 500);
            });
        }
    }

    // ============================================
    // INITIALIZE WITH MUTATION OBSERVER
    // ============================================
    let debounceTimer = null;

    function debouncedInject() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            injectCheckboxes();
            injectButtons();
        }, 100);
    }

    function initObserver() {
        // Watch for changes in the vessel listing area
        const observer = new MutationObserver(function(mutations) {
            let shouldInject = false;
            for (const mutation of mutations) {
                // Check if relevant elements changed
                if (mutation.target.id === 'notifications-vessels-listing' ||
                    mutation.target.classList?.contains('vesselList') ||
                    mutation.target.classList?.contains('vesselRow') ||
                    mutation.target.classList?.contains('header-text') ||
                    mutation.addedNodes.length > 0) {
                    shouldInject = true;
                    break;
                }
            }
            if (shouldInject) {
                debouncedInject();
            }
        });

        // Start observing when app is ready
        function startObserving() {
            const app = document.getElementById('app');
            if (app) {
                observer.observe(app, {
                    childList: true,
                    subtree: true
                });
                log('MutationObserver started');
                // Initial injection
                debouncedInject();
            } else {
                setTimeout(startObserving, 500);
            }
        }

        startObserving();
    }

    initObserver();
    log('Script loaded');
})();
