// ==UserScript==
// @name        Shipping Manager - Export Messages
// @description Export all messenger conversations as CSV or JSON
// @version     1.12
// @author      https://github.com/justonlyforyou/
// @order       51
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==
/* globals File, Blob, URL */

(function() {
    'use strict';

    // RebelShip Menu Logo SVG
    const REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    // Get or create RebelShip menu
    function getOrCreateRebelShipMenu() {
        // Check if dropdown already exists (it's in document.body now)
        var existingDropdown = document.getElementById('rebelship-dropdown');
        if (existingDropdown) return existingDropdown;

        // Check if another script is creating the menu
        if (window._rebelshipMenuCreating) return null;
        window._rebelshipMenuCreating = true;

        // Double-check after lock
        existingDropdown = document.getElementById('rebelship-dropdown');
        if (existingDropdown) { window._rebelshipMenuCreating = false; return existingDropdown; }

        var messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) { window._rebelshipMenuCreating = false; return null; }

        var container = document.createElement('div');
        container.id = 'rebelship-menu';
        container.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:4px !important;z-index:999999;';

        var btn = document.createElement('button');
        btn.id = 'rebelship-menu-btn';
        btn.innerHTML = REBELSHIP_LOGO;
        btn.title = 'RebelShip Menu';

        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';

        var dropdown = document.createElement('div');
        dropdown.id = 'rebelship-dropdown';
        dropdown.className = 'rebelship-dropdown';
        dropdown.style.cssText = 'display:none;position:fixed;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

        container.appendChild(btn);
        document.body.appendChild(dropdown);

        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            } else {
                var rect = btn.getBoundingClientRect();
                dropdown.style.top = (rect.bottom + 4) + 'px';
                dropdown.style.right = (window.innerWidth - rect.right) + 'px';
                dropdown.style.display = 'block';
            }
        });

        document.addEventListener('click', function(e) {
            if (!container.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        if (messagingIcon.parentNode) {
            messagingIcon.parentNode.insertBefore(container, messagingIcon);
        }

        window._rebelshipMenuCreating = false;
        return dropdown;
    }

    // Add menu item with submenu support
    function addMenuItem(label, hasSubmenu, onClick, scriptOrder) {
        const dropdown = getOrCreateRebelShipMenu();
        if (!dropdown) {
            setTimeout(() => addMenuItem(label, hasSubmenu, onClick, scriptOrder), 1000);
            return null;
        }

        if (dropdown.querySelector(`[data-rebelship-item="${label}"]`)) {
            return dropdown.querySelector(`[data-rebelship-item="${label}"]`);
        }

        const item = document.createElement('div');
        item.dataset.rebelshipItem = label;
        item.dataset.order = scriptOrder;
        item.style.cssText = 'position:relative;';

        const itemBtn = document.createElement('div');
        itemBtn.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:13px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
        itemBtn.innerHTML = '<span>' + label + '</span>' + (hasSubmenu ? '<span style="font-size:14px;">&#9664;</span>' : '');

        itemBtn.addEventListener('mouseenter', () => itemBtn.style.background = '#374151');
        itemBtn.addEventListener('mouseleave', () => itemBtn.style.background = 'transparent');

        if (!hasSubmenu && onClick) {
            itemBtn.addEventListener('click', onClick);
        }

        item.appendChild(itemBtn);

        // Insert in sorted order by scriptOrder
        const items = dropdown.querySelectorAll('[data-rebelship-item]');
        let insertBefore = null;
        for (let i = 0; i < items.length; i++) {
            const existingOrder = parseInt(items[i].dataset.order, 10);
            if (scriptOrder < existingOrder) {
                insertBefore = items[i];
                break;
            }
        }
        if (insertBefore) {
            dropdown.insertBefore(item, insertBefore);
        } else {
            dropdown.appendChild(item);
        }

        return item;
    }

    // Fetch all chats
    async function fetchAllChats() {
        const response = await fetch('/api/messenger/get-chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({})
        });
        const data = await response.json();
        return data?.data || [];
    }

    // Fetch messages for a single chat
    async function fetchChatMessages(chatId) {
        const response = await fetch('/api/messenger/get-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ chat_id: chatId })
        });
        const data = await response.json();
        return data?.data?.chat?.messages || [];
    }

    // Fetch alliance chat feed
    async function fetchAllianceChat() {
        const response = await fetch('https://shippingmanager.cc/api/alliance/get-chat-feed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({})
        });
        const data = await response.json();
        return data?.data?.chat_feed || [];
    }

    // Format timestamp to readable date
    function formatDate(timestamp) {
        return new Date(timestamp * 1000).toISOString();
    }

    // Export all messages
    async function exportMessages(format) {
        const dropdown = document.getElementById('rebelship-dropdown');
        if (dropdown) dropdown.style.display = 'none';

        console.log('[ExportMessages] Starting export as', format);

        try {
            // Show progress
            const progressDiv = document.createElement('div');
            progressDiv.id = 'export-progress';
            progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1f2937;color:#fff;padding:20px 40px;border-radius:8px;z-index:999999;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
            progressDiv.innerHTML = 'Loading chats...';
            document.body.appendChild(progressDiv);

            // Fetch all chats
            const chats = await fetchAllChats();
            console.log('[ExportMessages] Found', chats.length, 'chats');

            const allMessages = [];
            let processed = 0;

            // Fetch messages for each chat
            for (const chat of chats) {
                if (chat.system_chat) continue; // Skip system chats

                processed++;
                progressDiv.innerHTML = `Loading messages... ${processed}/${chats.length}`;

                const messages = await fetchChatMessages(chat.id);

                for (const msg of messages) {
                    allMessages.push({
                        chat_id: chat.id,
                        participant: chat.participants_string || 'Unknown',
                        subject: chat.subject || '',
                        message_body: msg.body,
                        is_mine: msg.is_mine,
                        sender_id: msg.user_id,
                        created_at: formatDate(msg.created_at),
                        timestamp: msg.created_at
                    });
                }

                // Small delay to not hammer the API
                await new Promise(r => setTimeout(r, 100));
            }

            console.log('[ExportMessages] Total messages:', allMessages.length);

            // Sort by timestamp
            allMessages.sort((a, b) => a.timestamp - b.timestamp);

            let content, filename, mimeType;

            if (format === 'json') {
                content = JSON.stringify(allMessages, null, 2);
                filename = `messages_export_${new Date().toISOString().slice(0,10)}.json`;
                mimeType = 'application/json';
            } else {
                // CSV format
                const headers = ['chat_id', 'participant', 'subject', 'is_mine', 'sender_id', 'created_at', 'message_body'];
                const csvRows = [headers.join(',')];

                for (const msg of allMessages) {
                    const row = [
                        msg.chat_id,
                        `"${(msg.participant || '').replace(/"/g, '""')}"`,
                        `"${(msg.subject || '').replace(/"/g, '""')}"`,
                        msg.is_mine,
                        msg.sender_id,
                        msg.created_at,
                        `"${(msg.message_body || '').replace(/"/g, '""').replace(/\n/g, '\\n')}"`
                    ];
                    csvRows.push(row.join(','));
                }

                content = csvRows.join('\n');
                filename = `messages_export_${new Date().toISOString().slice(0,10)}.csv`;
                mimeType = 'text/csv';
            }

            // Download file - with Android fallback
            const isAndroid = /Android/i.test(navigator.userAgent);
            
            if (isAndroid && navigator.share) {
                // Use Web Share API on Android
                const file = new File([content], filename, { type: mimeType });
                navigator.share({ files: [file], title: filename }).then(() => {
                    progressDiv.innerHTML = `Exported ${allMessages.length} messages!`;
                }).catch(() => {
                    // Fallback: open in new tab
                    const dataUrl = 'data:' + mimeType + ';charset=utf-8,' + encodeURIComponent(content);
                    window.open(dataUrl, '_blank');
                    progressDiv.innerHTML = `Exported ${allMessages.length} messages. Long-press to save.`;
                });
            } else {
                // Standard blob download for desktop
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                progressDiv.innerHTML = `Exported ${allMessages.length} messages!`;
            }
            setTimeout(() => progressDiv.remove(), 2000);

        } catch (error) {
            console.error('[ExportMessages] Error:', error);
            const progressDiv = document.getElementById('export-progress');
            if (progressDiv) {
                progressDiv.innerHTML = 'Export failed: ' + error.message;
                setTimeout(() => progressDiv.remove(), 3000);
            }
        }
    }


    // Export alliance chat
    async function exportAllianceChat(format) {
        const dropdown = document.getElementById('rebelship-dropdown');
        if (dropdown) dropdown.style.display = 'none';

        console.log('[ExportMessages] Starting alliance chat export as', format);

        try {
            const progressDiv = document.createElement('div');
            progressDiv.id = 'export-progress';
            progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1f2937;color:#fff;padding:20px 40px;border-radius:8px;z-index:999999;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
            progressDiv.innerHTML = 'Loading alliance chat...';
            document.body.appendChild(progressDiv);

            const chatFeed = await fetchAllianceChat();
            console.log('[ExportMessages] Found', chatFeed.length, 'alliance messages');

            const allMessages = chatFeed
                .filter(msg => msg.type === 'chat')
                .map(msg => ({
                    user_id: msg.user_id,
                    message: msg.message,
                    created_at: formatDate(msg.time_created),
                    timestamp: msg.time_created
                }))
                .sort((a, b) => a.timestamp - b.timestamp);

            let content, filename, mimeType;

            if (format === 'json') {
                content = JSON.stringify(allMessages, null, 2);
                filename = `alliance_chat_${new Date().toISOString().slice(0,10)}.json`;
                mimeType = 'application/json';
            } else {
                const headers = ['user_id', 'created_at', 'message'];
                const csvRows = [headers.join(',')];

                for (const msg of allMessages) {
                    const row = [
                        msg.user_id,
                        msg.created_at,
                        `"${(msg.message || '').replace(/"/g, '""').replace(/\n/g, '\\n')}"`
                    ];
                    csvRows.push(row.join(','));
                }

                content = csvRows.join('\n');
                filename = `alliance_chat_${new Date().toISOString().slice(0,10)}.csv`;
                mimeType = 'text/csv';
            }

            // Download file - with Android fallback
            const isAndroid = /Android/i.test(navigator.userAgent);

            if (isAndroid && navigator.share) {
                const file = new File([content], filename, { type: mimeType });
                navigator.share({ files: [file], title: filename }).then(() => {
                    progressDiv.innerHTML = `Exported ${allMessages.length} alliance messages!`;
                }).catch(() => {
                    const dataUrl = 'data:' + mimeType + ';charset=utf-8,' + encodeURIComponent(content);
                    window.open(dataUrl, '_blank');
                    progressDiv.innerHTML = `Exported ${allMessages.length} messages. Long-press to save.`;
                });
            } else {
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                progressDiv.innerHTML = `Exported ${allMessages.length} alliance messages!`;
            }

            setTimeout(() => progressDiv.remove(), 2000);

        } catch (error) {
            console.error('[ExportMessages] Alliance export error:', error);
            const progressDiv = document.getElementById('export-progress');
            if (progressDiv) {
                progressDiv.innerHTML = 'Export failed: ' + error.message;
                setTimeout(() => progressDiv.remove(), 3000);
            }
        }
    }

    // Create Export Messages submenu
    function createExportMenu() {
        const menuItem = addMenuItem('Export Messages', true, null, 51);
        if (!menuItem) return;

        if (menuItem.querySelector('.export-submenu')) return;

        const submenu = document.createElement('div');
        submenu.className = 'export-submenu';
        submenu.style.cssText = 'display:none;position:absolute;left:0;top:0;transform:translateX(-100%);background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:200px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

        const options = [
            { label: 'Messages CSV', format: 'csv', fn: exportMessages },
            { label: 'Messages JSON', format: 'json', fn: exportMessages },
            { label: 'Alliance Chat CSV', format: 'csv', fn: exportAllianceChat },
            { label: 'Alliance Chat JSON', format: 'json', fn: exportAllianceChat }
        ];

        options.forEach(opt => {
            const optItem = document.createElement('div');
            optItem.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:13px;border-bottom:1px solid #374151;';
            optItem.textContent = opt.label;
            optItem.addEventListener('mouseenter', () => optItem.style.background = '#374151');
            optItem.addEventListener('mouseleave', () => optItem.style.background = 'transparent');
            optItem.addEventListener('click', () => opt.fn(opt.format));
            submenu.appendChild(optItem);
        });

        menuItem.appendChild(submenu);

        menuItem.addEventListener('mouseenter', () => submenu.style.display = 'block');
        menuItem.addEventListener('mouseleave', () => submenu.style.display = 'none');

        console.log('[ExportMessages] Menu item added');
    }

    // Initialize
    function init() {
        createExportMenu();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
    } else {
        setTimeout(init, 2000);
    }
})();
