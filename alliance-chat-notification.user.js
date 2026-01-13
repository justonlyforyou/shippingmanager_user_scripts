// ==UserScript==
// @name        Shipping Manager - Alliance Chat Notification
// @description Shows a red dot on Alliance button when there are unread messages
// @version     2.6
// @author      https://github.com/justonlyforyou/
// @order       18
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    var STORAGE_KEY = 'rebelship_alliance_chat_last_read';
    var CHECK_INTERVAL = 30000; // Check every 30 seconds
    var MARK_READ_DELAY = 3000; // 3 seconds before marking as read
    var lastReadTimestamp = 0;
    var newestMessageTimestamp = 0;
    var markReadTimeout = null;
    var hasUnread = false;
    var isChatTabActive = false;

    // Load last read timestamp from localStorage
    function loadLastRead() {
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                lastReadTimestamp = parseInt(stored, 10);
                console.log('[AllianceChatNotify] Loaded last read:', new Date(lastReadTimestamp * 1000).toLocaleString());
            }
        } catch (e) {
            console.error('[AllianceChatNotify] Failed to load last read:', e);
        }
    }

    // Save last read timestamp to localStorage
    function saveLastRead(timestamp) {
        try {
            lastReadTimestamp = timestamp;
            localStorage.setItem(STORAGE_KEY, timestamp.toString());
            console.log('[AllianceChatNotify] Marked as read at:', new Date(timestamp * 1000).toLocaleString());
            hasUnread = false;
            updateNotificationDots();
        } catch (e) {
            console.error('[AllianceChatNotify] Failed to save last read:', e);
        }
    }

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

    var cachedAllianceId = null;

    // Fetch alliance ID from API
    async function fetchAllianceId() {
        if (cachedAllianceId) return cachedAllianceId;

        try {
            var response = await fetch('/api/alliance/get-user-alliance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({})
            });

            var data = await response.json();

            if (data && data.data && data.data.alliance && data.data.alliance.id) {
                cachedAllianceId = data.data.alliance.id;
                console.log('[AllianceChatNotify] Fetched alliance ID:', cachedAllianceId);
                return cachedAllianceId;
            }

            console.log('[AllianceChatNotify] No alliance found in API response');
            return null;
        } catch (e) {
            console.error('[AllianceChatNotify] Failed to fetch alliance ID:', e);
            return null;
        }
    }

    // Fetch latest chat messages and check for unread
    async function checkForUnreadMessages() {
        var allianceId = await fetchAllianceId();
        if (!allianceId) {
            console.log('[AllianceChatNotify] No alliance ID - user may not be in an alliance');
            return;
        }

        try {
            var response = await fetch('/api/alliance/get-chat-feed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ alliance_id: allianceId })
            });

            var data = await response.json();

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

        } catch (e) {
            console.error('[AllianceChatNotify] Failed to check messages:', e);
        }
    }

    // Mark messages as read after delay
    function scheduleMarkAsRead() {
        if (markReadTimeout) {
            clearTimeout(markReadTimeout);
        }

        console.log('[AllianceChatNotify] Scheduling mark as read in 3 seconds...');

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
            console.log('[AllianceChatNotify] Cancelled mark as read');
        }
    }

    // Monitor Chat tab clicks and state
    function setupChatTabMonitor() {
        // Use event delegation on document
        document.addEventListener('click', function(e) {
            var target = e.target;

            // Check if clicked on chat tab or its children
            var chatTab = findChatTab();
            if (chatTab && (chatTab === target || chatTab.contains(target))) {
                console.log('[AllianceChatNotify] Chat tab clicked!');
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
                console.log('[AllianceChatNotify] Modal closed');
            }

            lastModalVisible = isModalVisible;

            // Update dots when modal opens (chat tab might appear)
            if (isModalVisible) {
                updateNotificationDots();
            }
        }, 500);
    }

    // Initialize
    function init() {
        loadLastRead();

        // Setup monitors
        setupChatTabMonitor();
        monitorModalState();

        // Initial check
        checkForUnreadMessages();

        // Periodic check for new messages
        setInterval(checkForUnreadMessages, CHECK_INTERVAL);

        // Periodic dot update (in case elements are added dynamically)
        setInterval(updateNotificationDots, 1000);

        console.log('[AllianceChatNotify] Script loaded v1.1');
    }

    // Wait for page to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 2000); });
    } else {
        setTimeout(init, 2000);
    }
})();
