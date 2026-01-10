// ==UserScript==
// @name        Shipping Manager - Depart All Loop
// @description Clicks Depart All button repeatedly until all vessels departed
// @version     2.3
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

    function updateButtonState() {
        if (!loopBtn) return;
        const btnContent = loopBtn.querySelector('.btn-content-wrapper');
        if (running) {
            btnContent.textContent = 'Stop';
            loopBtn.classList.remove('light-blue');
            loopBtn.classList.add('red');
        } else {
            btnContent.textContent = 'Depart Loop';
            loopBtn.classList.remove('red');
            loopBtn.classList.add('light-blue');
        }
    }

    async function loop() {
        if (running) return;
        running = true;
        updateButtonState();

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
        updateButtonState();
        console.log('[Loop] Done');
    }

    function stop() {
        running = false;
        updateButtonState();
        console.log('[Loop] Stopped');
    }

    function injectStyles() {
        if (document.getElementById('depart-loop-style')) return;

        const style = document.createElement('style');
        style.id = 'depart-loop-style';
        style.textContent = '.bottomWrapper.btn-group { position: absolute !important; bottom: 0 !important; left: 0 !important; width: 100% !important; } .buttonWrapper { position: absolute !important; bottom: 46px !important; left: 0 !important; width: 100% !important; padding: 0 2px !important; box-sizing: border-box !important; gap: 2px !important; }';
        document.head.appendChild(style);
    }

    function addButton() {
        injectStyles();

        const orig = document.getElementById('depart-all-btn');
        if (!orig || document.getElementById('depart-loop-btn')) return;

        const buttonWrapper = orig.closest('.buttonWrapper');
        if (!buttonWrapper) return;

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'grid-column: 1 / -1; width: 100%; margin-top: 4px;';

        loopBtn = document.createElement('button');
        loopBtn.id = 'depart-loop-btn';
        loopBtn.type = 'button';
        loopBtn.className = 'btn btn-depart btn-block default light-blue';
        loopBtn.style.width = '100%';

        const btnContent = document.createElement('div');
        btnContent.className = 'btn-content-wrapper fit-btn-text';
        btnContent.style.fontSize = '14px';
        btnContent.textContent = 'Depart Loop';

        loopBtn.appendChild(btnContent);
        loopBtn.onclick = () => running ? stop() : loop();

        wrapper.appendChild(loopBtn);
        buttonWrapper.appendChild(wrapper);
    }

    setInterval(addButton, 1000);
})();
