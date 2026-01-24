// ==UserScript==
// @name        ShippingManager - Alliance Chat Notification
// @description Shows a red dot on Alliance button when there are unread messages
// @version     2.14
// @author      https://github.com/justonlyforyou/
// @order       2
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @grant       none
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    var SCRIPT_NAME = 'AllianceChatNotify';
    var STORE_NAME = 'data';

    var CHECK_INTERVAL = 30000; // Check every 30 seconds
    var MARK_READ_DELAY = 3000; // 3 seconds before marking as read
    var lastReadTimestamp = 0;
    var newestMessageTimestamp = 0;
    var markReadTimeout = null;
    var hasUnread = false;
    var isChatTabActive = false;

    // ============================================
    // RebelShipBridge Storage Functions
    // ============================================

    async function dbGet(key) {
        try {
            var result = await window.RebelShipBridge.storage.get(SCRIPT_NAME, STORE_NAME, key);
            if (result) {
                return JSON.parse(result);
            }
            return null;
        } catch (e) {
            console.error('[AllianceChatNotify] dbGet error:', e);
            return null;
        }
    }

    async function dbSet(key, value) {
        try {
            await window.RebelShipBridge.storage.set(SCRIPT_NAME, STORE_NAME, key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.error('[AllianceChatNotify] dbSet error:', e);
            return false;
        }
    }

    // ============================================
    // Load/Save Functions
    // ============================================

    // Load last read timestamp
    async function loadLastRead() {
        try {
            var stored = await dbGet('lastRead');
            if (stored) {
                lastReadTimestamp = stored;
            }
        } catch (e) {
            console.error('[AllianceChatNotify] Failed to load last read:', e);
        }
    }

    // Save last read timestamp
    async function saveLastRead(timestamp) {
        lastReadTimestamp = timestamp;
        hasUnread = false;
        updateNotificationDots();

        try {
            await dbSet('lastRead', timestamp);
            console.log('[AllianceChatNotify] Saved last read timestamp');
        } catch (e) {
            console.error('[AllianceChatNotify] Failed to save last read:', e);
        }
    }

    // ============================================
    // Notification Dot Functions
    // ============================================

    // Create notification dot on an element
    function createDot(parent, id) {
        if (!parent) return null;

        var existing = document.getElementById(id);
        if (existing) {
            existing.remove();
        }

        // Make sure parent has relative positioning
        var computedStyle = window.getComputedStyle(parent);
        if (computedStyle.position === 'static') {
            parent.style.position = 'relative';
        }

        var dot = document.createElement('div');
        dot.id = id;
        dot.style.cssText = 'position:absolute !important;top:2px !important;right:5px !important;width:10px !important;height:10px !important;background:#ef4444 !important;border-radius:50% !important;display:none;box-shadow:0 0 6px rgba(239,68,68,0.8) !important;z-index:100 !important;pointer-events:none !important;';

        parent.appendChild(dot);
        return dot;
    }

    // Update all notification dots based on hasUnread state
    function updateNotificationDots() {
        // Alliance button dot - wrap the img in a relative container
        var allianceBtn = document.getElementById('alliance-modal-btn');
        if (allianceBtn) {
            // Remove any old dot that might be in the wrong place
            var oldDot = document.getElementById('alliance-btn-notify-dot');
            if (oldDot) {
                oldDot.remove();
            }

            // Check if we already wrapped it
            var wrapper = document.getElementById('alliance-btn-wrapper');
            if (!wrapper) {
                // Create wrapper around the image
                wrapper = document.createElement('span');
                wrapper.id = 'alliance-btn-wrapper';
                wrapper.style.cssText = 'position:relative !important;display:inline-block !important;';
                allianceBtn.parentNode.insertBefore(wrapper, allianceBtn);
                wrapper.appendChild(allianceBtn);
            }

            // Create dot fresh each time to ensure correct positioning
            var dot = document.createElement('div');
            dot.id = 'alliance-btn-notify-dot';
            dot.style.cssText = 'position:absolute !important;top:5px !important;right:5px !important;width:10px !important;height:10px !important;background:#ef4444 !important;border-radius:50% !important;box-shadow:0 0 6px rgba(239,68,68,0.8) !important;z-index:100 !important;pointer-events:none !important;';
            dot.style.display = hasUnread ? 'block' : 'none';
            wrapper.appendChild(dot);
        }

        // Chat tab dot (inside alliance modal)
        var chatTab = findChatTab();
        if (chatTab) {
            var tabDot = createDot(chatTab, 'alliance-chat-tab-notify-dot');
            if (tabDot) {
                tabDot.style.display = hasUnread ? 'block' : 'none';
            }
        }
    }

    // Find the Chat tab in the alliance modal (3rd tab, index 2)
    function findChatTab() {
        var topNav = document.querySelector('#top-nav');
        if (!topNav) return null;
        var tabs = topNav.querySelectorAll('.tab.flex-centered');
        // Chat is always the 3rd tab (index 2): Overview, Co-op, Chat, Settings
        if (tabs.length >= 3) {
            return tabs[2];
        }
        return null;
    }

    // ============================================
    // API Functions
    // ============================================

    var cachedAllianceId = null;

    // Fetch alliance ID from API with retry
    function fetchAllianceId(maxRetries) {
        if (cachedAllianceId) return Promise.resolve(cachedAllianceId);

        maxRetries = maxRetries ?? 3;

        function attempt(attemptNum) {
            return fetch('/api/alliance/get-user-alliance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            }).then(function(response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.json();
            }).then(function(data) {
                if (data && data.data && data.data.alliance && data.data.alliance.id) {
                    cachedAllianceId = data.data.alliance.id;
                    return cachedAllianceId;
                }
                console.log('[AllianceChatNotify] No alliance found in API response');
                return null;
            }).catch(function(e) {
                console.log('[AllianceChatNotify] fetchAllianceId attempt ' + attemptNum + '/' + maxRetries + ' failed:', e.message);
                if (attemptNum < maxRetries) {
                    var delay = attemptNum * 1000;
                    return new Promise(function(r) { setTimeout(r, delay); }).then(function() {
                        return attempt(attemptNum + 1);
                    });
                }
                console.error('[AllianceChatNotify] Failed to fetch alliance ID after retries');
                return null;
            });
        }

        return attempt(1);
    }

    // Fetch latest chat messages and check for unread with retry
    function checkForUnreadMessages(maxRetries) {
        return fetchAllianceId().then(function(allianceId) {
            if (!allianceId) {
                console.log('[AllianceChatNotify] No alliance ID - user may not be in an alliance');
                return;
            }

            maxRetries = maxRetries ?? 3;

            function attempt(attemptNum) {
                return fetch('/api/alliance/get-chat-feed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ alliance_id: allianceId })
                }).then(function(response) {
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }
                    return response.json();
                }).then(function(data) {
                    // API returns data.chat_feed not data.messages
                    if (!data || !data.data || !data.data.chat_feed) {
                        console.log('[AllianceChatNotify] No chat_feed data');
                        return;
                    }

                    var chatFeed = data.data.chat_feed;
                    if (chatFeed.length === 0) {
                        hasUnread = false;
                        updateNotificationDots();
                        return;
                    }

                    // Find the newest message timestamp (only type: "chat", not "feed")
                    newestMessageTimestamp = 0;
                    chatFeed.forEach(function(msg) {
                        // Only count actual chat messages, not feed items like "member_left"
                        if (msg.type === 'chat') {
                            var msgTime = msg.time_created || 0;
                            if (msgTime > newestMessageTimestamp) {
                                newestMessageTimestamp = msgTime;
                            }
                        }
                    });

                    // Check if there are unread messages
                    var wasUnread = hasUnread;
                    if (newestMessageTimestamp > lastReadTimestamp) {
                        hasUnread = true;
                        if (!wasUnread) {
                            console.log('[AllianceChatNotify] Unread messages detected! Newest:', newestMessageTimestamp, 'Last read:', lastReadTimestamp);
                        }
                    } else {
                        hasUnread = false;
                    }

                    updateNotificationDots();
                }).catch(function(e) {
                    console.log('[AllianceChatNotify] checkForUnreadMessages attempt ' + attemptNum + '/' + maxRetries + ' failed:', e.message);
                    if (attemptNum < maxRetries) {
                        var delay = attemptNum * 1000;
                        return new Promise(function(r) { setTimeout(r, delay); }).then(function() {
                            return attempt(attemptNum + 1);
                        });
                    }
                    console.error('[AllianceChatNotify] Failed to check messages after retries');
                });
            }

            return attempt(1);
        });
    }

    // ============================================
    // Mark As Read Functions
    // ============================================

    // Mark messages as read after delay
    function scheduleMarkAsRead() {
        if (markReadTimeout) {
            clearTimeout(markReadTimeout);
        }

        markReadTimeout = setTimeout(function() {
            if (isChatTabActive && newestMessageTimestamp > 0) {
                saveLastRead(newestMessageTimestamp);
            }
        }, MARK_READ_DELAY);
    }

    // Cancel mark as read
    function cancelMarkAsRead() {
        if (markReadTimeout) {
            clearTimeout(markReadTimeout);
            markReadTimeout = null;
        }
    }

    // ============================================
    // Event Monitoring
    // ============================================

    // Monitor Chat tab clicks and state
    function setupChatTabMonitor() {
        // Use event delegation on document
        document.addEventListener('click', function(e) {
            var target = e.target;

            // Check if clicked on chat tab or its children
            var chatTab = findChatTab();
            if (chatTab && (chatTab === target || chatTab.contains(target))) {
                isChatTabActive = true;
                scheduleMarkAsRead();
            } else if (target.closest('.tab.flex-centered')) {
                // Clicked on another tab (not chat tab)
                var clickedTab = target.closest('.tab.flex-centered');
                if (clickedTab !== chatTab) {
                    isChatTabActive = false;
                    cancelMarkAsRead();
                }
            }
        });
    }

    // Monitor for modal close
    function monitorModalState() {
        var lastModalVisible = false;

        setInterval(function() {
            var modalWrapper = document.getElementById('modal-wrapper');
            var isModalVisible = modalWrapper && modalWrapper.offsetParent !== null;

            if (!isModalVisible && lastModalVisible) {
                // Modal just closed
                isChatTabActive = false;
                cancelMarkAsRead();
            }

            lastModalVisible = isModalVisible;

            // Update dots when modal opens (chat tab might appear)
            if (isModalVisible) {
                updateNotificationDots();
            }
        }, 500);
    }

    // ============================================
    // Initialization
    // ============================================

    async function init() {
        await loadLastRead();

        // Setup monitors
        setupChatTabMonitor();
        monitorModalState();

        // Initial check
        checkForUnreadMessages();

        // Periodic check for new messages
        setInterval(checkForUnreadMessages, CHECK_INTERVAL);

        // Periodic dot update (in case elements are added dynamically)
        setInterval(updateNotificationDots, 1000);

        console.log('[AllianceChatNotify] Script loaded');
    }

    // Wait for page to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 500); });
    } else {
        setTimeout(init, 500);
    }
})();
