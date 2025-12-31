// ==UserScript==
// @name        Shipping Manager - Auto Depart
// @description Automatically departs all vessels when they are in port (checks every 5 minutes)
// @version     1.1
// @author      https://github.com/justonlyforyou/
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

    async function checkAndDepart() {
        try {
            // Fetch all user vessels
            const response = await fetch('/api/vessel/get-all-user-vessels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ include_routes: false }),
                credentials: 'include'
            });

            const data = await response.json();

            if (!data.data || !data.data.user_vessels) {
                console.log('[AutoDepart] No vessel data received');
                return;
            }

            const vessels = data.data.user_vessels;
            const inPortCount = vessels.filter(v => v.status === 'port').length;

            console.log('[AutoDepart] Vessels in port:', inPortCount, '/', vessels.length);

            if (inPortCount > 0) {
                // Calculate how many times we need to click (max 20 vessels per click)
                const clickCount = Math.ceil(inPortCount / 20);
                console.log('[AutoDepart] Need to click Depart All', clickCount, 'time(s)');

                for (let i = 0; i < clickCount; i++) {
                    const departBtn = document.querySelector('#depart-all-btn');
                    if (departBtn) {
                        console.log('[AutoDepart] Clicking Depart All... (' + (i + 1) + '/' + clickCount + ')');
                        departBtn.click();

                        // Wait 2 seconds between clicks (except after last click)
                        if (i < clickCount - 1) {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    } else {
                        console.log('[AutoDepart] Depart All button not found on page');
                        break;
                    }
                }
            }
        } catch (err) {
            console.error('[AutoDepart] Error:', err);
        }
    }

    // Initial check after 10 seconds (give page time to load)
    setTimeout(checkAndDepart, 10000);

    // Then check every 5 minutes
    setInterval(checkAndDepart, CHECK_INTERVAL);

    console.log('[AutoDepart] Script loaded - checking every 5 minutes');
})();
