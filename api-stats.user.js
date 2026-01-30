// ==UserScript==
// @name         ShippingManager - API Stats Monitor
// @namespace    http://tampermonkey.net/
// @description  Monitor all API calls to shippingmanager.cc in the background
// @version      1.9
// @order        2
// @author       RebelShip
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-start
// @RequireRebelShipMenu true
// @enabled      false
// ==/UserScript==
/* globals addMenuItem, XMLHttpRequest */

(function() {
    'use strict';

    var SCRIPT_NAME = 'ApiStats';
    var STORE_NAME = 'calls';
    var MAX_AGE_MS = 61 * 60 * 1000;
    var SAVE_DEBOUNCE_MS = 1000;
    var apiCalls = [];
    var modalVisible = false;
    var currentFilter = 5;
    var saveTimeout = null;
    var bridgeReady = false;

    function log(msg) {
        console.log('[ApiStats] ' + msg);
    }

    async function dbGet(key) {
        if (!window.RebelShipBridge) return null;
        try {
            var result = await window.RebelShipBridge.storage.get(SCRIPT_NAME, STORE_NAME, key);
            if (result) {
                return JSON.parse(result);
            }
            return null;
        } catch (e) {
            log('dbGet error: ' + e);
            return null;
        }
    }

    async function dbSet(key, value) {
        if (!window.RebelShipBridge) return false;
        try {
            await window.RebelShipBridge.storage.set(SCRIPT_NAME, STORE_NAME, key, JSON.stringify(value));
            return true;
        } catch (e) {
            log('dbSet error: ' + e);
            return false;
        }
    }

    async function loadFromDb() {
        var data = await dbGet('apiCalls');
        if (data && Array.isArray(data)) {
            apiCalls = data;
            cleanupOldCalls();
            log('Loaded ' + apiCalls.length + ' calls from database');
        }
    }

    function scheduleSave() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        saveTimeout = setTimeout(function() {
            saveToDb();
        }, SAVE_DEBOUNCE_MS);
    }

    async function saveToDb() {
        cleanupOldCalls();
        await dbSet('apiCalls', apiCalls);
    }

    function cleanupOldCalls() {
        var cutoff = Date.now() - MAX_AGE_MS;
        apiCalls = apiCalls.filter(function(call) {
            return call.timestamp >= cutoff;
        });
    }

    function isApiUrl(url) {
        if (!url) return false;
        return url.indexOf('/api/') !== -1 || url.indexOf('/api?') !== -1;
    }

    function interceptFetch() {
        var originalFetch = window.fetch;
        window.fetch = function(input) {
            var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            if (isApiUrl(url)) {
                recordApiCall(url);
            }
            return originalFetch.apply(this, arguments);
        };
    }

    function interceptXHR() {
        var originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            if (isApiUrl(url)) {
                this._apiStatsUrl = url;
            }
            return originalOpen.apply(this, arguments);
        };

        var originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function() {
            if (this._apiStatsUrl) {
                recordApiCall(this._apiStatsUrl);
            }
            return originalSend.apply(this, arguments);
        };
    }

    function recordApiCall(url) {
        var endpoint = url.replace(/https?:\/\/[^\/]+/, '');
        apiCalls.push({
            url: endpoint,
            timestamp: Date.now()
        });
        if (bridgeReady) {
            scheduleSave();
        }
    }

    function getFilteredStats(minutes) {
        var cutoff = Date.now() - (minutes * 60 * 1000);
        var now = Date.now();
        var filtered = apiCalls.filter(function(call) {
            return call.timestamp >= cutoff;
        });
        log('getFilteredStats(' + minutes + 'min): total=' + apiCalls.length + ', filtered=' + filtered.length + ', cutoff=' + Math.round((now - cutoff) / 60000) + 'min ago');

        var stats = {};
        filtered.forEach(function(call) {
            if (!stats[call.url]) {
                stats[call.url] = { count: 0, lastCall: 0 };
            }
            stats[call.url].count++;
            if (call.timestamp > stats[call.url].lastCall) {
                stats[call.url].lastCall = call.timestamp;
            }
        });

        var result = [];
        for (var url in stats) {
            result.push({
                url: url,
                count: stats[url].count,
                lastCall: stats[url].lastCall
            });
        }

        result.sort(function(a, b) {
            return b.count - a.count;
        });

        return {
            endpoints: result,
            totalCalls: filtered.length
        };
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTime(timestamp) {
        var d = new Date(timestamp);
        var h = d.getHours().toString().padStart(2, '0');
        var m = d.getMinutes().toString().padStart(2, '0');
        var s = d.getSeconds().toString().padStart(2, '0');
        return h + ':' + m + ':' + s;
    }

    function createModal() {
        var existing = document.getElementById('api-stats-modal');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'api-stats-modal';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;';

        var modal = document.createElement('div');
        modal.style.cssText = 'background:#1a1a2e;border:1px solid #3a3a5e;border-radius:8px;width:700px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;color:#fff;font-family:Arial,sans-serif;';

        var header = document.createElement('div');
        header.style.cssText = 'padding:16px 20px;border-bottom:1px solid #3a3a5e;display:flex;justify-content:space-between;align-items:center;';
        header.innerHTML = '<span style="font-size:18px;font-weight:700;">API Stats Monitor</span>';

        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'X';
        closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0 8px;';
        closeBtn.onclick = function() {
            overlay.remove();
            modalVisible = false;
        };
        header.appendChild(closeBtn);

        var filters = document.createElement('div');
        filters.style.cssText = 'padding:12px 2px;border-bottom:1px solid #3a3a5e;display:flex;flex-wrap:wrap;gap:6px;align-items:center;';

        [1, 5, 10, 15, 30, 45, 60].forEach(function(mins) {
            var btn = document.createElement('button');
            btn.textContent = mins + 'm';
            btn.id = 'api-stats-filter-' + mins;
            btn.style.cssText = 'padding:4px 8px;border:1px solid #3a3a5e;border-radius:4px;cursor:pointer;font-size:12px;' +
                (currentFilter === mins ? 'background:#4a90d9;color:#fff;' : 'background:#2a2a4e;color:#aaa;');
            btn.onclick = function() {
                currentFilter = mins;
                log('Filter changed to ' + mins + ' minutes, apiCalls.length=' + apiCalls.length);
                updateModalContent();
                document.querySelectorAll('[id^="api-stats-filter-"]').forEach(function(b) {
                    b.style.background = '#2a2a4e';
                    b.style.color = '#aaa';
                });
                btn.style.background = '#4a90d9';
                btn.style.color = '#fff';
            };
            filters.appendChild(btn);
        });

        var refreshBtn = document.createElement('button');
        refreshBtn.textContent = 'Refresh';
        refreshBtn.style.cssText = 'padding:4px 8px;border:1px solid #3a3a5e;border-radius:4px;cursor:pointer;font-size:12px;background:#2a2a4e;color:#aaa;';
        refreshBtn.onclick = async function() {
            refreshBtn.textContent = '...';
            await loadFromDb();
            updateModalContent();
            refreshBtn.textContent = 'Refresh';
        };
        filters.appendChild(refreshBtn);

        var summary = document.createElement('div');
        summary.id = 'api-stats-summary';
        summary.style.cssText = 'padding:12px 20px;border-bottom:1px solid #3a3a5e;font-size:13px;color:#626b90;';

        var content = document.createElement('div');
        content.id = 'api-stats-content';
        content.style.cssText = 'flex:1;overflow-y:auto;padding:0;';

        modal.appendChild(header);
        modal.appendChild(filters);
        modal.appendChild(summary);
        modal.appendChild(content);
        overlay.appendChild(modal);

        overlay.onclick = function(e) {
            if (e.target === overlay) {
                overlay.remove();
                modalVisible = false;
            }
        };

        document.body.appendChild(overlay);
        modalVisible = true;
        updateModalContent();
    }

    function updateModalContent() {
        var stats = getFilteredStats(currentFilter);
        var summary = document.getElementById('api-stats-summary');
        var content = document.getElementById('api-stats-content');

        if (!summary || !content) return;

        summary.innerHTML = 'Total calls in last ' + currentFilter + ' minutes: <strong style="color:#fff;">' + stats.totalCalls + '</strong> | ' +
            'Unique endpoints: <strong style="color:#fff;">' + stats.endpoints.length + '</strong> | ' +
            'Calls/min: <strong style="color:#fff;">' + (stats.totalCalls / currentFilter).toFixed(1) + '</strong>';

        if (stats.endpoints.length === 0) {
            content.innerHTML = '<div style="padding:40px;text-align:center;color:#626b90;">No API calls recorded in the last ' + currentFilter + ' minutes</div>';
            return;
        }

        var table = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
        table += '<thead><tr style="background:#2a2a4e;position:sticky;top:0;">';
        table += '<th style="padding:10px 12px;text-align:left;border-bottom:1px solid #3a3a5e;">Endpoint</th>';
        table += '<th style="padding:10px 12px;text-align:center;border-bottom:1px solid #3a3a5e;width:80px;">Count</th>';
        table += '<th style="padding:10px 12px;text-align:center;border-bottom:1px solid #3a3a5e;width:100px;">Last Call</th>';
        table += '</tr></thead><tbody>';

        stats.endpoints.forEach(function(ep, idx) {
            var bgColor = idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
            table += '<tr style="background:' + bgColor + ';">';
            table += '<td style="padding:8px 12px;border-bottom:1px solid #2a2a4e;word-break:break-all;color:#aaa;">' + escapeHtml(ep.url) + '</td>';
            table += '<td style="padding:8px 12px;border-bottom:1px solid #2a2a4e;text-align:center;color:#4a90d9;font-weight:700;">' + ep.count + '</td>';
            table += '<td style="padding:8px 12px;border-bottom:1px solid #2a2a4e;text-align:center;color:#626b90;">' + formatTime(ep.lastCall) + '</td>';
            table += '</tr>';
        });

        table += '</tbody></table>';
        content.innerHTML = table;
    }

    function toggleModal() {
        if (modalVisible) {
            var m = document.getElementById('api-stats-modal');
            if (m) m.remove();
            modalVisible = false;
        } else {
            createModal();
        }
    }

    function setupKeyboardShortcut() {
        document.addEventListener('keydown', function(e) {
            if (e.altKey && e.key === 'a') {
                e.preventDefault();
                toggleModal();
            }
        });
    }

    async function initBridge() {
        if (window.RebelShipBridge) {
            bridgeReady = true;
            await loadFromDb();
            log('Bridge ready, loaded data from database');
        } else {
            setTimeout(initBridge, 100);
        }
    }

    function init() {
        interceptFetch();
        interceptXHR();

        addMenuItem('API Stats', toggleModal, 99);
        setupKeyboardShortcut();

        initBridge();

        setInterval(function() {
            cleanupOldCalls();
            if (bridgeReady) {
                saveToDb();
            }
        }, 60000);

        log('API Stats Monitor initialized - Click menu or press Alt+A to open');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
