// ==UserScript==
// @name         ShippingManager - Save Vessel History
// @namespace    http://tampermonkey.net/
// @version      2.8
// @description  Detect vessel history API calls and offer CSV download
// @author       https://github.com/justonlyforyou/
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    let currentHistoryBtn = null;
    let trackingEnabled = false;

    // Wait 5 seconds after page load before tracking (ignore initial page load calls)
    setTimeout(() => {
        trackingEnabled = true;
        console.log('[VesselHistory] Tracking enabled');
    }, 5000);

    // Intercept fetch BEFORE the game loads
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const [url, options] = args;
        const urlStr = typeof url === 'string' ? url : url.url;

        // Check if this is the vessel history endpoint (only after tracking is enabled)
        if (trackingEnabled && urlStr.includes('/api/vessel/get-vessel-history') && options && options.body) {
            try {
                const body = JSON.parse(options.body);
                const vesselId = body.vessel_id;

                if (vesselId) {
                    console.log('[VesselHistory] Detected fetch to get-vessel-history, vessel_id:', vesselId);

                    // Call original fetch first to get the response
                    const response = await originalFetch.apply(this, args);
                    const clonedResponse = response.clone();

                    // Extract vessel name from response
                    clonedResponse.json().then(data => {
                        const history = data.data?.vessel_history;
                        const vesselName = data.data?.user_vessel?.name || 'Vessel';

                        showSaveButton(vesselName, vesselId, history);
                    }).catch(() => {
                        showSaveButton('Vessel', vesselId, null);
                    });

                    return response;
                }
            } catch (e) {
                console.log('[VesselHistory] Error parsing fetch body:', e);
            }
        }

        return originalFetch.apply(this, args);
    };

    // Intercept XMLHttpRequest BEFORE the game loads
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url;
        this._method = method;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (trackingEnabled && this._url && this._url.includes('/api/vessel/get-vessel-history') && body) {
            try {
                const parsedBody = JSON.parse(body);
                const vesselId = parsedBody.vessel_id;

                if (vesselId) {
                    console.log('[VesselHistory] Detected XHR to get-vessel-history, vessel_id:', vesselId);

                    this.addEventListener('load', () => {
                        try {
                            const data = JSON.parse(this.responseText);
                            const history = data.data?.vessel_history;
                            const vesselName = data.data?.user_vessel?.name || 'Vessel';

                            showSaveButton(vesselName, vesselId, history);
                        } catch (e) {
                            showSaveButton('Vessel', vesselId, null);
                        }
                    });
                }
            } catch (e) {
                console.log('[VesselHistory] Error parsing XHR body:', e);
            }
        }

        return originalXHRSend.apply(this, [body]);
    };

    console.log('[VesselHistory] Fetch and XHR interceptors installed (document-start)');

    // Show save button in Voyage history header
    function showSaveButton(vesselName, vesselId, historyData) {
        console.log('[VesselHistory] showSaveButton called for', vesselName, vesselId);

        // Remove existing button
        if (currentHistoryBtn && currentHistoryBtn.parentNode) {
            currentHistoryBtn.parentNode.removeChild(currentHistoryBtn);
        }

        let retryCount = 0;
        const tryInsert = () => {
            retryCount++;
            console.log('[VesselHistory] tryInsert attempt', retryCount);

            // Find the blackBarHeader containing "Voyage history"
            const headers = document.querySelectorAll('.blackBarHeader');
            let targetHeader = null;
            for (const header of headers) {
                const p = header.querySelector('p');
                if (p && p.textContent.trim() === 'Voyage history') {
                    targetHeader = header;
                    break;
                }
            }

            if (!targetHeader) {
                if (retryCount < 20) {
                    setTimeout(tryInsert, 500);
                } else {
                    console.log('[VesselHistory] Gave up finding Voyage history header after 20 attempts');
                }
                return;
            }

            const btn = document.createElement('button');
            btn.id = 'save-vessel-history-btn';
            btn.textContent = 'Export History';
            btn.style.cssText = 'padding:4px 10px;background:#22c55e;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;margin-left:auto;';

            if (historyData) {
                // We already have the data, save directly
                btn.addEventListener('click', () => saveHistoryAsCSV(vesselName, vesselId, historyData));
            } else {
                // Need to fetch again
                btn.addEventListener('click', () => fetchAndSaveHistory(vesselId, vesselName));
            }

            // Make header a flex container to position button on the right
            targetHeader.style.display = 'flex';
            targetHeader.style.alignItems = 'center';
            targetHeader.appendChild(btn);
            currentHistoryBtn = btn;

            console.log('[VesselHistory] Button shown in header for', vesselName, vesselId);
        };

        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', tryInsert);
        } else {
            tryInsert();
        }
    }

    // Fetch history from API and save as CSV
    async function fetchAndSaveHistory(vesselId, vesselName) {
        try {
            const response = await originalFetch('https://shippingmanager.cc/api/vessel/get-vessel-history', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ vessel_id: parseInt(vesselId, 10) }),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('API request failed: ' + response.status);
            }

            const data = await response.json();
            const history = data.data?.vessel_history || [];

            if (history.length === 0) {
                alert('No history entries found for ' + vesselName);
                return;
            }

            saveHistoryAsCSV(vesselName, vesselId, history);

        } catch (err) {
            console.error('[VesselHistory] Error fetching history:', err);
            alert('Failed to fetch history: ' + err.message);
        }
    }

    // Save history as CSV - dynamically uses ALL fields from API response
    function saveHistoryAsCSV(vesselName, vesselId, history) {
        if (!history || history.length === 0) {
            alert('No history data available');
            return;
        }

        // Log raw data to console for debugging
        console.log('[VesselHistory] Raw history data:', JSON.stringify(history[0], null, 2));

        // Get all unique keys from all history entries, flatten nested objects
        const allKeys = new Set();
        for (const trip of history) {
            for (const key of Object.keys(trip)) {
                if (typeof trip[key] === 'object' && trip[key] !== null) {
                    // Flatten nested objects like cargo: {dry: 800, refrigerated: 700}
                    for (const subKey of Object.keys(trip[key])) {
                        allKeys.add(key + '_' + subKey);
                    }
                } else {
                    allKeys.add(key);
                }
            }
        }

        const columns = Array.from(allKeys).sort();
        let csv = columns.join(';') + '\n';

        for (const trip of history) {
            const row = columns.map(col => {
                if (col.includes('_')) {
                    // Handle flattened nested fields like cargo_dry
                    const [parent, child] = col.split('_');
                    const value = trip[parent]?.[child];
                    return escapeCSV(value);
                }
                return escapeCSV(trip[col]);
            });
            csv += row.join(';') + '\n';
        }

        // Download
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'vessel_history_' + vesselId + '_' + new Date().toISOString().slice(0,10) + '.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        alert('Exported ' + history.length + ' trips for ' + vesselName);

        // Remove button after save
        if (currentHistoryBtn && currentHistoryBtn.parentNode) {
            currentHistoryBtn.parentNode.removeChild(currentHistoryBtn);
            currentHistoryBtn = null;
        }
    }

    function escapeCSV(str) {
        if (str === null || str === undefined) return '';
        str = String(str);
        if (str.includes('"') || str.includes(';') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

})();
