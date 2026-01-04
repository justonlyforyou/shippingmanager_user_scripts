// ==UserScript==
// @name        Shipping Manager - Admin View
// @description Enable admin/moderator UI elements (client-side only)
// @version     8.5
// @author      https://github.com/justonlyforyou/
// @order       999
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    console.log('[AdminView] v8.5 loaded');

    // Inject into page context
    const script = document.createElement('script');
    script.textContent = `
(function() {
    if (window.__ADMIN_VIEW_85__) return;
    window.__ADMIN_VIEW_85__ = true;

    console.log('[AdminView] Initializing...');

    // ===== PATCH JSON.parse (works for admin_login) =====
    const origParse = JSON.parse;
    JSON.parse = function(text) {
        const result = origParse.apply(this, arguments);

        // Debug: Log any result with 'forum' in keys
        if (result && typeof result === 'object') {
            const keys = Object.keys(result);
            if (keys.some(k => k.toLowerCase().includes('forum'))) {
                console.log('[AdminView] JSON.parse found forum-related:', keys);
            }
            if (result.data && typeof result.data === 'object') {
                const dataKeys = Object.keys(result.data);
                if (dataKeys.some(k => k.toLowerCase().includes('forum'))) {
                    console.log('[AdminView] JSON.parse found forum in data:', dataKeys);
                }
            }
        }

        // Patch admin_login for red header
        if (result?.admin_login !== undefined) {
            result.admin_login = true;
        }
        if (result?.data?.admin_login !== undefined) {
            result.data.admin_login = true;
        }

        // Patch forum_user role
        if (result?.data && 'forum_user' in result.data) {
            console.log('[AdminView] JSON.parse: forum_user value:', result.data.forum_user);
            if (result.data.forum_user) {
                console.log('[AdminView] JSON.parse: role was:', result.data.forum_user.role);
                result.data.forum_user.role = 'admin';
                console.log('[AdminView] JSON.parse: Set role = admin');
            } else {
                // forum_user is null - create it
                result.data.forum_user = { role: 'admin', id: 1 };
                console.log('[AdminView] JSON.parse: Created forum_user with admin role');
            }
        }
        if (result?.forum_user) {
            console.log('[AdminView] JSON.parse: Found top-level forum_user');
            result.forum_user.role = 'admin';
        }

        return result;
    };
    console.log('[AdminView] JSON.parse patched');

    // ===== PATCH fetch for forum API calls =====
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = args[0]?.url || args[0] || '';
        const response = await originalFetch.apply(this, args);

        // Check if this is a forum API call
        if (typeof url === 'string' && url.includes('forum')) {
            console.log('[AdminView] Forum API call detected:', url);

            // Clone response and patch json method
            const origJson = response.json.bind(response);
            response.json = async function() {
                const data = await origJson();
                console.log('[AdminView] Forum response keys:', data ? Object.keys(data) : 'null');
                if (data?.data) {
                    console.log('[AdminView] Forum response.data keys:', Object.keys(data.data));
                }

                if (data?.data?.forum_user) {
                    console.log('[AdminView] fetch.json: Found forum_user, role was:', data.data.forum_user.role);
                    data.data.forum_user.role = 'admin';
                    console.log('[AdminView] fetch.json: Set forum_user.role = admin');
                }

                return data;
            };
        }

        return response;
    };
    console.log('[AdminView] fetch patched');

    // ===== HELPER: Get Vue App =====
    function getVueApp() {
        const appEl = document.querySelector('#app');
        return appEl?.__vue_app__;
    }

    // ===== HELPER: Get Pinia =====
    function getPinia() {
        const app = getVueApp();
        if (!app) return null;
        return app._context?.provides?.pinia || app.config?.globalProperties?.$pinia;
    }

    // ===== PATCH PINIA STORES =====
    function patchPiniaStores() {
        const pinia = getPinia();
        if (!pinia) return false;

        const userStore = pinia._s.get('user');
        if (userStore?.user) {
            userStore.user.is_admin = true;
        }

        return true;
    }

    // ===== FIND FORUM COMPONENT =====
    // The forum is in a Teleport/Modal, so we need to search ALL component instances
    function getAllComponentInstances(instance, results = []) {
        if (!instance) return results;

        results.push(instance);

        // Check subTree for child components
        if (instance.subTree) {
            walkVnode(instance.subTree, results);
        }

        return results;
    }

    function walkVnode(vnode, results) {
        if (!vnode) return;

        if (vnode.component) {
            getAllComponentInstances(vnode.component, results);
        }

        if (Array.isArray(vnode.children)) {
            for (const child of vnode.children) {
                walkVnode(child, results);
            }
        }

        if (vnode.dynamicChildren) {
            for (const child of vnode.dynamicChildren) {
                walkVnode(child, results);
            }
        }
    }

    function findForumComponent() {
        // Method 1: Search DOM for Vue internal properties
        const forumContainer = document.querySelector('.forumContainer');
        if (forumContainer) {
            // Check all properties on the element
            for (const key of Object.keys(forumContainer)) {
                if (key.startsWith('__vue')) {
                    const val = forumContainer[key];
                    console.log('[AdminView] Found on forumContainer:', key, val);
                    if (val?.ctx && 'forumUser' in val.ctx) {
                        return val;
                    }
                    if (val?.component?.ctx && 'forumUser' in val.component.ctx) {
                        return val.component;
                    }
                }
            }

            // Check parent elements
            let el = forumContainer;
            while (el && el !== document.body) {
                for (const key of Object.keys(el)) {
                    if (key.startsWith('__vue') && el[key]?.ctx) {
                        const ctx = el[key].ctx;
                        if ('forumUser' in ctx) {
                            console.log('[AdminView] Found forum via parent:', el.className);
                            return el[key];
                        }
                    }
                }
                el = el.parentElement;
            }
        }

        // Method 2: Walk component tree
        const app = getVueApp();
        if (!app?._instance) return null;

        const allInstances = getAllComponentInstances(app._instance);
        console.log('[AdminView] Total component instances:', allInstances.length);

        for (const instance of allInstances) {
            const ctx = instance.ctx || instance.proxy;
            if (ctx && 'forumUser' in ctx) {
                return instance;
            }
            if (instance.data && 'forumUser' in instance.data) {
                return instance;
            }
        }

        // Method 3: Check modal content for vnode
        const modalContent = document.querySelector('#central-container');
        if (modalContent) {
            for (const key of Object.keys(modalContent)) {
                if (key.startsWith('__')) {
                    console.log('[AdminView] Modal content key:', key, modalContent[key]);
                }
            }
        }

        return null;
    }

    function patchForumComponent() {
        const forumComp = findForumComponent();
        if (!forumComp) {
            // Don't spam console
            return false;
        }

        console.log('[AdminView] Found forum component!');
        const ctx = forumComp.ctx || forumComp.proxy;
        const data = forumComp.data;

        // Try ctx first
        if (ctx?.forumUser) {
            console.log('[AdminView] Current forumUser (ctx):', ctx.forumUser);
            ctx.forumUser.role = 'admin';
            console.log('[AdminView] Set forumUser.role = admin via ctx');
        }

        // Also try data
        if (data?.forumUser) {
            console.log('[AdminView] Current forumUser (data):', data.forumUser);
            data.forumUser.role = 'admin';
            console.log('[AdminView] Set forumUser.role = admin via data');
        }

        // If forumUser doesn't exist, create it
        if (!ctx?.forumUser && !data?.forumUser) {
            if (ctx) {
                ctx.forumUser = { role: 'admin', id: 1 };
                console.log('[AdminView] Created forumUser with admin role');
            }
        }

        // Force update
        if (forumComp.proxy?.$forceUpdate) {
            forumComp.proxy.$forceUpdate();
        }
        if (forumComp.update) {
            forumComp.update();
        }

        return true;
    }

    // ===== MUTATION OBSERVER =====
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;

                let className = '';
                if (node.className) {
                    if (typeof node.className === 'string') {
                        className = node.className;
                    } else if (node.className.baseVal) {
                        className = node.className.baseVal;
                    }
                }

                if (className.includes('forum') ||
                    className.includes('Forum') ||
                    className.includes('modal') ||
                    node.id === 'modal-container' ||
                    node.querySelector?.('.forumContainer')) {

                    console.log('[AdminView] Forum element detected');
                    setTimeout(patchForumComponent, 100);
                    setTimeout(patchForumComponent, 500);
                    setTimeout(patchForumComponent, 1500);
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // ===== CONSOLE API =====
    window.adminView = {
        patch: patchForumComponent,
        patchStores: patchPiniaStores,
        getApp: getVueApp,
        getPinia: getPinia,
        status: () => {
            console.log('=== AdminView Status ===');
            const app = getVueApp();
            console.log('Vue App:', app ? 'Found' : 'Not found');

            const pinia = getPinia();
            if (pinia) {
                console.log('Pinia stores:', Array.from(pinia._s.keys()));
            }

            const forumComp = findForumComponent();
            if (forumComp) {
                const ctx = forumComp.ctx || forumComp.proxy;
                console.log('Forum component: Found');
                console.log('forumUser:', ctx?.forumUser);
                console.log('isForumAdmin:', ctx?.isForumAdmin);
                console.log('isForumModerator:', ctx?.isForumModerator);
            } else {
                console.log('Forum component: Not found (open Community first)');
            }

            // Also show DOM inspection
            const fc = document.querySelector('.forumContainer');
            if (fc) {
                console.log('forumContainer element keys:', Object.keys(fc).filter(k => k.startsWith('__')));
            }
        }
    };

    console.log('[AdminView] Ready!');
    console.log('[AdminView] Use adminView.status() to check state');

    // Initial store patch
    setTimeout(patchPiniaStores, 2000);

})();
`;

    document.head.appendChild(script);
})();
