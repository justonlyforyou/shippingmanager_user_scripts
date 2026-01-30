// ==UserScript==
// @name         ShippingManager - ChatBot
// @namespace    http://tampermonkey.net/
// @description  Automated chatbot for alliance chat and DMs with command system
// @version      2.16
// @order        60
// @author       RebelShip
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @RequireRebelShipMenu true
// @background-job-required true
// @enabled      false
// ==/UserScript==
/* globals addMenuItem */

(function() {
    'use strict';

    var SCRIPT_NAME = 'ChatBot';
    var STORE_NAME = 'data';
    var LOG_PREFIX = '[ChatBot]';

    // Polling intervals
    var POLL_INTERVAL_MS = 10000; // 10 seconds

    // Rate limits
    var DM_COOLDOWN_MS = 45000; // 45 seconds between DMs
    var ALLIANCE_COOLDOWN_MS = 30000; // 30 seconds between alliance messages
    var COMMAND_DELAY_MS = 5000; // 5 seconds before responding to command
    var MAX_MESSAGE_LENGTH = 1000;

    // State
    var enabled = false;
    var bridgeReady = false;
    var pollInterval = null;
    var lastDmSendTime = 0;
    var lastAllianceSendTime = 0;
    var processedDmIds = new Set();
    var processedAllianceIds = new Set();
    var commandQueue = [];
    var isProcessingQueue = false;
    var settings = null;
    var cachedAllianceMembers = null;
    var cachedAllianceMembersTime = 0;
    var isModalOpen = false;
    var modalListenerAttached = false;
    var chatUserIdCache = {}; // chat_id -> user_id mapping
    var cachedAllianceId = null;

    // Command registry - other scripts can register commands
    var registeredCommands = {};

    // Default settings
    var DEFAULT_SETTINGS = {
        enabled: false,
        commandPrefix: '!',
        notifyIngame: true,
        notifySystem: false,
        commands: {
            help: { enabled: true, minRole: 'all', dmEnabled: true, allianceEnabled: true }
        },
        registeredCommandSettings: {},
        customCommands: []
    };

    // ============================================
    // Logging
    // ============================================

    function log(msg, level) {
        level = level || 'log';
        var fn = console[level] || console.log;
        fn(LOG_PREFIX + ' ' + msg);
    }

    // ============================================
    // Storage Functions
    // ============================================

    async function dbGet(key) {
        if (!window.RebelShipBridge) return null;
        try {
            var result = await window.RebelShipBridge.storage.get(SCRIPT_NAME, STORE_NAME, key);
            if (result) return JSON.parse(result);
            return null;
        } catch (e) {
            log('dbGet error: ' + e, 'error');
            return null;
        }
    }

    async function dbSet(key, value) {
        if (!window.RebelShipBridge) return false;
        try {
            await window.RebelShipBridge.storage.set(SCRIPT_NAME, STORE_NAME, key, JSON.stringify(value));
            return true;
        } catch (e) {
            log('dbSet error: ' + e, 'error');
            return false;
        }
    }

    async function loadSettings() {
        var stored = await dbGet('settings');
        if (stored) {
            settings = Object.assign({}, DEFAULT_SETTINGS, stored);
            if (!settings.commands) settings.commands = DEFAULT_SETTINGS.commands;
            if (!settings.registeredCommandSettings) settings.registeredCommandSettings = {};
            if (!settings.customCommands) settings.customCommands = [];
        } else {
            settings = Object.assign({}, DEFAULT_SETTINGS);
        }
        enabled = settings.enabled;
        log('Settings loaded, enabled: ' + enabled);
    }

    async function saveSettings() {
        settings.enabled = enabled;
        await dbSet('settings', settings);
        log('Settings saved');
    }

    async function loadProcessedIds() {
        var dmIds = await dbGet('processedDmIds');
        if (dmIds && Array.isArray(dmIds)) processedDmIds = new Set(dmIds);
        var allianceIds = await dbGet('processedAllianceIds');
        if (allianceIds && Array.isArray(allianceIds)) processedAllianceIds = new Set(allianceIds);
        var userIdCache = await dbGet('chatUserIdCache');
        if (userIdCache && typeof userIdCache === 'object') chatUserIdCache = userIdCache;
    }

    async function saveProcessedIds() {
        var dmArray = Array.from(processedDmIds).slice(-500);
        var allianceArray = Array.from(processedAllianceIds).slice(-500);
        processedDmIds = new Set(dmArray);
        processedAllianceIds = new Set(allianceArray);
        await dbSet('processedDmIds', dmArray);
        await dbSet('processedAllianceIds', allianceArray);
        await dbSet('chatUserIdCache', chatUserIdCache);
    }

    // ============================================
    // Pinia Store Access
    // ============================================

    function getPinia() {
        var appEl = document.querySelector('#app');
        if (!appEl || !appEl.__vue_app__) return null;
        var app = appEl.__vue_app__;
        return app._context.provides.pinia || app.config.globalProperties.$pinia;
    }

    function getStore(name) {
        var pinia = getPinia();
        if (!pinia || !pinia._s) return null;
        return pinia._s.get(name);
    }

    function getUserId() {
        var userStore = getStore('user');
        if (userStore && userStore.user) return userStore.user.id;
        return null;
    }

    async function getAllianceId() {
        if (cachedAllianceId) return cachedAllianceId;
        try {
            var response = await apiCall('/alliance/get-user-alliance', 'POST', {});
            if (response && response.data && response.data.alliance && response.data.alliance.id) {
                cachedAllianceId = response.data.alliance.id;
                log('Fetched alliance ID: ' + cachedAllianceId);
                return cachedAllianceId;
            }
        } catch (e) {
            log('Failed to fetch alliance ID: ' + e, 'error');
        }
        return null;
    }

    function getModalStore() {
        try {
            var pinia = getPinia();
            if (pinia && pinia._s) return pinia._s.get('modal');
        } catch {
            log('Failed to get modalStore', 'error');
        }
        return null;
    }

    function getToastStore() {
        try {
            var pinia = getPinia();
            if (pinia && pinia._s) return pinia._s.get('toast');
        } catch {
            log('Failed to get toastStore', 'error');
        }
        return null;
    }

    // ============================================
    // API Functions
    // ============================================

    async function apiCall(endpoint, method, body) {
        var url = 'https://shippingmanager.cc/api' + endpoint;
        var options = {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        };
        if (body) options.body = JSON.stringify(body);
        var response = await fetch(url, options);
        if (!response.ok) throw new Error('API error: ' + response.status);
        return response.json();
    }

    async function fetchDmChats() {
        try {
            var response = await apiCall('/messenger/get-chats', 'POST', {});
            return response.data || [];
        } catch (e) {
            log('Failed to fetch DM chats: ' + e, 'error');
            return [];
        }
    }

    async function fetchChatDetails(chatId) {
        try {
            var response = await apiCall('/messenger/get-chat', 'POST', { chat_id: chatId });
            if (response.data && response.data.chat) {
                return response.data.chat;
            }
            return null;
        } catch (e) {
            log('Failed to fetch chat details: ' + e, 'error');
            return null;
        }
    }

    async function getUserIdForChat(chatId) {
        // Return from cache if available
        if (chatUserIdCache[chatId]) {
            return chatUserIdCache[chatId];
        }
        // Fetch chat details to get sender user_id (only once per chat)
        var chat = await fetchChatDetails(chatId);
        if (chat && chat.messages && chat.messages.length > 0) {
            var myUserId = getUserId();
            // Find the other participant's user_id
            for (var i = 0; i < chat.messages.length; i++) {
                var msg = chat.messages[i];
                if (msg.user_id && msg.user_id !== myUserId) {
                    chatUserIdCache[chatId] = msg.user_id;
                    log('Cached user_id ' + msg.user_id + ' for chat ' + chatId);
                    return msg.user_id;
                }
            }
        }
        return null;
    }

    async function fetchAllianceChatFeed() {
        var allianceId = await getAllianceId();
        if (!allianceId) return [];
        try {
            var response = await apiCall('/alliance/get-chat-feed', 'POST', {
                alliance_id: allianceId,
                offset: 0,
                limit: 5
            });
            if (response.data && response.data.chat_feed) {
                return response.data.chat_feed;
            }
            return [];
        } catch (e) {
            log('Failed to fetch alliance chat: ' + e, 'error');
            return [];
        }
    }

    async function sendDm(userId, subject, message) {
        var now = Date.now();
        var timeSinceLastDm = now - lastDmSendTime;
        if (timeSinceLastDm < DM_COOLDOWN_MS) {
            var waitTime = DM_COOLDOWN_MS - timeSinceLastDm;
            log('DM rate limit, waiting ' + Math.ceil(waitTime / 1000) + 's');
            await new Promise(function(resolve) { setTimeout(resolve, waitTime); });
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            message = message.substring(0, MAX_MESSAGE_LENGTH - 3) + '...';
        }
        try {
            var response = await apiCall('/messenger/send-message', 'POST', {
                recipient: userId, subject: subject, body: message
            });
            lastDmSendTime = Date.now();
            if (response.error) {
                log('DM send error: ' + response.error, 'error');
                return false;
            }
            log('DM sent to user ' + userId);
            return true;
        } catch (e) {
            log('Failed to send DM: ' + e, 'error');
            return false;
        }
    }

    async function sendAllianceMessage(message) {
        var allianceId = await getAllianceId();
        if (!allianceId) {
            log('No alliance ID', 'error');
            return false;
        }
        var now = Date.now();
        var timeSinceLast = now - lastAllianceSendTime;
        if (timeSinceLast < ALLIANCE_COOLDOWN_MS) {
            var waitTime = ALLIANCE_COOLDOWN_MS - timeSinceLast;
            log('Alliance rate limit, waiting ' + Math.ceil(waitTime / 1000) + 's');
            await new Promise(function(resolve) { setTimeout(resolve, waitTime); });
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            message = message.substring(0, MAX_MESSAGE_LENGTH - 3) + '...';
        }
        try {
            var response = await apiCall('/alliance/post-chat', 'POST', {
                alliance_id: allianceId, text: message
            });
            lastAllianceSendTime = Date.now();
            if (response.error) {
                log('Alliance send error: ' + response.error, 'error');
                return false;
            }
            log('Alliance message sent');
            return true;
        } catch (e) {
            log('Failed to send alliance message: ' + e, 'error');
            return false;
        }
    }

    // ============================================
    // Role Checking
    // ============================================

    async function getAllianceMembers() {
        var now = Date.now();
        if (cachedAllianceMembers && (now - cachedAllianceMembersTime) < 60000) {
            return cachedAllianceMembers;
        }
        try {
            var response = await apiCall('/alliance/get-alliance-members', 'POST', {});
            var members = response.data ? response.data.members : response.members;
            if (members) {
                cachedAllianceMembers = members;
                cachedAllianceMembersTime = now;
            }
            return members || [];
        } catch (e) {
            log('Failed to fetch alliance members: ' + e, 'error');
            return cachedAllianceMembers || [];
        }
    }

    async function getUserRole(userId) {
        var members = await getAllianceMembers();
        var member = members.find(function(m) { return m.user_id === parseInt(userId); });
        if (!member) return 'none';
        return member.role || 'member';
    }

    async function hasMinRole(userId, minRole) {
        if (minRole === 'all') return true;
        var role = await getUserRole(userId);
        var roleHierarchy = ['none', 'member', 'management', 'coo', 'interim_ceo', 'ceo'];
        var minRoleIndex = roleHierarchy.indexOf(minRole.toLowerCase().replace(' ', '_'));
        var userRoleIndex = roleHierarchy.indexOf(role.toLowerCase().replace(' ', '_'));
        if (minRoleIndex === -1) minRoleIndex = 0;
        if (userRoleIndex === -1) userRoleIndex = 1;
        if (minRole === 'management') {
            return userRoleIndex >= roleHierarchy.indexOf('management');
        }
        return userRoleIndex >= minRoleIndex;
    }

    // ============================================
    // Command System
    // ============================================

    window.RebelShipChatBot = window.RebelShipChatBot || {
        registerCommand: function(name, handler, options) {
            options = options || {};
            registeredCommands[name.toLowerCase()] = {
                handler: handler,
                minRole: options.minRole || 'all',
                description: options.description || '',
                usage: options.usage || '',
                renderSettings: options.renderSettings || null
            };
            log('Command registered: ' + name);
        },
        unregisterCommand: function(name) {
            delete registeredCommands[name.toLowerCase()];
            log('Command unregistered: ' + name);
        },
        isEnabled: function() { return enabled; },
        sendAllianceMessage: function(message) {
            return sendAllianceMessage(message);
        }
    };

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function parseCommand(message) {
        if (!settings) return null;
        var prefix = settings.commandPrefix;
        if (!message.startsWith(prefix)) return null;
        var parts = message.substring(prefix.length).trim().split(/\s+/);
        var command = parts[0].toLowerCase();
        var args = parts.slice(1);
        return { command: command, args: args };
    }

    async function executeCommand(command, args, userId, userName, isDm) {
        // Built-in: help (with optional subcommand)
        if (command === 'help' && settings.commands.help && settings.commands.help.enabled) {
            // Check per-command DM/Alliance setting
            var helpDmEnabled = settings.commands.help.dmEnabled !== false;
            var helpAllianceEnabled = settings.commands.help.allianceEnabled !== false;
            if (isDm && !helpDmEnabled) return false;
            if (!isDm && !helpAllianceEnabled) return false;

            var hasRole = await hasMinRole(userId, settings.commands.help.minRole);
            if (hasRole) {
                await handleHelpCommand(args, userId, isDm);
                return true;
            }
        }

        // Registered commands from other scripts
        if (registeredCommands[command]) {
            var regCmd = registeredCommands[command];
            var cmdSettings = settings.registeredCommandSettings[command];

            // Check if command is disabled in settings
            if (cmdSettings && cmdSettings.enabled === false) {
                return false;
            }

            // Check per-command DM/Alliance setting
            var regDmEnabled = cmdSettings ? cmdSettings.dmEnabled !== false : true;
            var regAllianceEnabled = cmdSettings ? cmdSettings.allianceEnabled !== false : true;
            if (isDm && !regDmEnabled) return false;
            if (!isDm && !regAllianceEnabled) return false;

            // Use settings minRole if configured, otherwise use command's default
            var effectiveMinRole = (cmdSettings && cmdSettings.minRole) ? cmdSettings.minRole : regCmd.minRole;
            var hasRegRole = await hasMinRole(userId, effectiveMinRole);
            if (hasRegRole) {
                try {
                    await regCmd.handler(args, userId, userName, isDm, sendResponse);
                    return true;
                } catch (e) {
                    log('Error executing command ' + command + ': ' + e, 'error');
                    return false;
                }
            }
            return false;
        }

        // Custom commands
        for (var i = 0; i < settings.customCommands.length; i++) {
            var custom = settings.customCommands[i];
            if (custom.name.toLowerCase() === command && custom.enabled !== false) {
                // Check per-command DM/Alliance setting
                var customDmEnabled = custom.dmEnabled !== false;
                var customAllianceEnabled = custom.allianceEnabled !== false;
                if (isDm && !customDmEnabled) return false;
                if (!isDm && !customAllianceEnabled) return false;

                var hasCustomRole = await hasMinRole(userId, custom.minRole || 'all');
                if (hasCustomRole) {
                    await sendResponse(custom.outputText, userId, isDm);
                    return true;
                }
                return false;
            }
        }

        return false;
    }

    async function sendResponse(message, userId, isDm) {
        if (isDm) {
            await sendDm(userId, 'Bot Response', message);
        } else {
            await sendAllianceMessage(message);
        }
    }

    // ============================================
    // Built-in Command Handlers
    // ============================================

    async function handleHelpCommand(args, userId, isDm) {
        var prefix = settings.commandPrefix;

        // Check if user wants help for a specific command: !help <commandname>
        if (args.length > 0) {
            var targetCmd = args[0].toLowerCase();

            // Check registered commands
            if (registeredCommands[targetCmd]) {
                var cmd = registeredCommands[targetCmd];
                var lines = [];
                lines.push('Help: ' + prefix + targetCmd);
                lines.push('');
                if (cmd.description) lines.push(cmd.description);
                if (cmd.usage) {
                    lines.push('');
                    lines.push('Usage:');
                    lines.push(cmd.usage);
                }
                if (cmd.minRole !== 'all') {
                    lines.push('');
                    lines.push('Required role: ' + cmd.minRole);
                }
                await sendResponse(lines.join('\n'), userId, isDm);
                return;
            }

            // Check custom commands
            for (var i = 0; i < settings.customCommands.length; i++) {
                var custom = settings.customCommands[i];
                if (custom.name.toLowerCase() === targetCmd && custom.enabled !== false) {
                    var customLines = [];
                    customLines.push('Help: ' + prefix + custom.name);
                    customLines.push('');
                    customLines.push('Custom command (static response)');
                    if (custom.minRole !== 'all') {
                        customLines.push('Required role: ' + custom.minRole);
                    }
                    await sendResponse(customLines.join('\n'), userId, isDm);
                    return;
                }
            }

            // Command not found
            await sendResponse('Unknown command: ' + targetCmd + '\nUse ' + prefix + 'help for list of commands.', userId, isDm);
            return;
        }

        // General help - list all commands
        var lines = [];
        lines.push('ChatBot Commands');
        lines.push('');
        lines.push(prefix + 'help - Show this help');

        // Registered commands from other scripts - show help hints first
        var regCmdNames = Object.keys(registeredCommands);
        var enabledRegCmds = [];
        for (var j = 0; j < regCmdNames.length; j++) {
            var cmdName = regCmdNames[j];
            var regCmdSettings = settings.registeredCommandSettings[cmdName];
            if (regCmdSettings && regCmdSettings.enabled === false) {
                continue;
            }
            enabledRegCmds.push(cmdName);
        }

        // Show !help <cmd> hints for registered commands
        for (var h = 0; h < enabledRegCmds.length; h++) {
            var helpCmdName = enabledRegCmds[h];
            lines.push(prefix + 'help ' + helpCmdName + ' - Show ' + helpCmdName + ' help');
        }
        lines.push('');

        // Show registered commands with descriptions
        var hasRegCmd = false;
        for (var r = 0; r < enabledRegCmds.length; r++) {
            hasRegCmd = true;
            var regCmdName = enabledRegCmds[r];
            var regCmd = registeredCommands[regCmdName];
            var regCmdSettingsForDesc = settings.registeredCommandSettings[regCmdName];
            var desc = regCmd.description || 'No description';
            var effectiveRole = (regCmdSettingsForDesc && regCmdSettingsForDesc.minRole) ? regCmdSettingsForDesc.minRole : regCmd.minRole;
            var roleNote = effectiveRole !== 'all' ? ' (' + effectiveRole + ')' : '';
            lines.push(prefix + regCmdName + ' - ' + desc + roleNote);
        }
        if (hasRegCmd) lines.push('');

        // Custom commands
        var hasCustom = false;
        for (var k = 0; k < settings.customCommands.length; k++) {
            var customCmd = settings.customCommands[k];
            if (customCmd.enabled !== false) {
                hasCustom = true;
                var customRoleNote = customCmd.minRole !== 'all' ? ' (' + customCmd.minRole + ')' : '';
                lines.push(prefix + customCmd.name + customRoleNote);
            }
        }
        if (hasCustom) lines.push('');

        lines.push('Rate limits: DM 45s, Alliance 30s, Max 1000 chars');
        await sendResponse(lines.join('\n'), userId, isDm);
    }

    // ============================================
    // Command Queue Processing
    // ============================================

    function queueCommand(executeFn, info) {
        commandQueue.push({ fn: executeFn, info: info });
        processCommandQueue();
    }

    async function processCommandQueue() {
        if (isProcessingQueue) return;
        isProcessingQueue = true;
        while (commandQueue.length > 0) {
            var item = commandQueue.shift();
            try {
                await item.fn();
            } catch (e) {
                log('Error executing command ' + item.info + ': ' + e, 'error');
            }
            if (commandQueue.length > 0) {
                await new Promise(function(resolve) { setTimeout(resolve, COMMAND_DELAY_MS); });
            }
        }
        isProcessingQueue = false;
    }

    // ============================================
    // Message Processing
    // ============================================

    async function processDmChats() {
        var chats = await fetchDmChats();
        for (var i = 0; i < chats.length; i++) {
            var chat = chats[i];
            // Skip system chats and read chats
            if (chat.system_chat || !chat.new) continue;
            // Use time_last_message as unique ID
            var messageId = chat.id + '_' + chat.time_last_message;
            if (processedDmIds.has(messageId)) continue;
            processedDmIds.add(messageId);
            // chat.body contains the last message text directly!
            var messageText = chat.body || '';
            var parsed = parseCommand(messageText);
            if (parsed) {
                log('DM command from ' + chat.participants_string + ': ' + parsed.command);
                var capturedParsed = parsed;
                var capturedChatId = chat.id;
                var capturedUserName = chat.participants_string;
                queueCommand(async function() {
                    // Get user_id for this chat (cached, only fetches once per chat)
                    var userId = await getUserIdForChat(capturedChatId);
                    if (userId) {
                        await executeCommand(capturedParsed.command, capturedParsed.args, userId, capturedUserName, true);
                    } else {
                        log('Could not get user_id for chat ' + capturedChatId, 'warn');
                    }
                }, 'DM:' + parsed.command);
            }
        }
        await saveProcessedIds();
    }

    async function processAllianceChat() {
        var chatFeed = await fetchAllianceChatFeed();
        for (var i = 0; i < chatFeed.length; i++) {
            var item = chatFeed[i];
            if (item.type !== 'chat') continue;
            var msg = item.message || '';
            // Skip if not a command (doesn't start with prefix)
            if (!msg.startsWith(settings.commandPrefix)) continue;
            var messageId = item.user_id + '_' + item.time_created;
            if (processedAllianceIds.has(messageId)) continue;
            processedAllianceIds.add(messageId);
            var parsed = parseCommand(msg);
            if (parsed) {
                log('Command: !' + parsed.command + ' from user ' + item.user_id);
                var capturedParsed = parsed;
                var capturedUserId = item.user_id;
                queueCommand(async function() {
                    await executeCommand(capturedParsed.command, capturedParsed.args, capturedUserId, 'Alliance Member', false);
                }, 'Alliance:' + parsed.command);
            }
        }
        await saveProcessedIds();
    }

    // ============================================
    // Polling
    // ============================================

    function startPolling() {
        if (pollInterval) return;
        pollInterval = setInterval(async function() {
            if (!enabled) return;
            await processDmChats();
            await processAllianceChat();
        }, POLL_INTERVAL_MS);
        log('Polling started (10s)');
    }

    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
            log('Polling stopped');
        }
    }

    // ============================================
    // Toast / Notifications
    // ============================================

    function showToast(message, type) {
        type = type || 'success';
        if (settings.notifyIngame) {
            var toastStore = getToastStore();
            if (toastStore) {
                try {
                    if (type === 'error' && toastStore.error) {
                        toastStore.error(message);
                    } else if (toastStore.success) {
                        toastStore.success(message);
                    }
                } catch (err) {
                    log('Toast error: ' + err, 'error');
                }
            }
        }
    }

    // ============================================
    // Settings Modal (Game-style like auto-repair)
    // ============================================

    function injectModalStyles() {
        if (document.getElementById('chatbot-modal-styles')) return;
        var style = document.createElement('style');
        style.id = 'chatbot-modal-styles';
        style.textContent = [
            '@keyframes chatbot-fade-in{0%{opacity:0}to{opacity:1}}',
            '@keyframes chatbot-fade-out{0%{opacity:1}to{opacity:0}}',
            '@keyframes chatbot-drop-down{0%{transform:translateY(-10px)}to{transform:translateY(0)}}',
            '@keyframes chatbot-push-up{0%{transform:translateY(0)}to{transform:translateY(-10px)}}',
            '#chatbot-modal-wrapper{align-items:flex-start;display:flex;height:100vh;justify-content:center;left:0;overflow:hidden;position:absolute;top:0;width:100vw;z-index:9999}',
            '#chatbot-modal-wrapper #chatbot-modal-background{animation:chatbot-fade-in .15s linear forwards;background-color:rgba(0,0,0,.5);height:100%;left:0;opacity:0;position:absolute;top:0;width:100%}',
            '#chatbot-modal-wrapper.hide #chatbot-modal-background{animation:chatbot-fade-out .15s linear forwards}',
            '#chatbot-modal-wrapper #chatbot-modal-content-wrapper{animation:chatbot-drop-down .15s linear forwards,chatbot-fade-in .15s linear forwards;height:100%;max-width:500px;opacity:0;position:relative;width:100%;z-index:9001}',
            '#chatbot-modal-wrapper.hide #chatbot-modal-content-wrapper{animation:chatbot-push-up .15s linear forwards,chatbot-fade-out .15s linear forwards}',
            '#chatbot-modal-wrapper #chatbot-modal-container{background-color:#fff;height:100vh;overflow:hidden;position:absolute;width:100%}',
            '#chatbot-modal-container .modal-header{align-items:center;background:#626b90;border-radius:0;color:#fff;display:flex;height:31px;justify-content:space-between;text-align:left;width:100%;border:0!important;padding:0 .5rem!important}',
            '#chatbot-modal-container .header-title{font-weight:700;text-transform:uppercase;width:90%}',
            '#chatbot-modal-container .header-icon{cursor:pointer;height:1.2rem;margin:0 .5rem}',
            '#chatbot-modal-container .header-icon.closeModal{height:19px;width:19px}',
            '#chatbot-modal-container #chatbot-modal-content{height:calc(100% - 31px);max-width:inherit;overflow:hidden;display:flex;flex-direction:column}',
            '#chatbot-modal-container #chatbot-central-container{background-color:#e9effd;margin:0;overflow-x:hidden;overflow-y:auto;width:100%;flex:1;padding:10px 15px;-webkit-overflow-scrolling:touch}',
            '#chatbot-modal-wrapper.hide{pointer-events:none}',
            '#chatbot-modal-wrapper input[type="text"],#chatbot-modal-wrapper input[type="number"],#chatbot-modal-wrapper textarea,#chatbot-modal-wrapper select{font-size:16px!important;min-height:44px;-webkit-appearance:none}',
            '@media(max-width:768px){#chatbot-modal-wrapper #chatbot-modal-content-wrapper{max-width:100%}}'
        ].join('');
        document.head.appendChild(style);
    }

    function closeModal() {
        if (!isModalOpen) return;
        isModalOpen = false;
        var wrapper = document.getElementById('chatbot-modal-wrapper');
        if (wrapper) wrapper.classList.add('hide');
    }

    function setupModalWatcher() {
        if (modalListenerAttached) return;
        modalListenerAttached = true;
        window.addEventListener('rebelship-menu-click', function() {
            if (isModalOpen) closeModal();
        });
    }

    function openSettingsModal() {
        var modalStore = getModalStore();
        if (modalStore && modalStore.closeAll) modalStore.closeAll();

        injectModalStyles();

        var existing = document.getElementById('chatbot-modal-wrapper');
        if (existing) {
            var contentCheck = existing.querySelector('#chatbot-settings-content');
            if (contentCheck) {
                existing.classList.remove('hide');
                isModalOpen = true;
                updateSettingsContent();
                return;
            }
            existing.remove();
        }

        var headerEl = document.querySelector('header');
        var headerHeight = headerEl ? headerEl.offsetHeight : 89;

        var wrapper = document.createElement('div');
        wrapper.id = 'chatbot-modal-wrapper';

        var background = document.createElement('div');
        background.id = 'chatbot-modal-background';
        background.onclick = function() { closeModal(); };

        var contentWrapper = document.createElement('div');
        contentWrapper.id = 'chatbot-modal-content-wrapper';

        var container = document.createElement('div');
        container.id = 'chatbot-modal-container';
        container.className = 'font-lato';
        container.style.top = headerHeight + 'px';
        container.style.height = 'calc(100vh - ' + headerHeight + 'px)';
        container.style.maxHeight = 'calc(100vh - ' + headerHeight + 'px)';

        var modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';

        var headerTitle = document.createElement('span');
        headerTitle.className = 'header-title';
        headerTitle.textContent = 'ChatBot Settings';

        var closeIcon = document.createElement('img');
        closeIcon.className = 'header-icon closeModal';
        closeIcon.src = '/images/icons/close_icon_new.svg';
        closeIcon.onclick = function() { closeModal(); };
        closeIcon.onerror = function() {
            this.style.display = 'none';
            var fallback = document.createElement('span');
            fallback.textContent = 'X';
            fallback.style.cssText = 'cursor:pointer;font-weight:bold;padding:0 .5rem;';
            fallback.onclick = function() { closeModal(); };
            this.parentNode.appendChild(fallback);
        };

        modalHeader.appendChild(headerTitle);
        modalHeader.appendChild(closeIcon);

        var modalContent = document.createElement('div');
        modalContent.id = 'chatbot-modal-content';

        var centralContainer = document.createElement('div');
        centralContainer.id = 'chatbot-central-container';

        var settingsContent = document.createElement('div');
        settingsContent.id = 'chatbot-settings-content';
        centralContainer.appendChild(settingsContent);

        modalContent.appendChild(centralContainer);
        container.appendChild(modalHeader);
        container.appendChild(modalContent);
        contentWrapper.appendChild(container);
        wrapper.appendChild(background);
        wrapper.appendChild(contentWrapper);
        document.body.appendChild(wrapper);

        isModalOpen = true;
        updateSettingsContent();
    }

    function updateSettingsContent() {
        var content = document.getElementById('chatbot-settings-content');
        if (!content) return;

        var customCmdsHtml = '';
        for (var i = 0; i < settings.customCommands.length; i++) {
            var cmd = settings.customCommands[i];
            var outputLen = (cmd.outputText || '').length;
            var customDmChecked = cmd.dmEnabled !== false ? 'checked' : '';
            var customAllianceChecked = cmd.allianceEnabled !== false ? 'checked' : '';
            customCmdsHtml += '<div class="custom-cmd-item" data-idx="' + i + '" style="margin-bottom:12px;padding:12px;background:#d0d8f0;border-radius:6px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                    '<div style="display:flex;align-items:center;gap:8px;">' +
                        '<span style="font-size:12px;color:#626b90;">Command:</span>' +
                        '<input type="text" value="' + escapeHtml(cmd.name || '') + '" placeholder="e.g. status" class="cmd-name" style="width:120px;padding:6px 8px;background:#fff;border:1px solid #c0c8e0;border-radius:4px;font-size:13px;">' +
                    '</div>' +
                    '<button class="cmd-delete" style="padding:4px 10px;background:#dc3545;color:#fff;border:0;border-radius:4px;cursor:pointer;font-size:12px;">Remove</button>' +
                '</div>' +
                '<div style="margin-bottom:8px;">' +
                    '<textarea class="cmd-output" placeholder="Response text (max 1000 chars, use Shift+Enter for line breaks)" maxlength="1000" style="width:100%;min-height:60px;padding:8px;background:#fff;border:1px solid #c0c8e0;border-radius:4px;font-size:13px;resize:vertical;box-sizing:border-box;">' + (cmd.outputText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>' +
                    '<div style="text-align:right;font-size:11px;color:#626b90;margin-top:2px;"><span class="cmd-char-count">' + outputLen + '</span> / 1000</div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
                    '<span style="font-size:12px;color:#626b90;">Min Role:</span>' +
                    '<select class="cmd-role" style="padding:5px 8px;background:#fff;border:1px solid #c0c8e0;border-radius:4px;font-size:12px;">' +
                        '<option value="all"' + (cmd.minRole === 'all' ? ' selected' : '') + '>All Members</option>' +
                        '<option value="member"' + (cmd.minRole === 'member' ? ' selected' : '') + '>Member</option>' +
                        '<option value="management"' + (cmd.minRole === 'management' ? ' selected' : '') + '>Management</option>' +
                        '<option value="coo"' + (cmd.minRole === 'coo' ? ' selected' : '') + '>COO</option>' +
                        '<option value="ceo"' + (cmd.minRole === 'ceo' ? ' selected' : '') + '>CEO</option>' +
                    '</select>' +
                    '<label style="display:flex;align-items:center;margin-left:8px;font-size:11px;">' +
                        '<input type="checkbox" class="cmd-dm" ' + customDmChecked + ' style="width:14px;height:14px;margin-right:4px;accent-color:#0db8f4;">DM' +
                    '</label>' +
                    '<label style="display:flex;align-items:center;font-size:11px;">' +
                        '<input type="checkbox" class="cmd-alliance" ' + customAllianceChecked + ' style="width:14px;height:14px;margin-right:4px;accent-color:#0db8f4;">Alliance' +
                    '</label>' +
                '</div>' +
            '</div>';
        }

        // Build registered commands HTML
        var registeredCmdsHtml = '';
        var regCmdNames = Object.keys(registeredCommands);
        if (regCmdNames.length > 0) {
            registeredCmdsHtml = '<div style="margin-bottom:16px;">' +
                '<div style="font-weight:700;font-size:14px;margin-bottom:8px;">Script Commands</div>' +
                '<div style="display:flex;flex-direction:column;gap:8px;">';

            for (var j = 0; j < regCmdNames.length; j++) {
                var cmdName = regCmdNames[j];
                var regCmd = registeredCommands[cmdName];
                var cmdSettings = settings.registeredCommandSettings[cmdName];
                var isEnabled = cmdSettings ? cmdSettings.enabled !== false : true;
                var currentRole = (cmdSettings && cmdSettings.minRole) ? cmdSettings.minRole : regCmd.minRole;

                var regDmEnabled = cmdSettings ? cmdSettings.dmEnabled !== false : true;
                var regAllianceEnabled = cmdSettings ? cmdSettings.allianceEnabled !== false : true;

                registeredCmdsHtml += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
                    '<input type="checkbox" class="reg-cmd-enabled" data-cmd="' + cmdName + '" ' + (isEnabled ? 'checked' : '') +
                    ' style="width:18px;height:18px;accent-color:#0db8f4;">' +
                    '<span style="font-size:13px;width:60px;">!' + cmdName + '</span>' +
                    '<select class="reg-cmd-role" data-cmd="' + cmdName + '" style="padding:6px;background:#ebe9ea;border:0;border-radius:4px;font-size:12px;">' +
                        '<option value="all"' + (currentRole === 'all' ? ' selected' : '') + '>All</option>' +
                        '<option value="member"' + (currentRole === 'member' ? ' selected' : '') + '>Member</option>' +
                        '<option value="management"' + (currentRole === 'management' ? ' selected' : '') + '>Management</option>' +
                        '<option value="coo"' + (currentRole === 'coo' ? ' selected' : '') + '>COO</option>' +
                        '<option value="ceo"' + (currentRole === 'ceo' ? ' selected' : '') + '>CEO</option>' +
                    '</select>' +
                    '<label style="display:flex;align-items:center;margin-left:8px;font-size:11px;">' +
                        '<input type="checkbox" class="reg-cmd-dm" data-cmd="' + cmdName + '" ' + (regDmEnabled ? 'checked' : '') +
                        ' style="width:14px;height:14px;margin-right:4px;accent-color:#0db8f4;">DM' +
                    '</label>' +
                    '<label style="display:flex;align-items:center;font-size:11px;">' +
                        '<input type="checkbox" class="reg-cmd-alliance" data-cmd="' + cmdName + '" ' + (regAllianceEnabled ? 'checked' : '') +
                        ' style="width:14px;height:14px;margin-right:4px;accent-color:#0db8f4;">Alliance' +
                    '</label>' +
                    '<span style="font-size:11px;color:#626b90;margin-left:4px;">' + (regCmd.description || '') + '</span>' +
                '</div>';

                // Add settings container if command has renderSettings
                if (regCmd.renderSettings) {
                    registeredCmdsHtml += '<div class="reg-cmd-settings" data-cmd="' + cmdName + '" style="margin-left:26px;margin-bottom:8px;"></div>';
                }
            }

            registeredCmdsHtml += '</div></div>';
        }

        content.innerHTML = '\
            <div style="padding:15px;font-family:Lato,sans-serif;color:#01125d;">\
                <div style="margin-bottom:16px;">\
                    <label style="display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:16px;">\
                        <input type="checkbox" id="cb-enabled" ' + (settings.enabled ? 'checked' : '') + '\
                               style="width:20px;height:20px;margin-right:12px;accent-color:#0db8f4;cursor:pointer;">\
                        <span>Enable ChatBot</span>\
                    </label>\
                </div>\
                <div style="margin-bottom:16px;">\
                    <label style="display:block;margin-bottom:6px;font-size:14px;font-weight:700;">Command Prefix</label>\
                    <input type="text" id="cb-prefix" value="' + settings.commandPrefix + '"\
                           style="width:60px;padding:8px;background:#ebe9ea;border:0;border-radius:4px;text-align:center;font-size:16px;">\
                </div>\
                <div style="margin-bottom:16px;">\
                    <div style="font-weight:700;font-size:14px;margin-bottom:8px;">Built-in Commands</div>\
                    <div style="display:flex;flex-direction:column;gap:8px;">\
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">\
                            <input type="checkbox" id="cb-cmd-help" ' + (settings.commands.help.enabled ? 'checked' : '') + '\
                                   style="width:18px;height:18px;accent-color:#0db8f4;">\
                            <span style="font-size:13px;width:60px;">!help</span>\
                            <select id="cb-cmd-help-role" style="padding:6px;background:#ebe9ea;border:0;border-radius:4px;font-size:12px;">\
                                <option value="all"' + (settings.commands.help.minRole === 'all' ? ' selected' : '') + '>All</option>\
                                <option value="member"' + (settings.commands.help.minRole === 'member' ? ' selected' : '') + '>Member</option>\
                                <option value="management"' + (settings.commands.help.minRole === 'management' ? ' selected' : '') + '>Management</option>\
                                <option value="coo"' + (settings.commands.help.minRole === 'coo' ? ' selected' : '') + '>COO</option>\
                                <option value="ceo"' + (settings.commands.help.minRole === 'ceo' ? ' selected' : '') + '>CEO</option>\
                            </select>\
                            <label style="display:flex;align-items:center;margin-left:8px;font-size:11px;">\
                                <input type="checkbox" id="cb-cmd-help-dm" ' + (settings.commands.help.dmEnabled !== false ? 'checked' : '') + '\
                                       style="width:14px;height:14px;margin-right:4px;accent-color:#0db8f4;">DM\
                            </label>\
                            <label style="display:flex;align-items:center;font-size:11px;">\
                                <input type="checkbox" id="cb-cmd-help-alliance" ' + (settings.commands.help.allianceEnabled !== false ? 'checked' : '') + '\
                                       style="width:14px;height:14px;margin-right:4px;accent-color:#0db8f4;">Alliance\
                            </label>\
                        </div>\
                    </div>\
                </div>\
                ' + registeredCmdsHtml + '\
                <div style="margin-bottom:16px;">\
                    <div style="font-weight:700;font-size:14px;margin-bottom:8px;">Custom Commands</div>\
                    <div id="custom-commands-list">' + customCmdsHtml + '</div>\
                    <button id="cb-add-cmd" style="padding:8px 16px;background:#0db8f4;color:#fff;border:0;border-radius:4px;cursor:pointer;margin-top:8px;">+ Add Command</button>\
                </div>\
                <div style="margin-bottom:16px;">\
                    <div style="font-weight:700;font-size:14px;margin-bottom:8px;">Notifications</div>\
                    <div style="display:flex;gap:20px;">\
                        <label style="display:flex;align-items:center;cursor:pointer;">\
                            <input type="checkbox" id="cb-notify-ingame" ' + (settings.notifyIngame ? 'checked' : '') + '\
                                   style="width:18px;height:18px;margin-right:8px;accent-color:#0db8f4;">\
                            <span style="font-size:13px;">Ingame</span>\
                        </label>\
                        <label style="display:flex;align-items:center;cursor:pointer;">\
                            <input type="checkbox" id="cb-notify-system" ' + (settings.notifySystem ? 'checked' : '') + '\
                                   style="width:18px;height:18px;margin-right:8px;accent-color:#0db8f4;">\
                            <span style="font-size:13px;">System</span>\
                        </label>\
                    </div>\
                </div>\
                <div style="font-size:11px;color:#626b90;margin-bottom:16px;padding:10px;background:#d0d8f0;border-radius:4px;">\
                    <strong>Rate Limits:</strong> DM 45s, Alliance 30s, Command delay 5s<br>\
                    <strong>Max message:</strong> 1000 chars<br>\
                    <strong>Polling:</strong> Every 10 seconds<br>\
                    <strong>Mobile:</strong> When app is in background, polling is 60 seconds<br>\
                    <strong>Registered external commands:</strong> ' + Object.keys(registeredCommands).length + '\
                </div>\
                <div style="display:flex;gap:12px;justify-content:space-between;">\
                    <button id="cb-cancel" style="padding:10px 24px;background:linear-gradient(90deg,#d7d8db,#95969b);border:0;border-radius:6px;color:#393939;cursor:pointer;font-size:14px;font-weight:500;">Cancel</button>\
                    <button id="cb-save" style="padding:10px 24px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">Save</button>\
                </div>\
            </div>';

        // Event listeners
        document.getElementById('cb-cancel').addEventListener('click', function() {
            closeModal();
        });

        // Render custom settings for registered commands
        var settingsContainers = document.querySelectorAll('.reg-cmd-settings');
        settingsContainers.forEach(function(container) {
            var containerCmdName = container.getAttribute('data-cmd');
            var containerRegCmd = registeredCommands[containerCmdName];
            if (containerRegCmd && containerRegCmd.renderSettings) {
                var settingsHtml = containerRegCmd.renderSettings();
                if (settingsHtml) {
                    container.innerHTML = settingsHtml;
                }
            }
        });

        document.getElementById('cb-add-cmd').addEventListener('click', function() {
            settings.customCommands.push({ name: '', outputText: '', minRole: 'all', enabled: true, dmEnabled: true, allianceEnabled: true });
            updateSettingsContent();
        });

        var deleteButtons = document.querySelectorAll('.cmd-delete');
        deleteButtons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var item = this.closest('.custom-cmd-item');
                var idx = parseInt(item.getAttribute('data-idx'));
                settings.customCommands.splice(idx, 1);
                updateSettingsContent();
            });
        });

        var textareas = document.querySelectorAll('.cmd-output');
        textareas.forEach(function(ta) {
            ta.addEventListener('input', function() {
                var item = this.closest('.custom-cmd-item');
                var counter = item.querySelector('.cmd-char-count');
                if (counter) counter.textContent = this.value.length;
            });
        });

        document.getElementById('cb-save').addEventListener('click', function() {
            var wasEnabled = settings.enabled;
            settings.enabled = document.getElementById('cb-enabled').checked;
            settings.commandPrefix = document.getElementById('cb-prefix').value || '!';
            settings.commands.help.enabled = document.getElementById('cb-cmd-help').checked;
            settings.commands.help.minRole = document.getElementById('cb-cmd-help-role').value;
            settings.commands.help.dmEnabled = document.getElementById('cb-cmd-help-dm').checked;
            settings.commands.help.allianceEnabled = document.getElementById('cb-cmd-help-alliance').checked;
            settings.notifyIngame = document.getElementById('cb-notify-ingame').checked;
            settings.notifySystem = document.getElementById('cb-notify-system').checked;

            // Collect custom commands
            var cmdList = document.getElementById('custom-commands-list');
            var cmdItems = cmdList.querySelectorAll('.custom-cmd-item');
            settings.customCommands = [];
            cmdItems.forEach(function(item) {
                var nameInput = item.querySelector('.cmd-name');
                var outputInput = item.querySelector('.cmd-output');
                var roleSelect = item.querySelector('.cmd-role');
                var dmCheckbox = item.querySelector('.cmd-dm');
                var allianceCheckbox = item.querySelector('.cmd-alliance');
                var name = nameInput ? nameInput.value.trim() : '';
                var output = outputInput ? outputInput.value : '';
                var role = roleSelect ? roleSelect.value : 'all';
                var dmEnabledVal = dmCheckbox ? dmCheckbox.checked : true;
                var allianceEnabledVal = allianceCheckbox ? allianceCheckbox.checked : true;
                if (name) {
                    settings.customCommands.push({ name: name, outputText: output, minRole: role, enabled: true, dmEnabled: dmEnabledVal, allianceEnabled: allianceEnabledVal });
                }
            });

            // Collect registered command settings
            var regCmdCheckboxes = document.querySelectorAll('.reg-cmd-enabled');
            var regCmdRoles = document.querySelectorAll('.reg-cmd-role');
            var regCmdDms = document.querySelectorAll('.reg-cmd-dm');
            var regCmdAlliances = document.querySelectorAll('.reg-cmd-alliance');
            settings.registeredCommandSettings = {};
            regCmdCheckboxes.forEach(function(cb) {
                var cbCmdName = cb.getAttribute('data-cmd');
                if (!settings.registeredCommandSettings[cbCmdName]) {
                    settings.registeredCommandSettings[cbCmdName] = {};
                }
                settings.registeredCommandSettings[cbCmdName].enabled = cb.checked;
            });
            regCmdRoles.forEach(function(sel) {
                var selCmdName = sel.getAttribute('data-cmd');
                if (!settings.registeredCommandSettings[selCmdName]) {
                    settings.registeredCommandSettings[selCmdName] = {};
                }
                settings.registeredCommandSettings[selCmdName].minRole = sel.value;
            });
            regCmdDms.forEach(function(cb) {
                var cbCmdName = cb.getAttribute('data-cmd');
                if (!settings.registeredCommandSettings[cbCmdName]) {
                    settings.registeredCommandSettings[cbCmdName] = {};
                }
                settings.registeredCommandSettings[cbCmdName].dmEnabled = cb.checked;
            });
            regCmdAlliances.forEach(function(cb) {
                var cbCmdName = cb.getAttribute('data-cmd');
                if (!settings.registeredCommandSettings[cbCmdName]) {
                    settings.registeredCommandSettings[cbCmdName] = {};
                }
                settings.registeredCommandSettings[cbCmdName].allianceEnabled = cb.checked;
            });

            enabled = settings.enabled;
            saveSettings().then(function() {
                if (enabled && !wasEnabled) {
                    startPolling();
                } else if (!enabled && wasEnabled) {
                    stopPolling();
                }
                log('Settings saved');
                showToast('ChatBot settings saved');
                closeModal();
            });
        });
    }

    // ============================================
    // Menu Integration
    // ============================================

    function setupMenu() {
        addMenuItem('ChatBot', openSettingsModal, 60);
    }

    // ============================================
    // Initialization
    // ============================================

    async function initBridge() {
        if (window.RebelShipBridge) {
            bridgeReady = true;
            await loadSettings();
            await loadProcessedIds();
            log('Bridge ready');
            if (enabled) startPolling();
        } else {
            setTimeout(initBridge, 100);
        }
    }

    // Background job for Android BackgroundScriptService
    function registerBackgroundJob() {
        window.rebelshipBackgroundJobs = window.rebelshipBackgroundJobs || [];

        // Check if already registered
        var alreadyRegistered = window.rebelshipBackgroundJobs.some(function(job) {
            return job.name === 'ChatBot';
        });
        if (alreadyRegistered) {
            log('Background job already registered');
            return;
        }

        window.rebelshipBackgroundJobs.push({
            name: 'ChatBot',
            run: async function() {
                if (!enabled) {
                    return { skipped: true, reason: 'ChatBot disabled' };
                }

                log('Background job running...');

                try {
                    // Load settings if not loaded
                    if (!bridgeReady && window.RebelShipBridge) {
                        bridgeReady = true;
                        await loadSettings();
                        await loadProcessedIds();
                    }

                    if (!enabled) {
                        return { skipped: true, reason: 'ChatBot disabled after load' };
                    }

                    // Process DMs and alliance chat
                    await processDmChats();
                    await processAllianceChat();
                } catch (e) {
                    log('Background job error: ' + e.message);
                    return { success: false, error: e.message };
                }

                return { success: true };
            }
        });

        log('Background job registered');
    }

    function init() {
        setupMenu();
        setupModalWatcher();
        registerBackgroundJob();
        initBridge();
        log('ChatBot initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
