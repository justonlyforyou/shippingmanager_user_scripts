// ==UserScript==
// @name        ShippingManager - Export your messages
// @description Export all DM's as CSV or JSON
// @version     1.25
// @author      https://github.com/justonlyforyou/
// @order        11
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// @RequireRebelShipMenu true
// ==/UserScript==
/* globals File, Blob, URL, addSubMenu */

(function() {
    'use strict';

    // Fetch all chats with retry
    function fetchAllChats(maxRetries) {
        maxRetries = maxRetries ?? 3;

        function attempt(attemptNum) {
            return fetch('/api/messenger/get-chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            })
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function(data) {
                return data && data.data ? data.data : [];
            })
            .catch(function(e) {
                console.log('[ExportMessages] fetchAllChats attempt ' + attemptNum + '/' + maxRetries + ' failed:', e.message);
                if (attemptNum < maxRetries) {
                    var delay = attemptNum * 1000;
                    return new Promise(function(resolve) { setTimeout(resolve, delay); }).then(function() {
                        return attempt(attemptNum + 1);
                    });
                }
                throw e;
            });
        }

        return attempt(1);
    }

    // Fetch messages for a single chat with retry
    function fetchChatMessages(chatId, maxRetries) {
        maxRetries = maxRetries ?? 3;

        function attempt(attemptNum) {
            return fetch('/api/messenger/get-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ chat_id: chatId })
            })
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function(data) {
                return data && data.data && data.data.chat && data.data.chat.messages ? data.data.chat.messages : [];
            })
            .catch(function(e) {
                console.log('[ExportMessages] fetchChatMessages attempt ' + attemptNum + '/' + maxRetries + ' failed:', e.message);
                if (attemptNum < maxRetries) {
                    var delay = attemptNum * 1000;
                    return new Promise(function(resolve) { setTimeout(resolve, delay); }).then(function() {
                        return attempt(attemptNum + 1);
                    });
                }
                throw e;
            });
        }

        return attempt(1);
    }

    // Fetch alliance chat feed with retry
    function fetchAllianceChat(maxRetries) {
        maxRetries = maxRetries ?? 3;

        function attempt(attemptNum) {
            return fetch('https://shippingmanager.cc/api/alliance/get-chat-feed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            })
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function(data) {
                return data && data.data && data.data.chat_feed ? data.data.chat_feed : [];
            })
            .catch(function(e) {
                console.log('[ExportMessages] fetchAllianceChat attempt ' + attemptNum + '/' + maxRetries + ' failed:', e.message);
                if (attemptNum < maxRetries) {
                    var delay = attemptNum * 1000;
                    return new Promise(function(resolve) { setTimeout(resolve, delay); }).then(function() {
                        return attempt(attemptNum + 1);
                    });
                }
                throw e;
            });
        }

        return attempt(1);
    }

    // Format timestamp to readable date
    function formatDate(timestamp) {
        return new Date(timestamp * 1000).toISOString();
    }

    // Download file helper
    function downloadFile(content, filename, mimeType, messageCount, progressDiv) {
        var isAndroid = /Android/i.test(navigator.userAgent);

        if (isAndroid && navigator.share) {
            var file = new File([content], filename, { type: mimeType });
            navigator.share({ files: [file], title: filename }).then(function() {
                progressDiv.innerHTML = 'Exported ' + messageCount + ' messages!';
            }).catch(function() {
                var dataUrl = 'data:' + mimeType + ';charset=utf-8,' + encodeURIComponent(content);
                window.open(dataUrl, '_blank');
                progressDiv.innerHTML = 'Exported ' + messageCount + ' messages. Long-press to save.';
            });
        } else {
            var blob = new Blob([content], { type: mimeType });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            progressDiv.innerHTML = 'Exported ' + messageCount + ' messages!';
        }
        setTimeout(function() { progressDiv.remove(); }, 2000);
    }

    // Export all messages
    function exportMessages(format) {
        var dropdown = document.getElementById('rebelship-dropdown');
        if (dropdown) dropdown.style.display = 'none';

        var progressDiv = document.createElement('div');
        progressDiv.id = 'export-progress';
        progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1f2937;color:#fff;padding:20px 40px;border-radius:8px;z-index:999999;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
        progressDiv.innerHTML = 'Loading chats...';
        document.body.appendChild(progressDiv);

        fetchAllChats()
            .then(function(chats) {
                var allMessages = [];
                var processed = 0;
                var filteredChats = chats.filter(function(chat) { return !chat.system_chat; });

                function processNext() {
                    if (processed >= filteredChats.length) {
                        return Promise.resolve(allMessages);
                    }

                    var chat = filteredChats[processed];
                    processed++;
                    progressDiv.innerHTML = 'Loading messages... ' + processed + '/' + filteredChats.length;

                    return fetchChatMessages(chat.id)
                        .then(function(messages) {
                            messages.forEach(function(msg) {
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
                            });
                            return new Promise(function(r) { setTimeout(r, 100); });
                        })
                        .then(processNext);
                }

                return processNext();
            })
            .then(function(allMessages) {
                allMessages.sort(function(a, b) { return a.timestamp - b.timestamp; });

                var content, filename, mimeType;

                if (format === 'json') {
                    content = JSON.stringify(allMessages, null, 2);
                    filename = 'messages_export_' + new Date().toISOString().slice(0, 10) + '.json';
                    mimeType = 'application/json';
                } else {
                    var headers = ['chat_id', 'participant', 'subject', 'is_mine', 'sender_id', 'created_at', 'message_body'];
                    var csvRows = [headers.join(',')];

                    allMessages.forEach(function(msg) {
                        var row = [
                            msg.chat_id,
                            '"' + (msg.participant || '').replace(/"/g, '""') + '"',
                            '"' + (msg.subject || '').replace(/"/g, '""') + '"',
                            msg.is_mine,
                            msg.sender_id,
                            msg.created_at,
                            '"' + (msg.message_body || '').replace(/"/g, '""').replace(/\n/g, '\\n') + '"'
                        ];
                        csvRows.push(row.join(','));
                    });

                    content = csvRows.join('\n');
                    filename = 'messages_export_' + new Date().toISOString().slice(0, 10) + '.csv';
                    mimeType = 'text/csv';
                }

                downloadFile(content, filename, mimeType, allMessages.length, progressDiv);
            })
            .catch(function(error) {
                console.error('[ExportMessages] Error:', error);
                progressDiv.innerHTML = 'Export failed: ' + error.message;
                setTimeout(function() { progressDiv.remove(); }, 3000);
            });
    }

    // Export alliance chat
    function exportAllianceChat(format) {
        var dropdown = document.getElementById('rebelship-dropdown');
        if (dropdown) dropdown.style.display = 'none';

        var progressDiv = document.createElement('div');
        progressDiv.id = 'export-progress';
        progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1f2937;color:#fff;padding:20px 40px;border-radius:8px;z-index:999999;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
        progressDiv.innerHTML = 'Loading alliance chat...';
        document.body.appendChild(progressDiv);

        fetchAllianceChat()
            .then(function(chatFeed) {
                var allMessages = chatFeed
                    .filter(function(msg) { return msg.type === 'chat'; })
                    .map(function(msg) {
                        return {
                            user_id: msg.user_id,
                            message: msg.message,
                            created_at: formatDate(msg.time_created),
                            timestamp: msg.time_created
                        };
                    })
                    .sort(function(a, b) { return a.timestamp - b.timestamp; });

                var content, filename, mimeType;

                if (format === 'json') {
                    content = JSON.stringify(allMessages, null, 2);
                    filename = 'alliance_chat_' + new Date().toISOString().slice(0, 10) + '.json';
                    mimeType = 'application/json';
                } else {
                    var headers = ['user_id', 'created_at', 'message'];
                    var csvRows = [headers.join(',')];

                    allMessages.forEach(function(msg) {
                        var row = [
                            msg.user_id,
                            msg.created_at,
                            '"' + (msg.message || '').replace(/"/g, '""').replace(/\n/g, '\\n') + '"'
                        ];
                        csvRows.push(row.join(','));
                    });

                    content = csvRows.join('\n');
                    filename = 'alliance_chat_' + new Date().toISOString().slice(0, 10) + '.csv';
                    mimeType = 'text/csv';
                }

                downloadFile(content, filename, mimeType, allMessages.length, progressDiv);
            })
            .catch(function(error) {
                console.error('[ExportMessages] Alliance export error:', error);
                progressDiv.innerHTML = 'Export failed: ' + error.message;
                setTimeout(function() { progressDiv.remove(); }, 3000);
            });
    }

    // Register submenu
    function createExportMenu() {
        var subItems = [
            { label: 'Messages CSV', onClick: function() { exportMessages('csv'); } },
            { label: 'Messages JSON', onClick: function() { exportMessages('json'); } },
            { label: 'Alliance Chat CSV', onClick: function() { exportAllianceChat('csv'); } },
            { label: 'Alliance Chat JSON', onClick: function() { exportAllianceChat('json'); } }
        ];
        addSubMenu('Export Messages', subItems, 996);
        console.log('[ExportMessages] Submenu registered');
    }

    // Initialize
    function init() {
        createExportMenu();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
