// ==UserScript==
// @name         ShippingManager - Mass-Moore/Resume
// @namespace    http://tampermonkey.net/
// @version      4.15
// @description  Mass Moor and Resume vessels with checkbox selection
// @author       https://github.com/justonlyforyou/
// @order        60
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==
/* globals MutationObserver */

(function() {
    'use strict';

    const API_BASE = 'https://shippingmanager.cc/api';

    function log(msg, level) {
        var prefix = '[Fleet Manager] ';
        if (level === 'error') {
            console.error(prefix + msg);
        } else if (level === 'warn') {
            console.warn(prefix + msg);
        } else {
            console.log(prefix + msg);
        }
    }

    // State
    var selectedVessels = new Set();
    var vesselIdMap = new Map(); // Maps row element to vessel ID
    var isProcessing = false;

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

    function getToastStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('toast');
        } catch {
            return null;
        }
    }

    function showToast(message, type) {
        type = type || 'success';
        var toastStore = getToastStore();
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

    // ============================================
    // API FUNCTIONS
    // ============================================
    async function parkVessel(vesselId) {
        var response = await fetch(API_BASE + '/vessel/park-vessel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ vessel_id: vesselId })
        });
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        return response.json();
    }

    async function resumeVessel(vesselId) {
        var response = await fetch(API_BASE + '/vessel/resume-parked-vessel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ vessel_id: vesselId })
        });
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        return response.json();
    }

    // ============================================
    // GET VESSEL STORE FROM PINIA
    // ============================================
    function getVesselStore() {
        try {
            var pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('vessel');
        } catch {
            return null;
        }
    }

    // ============================================
    // GET VESSEL BY ID
    // ============================================
    function getVesselById(vesselId) {
        var vesselStore = getVesselStore();
        if (!vesselStore || !vesselStore.userVessels) return null;
        return vesselStore.userVessels.find(function(v) {
            return v.id === vesselId;
        });
    }

    // ============================================
    // GET VESSEL ID FROM ROW
    // ============================================
    function getVesselIdFromRow(row) {
        // Try cached ID first
        if (vesselIdMap.has(row)) {
            return vesselIdMap.get(row);
        }

        // Get vessel name from row
        var nameEl = row.querySelector('.vesselName .nameValue');
        if (!nameEl) return null;
        var vesselName = nameEl.textContent.trim();
        if (!vesselName) return null;

        // Get vessel ID from vesselStore by matching name
        var vesselStore = getVesselStore();
        if (!vesselStore || !vesselStore.userVessels) return null;

        var vessel = vesselStore.userVessels.find(function(v) {
            return v.name === vesselName;
        });

        if (vessel && vessel.id) {
            vesselIdMap.set(row, vessel.id);
            return vessel.id;
        }

        return null;
    }

    // ============================================
    // UI INJECTION
    // ============================================
    function injectCheckboxes() {
        var vesselList = document.querySelector('#notifications-vessels-listing .vesselList');
        if (!vesselList) return;

        // Get current tab from header text
        var header = document.querySelector('#notifications-vessels-listing .header-text .text-center');
        if (!header) return;
        var headerText = header.textContent.trim().toLowerCase();

        var isAtPort = headerText.includes('at port');
        var isAnchored = headerText.includes('anchored');
        var isAtSea = headerText.includes('at sea');

        // Only show checkboxes in "at port", "anchored" and "at sea" tabs
        if (!isAtPort && !isAnchored && !isAtSea) {
            vesselList.querySelectorAll('.fleet-manager-checkbox').forEach(function(cb) {
                cb.remove();
            });
            selectedVessels.clear();
            return;
        }

        var vesselStore = getVesselStore();
        var userVessels = vesselStore && vesselStore.userVessels ? vesselStore.userVessels : [];

        var vesselRows = vesselList.querySelectorAll('.vesselRow');
        vesselRows.forEach(function(row) {
            var nameEl = row.querySelector('.vesselName .nameValue');
            if (!nameEl) return;
            var vesselName = nameEl.textContent.trim();

            var vessel = userVessels.find(function(v) { return v.name === vesselName; });
            var existingCheckbox = row.querySelector('.fleet-manager-checkbox');

            // In anchored tab, only show checkbox for moored vessels (is_parked === true)
            if (isAnchored && (!vessel || !vessel.is_parked)) {
                if (existingCheckbox) existingCheckbox.remove();
                return;
            }

            // Skip if already has checkbox
            if (existingCheckbox) return;

            // Create checkbox wrapper
            var checkboxWrapper = document.createElement('div');
            checkboxWrapper.className = 'fleet-manager-checkbox';
            checkboxWrapper.style.cssText = 'position: absolute; left: 8px; top: 50%; transform: translateY(-50%); z-index: 100;';

            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer; accent-color: #22c55e;';

            checkbox.addEventListener('change', function(e) {
                e.stopPropagation();
                var vid = getVesselIdFromRow(row);
                log('Checkbox changed, vessel ID: ' + vid);
                if (vid) {
                    if (checkbox.checked) {
                        selectedVessels.add(vid);
                    } else {
                        selectedVessels.delete(vid);
                    }
                    updateButtonStates();
                    log('Selection: ' + selectedVessels.size + ' vessels, IDs: ' + Array.from(selectedVessels).join(', '));
                } else {
                    log('Could not get vessel ID from row!', 'error');
                }
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
        if (document.getElementById('fleet-manager-buttons')) return;

        // Inject CSS override for height (only once)
        if (!document.getElementById('fleet-manager-style')) {
            var style = document.createElement('style');
            style.id = 'fleet-manager-style';
            style.textContent = [
                '#notifications-vessels-listing .vesselList { padding-bottom: 2px !important; }',
                '#notifications-vessels-listing .header-text { padding: 3px !important; }',
                '.bottomWrapper.btn-group { position: absolute !important; bottom: 0 !important; left: 0 !important; width: 100% !important; }',
                '.singleButtonWrapper { position: absolute !important; bottom: 46px !important; left: 0 !important; width: 100% !important; padding: 0 4px !important; box-sizing: border-box !important; background: var(--background-light) !important; }',
                '.buttonWrapper { position: absolute !important; bottom: 46px !important; left: 0 !important; width: 100% !important; padding: 0 2px !important; box-sizing: border-box !important; gap: 2px !important; background: var(--background-light) !important; }',
                '#fleet-manager-buttons { background: var(--background-light) !important; padding: 4px 2px !important; margin-bottom: 2px !important; }',
                '.fleet-manager-checkbox { z-index: 100 !important; }',
                '.vesselRow { position: relative !important; z-index: 1 !important; }',
                '@media (max-width: 768px) { #notifications-vessels-listing .vesselList { max-height: calc(100% - 70px) !important; height: calc(100% - 70px) !important; } }'
            ].join(' ');
            document.head.appendChild(style);
        }

        // Find container: depart-all-btn parent (at port) or singleButtonWrapper (at sea/anchored)
        var container = null;
        var departBtn = document.getElementById('depart-all-btn');
        if (departBtn) {
            container = departBtn.closest('.buttonWrapper') || departBtn.parentNode;
        } else {
            container = document.querySelector('.singleButtonWrapper');
        }
        if (!container) return;

        var buttonContainer = document.createElement('div');
        buttonContainer.id = 'fleet-manager-buttons';
        buttonContainer.style.cssText = 'grid-column: 1 / -1; width: 100%; display: flex; gap: 4px; padding: 0; box-sizing: border-box; margin-bottom: 4px;';

        // All button
        var allBtn = createButton('All', function() {
            selectAll(true);
        });
        allBtn.id = 'fleet-manager-all-btn';

        // None button
        var noneBtn = createButton('None', function() {
            selectAll(false);
        });
        noneBtn.id = 'fleet-manager-none-btn';

        // Moor button
        var moorBtn = createButton('Moor', function() {
            log('MOOR BUTTON CLICKED! disabled=' + moorBtn.disabled + ', isProcessing=' + isProcessing + ', selectedVessels.size=' + selectedVessels.size);
            if (!moorBtn.disabled) {
                processSelectedVessels('moor');
            }
        });
        moorBtn.id = 'fleet-manager-moor-btn';
        moorBtn.disabled = true;

        // Resume button
        var resumeBtn = createButton('Resume', function() {
            log('RESUME BUTTON CLICKED! disabled=' + resumeBtn.disabled + ', isProcessing=' + isProcessing + ', selectedVessels.size=' + selectedVessels.size);
            if (!resumeBtn.disabled) {
                processSelectedVessels('resume');
            }
        });
        resumeBtn.id = 'fleet-manager-resume-btn';
        resumeBtn.disabled = true;

        buttonContainer.appendChild(allBtn);
        buttonContainer.appendChild(noneBtn);
        buttonContainer.appendChild(moorBtn);
        buttonContainer.appendChild(resumeBtn);

        // Insert at TOP of container (before 4x Speed and Depart)
        container.insertBefore(buttonContainer, container.firstChild);

        log('Buttons injected');
    }

    function createButton(text, onClick) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-depart btn-block default light-blue';
        btn.style.cssText = 'flex: 1;';

        var btnContent = document.createElement('div');
        btnContent.className = 'btn-content-wrapper fit-btn-text';
        btnContent.style.fontSize = '14px';
        btnContent.textContent = text;

        btn.appendChild(btnContent);
        btn.addEventListener('click', onClick);

        return btn;
    }

    function updateButtonStates() {
        var moorBtn = document.getElementById('fleet-manager-moor-btn');
        var resumeBtn = document.getElementById('fleet-manager-resume-btn');

        var hasSelection = selectedVessels.size > 0;
        var shouldDisable = !hasSelection || isProcessing;

        log('updateButtonStates: hasSelection=' + hasSelection + ', isProcessing=' + isProcessing + ', shouldDisable=' + shouldDisable);

        if (moorBtn) {
            moorBtn.disabled = shouldDisable;
            moorBtn.style.opacity = shouldDisable ? '0.5' : '1';
            moorBtn.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';
        }
        if (resumeBtn) {
            resumeBtn.disabled = shouldDisable;
            resumeBtn.style.opacity = shouldDisable ? '0.5' : '1';
            resumeBtn.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';
        }
    }

    // ============================================
    // SELECTION FUNCTIONS
    // ============================================
    function selectAll(select) {
        var checkboxes = document.querySelectorAll('.fleet-manager-checkbox input[type="checkbox"]');
        checkboxes.forEach(function(cb) {
            cb.checked = select;
            var row = cb.closest('.vesselRow');
            var vid = getVesselIdFromRow(row);
            if (vid) {
                if (select) {
                    selectedVessels.add(vid);
                } else {
                    selectedVessels.delete(vid);
                }
            }
        });
        updateButtonStates();
        log('Selection: ' + selectedVessels.size + ' vessels');
    }

    function clearAllCheckboxes() {
        var checkboxes = document.querySelectorAll('.fleet-manager-checkbox input[type="checkbox"]');
        checkboxes.forEach(function(cb) {
            cb.checked = false;
        });
        selectedVessels.clear();
        updateButtonStates();
        log('Cleared all checkboxes');
    }

    // ============================================
    // PROCESS VESSELS
    // ============================================
    async function processSelectedVessels(action) {
        log('processSelectedVessels called: ' + action + ', selected: ' + selectedVessels.size);

        if (selectedVessels.size === 0) {
            log('No vessels selected!');
            showToast('No vessels selected', 'error');
            return;
        }

        if (isProcessing) {
            log('Already processing, skipping');
            return;
        }

        isProcessing = true;
        updateButtonStates();

        var allVesselIds = Array.from(selectedVessels);
        var successCount = 0;
        var skippedCount = 0;
        var failedVessels = [];

        // Filter vessels based on action:
        // - Resume: only vessels where is_parked === true
        // - Moor: only vessels where is_parked === false
        var vesselIds = allVesselIds.filter(function(vid) {
            var vessel = getVesselById(vid);
            if (!vessel) {
                skippedCount++;
                return false;
            }
            if (action === 'resume' && vessel.is_parked !== true) {
                skippedCount++;
                return false;
            }
            if (action === 'moor' && vessel.is_parked === true) {
                skippedCount++;
                return false;
            }
            return true;
        });

        log('Processing ' + vesselIds.length + ' vessels for ' + action + ' (skipped ' + skippedCount + ')');

        if (vesselIds.length === 0) {
            var actionText = action === 'moor' ? 'moor' : 'resume';
            showToast('No vessels to ' + actionText + ' (all skipped)', 'error');
            isProcessing = false;
            clearAllCheckboxes();
            updateButtonStates();
            return;
        }

        try {
            for (var i = 0; i < vesselIds.length; i++) {
                var vesselId = vesselIds[i];
                try {
                    if (action === 'moor') {
                        await parkVessel(vesselId);
                    } else {
                        await resumeVessel(vesselId);
                    }
                    successCount++;
                } catch (err) {
                    failedVessels.push({ id: vesselId, error: err.message });
                }

                // Small delay between requests
                if (i < vesselIds.length - 1) {
                    await new Promise(function(resolve) { setTimeout(resolve, 200); });
                }
            }

            // Show success toast
            var actionText = action === 'moor' ? 'Moored' : 'Resumed';
            if (successCount > 0) {
                showToast(actionText + ' ' + successCount + ' vessel(s)', 'success');
            }

            // Show individual error toasts for each failed vessel
            failedVessels.forEach(function(failed) {
                showToast('Vessel ' + failed.id + ' failed: ' + failed.error, 'error');
            });

            // Refresh the vessel list
            refreshVesselList();
        } catch (outerErr) {
            log('processSelectedVessels outer error: ' + outerErr.message, 'error');
            showToast('Error: ' + outerErr.message, 'error');
        } finally {
            // Always reset state and clear selection
            isProcessing = false;
            clearAllCheckboxes();
            updateButtonStates();
            log('processSelectedVessels finished, isProcessing reset to false');
        }
    }

    function refreshVesselList() {
        var vesselStore = getVesselStore();
        if (vesselStore && vesselStore.fetchUserVessels) {
            vesselStore.fetchUserVessels().then(function() {
                log('Refreshed vessel list via vesselStore.fetchUserVessels()');
                // Re-inject checkboxes after fetch completes
                setTimeout(function() {
                    injectCheckboxes();
                    updateButtonStates();
                }, 500);
            });
        } else {
            // Fallback: just re-inject checkboxes
            setTimeout(function() {
                injectCheckboxes();
                updateButtonStates();
            }, 1000);
        }
    }

    // ============================================
    // FORCE HEIGHT ON VESSEL LISTING
    // ============================================
    function getTargetHeight() {
        var header = document.querySelector('#notifications-vessels-listing .header-text .text-center');
        if (header) {
            var headerText = header.textContent.trim().toLowerCase();
            if (headerText.includes('at sea')) {
                return 'calc(100% - 80px)';
            }
        }
        return 'calc(100% - 140px)';
    }

    function setupHeightObserver() {
        var listing = document.getElementById('notifications-vessels-listing');
        if (!listing) return;

        var targetHeight = getTargetHeight();

        // Always update height based on current tab
        if (listing.style.height !== targetHeight) {
            listing.style.height = targetHeight;
        }

        if (listing._fleetManagerObserver) return;

        // Watch for style changes and force height
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.attributeName === 'style') {
                    var target = getTargetHeight();
                    if (listing.style.height !== target) {
                        listing.style.height = target;
                    }
                }
            });
        });

        observer.observe(listing, { attributes: true, attributeFilter: ['style'] });
        listing._fleetManagerObserver = observer;
        log('Height observer attached');
    }


    // ============================================
    // INITIALIZE - Same approach as depart-all-loop.user.js
    // ============================================
    setInterval(function() {
        injectCheckboxes();
        injectButtons();
        setupHeightObserver();
    }, 1000);
})();
