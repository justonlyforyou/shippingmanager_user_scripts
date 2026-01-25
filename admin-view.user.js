// ==UserScript==
// @name        ShippingManager - Admin View
// @description Enable admin/moderator UI elements (client-side only - just for look and feel). HAS NO ADMIN FUNCTIONS IN BACKEND!
// @version     8.7
// @author      https://github.com/justonlyforyou/
// @order        50
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    const script = document.createElement('script');
    script.textContent = `
(function() {
    if (window.__ADMIN_VIEW_87__) return;
    window.__ADMIN_VIEW_87__ = true;

    var origParse = JSON.parse;
    JSON.parse = function(text) {
        var result = origParse.apply(this, arguments);
        if (result?.admin_login !== undefined) {
            result.admin_login = true;
        }
        if (result?.data?.admin_login !== undefined) {
            result.data.admin_login = true;
        }
        if (result?.data && 'forum_user' in result.data) {
            if (result.data.forum_user) {
                result.data.forum_user.role = 'admin';
            } else {
                result.data.forum_user = { role: 'admin', id: 1 };
            }
        }
        if (result?.forum_user) {
            result.forum_user.role = 'admin';
        }
        return result;
    };

    var originalFetch = window.fetch;
    window.fetch = async function(...args) {
        var url = args[0]?.url || args[0] || '';
        var response = await originalFetch.apply(this, args);
        if (typeof url === 'string' && url.includes('forum')) {
            var origJson = response.json.bind(response);
            response.json = async function() {
                var data = await origJson();
                if (data?.data?.forum_user) {
                    data.data.forum_user.role = 'admin';
                }
                return data;
            };
        }
        return response;
    };

    function getVueApp() {
        var appEl = document.querySelector('#app');
        return appEl?.__vue_app__;
    }

    function getPinia() {
        var app = getVueApp();
        if (!app) return null;
        return app._context?.provides?.pinia || app.config?.globalProperties?.$pinia;
    }

    function patchPiniaStores() {
        var pinia = getPinia();
        if (!pinia) return false;
        var userStore = pinia._s.get('user');
        if (userStore?.user) {
            userStore.user.is_admin = true;
        }
        return true;
    }

    function getAllComponentInstances(instance, results) {
        results = results || [];
        if (!instance) return results;
        results.push(instance);
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
            for (var i = 0; i < vnode.children.length; i++) {
                walkVnode(vnode.children[i], results);
            }
        }
        if (vnode.dynamicChildren) {
            for (var j = 0; j < vnode.dynamicChildren.length; j++) {
                walkVnode(vnode.dynamicChildren[j], results);
            }
        }
    }

    function findForumComponent() {
        var forumContainer = document.querySelector('.forumContainer');
        if (forumContainer) {
            var keys = Object.keys(forumContainer);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (key.startsWith('__vue')) {
                    var val = forumContainer[key];
                    if (val?.ctx && 'forumUser' in val.ctx) {
                        return val;
                    }
                    if (val?.component?.ctx && 'forumUser' in val.component.ctx) {
                        return val.component;
                    }
                }
            }
            var el = forumContainer;
            while (el && el !== document.body) {
                var elKeys = Object.keys(el);
                for (var j = 0; j < elKeys.length; j++) {
                    var k = elKeys[j];
                    if (k.startsWith('__vue') && el[k]?.ctx) {
                        if ('forumUser' in el[k].ctx) {
                            return el[k];
                        }
                    }
                }
                el = el.parentElement;
            }
        }
        var app = getVueApp();
        if (!app?._instance) return null;
        var allInstances = getAllComponentInstances(app._instance);
        for (var n = 0; n < allInstances.length; n++) {
            var instance = allInstances[n];
            var ctx = instance.ctx || instance.proxy;
            if (ctx && 'forumUser' in ctx) {
                return instance;
            }
            if (instance.data && 'forumUser' in instance.data) {
                return instance;
            }
        }
        return null;
    }

    function patchForumComponent() {
        var forumComp = findForumComponent();
        if (!forumComp) return false;
        var ctx = forumComp.ctx || forumComp.proxy;
        var data = forumComp.data;
        if (ctx?.forumUser) {
            ctx.forumUser.role = 'admin';
        }
        if (data?.forumUser) {
            data.forumUser.role = 'admin';
        }
        if (!ctx?.forumUser && !data?.forumUser) {
            if (ctx) {
                ctx.forumUser = { role: 'admin', id: 1 };
            }
        }
        if (forumComp.proxy?.$forceUpdate) {
            forumComp.proxy.$forceUpdate();
        }
        if (forumComp.update) {
            forumComp.update();
        }
        return true;
    }

    var observer = new MutationObserver(function(mutations) {
        for (var m = 0; m < mutations.length; m++) {
            var addedNodes = mutations[m].addedNodes;
            for (var n = 0; n < addedNodes.length; n++) {
                var node = addedNodes[n];
                if (node.nodeType !== 1) continue;
                var className = '';
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
                    setTimeout(patchForumComponent, 100);
                    setTimeout(patchForumComponent, 500);
                    setTimeout(patchForumComponent, 1500);
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.adminView = {
        patch: patchForumComponent,
        patchStores: patchPiniaStores,
        getApp: getVueApp,
        getPinia: getPinia
    };

    setTimeout(patchPiniaStores, 2000);
})();
`;
    document.head.appendChild(script);
})();
