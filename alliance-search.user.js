// ==UserScript==
// @name        Shipping Manager - Alliance Search
// @description Search all alliances by name and open their profile
// @version     3.2
// @author      https://github.com/justonlyforyou/
// @order       19
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @enabled     false
// ==/UserScript==
/* globals Event */

(function() {
    'use strict';

    var STORAGE_KEY = 'rebelship_alliances';
    var STORAGE_META_KEY = 'rebelship_alliances_meta';
    var STORAGE_PROGRESS_KEY = 'rebelship_alliances_progress';
    var isMobile = window.innerWidth < 1024;
    var isDownloading = false;
    var isIndexReady = false;
    var PAGE_SIZE = 10;
    var currentResults = [];
    var displayedCount = 0;
    var isLoadingMore = false;

    // RebelShip Menu Logo SVG
    var REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    // Format numbers with thousand separators
    function formatNumber(num) {
        return num.toLocaleString('en-US');
    }

    // Get Pinia stores
    function getStores() {
        try {
            var appEl = document.querySelector('#app');
            if (!appEl || !appEl.__vue_app__) return null;
            var app = appEl.__vue_app__;
            var pinia = app._context.provides.pinia || app.config.globalProperties.$pinia;
            if (!pinia || !pinia._s) return null;
            return {
                modalStore: pinia._s.get('modal'),
                allianceStore: pinia._s.get('alliance'),
                userStore: pinia._s.get('user')
            };
        } catch (e) {
            console.error('[AllianceSearch] Failed to get stores:', e);
            return null;
        }
    }

    // Open alliance modal by ID
    async function openAllianceModal(allianceId) {
        var stores = getStores();
        if (!stores) {
            alert('Failed to access game stores. Try refreshing the page.');
            return;
        }

        console.log('[AllianceSearch] Opening alliance:', allianceId);

        // The alliance store uses Vue refs, so we need to set the ID properly
        // The game code does: n.value.id = t where n is the alliance ref
        if (stores.allianceStore) {
            // Try different ways to set the ID based on how Vue/Pinia exposes it
            if (stores.allianceStore.alliance && typeof stores.allianceStore.alliance === 'object') {
                // If it's a ref with .value
                if (stores.allianceStore.alliance.value !== undefined) {
                    stores.allianceStore.alliance.value.id = allianceId;
                } else {
                    // Direct property access (unwrapped ref in Pinia)
                    stores.allianceStore.alliance.id = allianceId;
                }
            }

            // Also try using $patch if available (Pinia method)
            if (typeof stores.allianceStore.$patch === 'function') {
                stores.allianceStore.$patch(function(state) {
                    if (state.alliance) {
                        state.alliance.id = allianceId;
                    }
                });
            }
        }

        // Small delay to let store update
        await new Promise(function(r) { setTimeout(r, 100); });

        // Open the alliance overview modal - it will fetch fresh data
        stores.modalStore.open('allianceOverview');
    }

    // Get stored alliances
    function getStoredAlliances() {
        try {
            var data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('[AllianceSearch] Failed to load alliances:', e);
            return [];
        }
    }

    // Get storage metadata
    function getStorageMeta() {
        try {
            var data = localStorage.getItem(STORAGE_META_KEY);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    // Get download progress (for resume after F5)
    function getDownloadProgress() {
        try {
            var data = localStorage.getItem(STORAGE_PROGRESS_KEY);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    // Save download progress
    function saveDownloadProgress(offset, alliances) {
        try {
            localStorage.setItem(STORAGE_PROGRESS_KEY, JSON.stringify({
                offset: offset,
                alliances: alliances,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.error('[AllianceSearch] Failed to save progress:', e);
        }
    }

    // Clear download progress
    function clearDownloadProgress() {
        localStorage.removeItem(STORAGE_PROGRESS_KEY);
    }

    // Save alliances to localStorage
    function saveAlliances(alliances) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(alliances));
            localStorage.setItem(STORAGE_META_KEY, JSON.stringify({
                count: alliances.length,
                timestamp: Date.now(),
                date: new Date().toLocaleString()
            }));
            clearDownloadProgress();
            return true;
        } catch (e) {
            console.error('[AllianceSearch] Failed to save alliances:', e);
            return false;
        }
    }

    // Check if index is ready
    function checkIndexReady() {
        var meta = getStorageMeta();
        var progress = getDownloadProgress();

        // Index is ready if we have data and no incomplete download
        isIndexReady = meta && meta.count > 0 && !progress;
        return isIndexReady;
    }

    // Update dialog UI based on state
    function updateDialogState() {
        // Re-check index state
        checkIndexReady();

        var searchContainer = document.getElementById('alliance-search-container');
        var indexingContainer = document.getElementById('alliance-indexing-container');
        var statusLine = document.getElementById('alliance-search-status');

        // No UI elements found yet
        if (!searchContainer || !indexingContainer) {
            console.log('[AllianceSearch] UI elements not found, state:', isIndexReady ? 'ready' : 'indexing');
            return;
        }

        console.log('[AllianceSearch] Updating state - isIndexReady:', isIndexReady, 'isDownloading:', isDownloading);

        if (isIndexReady && !isDownloading) {
            searchContainer.style.display = 'flex';
            indexingContainer.style.display = 'none';
            var meta = getStorageMeta();
            if (meta && statusLine) {
                statusLine.textContent = meta.count + ' alliances indexed (' + meta.date + ')';
            }
            // Trigger initial results display and resize
            var searchInput = document.getElementById('alliance-search-input');
            if (searchInput) {
                searchInput.dispatchEvent(new Event('input'));
            }
            // Recalculate height after content is visible
            setTimeout(resizeResultsContainer, 150);
        } else {
            searchContainer.style.display = 'none';
            indexingContainer.style.display = 'block';
        }
    }

    // Fetch all alliances from API (with resume support)
    async function fetchAllAlliances(forceRestart) {
        if (isDownloading) {
            console.log('[AllianceSearch] Download already in progress');
            return;
        }

        isDownloading = true;
        isIndexReady = false;
        updateDialogState();

        var progress = forceRestart ? null : getDownloadProgress();
        var allAlliances = progress ? progress.alliances : [];
        var offset = progress ? progress.offset : 0;
        var limit = 50;
        var page = Math.floor(offset / limit) + 1;

        if (progress) {
            console.log('[AllianceSearch] Resuming download from offset', offset, 'with', allAlliances.length, 'alliances');
        } else {
            console.log('[AllianceSearch] Starting fresh alliance download...');
        }

        try {
            while (true) {
                var response = await fetch('/api/alliance/get-open-alliances', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        limit: limit,
                        offset: offset,
                        filter: 'all'
                    })
                });

                var data = await response.json();

                if (!data || !data.data || !data.data.alliances) {
                    console.log('[AllianceSearch] No more data at offset', offset);
                    break;
                }

                var alliances = data.data.alliances;

                if (alliances.length === 0) {
                    console.log('[AllianceSearch] Done! No more alliances at offset', offset);
                    break;
                }

                // Store alliance data with stats
                alliances.forEach(function(a) {
                    allAlliances.push({
                        id: a.id,
                        name: a.name,
                        image: a.image,
                        image_colors: a.image_colors,
                        language: a.language,
                        members: a.members,
                        benefit_level: a.benefit_level,
                        total_share_value: a.total_share_value,
                        departures_24h: a.stats ? a.stats.departures_24h : 0,
                        contribution_24h: a.stats ? a.stats.contribution_score_24h : 0,
                        coops_24h: a.stats ? a.stats.coops_24h : 0
                    });
                });

                // Update UI
                updateIndexingStatus(allAlliances.length, page);

                console.log('[AllianceSearch] Page', page, '- Got', alliances.length, 'alliances (total:', allAlliances.length, ')');

                offset += limit;
                page++;

                // Save progress every 10 pages for resume capability
                if (page % 10 === 0) {
                    saveDownloadProgress(offset, allAlliances);
                }

                // Small delay to avoid rate limiting
                await new Promise(function(r) { setTimeout(r, 200); });
            }

            // Save final result
            if (saveAlliances(allAlliances)) {
                console.log('[AllianceSearch] Saved', allAlliances.length, 'alliances to localStorage');
            }

            isIndexReady = true;

        } catch (e) {
            console.error('[AllianceSearch] Download error:', e);
            // Save progress so we can resume
            saveDownloadProgress(offset, allAlliances);
            updateIndexingStatus(-1, 0, e.message);
        } finally {
            isDownloading = false;
            updateDialogState();
        }

        return allAlliances;
    }

    // Update indexing status in UI
    function updateIndexingStatus(count, page, error) {
        var statusText = document.getElementById('alliance-indexing-status');
        if (!statusText) return;

        if (error) {
            statusText.textContent = 'Error: ' + error + ' (will resume on next load)';
            statusText.style.color = '#ef4444';
        } else if (count >= 0) {
            statusText.textContent = 'Indexing alliances... ' + count + ' found (page ' + page + ')';
            statusText.style.color = '#fbbf24';
        }
    }

    // Filter and search alliances
    function filterAlliances(query, minMembers, minContribution, minDepartures) {
        var alliances = getStoredAlliances();

        // Apply filters
        var filtered = alliances.filter(function(a) {
            if (minMembers > 0 && (a.members || 0) < minMembers) return false;
            if (minContribution > 0 && (a.contribution_24h || 0) < minContribution) return false;
            if (minDepartures > 0 && (a.departures_24h || 0) < minDepartures) return false;
            return true;
        });

        // Apply search query if provided
        if (query && query.length >= 2) {
            var queryLower = query.toLowerCase();
            filtered = filtered.filter(function(a) {
                return a.name.toLowerCase().indexOf(queryLower) !== -1;
            });
        }

        // Sort alphabetically by name
        filtered.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return filtered;
    }

    // Get or create mobile row
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

    // Get or create RebelShip menu
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
            container.style.cssText = 'position:relative;display:inline-block;margin-left:auto;';

            var btn = document.createElement('button');
            btn.id = 'rebelship-menu-btn';
            btn.innerHTML = REBELSHIP_LOGO;
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:18px;height:18px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;';
            btn.title = 'RebelShip Menu';

            var dropdown = document.createElement('div');
            dropdown.className = 'rebelship-dropdown';
            dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

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

            row.appendChild(container);
            return dropdown;
        }

        // Desktop
        var messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) return null;

        container = document.createElement('div');
        container.id = 'rebelship-menu';
        container.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:10px;margin-left:auto;';

        btn = document.createElement('button');
        btn.id = 'rebelship-menu-btn';
        btn.innerHTML = REBELSHIP_LOGO;
        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        btn.title = 'RebelShip Menu';

        dropdown = document.createElement('div');
        dropdown.className = 'rebelship-dropdown';
        dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

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

        return dropdown;
    }

    // Add menu item
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
            itemBtn.addEventListener('click', onClick);
        }

        item.appendChild(itemBtn);
        dropdown.appendChild(item);

        return item;
    }

    var injectRetryCount = 0;
    var MAX_INJECT_RETRIES = 20;

    // Open the routeResearch modal and inject alliance search content
    function openAllianceSearchModal() {
        var stores = getStores();
        if (!stores) {
            console.error('[AllianceSearch] Cannot open modal - stores not available');
            setTimeout(openAllianceSearchModal, 1000);
            return;
        }

        // Reset retry counter
        injectRetryCount = 0;

        // Open the routeResearch modal
        stores.modalStore.open('routeResearch');

        // Wait for modal to render, then inject our content
        setTimeout(function() {
            injectSearchContent();
        }, 300);
    }

    // Inject alliance search content into the modal
    function injectSearchContent() {
        injectRetryCount++;

        // Find any modal content area - try multiple selectors
        var modalContent = null;
        var selectors = [
            '#modal-content',
            '#modal-content-wrapper',
            '.modal-content',
            '.modal-body',
            '.content-wrapper',
            '#modal-wrapper .content',
            '[class*="modal"] [class*="content"]',
            '#modal-wrapper > div > div'
        ];

        for (var i = 0; i < selectors.length; i++) {
            var el = document.querySelector(selectors[i]);
            if (el) {
                modalContent = el;
                console.log('[AllianceSearch] Found modal with selector:', selectors[i]);
                break;
            }
        }

        if (!modalContent) {
            if (injectRetryCount < MAX_INJECT_RETRIES) {
                setTimeout(injectSearchContent, 200);
            } else {
                console.error('[AllianceSearch] Could not find modal content after', MAX_INJECT_RETRIES, 'retries');
                // Fallback: create our own overlay dialog
                createFallbackDialog();
            }
            return;
        }

        // Check if already injected
        if (document.getElementById('alliance-search-wrapper')) {
            updateDialogState();
            return;
        }

        console.log('[AllianceSearch] Injecting into:', modalContent);

        // Clear existing content and inject ours
        modalContent.innerHTML = '';

        // Build and inject search content
        var wrapper = buildSearchContent();
        wrapper.style.cssText = 'padding:10px;display:flex;flex-direction:column;height:100%;box-sizing:border-box;';
        modalContent.style.cssText = (modalContent.style.cssText || '') + 'display:flex;flex-direction:column;height:100%;';
        modalContent.appendChild(wrapper);

        // Change modal title via store
        var stores = getStores();
        if (stores && stores.modalStore && stores.modalStore.modalSettings) {
            stores.modalStore.modalSettings.title = 'Alliance Search';
            console.log('[AllianceSearch] Title set via modalStore');
        }

        // Also try DOM as fallback
        setTimeout(function() {
            var titleEl = document.querySelector('.title span');
            if (titleEl && titleEl.textContent !== 'Alliance Search') {
                titleEl.textContent = 'Alliance Search';
            }
        }, 100);

        // Set initial state
        updateDialogState();

        // Focus search input
        var searchInput = document.getElementById('alliance-search-input');
        if (searchInput) {
            searchInput.focus();
        }

        // Dynamically calculate results container height
        setTimeout(resizeResultsContainer, 100);
    }

    // Resize results container to fill available modal space
    function resizeResultsContainer() {
        var resultsContainer = document.getElementById('alliance-search-results');
        var searchContainer = document.getElementById('alliance-search-container');
        if (!resultsContainer || !searchContainer) return;

        // Find the modal wrapper (game uses #modal-wrapper)
        var modalWrapper = document.getElementById('modal-wrapper');
        if (!modalWrapper) {
            console.log('[AllianceSearch] Modal wrapper not found, using viewport');
            // Fallback: use viewport height
            resultsContainer.style.maxHeight = 'calc(70vh - 180px)';
            return;
        }

        // Get the inner content area of the modal
        var modalInner = modalWrapper.querySelector('.content') ||
                         modalWrapper.querySelector('[class*="content"]') ||
                         modalWrapper;

        var modalRect = modalInner.getBoundingClientRect();

        // Calculate space used by other elements (status, search row, filter row)
        var usedHeight = 0;
        Array.from(searchContainer.children).forEach(function(child) {
            if (child.id !== 'alliance-search-results') {
                usedHeight += child.offsetHeight + 10;
            }
        });

        // Calculate available height (modal height - used space - padding)
        var availableHeight = modalRect.height - usedHeight - 60;

        if (availableHeight > 100) {
            resultsContainer.style.maxHeight = availableHeight + 'px';
            console.log('[AllianceSearch] Set results height to', availableHeight + 'px');
        } else {
            // Fallback
            resultsContainer.style.maxHeight = 'calc(70vh - 180px)';
            console.log('[AllianceSearch] Using fallback height');
        }
    }

    // Fallback dialog if modal injection fails
    function createFallbackDialog() {
        var existing = document.getElementById('alliance-search-dialog');
        if (existing) {
            existing.style.display = 'flex';
            updateDialogState();
            return;
        }

        var overlay = document.createElement('div');
        overlay.id = 'alliance-search-dialog';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;z-index:100000;';

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:#1f2937;border-radius:8px;padding:20px;width:90%;max-width:500px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;';

        // Header
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;';

        var title = document.createElement('h2');
        title.textContent = 'Alliance Search';
        title.style.cssText = 'color:#fff;margin:0;font-size:18px;';

        var closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:24px;cursor:pointer;padding:0;line-height:1;';
        closeBtn.onclick = function() { overlay.style.display = 'none'; };

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Build content
        var content = buildSearchContent();

        dialog.appendChild(header);
        dialog.appendChild(content);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        });

        updateDialogState();
    }

    // Build search content (shared between modal and fallback)
    function buildSearchContent() {
        var wrapper = document.createElement('div');
        wrapper.id = 'alliance-search-wrapper';
        wrapper.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;height:100%;';

        // Add spinner style if not exists
        if (!document.getElementById('alliance-search-style')) {
            var style = document.createElement('style');
            style.id = 'alliance-search-style';
            style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }

        // Indexing container
        var indexingContainer = document.createElement('div');
        indexingContainer.id = 'alliance-indexing-container';
        indexingContainer.style.cssText = 'text-align:center;padding:40px 20px;';

        var spinner = document.createElement('div');
        spinner.style.cssText = 'width:40px;height:40px;border:3px solid #374151;border-top-color:#3b82f6;border-radius:50%;margin:0 auto 20px;animation:spin 1s linear infinite;';

        var indexingText = document.createElement('div');
        indexingText.id = 'alliance-indexing-status';
        indexingText.style.cssText = 'color:#1a1a2e;font-size:14px;font-weight:bold;';
        indexingText.textContent = 'Indexing alliances...';

        indexingContainer.appendChild(spinner);
        indexingContainer.appendChild(indexingText);

        // Search container
        var searchContainer = document.createElement('div');
        searchContainer.id = 'alliance-search-container';
        searchContainer.style.cssText = 'display:none;flex-direction:column;flex:1;overflow:hidden;min-height:0;';

        var statusLine = document.createElement('div');
        statusLine.id = 'alliance-search-status';
        statusLine.style.cssText = 'color:#333;font-size:12px;margin-bottom:10px;';

        var searchRow = document.createElement('div');
        searchRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';

        var searchInput = document.createElement('input');
        searchInput.id = 'alliance-search-input';
        searchInput.type = 'text';
        searchInput.placeholder = 'Search alliance name...';
        searchInput.style.cssText = 'flex:1;padding:10px;border-radius:4px;border:1px solid #ccc;background:#f5f5f5;color:#333;font-size:14px;';

        var refreshBtn = document.createElement('button');
        refreshBtn.id = 'alliance-refresh-btn';
        refreshBtn.textContent = 'Update';
        refreshBtn.style.cssText = 'padding:10px 15px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;';

        searchRow.appendChild(searchInput);
        searchRow.appendChild(refreshBtn);

        // Filter row
        var filterRow = document.createElement('div');
        filterRow.style.cssText = 'display:flex;gap:8px;margin-bottom:15px;flex-wrap:wrap;';

        var filterInputStyle = 'width:110px;padding:6px 8px;border-radius:4px;border:1px solid #ccc;background:#f5f5f5;color:#333;font-size:12px;';

        var minMembersInput = document.createElement('input');
        minMembersInput.id = 'alliance-filter-members';
        minMembersInput.type = 'number';
        minMembersInput.min = '0';
        minMembersInput.max = '30';
        minMembersInput.placeholder = 'Min Members';
        minMembersInput.style.cssText = filterInputStyle;

        var minContribInput = document.createElement('input');
        minContribInput.id = 'alliance-filter-contribution';
        minContribInput.type = 'number';
        minContribInput.min = '0';
        minContribInput.placeholder = 'Min Contrib 24h';
        minContribInput.style.cssText = filterInputStyle;

        var minDeparturesInput = document.createElement('input');
        minDeparturesInput.id = 'alliance-filter-departures';
        minDeparturesInput.type = 'number';
        minDeparturesInput.min = '0';
        minDeparturesInput.placeholder = 'Min Dep 24h';
        minDeparturesInput.style.cssText = filterInputStyle;

        var resultCount = document.createElement('span');
        resultCount.id = 'alliance-result-count';
        resultCount.style.cssText = 'color:#666;font-size:12px;margin-left:auto;align-self:center;';

        filterRow.appendChild(minMembersInput);
        filterRow.appendChild(minContribInput);
        filterRow.appendChild(minDeparturesInput);
        filterRow.appendChild(resultCount);

        var resultsContainer = document.createElement('div');
        resultsContainer.id = 'alliance-search-results';
        resultsContainer.style.cssText = 'flex:1;overflow-y:auto;min-height:0;';

        searchContainer.appendChild(statusLine);
        searchContainer.appendChild(searchRow);
        searchContainer.appendChild(filterRow);
        searchContainer.appendChild(resultsContainer);

        wrapper.appendChild(indexingContainer);
        wrapper.appendChild(searchContainer);

        // Function to perform search with filters
        function doSearch() {
            var query = searchInput.value;
            var minMembers = parseInt(minMembersInput.value) || 0;
            var minContrib = parseInt(minContribInput.value) || 0;
            var minDep = parseInt(minDeparturesInput.value) || 0;

            currentResults = filterAlliances(query, minMembers, minContrib, minDep);
            displayedCount = 0;

            // Update result count
            resultCount.textContent = currentResults.length + ' results';

            // Clear and render first page
            resultsContainer.innerHTML = '';
            loadMoreResults(resultsContainer);
        }

        // Event handlers
        var searchTimeout = null;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(doSearch, 300);
        });

        // Filter change handlers
        minMembersInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(doSearch, 300);
        });
        minContribInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(doSearch, 300);
        });
        minDeparturesInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(doSearch, 300);
        });

        // Lazy loading scroll handler
        resultsContainer.addEventListener('scroll', function() {
            var scrollTop = resultsContainer.scrollTop;
            var scrollHeight = resultsContainer.scrollHeight;
            var clientHeight = resultsContainer.clientHeight;

            console.log('[AllianceSearch] Scroll event - top:', scrollTop, 'height:', scrollHeight, 'client:', clientHeight);

            if (isLoadingMore) return;
            if (displayedCount >= currentResults.length) return;

            // Load more when near bottom (within 50px)
            if (scrollTop + clientHeight >= scrollHeight - 50) {
                console.log('[AllianceSearch] Loading more... displayed:', displayedCount, 'total:', currentResults.length);
                loadMoreResults(resultsContainer);
            }
        });

        // Also add wheel event as backup for scroll detection
        resultsContainer.addEventListener('wheel', function(e) {
            // Check if at bottom when scrolling down
            if (e.deltaY > 0) {
                var scrollTop = resultsContainer.scrollTop;
                var scrollHeight = resultsContainer.scrollHeight;
                var clientHeight = resultsContainer.clientHeight;

                if (scrollTop + clientHeight >= scrollHeight - 50) {
                    if (!isLoadingMore && displayedCount < currentResults.length) {
                        console.log('[AllianceSearch] Wheel load more...');
                        loadMoreResults(resultsContainer);
                    }
                }
            }
        });

        refreshBtn.addEventListener('click', function() {
            if (isDownloading) return;
            fetchAllAlliances(true);
        });

        // Initial load when ready
        if (isIndexReady) {
            setTimeout(doSearch, 100);
        }

        return wrapper;
    }

    // Load more results (lazy loading)
    function loadMoreResults(container) {
        if (isLoadingMore) return;

        // Remove existing load more button
        var existingBtn = container.querySelector('.load-more-btn');
        if (existingBtn) existingBtn.remove();

        if (displayedCount >= currentResults.length) {
            console.log('[AllianceSearch] No more results to load');
            return;
        }

        isLoadingMore = true;

        var nextBatch = currentResults.slice(displayedCount, displayedCount + PAGE_SIZE);
        console.log('[AllianceSearch] Rendering batch of', nextBatch.length, 'items');
        renderResults(nextBatch, container, true);
        displayedCount += nextBatch.length;

        // Add "Load More" button if there are more results
        if (displayedCount < currentResults.length) {
            var loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'load-more-btn';
            loadMoreBtn.textContent = 'Load More (' + (currentResults.length - displayedCount) + ' remaining)';
            loadMoreBtn.style.cssText = 'width:100%;padding:12px;margin-top:10px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;';
            loadMoreBtn.addEventListener('click', function() {
                loadMoreResults(container);
            });
            container.appendChild(loadMoreBtn);
        }

        isLoadingMore = false;
    }

    // Render search results (append mode for lazy loading)
    function renderResults(alliances, container, append) {
        if (!append) {
            container.innerHTML = '';
        }

        if (alliances.length === 0 && !append) {
            var noResults = document.createElement('div');
            noResults.style.cssText = 'color:#666;text-align:center;padding:20px;';
            noResults.textContent = 'No alliances found';
            container.appendChild(noResults);
            return;
        }

        alliances.forEach(function(alliance) {
            var item = document.createElement('div');
            item.style.cssText = 'padding:10px;border-bottom:1px solid #ddd;cursor:pointer;display:flex;align-items:center;gap:10px;';

            item.addEventListener('mouseenter', function() {
                try { this.style.background = '#e5e5e5'; } catch {}
            });
            item.addEventListener('mouseleave', function() {
                try { this.style.background = 'transparent'; } catch {}
            });

            // Alliance logo
            var logoDiv = document.createElement('div');
            logoDiv.style.cssText = 'width:40px;height:40px;flex-shrink:0;border-radius:4px;overflow:hidden;';
            if (alliance.image) {
                var logoImg = document.createElement('img');
                logoImg.src = '/images/alliances/' + alliance.image + '.svg';
                logoImg.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                if (alliance.image_colors && alliance.image_colors.primary) {
                    logoDiv.style.background = alliance.image_colors.primary;
                }
                logoDiv.appendChild(logoImg);
            }

            // Main info (name + language)
            var mainDiv = document.createElement('div');
            mainDiv.style.cssText = 'flex:1;min-width:0;';

            var nameDiv = document.createElement('div');
            nameDiv.style.cssText = 'color:#333;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            nameDiv.textContent = alliance.name;

            var langDiv = document.createElement('div');
            langDiv.style.cssText = 'color:#888;font-size:11px;';
            langDiv.textContent = (alliance.language || 'en').toUpperCase() + ' | Level ' + alliance.benefit_level;

            mainDiv.appendChild(nameDiv);
            mainDiv.appendChild(langDiv);

            // Stats column (members/slots)
            var membersDiv = document.createElement('div');
            membersDiv.style.cssText = 'text-align:center;min-width:50px;';
            var freeSlots = 30 - (alliance.members || 0);
            membersDiv.innerHTML = '<div style="font-weight:600;color:#333;font-size:14px;">' + alliance.members + '/30</div>' +
                '<div style="color:' + (freeSlots > 0 ? '#4ade80' : '#ef4444') + ';font-size:14px;">' + freeSlots + ' free</div>';

            // 24h stats (departures + contribution)
            var statsDiv = document.createElement('div');
            statsDiv.style.cssText = 'text-align:right;min-width:120px;font-size:11px;';
            var departures = alliance.departures_24h || 0;
            var contribution = alliance.contribution_24h || 0;
            statsDiv.innerHTML =
                '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">' +
                    '<span style="color:#888;">Departures 24h:</span>' +
                    '<span style="color:#333;font-weight:500;">' + formatNumber(departures) + '</span>' +
                '</div>' +
                '<div style="display:flex;justify-content:space-between;">' +
                    '<span style="color:#888;">Contribution 24h:</span>' +
                    '<span style="color:#333;font-weight:500;">' + formatNumber(contribution) + '</span>' +
                '</div>';

            item.appendChild(logoDiv);
            item.appendChild(mainDiv);
            item.appendChild(membersDiv);
            item.appendChild(statsDiv);

            item.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();

                console.log('[AllianceSearch] Clicked on alliance:', alliance.name, 'ID:', alliance.id);

                // Close fallback dialog if exists
                var fallbackDialog = document.getElementById('alliance-search-dialog');
                if (fallbackDialog) {
                    fallbackDialog.style.display = 'none';
                }
                // Close rebel menu dropdown
                var rebelMenu = document.getElementById('rebelship-menu');
                if (rebelMenu) {
                    var dropdown = rebelMenu.querySelector('.rebelship-dropdown');
                    if (dropdown) dropdown.style.display = 'none';
                }
                // Close game modal first, then open alliance after delay
                var stores = getStores();
                if (stores && stores.modalStore && stores.modalStore.closeAll) {
                    stores.modalStore.closeAll();
                }

                // Wait for modal to close, then open alliance
                setTimeout(function() {
                    openAllianceModal(alliance.id);
                }, 200);
            });

            container.appendChild(item);
        });
    }

    // Start background download
    function startBackgroundDownload() {
        var progress = getDownloadProgress();
        var meta = getStorageMeta();

        // Check if we need to download
        if (progress) {
            // Resume incomplete download
            console.log('[AllianceSearch] Found incomplete download, resuming...');
            fetchAllAlliances(false);
        } else if (!meta || meta.count === 0) {
            // No data, start fresh download
            console.log('[AllianceSearch] No alliance data, starting download...');
            fetchAllAlliances(true);
        } else {
            // Index is ready
            isIndexReady = true;
            console.log('[AllianceSearch] Alliance index ready:', meta.count, 'alliances');
        }
    }

    // Initialize
    function init() {
        // Check index state
        checkIndexReady();

        // Add menu item
        addMenuItem('Alliance Search', function() {
            var rebelMenu = document.getElementById('rebelship-menu');
            if (rebelMenu) {
                var dropdown = rebelMenu.querySelector('.rebelship-dropdown');
                if (dropdown) dropdown.style.display = 'none';
            }
            openAllianceSearchModal();
        });

        // Start background download if needed
        startBackgroundDownload();

        console.log('[AllianceSearch] Script loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 2000); });
    } else {
        setTimeout(init, 2000);
    }
})();
