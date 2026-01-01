// ==UserScript==
// @name         Fix Alliance Member Exclude
// @namespace    https://shippingmanager.cc/
// @version      1.0
// @description  Fixes broken exclude buttons for CEO and adds missing ones for regular members
// @author       https://github.com/justonlyforyou/
// @order        51
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==

(function() {
    'use strict';

    // ===========================================
    // BUGS FIXED:
    // 1. CEO exclude button passes wrong arguments (individual instead of object)
    //    excludeUserPrompt(t, e.user_id, e.role, e.company_name) - BROKEN
    //    Should be: excludeUserPrompt({e:t, user_id:e.user_id, member_role:e.role, company_name:e.company_name})
    //
    // 2. Member exclude buttons missing member_role, buttons not rendered
    //    excludeUserPrompt({e:t, user_id:e.user_id, company_name:e.company_name}) - missing member_role
    // ===========================================

    function getPinia() {
        const app = document.querySelector('#app');
        if (!app?.__vue_app__) return null;
        return app.__vue_app__._context?.provides?.pinia || app.__vue_app__.config?.globalProperties?.$pinia;
    }

    function getToastStore() {
        return getPinia()?._s?.get('toast');
    }

    function getAllianceStore() {
        return getPinia()?._s?.get('alliance');
    }

    function getUserStore() {
        return getPinia()?._s?.get('user');
    }

    function getLanguage() {
        return document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$Language;
    }

    function getCEO() {
        const alliance = getAllianceStore();
        if (!alliance?.members) return null;
        return alliance.members.find(m => m.role === 'ceo');
    }

    function getMyMember() {
        const userStore = getUserStore();
        const allianceStore = getAllianceStore();
        if (!userStore?.user || !allianceStore?.members) return null;
        return allianceStore.members.find(m => m.user_id === userStore.user.id);
    }

    function canKickMembers() {
        const myMember = getMyMember();
        if (!myMember) return false;
        const kickRoles = ['ceo', 'interim_ceo', 'coo', 'management'];
        return kickRoles.includes(myMember.role);
    }

    // ===========================================
    // KICK FUNCTION
    // ===========================================

    async function doKick(userId, companyName, isCeoConfirm = false) {
        const toast = getToastStore();
        const Language = getLanguage();

        console.log('[Exclude Fix] Kicking user:', userId, isCeoConfirm ? '(CEO confirm)' : '');

        const body = { user_id: userId };
        if (isCeoConfirm) body.ceo_confirmed = true;

        const response = await fetch('/api/alliance/exclude-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        console.log('[Exclude Fix] Response:', data);

        if (data.error === 'ceo_inactivity_period_not_reached') {
            const msg = Language?.text('Errors/ceo_inactivity_period_not_reached') || 'CEO inactivity period not reached (14 days required)';
            toast ? toast.error(msg) : alert(msg);

        } else if (data.error === 'ceo_inactivity_period_reached_confirm') {
            const confirmMsg = Language?.text('Alliance/management/ceo_inactivity_period_reached_confirm', {'[company_name]': companyName})
                || `Final confirm: Remove ${companyName} as CEO permanently?`;

            if (toast) {
                toast.prompt(confirmMsg, [
                    { text: 'Yes', buttonColor: 'red', value: true },
                    { text: 'No', value: false }
                ]).then((yes) => { if (yes) doKick(userId, companyName, true); });
            } else if (confirm(confirmMsg)) {
                doKick(userId, companyName, true);
            }

        } else if (data.error) {
            toast ? toast.error(data.error) : alert(data.error);
        } else {
            location.reload();
        }
    }

    // ===========================================
    // FIX 1: CEO EXCLUDE BUTTON
    // ===========================================

    function fixCeoExcludeButton() {
        const allButtons = document.querySelectorAll('button, .btn');

        for (const btn of allButtons) {
            const text = btn.textContent?.toLowerCase() || '';
            const isExclude = text.includes('exclude') || text.includes('entfernen');
            const isRed = btn.className.includes('red');

            if (!isExclude || !isRed) continue;
            if (btn.dataset.smfixCeoFixed) continue;
            if (btn.dataset.smfixMemberExcludeBtn) continue;
            if (btn.id?.startsWith('smfix-')) continue;

            // Check if this might be the CEO button by looking at parent structure
            // CEO button is typically in management section, not in member list
            const isInMemberList = btn.closest('[class*="member-list"], [class*="members-table"], table');
            if (isInMemberList) continue; // Skip member list buttons

            const ceo = getCEO();
            if (!ceo) continue;

            console.log('[Exclude Fix] Found CEO exclude button');

            // Hide broken button
            btn.style.display = 'none';
            btn.dataset.smfixCeoFixed = 'true';

            // Create working button
            const newBtn = document.createElement('button');
            newBtn.id = 'smfix-ceo-exclude-btn';
            newBtn.className = btn.className;
            newBtn.textContent = btn.textContent;
            newBtn.style.cssText = btn.style.cssText;
            newBtn.style.display = '';

            newBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();

                const ceo = getCEO();
                const toast = getToastStore();
                const Language = getLanguage();

                if (!ceo) {
                    alert('CEO not found. Refresh the page.');
                    return;
                }

                console.log('[Exclude Fix] CEO exclude clicked:', ceo);

                const msg = Language?.text('Alliance/management/exclude_user_prompt', {'[company_name]': ceo.company_name})
                    || `Remove ${ceo.company_name} from alliance?`;

                if (toast) {
                    toast.prompt(msg, [
                        { text: 'Yes', buttonColor: 'red', value: true },
                        { text: 'No', value: false }
                    ]).then((confirmed) => {
                        if (confirmed) doKick(ceo.user_id, ceo.company_name);
                    });
                } else if (confirm(msg)) {
                    doKick(ceo.user_id, ceo.company_name);
                }
            });

            btn.parentNode.insertBefore(newBtn, btn.nextSibling);
            console.log('[Exclude Fix] Replaced CEO exclude button');
        }
    }

    // ===========================================
    // FIX 2: MEMBER EXCLUDE BUTTONS
    // ===========================================

    function createMemberExcludeButton(member) {
        const Language = getLanguage();

        const btn = document.createElement('button');
        btn.className = 'btn default red';
        btn.textContent = Language?.text('Alliance/management/exclude') || 'Exclude';
        btn.dataset.smfixMemberExcludeBtn = member.user_id;
        btn.style.marginLeft = '5px';

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            const toast = getToastStore();
            const Language = getLanguage();

            console.log('[Exclude Fix] Member exclude clicked:', member);

            const msg = Language?.text('Alliance/management/exclude_user_prompt', {'[company_name]': member.company_name})
                || `Remove ${member.company_name} from alliance?`;

            if (toast) {
                toast.prompt(msg, [
                    { text: 'Yes', buttonColor: 'red', value: true },
                    { text: 'No', value: false }
                ]).then((confirmed) => {
                    if (confirmed) doKick(member.user_id, member.company_name);
                });
            } else if (confirm(msg)) {
                doKick(member.user_id, member.company_name);
            }
        });

        return btn;
    }

    function addMemberExcludeButtons() {
        if (!canKickMembers()) return;

        const allianceStore = getAllianceStore();
        const userStore = getUserStore();
        if (!allianceStore?.members || !userStore?.user) return;

        const myUserId = userStore.user.id;

        // Find member rows
        const memberElements = document.querySelectorAll('[class*="member"], [class*="row"], tr');

        for (const el of memberElements) {
            if (el.querySelector('[data-smfix-member-exclude-btn]')) continue;

            const textContent = el.textContent || '';

            for (const member of allianceStore.members) {
                // Skip self
                if (member.user_id === myUserId) continue;

                // Skip CEO (handled separately)
                if (member.role === 'ceo') continue;

                // Skip management (can't kick them)
                if (member.has_management_role) continue;

                // Match by company name
                if (textContent.includes(member.company_name)) {
                    if (document.querySelector(`[data-smfix-member-exclude-btn="${member.user_id}"]`)) continue;

                    const btnContainer = el.querySelector('[class*="btn"], [class*="button"], [class*="action"]')?.parentElement
                        || el.querySelector('td:last-child')
                        || el;

                    const excludeBtn = createMemberExcludeButton(member);
                    btnContainer.appendChild(excludeBtn);

                    console.log('[Exclude Fix] Added member exclude button for:', member.company_name);
                    break;
                }
            }
        }
    }

    // ===========================================
    // MAIN
    // ===========================================

    function runFixes() {
        fixCeoExcludeButton();
        addMemberExcludeButtons();
    }

    setInterval(runFixes, 500);

    console.log('[Exclude Fix] v1.0 loaded - fixing CEO button + adding member buttons');
})();
