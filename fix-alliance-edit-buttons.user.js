// ==UserScript==
// @name         Fix Alliance Edit Buttons
// @namespace    https://shippingmanager.cc/
// @version      1.1
// @description  Adds missing edit buttons for alliance name/description for interim_ceo
// @author       https://github.com/justonlyforyou/
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==

(function() {
    'use strict';

    // ===========================================
    // BUG FIXED:
    // Edit buttons for alliance name/description only show for CEO
    // But interim_ceo should also be able to edit
    //
    // Original code:
    //   o.isUserCEO?...openPopover("editName")
    //   o.isUserCEO?...openPopover("editDescription")
    //
    // This script adds edit buttons for interim_ceo
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

    function getMyMember() {
        const userStore = getUserStore();
        const allianceStore = getAllianceStore();
        if (!userStore?.user || !allianceStore?.members) return null;
        return allianceStore.members.find(m => m.user_id === userStore.user.id);
    }

    let lastLoggedRole = null;

    function shouldShowButtons() {
        const myMember = getMyMember();
        if (!myMember) {
            return false;
        }
        // Only log role once when it changes
        if (lastLoggedRole !== myMember.role) {
            console.log('[Alliance Edit Fix] Role:', myMember.role);
            lastLoggedRole = myMember.role;
        }
        // Only add buttons for interim_ceo
        // CEO already has the buttons built into the game
        return myMember.role === 'interim_ceo';
    }

    // ===========================================
    // EDIT NAME
    // ===========================================

    async function updateAllianceName(newName) {
        const toast = getToastStore();
        const Language = getLanguage();
        const allianceStore = getAllianceStore();

        if (newName.length < 3) {
            const msg = 'Name must be at least 3 characters';
            toast ? toast.error(msg) : alert(msg);
            return;
        }

        console.log('[Alliance Edit Fix] Updating name to:', newName);

        const response = await fetch('/api/alliance/update-alliance-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });

        const data = await response.json();
        console.log('[Alliance Edit Fix] Response:', data);

        if (data.error) {
            toast ? toast.error(data.error) : alert(data.error);
        } else {
            const msg = Language?.text('Alliance/management/name_updated') || 'Alliance name updated';
            toast ? toast.success(msg) : alert(msg);
            if (data.data && allianceStore) {
                allianceStore.update(data.data);
            }
            location.reload();
        }
    }

    function showNameEditPrompt() {
        const allianceStore = getAllianceStore();
        const toast = getToastStore();
        const Language = getLanguage();

        if (!allianceStore?.alliance) {
            alert('Alliance data not loaded');
            return;
        }

        const currentName = allianceStore.alliance.name;

        if (toast && toast.input) {
            toast.input(
                Language?.text('Alliance/management/edit_name') || 'Edit Alliance Name',
                currentName,
                [
                    { text: Language?.text('General/save') || 'Save', buttonColor: 'blue', value: true },
                    { text: Language?.text('General/cancel') || 'Cancel', value: false }
                ]
            ).then((result) => {
                if (result && result !== currentName) {
                    updateAllianceName(result);
                }
            });
        } else {
            const newName = prompt('Enter new alliance name:', currentName);
            if (newName && newName !== currentName) {
                updateAllianceName(newName);
            }
        }
    }

    // ===========================================
    // EDIT DESCRIPTION
    // ===========================================

    async function updateAllianceDescription(newDesc) {
        const toast = getToastStore();
        const Language = getLanguage();
        const allianceStore = getAllianceStore();

        console.log('[Alliance Edit Fix] Updating description');

        const response = await fetch('/api/alliance/update-alliance-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: newDesc })
        });

        const data = await response.json();
        console.log('[Alliance Edit Fix] Response:', data);

        if (data.error) {
            toast ? toast.error(data.error) : alert(data.error);
        } else {
            const msg = Language?.text('Alliance/management/description_updated') || 'Alliance description updated';
            toast ? toast.success(msg) : alert(msg);
            if (data.data && allianceStore) {
                allianceStore.update(data.data);
            }
            location.reload();
        }
    }

    function showDescriptionEditPrompt() {
        const allianceStore = getAllianceStore();
        const toast = getToastStore();
        const Language = getLanguage();

        if (!allianceStore?.alliance) {
            alert('Alliance data not loaded');
            return;
        }

        const currentDesc = allianceStore.alliance.description;

        if (toast && toast.input) {
            toast.input(
                Language?.text('Alliance/management/edit_description') || 'Edit Alliance Description',
                currentDesc,
                [
                    { text: Language?.text('General/save') || 'Save', buttonColor: 'blue', value: true },
                    { text: Language?.text('General/cancel') || 'Cancel', value: false }
                ]
            ).then((result) => {
                if (result !== false && result !== currentDesc) {
                    updateAllianceDescription(result);
                }
            });
        } else {
            const newDesc = prompt('Enter new alliance description:', currentDesc);
            if (newDesc !== null && newDesc !== currentDesc) {
                updateAllianceDescription(newDesc);
            }
        }
    }

    // ===========================================
    // CREATE EDIT BUTTONS
    // ===========================================

    function createEditButton(type) {
        const btn = document.createElement('div');
        btn.className = 'edit-btn no-select';
        btn.dataset.smfixEditBtn = type;
        btn.style.cursor = 'pointer';
        btn.style.marginLeft = '5px';
        btn.style.display = 'inline-block';

        const img = document.createElement('img');
        img.src = '/images/alliances/edit_alliance_icon.svg';
        img.style.width = '16px';
        img.style.height = '16px';
        btn.appendChild(img);

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            if (type === 'name') {
                showNameEditPrompt();
            } else if (type === 'description') {
                showDescriptionEditPrompt();
            }
        });

        return btn;
    }

    // ===========================================
    // INJECT EDIT BUTTONS
    // ===========================================

    function addEditButtons() {
        // Only add for interim_ceo
        if (!shouldShowButtons()) {
            return;
        }

        const allianceStore = getAllianceStore();
        if (!allianceStore?.alliance) {
            console.log('[Alliance Edit Fix] No alliance data');
            return;
        }
        console.log('[Alliance Edit Fix] Alliance name:', allianceStore.alliance.name);
        console.log('[Alliance Edit Fix] Alliance description:', allianceStore.alliance.description?.substring(0, 30));

        // Find all divs and look for ones containing our alliance name as direct text
        const allDivs = document.querySelectorAll('div');
        let foundName = false;
        let foundDesc = false;

        for (const div of allDivs) {
            if (foundName && foundDesc) break;

            // Get direct text content (not from children)
            const directText = Array.from(div.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent.trim())
                .join('');

            // Check for alliance name
            if (!foundName && directText === allianceStore.alliance.name) {
                if (div.querySelector('[data-smfix-edit-btn="name"]')) continue;
                if (div.querySelector('.edit-btn')) continue;

                const editBtn = createEditButton('name');
                div.appendChild(editBtn);
                console.log('[Alliance Edit Fix] Added name edit button to:', div);
                foundName = true;
            }

            // Check for alliance description
            if (!foundDesc && allianceStore.alliance.description) {
                if (directText === allianceStore.alliance.description) {
                    if (div.querySelector('[data-smfix-edit-btn="description"]')) continue;
                    if (div.querySelector('.edit-btn')) continue;

                    const editBtn = createEditButton('description');
                    div.appendChild(editBtn);
                    console.log('[Alliance Edit Fix] Added description edit button to:', div);
                    foundDesc = true;
                }
            }
        }

        if (!foundName) {
            console.log('[Alliance Edit Fix] Could not find name element');
        }
        if (!foundDesc) {
            console.log('[Alliance Edit Fix] Could not find description element');
        }
    }

    // ===========================================
    // ALTERNATIVE: Find by alliance modal structure
    // ===========================================

    function addEditButtonsToModal() {
        // Only add for interim_ceo
        if (!shouldShowButtons()) {
            return;
        }

        const allianceStore = getAllianceStore();
        if (!allianceStore?.alliance) return;

        // Look for the alliance modal content
        const modalContent = document.querySelector('.modal-content, .alliance-modal, [class*="alliance"]');
        if (!modalContent) return;

        // Find elements containing alliance name/description by text content
        const allDivs = modalContent.querySelectorAll('div');

        for (const div of allDivs) {
            // Skip if already processed
            if (div.dataset.smfixProcessed) continue;

            const text = div.textContent?.trim();
            const directText = Array.from(div.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent.trim())
                .join('');

            // Check for name match (direct text content, not including children)
            if (directText === allianceStore.alliance.name) {
                if (!div.querySelector('[data-smfix-edit-btn="name"]') && !div.querySelector('.edit-btn img[src*="edit"]')) {
                    const editBtn = createEditButton('name');
                    div.appendChild(editBtn);
                    div.dataset.smfixProcessed = 'true';
                    console.log('[Alliance Edit Fix] Added name edit button to modal');
                }
            }

            // Check for description match
            if (directText && allianceStore.alliance.description &&
                directText.length > 10 &&
                directText === allianceStore.alliance.description) {
                if (!div.querySelector('[data-smfix-edit-btn="description"]') && !div.querySelector('.edit-btn img[src*="edit"]')) {
                    const editBtn = createEditButton('description');
                    div.appendChild(editBtn);
                    div.dataset.smfixProcessed = 'true';
                    console.log('[Alliance Edit Fix] Added description edit button to modal');
                }
            }
        }
    }

    // ===========================================
    // MAIN
    // ===========================================

    function runFix() {
        addEditButtons();
        addEditButtonsToModal();
    }

    setInterval(runFix, 500);

    console.log('[Alliance Edit Fix] v1.0 loaded - adding edit buttons for interim_ceo');
})();
