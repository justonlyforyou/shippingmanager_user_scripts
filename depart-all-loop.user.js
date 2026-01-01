// ==UserScript==
// @name        Shipping Manager - Depart All Loop
// @description Clicks Depart All button repeatedly until all vessels departed
// @version     1.0
// @author      https://github.com/justonlyforyou/
// @order       23
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    let running = false;
    let loopBtn = null;

    function hasErrorNotification() {
        const notifications = document.querySelectorAll('.singleNotification .content');
        for (const n of notifications) {
            if (n.textContent.includes('Not enough fuel')) {
                return true;
            }
        }
        return false;
    }

    async function getVesselsAtPort() {
        const res = await fetch('/api/vessel/get-all-user-vessels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ include_routes: false })
        });
        const data = await res.json();
        const vessels = data.data?.user_vessels || [];

        const atPort = vessels.filter(v =>
            v.status === 'port' &&
            !v.is_parked &&
            v.route_name
        );

        return atPort.length;
    }


    async function loop() {
        if (running) return;
        running = true;

        if (loopBtn) {
            loopBtn.textContent = 'Stop';
            loopBtn.style.background = '#ef4444';
        }

        console.log('[Loop] Start');

        while (running) {
            const count = await getVesselsAtPort();
            console.log('[Loop] Vessels at port:', count);

            if (count === 0) {
                console.log('[Loop] All vessels departed');
                break;
            }

            const departBtn = document.getElementById('depart-all-btn');
            if (!departBtn) {
                console.log('[Loop] Depart All button not found');
                break;
            }

            console.log('[Loop] Clicking Depart All...');
            departBtn.click();

            // Wait for response
            await new Promise(r => setTimeout(r, 2000));

            // Check for error notification in DOM
            if (hasErrorNotification()) {
                console.log('[Loop] Stopping - Not enough fuel');
                break;
            }
        }

        running = false;
        if (loopBtn) {
            loopBtn.textContent = 'Depart Loop';
            loopBtn.style.background = '#3b82f6';
        }
        console.log('[Loop] Done');
    }

    function stop() {
        running = false;
        console.log('[Loop] Stopped');
    }

    function addButton() {
        const orig = document.getElementById('depart-all-btn');
        if (!orig || document.getElementById('depart-loop-btn')) return;

        const harborMenu = orig.closest('.harborMenu') || orig.closest('.harbor-menu') || orig.parentNode;
        const menuWidth = harborMenu.offsetWidth;

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'grid-column: 1 / -1; width: 100%;';

        loopBtn = document.createElement('button');
        loopBtn.id = 'depart-loop-btn';
        loopBtn.textContent = 'Depart Loop';
        loopBtn.style.cssText = `display:block;width:${menuWidth - 20}px;margin:2px auto 4px;padding:6px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;`;
        loopBtn.onclick = () => running ? stop() : loop();

        wrapper.appendChild(loopBtn);
        harborMenu.appendChild(wrapper);
    }

    setInterval(addButton, 1000);
})();
