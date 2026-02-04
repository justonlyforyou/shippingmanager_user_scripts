# Shipping Manager User Scripts - User Manual

A collection of user scripts for [Shipping Manager](https://shippingmanager.cc/) that fix game bugs and add quality-of-life features.

---

## Table of Contents

1. [Installation](#installation)
2. [Scripts Overview](#scripts-overview)
3. [Detailed Documentation](#detailed-documentation)
   - [Rebelship Header Optimizer](#rebelship-header-optimizeruserjs---header-optimizer)
   - [Depart Manager](#departmanageruserjs---depart-manager)
   - [Auto Repair](#auto-repairuserjs---auto-repair)
   - [Auto Happy Staff](#auto-happy-stuffuserjs---auto-happy-staff)
   - [Auto CO-OP](#auto-coop-tickets-displayuserjs---auto-co-op)
   - [Auto Reputation](#auto-marketing-reputation-displayuserjs---auto-reputation)
   - [Auto Drydock](#auto-drydockuserjs---auto-drydock)
   - [Smuggler's Eye](#smugglers-eyeuserjs---smugglers-eye)
   - [Fleet Manager](#fleet-manageruserjs---mass-moorresume)
   - [Vessel Shopping Cart](#vessel-cartuserjs---vessel-shopping-cart)
   - [Vessel Sell Cart](#vessel-selluserjs---vessel-sell-cart)
   - [Bunker Price Display](#bunker-price-displayuserjs---bunker-prices)
   - [Forecast Calendar](#forecast-calendaruserjs---forecast-calendar)
   - [Demand Summary](#demand-summaryuserjs---demand-summary)
   - [API Stats Monitor](#api-statsuserjs---api-stats-monitor)
   - [Distance Filter](#enable-distance-filteruserjs---distance-filter)
   - [Map Unlock](#map-unlockuserjs---premium-features)
   - [Fast Delivery](#fast-deliveryuserjs---fast-delivery)
   - [Depart All Loop](#depart-all-loopuserjs---depart-all-loop)
   - [Alliance Chat Notification](#alliance-chat-notificationuserjs---chat-notification)
   - [Alliance Search](#alliance-searchuserjs---alliance-search)
   - [Alliance ID Display](#alliance-id-displayuserjs---alliance-id-display)
   - [Cleanup System Messages](#cleanup-system-messagesuserjs---cleanup-system-messages)
   - [Auto Anchor](#auto-anchoruserjs---auto-anchor)
   - [Auto Stock](#auto-stockuserjs---auto-stock)
   - [ChatBot](#chatbotuserjs---chatbot)
   - [Export Scripts](#export-scripts)
   - [Bug Fix Scripts](#bug-fix-scripts)
   - [Vessel Details Fix](#fix-missing-vessel-detailsuserjs---vessel-details-fix)
   - [Admin View](#admin-viewuserjs---admin-view)
4. [Developer Guide](#developer-guide)
5. [Background Execution](#background-execution)

---

## Installation

### Required: RebelShip Browser

These scripts **require RebelShip Browser** and do not work with Tampermonkey or other userscript managers.

**Why?** The scripts depend on:
- **RebelShip Menu System** - Central menu for all script settings (in browser menu)
- **RebelShipBridge API** - Encrypted SQLCipher database for persistent storage
- **Background Job Support** - Native integration for scripts that run periodically

**Download:**

| Platform | Link |
|----------|------|
| Windows | [RebelShip Browser](https://github.com/justonlyforyou/RebelShipBrowser) |
| Android | [RebelShip Browser Mobile](https://github.com/AstroNik/RebelShipBrowser_Mobile) |

Scripts are pre-installed and automatically updated with the browser.

### Why Not Tampermonkey?

Previous versions of these scripts worked with Tampermonkey, but the current architecture requires:

1. **SQLCipher Database** - Scripts store settings and data in an encrypted SQLite database via `RebelShipBridge.storage`. This API is only available in RebelShip Browser.

2. **RebelShip Menu** - The `addMenuItem()` function and menu system are provided by the browser, not by a userscript.

3. **Background Execution** - Scripts like Auto-Depart, Auto-Repair need to run when the browser tab is not active. RebelShip Browser handles this natively.

4. **Cross-Script Communication** - Scripts share data (e.g., pending route settings) through a common database that Tampermonkey cannot provide.

---

## Scripts Overview

| Script | Version | Description |
|--------|---------|-------------|
| rebelship-header-optimizer.user.js | 3.51 | Header UI optimization, mobile layout, resize handling |
| departmanager.user.js | 3.44 | Auto-Bunker, Auto-Depart, Route Settings, Min Utilization |
| auto-repair.user.js | 2.41 | Auto-repair at wear threshold |
| auto-happy-stuff.user.js | 1.40 | Auto salary adjustment for crew/management morale |
| auto-coop-tickets-display.user.js | 5.38 | Co-Op display in header, Auto-COOP sending |
| auto-marketing-reputation-display.user.js | 5.29 | Reputation in header, auto campaign renewal |
| auto-drydock.user.js | 1.6 | Auto-drydock at hours threshold, drydock bug prevention |
| smugglers-eye.user.js | 1.9 | Price optimization: 4% markup, gradual increase, max guards |
| fleet-manager.user.js | 4.15 | Mass Moor/Resume with checkboxes |
| vessel-cart.user.js | 4.29 | Shopping cart for vessel purchase/build |
| vessel-sell.user.js | 1.0 | Bulk-sell vessels with lazy-loaded sell prices |
| bunker-price-display.user.js | 3.20 | Fuel/CO2 prices and fill level in header |
| forecast-calendar.user.js | 3.39 | Page-flip calendar with price forecasts |
| demand-summary.user.js | 4.81 | Port demand with capacity overview, alliance ranking |
| api-stats.user.js | 1.9 | Monitor and analyze API call patterns |
| enable-distance-filter.user.js | 9.19 | Filter ports by distance |
| map-unlock.user.js | 1.10 | Premium Map Themes, Tanker Ops, Metropolis, Zoom |
| fast-delivery.user.js | 1.11 | Fast vessel delivery via drydock bug |
| depart-all-loop.user.js | 2.6 | Clicks Depart All until all departed |
| alliance-chat-notification.user.js | 2.14 | Red dot for unread alliance messages |
| alliance-search.user.js | 3.47 | Search all open alliances |
| harbor-improvements.user.js | 2.7 | Details button repositioning in harbor menu |
| at-port-refresh.user.js | 1.4 | Auto-refresh At Port list every 30 sec |
| buy-vip-vessel.user.js | 2.25 | Buy VIP vessels |
| export-vessels-csv.user.js | 1.19 | Export fleet as CSV |
| export-messages.user.js | 1.25 | Export messages as CSV/JSON |
| export-vessel-history.user.js | 3.5 | Save vessel history as CSV |
| fix-alliance-member-exclude.user.js | 1.6 | Fix exclude buttons for CEO |
| fix-alliance-interimCEO.user.js | 1.6 | Add edit buttons for Interim CEO |
| admin-view.user.js | 8.7 | Shows Admin UI (visual only, no permissions) |
| auto-anchor.user.js | 1.4 | Auto-purchase anchor points when timer expires |
| auto-stock.user.js | 2.9 | IPO Alerts and Investments tabs in Finance modal |
| chatbot.user.js | 2.16 | Automated chatbot for alliance chat and DMs |
| fix-missing-vessel-details.user.js | 2.5 | Fix missing vessel details (Engine, Port, Fuel Factor) |
| alliance-id-display.user.js | 1.0 | Shows alliance ID next to name in modal, click to copy |
| cleanup-system-messages.user.js | 1.0 | Bulk delete alliance join and donation system messages |

---

## Detailed Documentation

---

### rebelship-header-optimizer.user.js - Header Optimizer

**Version:** 3.51 | **Order:** 1 (loads first)

**IMPORTANT:** This script should be installed for proper header layout on all devices. It optimizes the header UI for both desktop and mobile views.

#### Features

- Custom VIP Points and Cash display
- Mobile-optimized layout (< 768px)
- Stock display with trend indicators
- Header resize handling for all scripts

---

### departmanager.user.js - Depart Manager

**Version:** 3.44 | **Background Job:** Yes

The main automation script for departure and route management.

#### Accessing Settings

Open **RebelShip Menu** > **"Depart Manager"**

#### Features

##### 1. Auto Bunker Refill (Fuel & CO2)

| Mode | Behavior |
|------|----------|
| **Off** | No automatic purchasing |
| **Basic** | Fills bunker to 100% when price <= Basic Threshold |
| **Intelligent** | Extends Basic with shortfall-only purchases at higher prices |

##### 2. Auto-Depart

Automatically departs vessels when conditions are met.
- Sorts vessels by fuel requirement (highest first)
- Checks fuel/CO2 availability before each departure
- Buys shortfall if within price thresholds

##### 3. Minimum Utilization Warning

Alerts when vessel utilization drops below threshold.

##### 4. Route Settings Tab

Adds a **Settings** tab to the Routes modal for editing ALL vessels (including enroute).

| Column | Meaning |
|--------|---------|
| Status | P=Port, E=Enroute, A=Anchored, MP=Moored Port, ME=Moored Enroute |
| Pending | Values saved for next departure (purple) |

##### 5. UI Features

- Auto-Expand Advanced sections
- Price Difference Badges (green = above auto-price, red = below)

---

### auto-repair.user.js - Auto Repair

**Version:** 2.41 | **Background Job:** Yes

Automatically repairs vessels when wear reaches threshold.

#### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enabled | Enables auto-repair | Off |
| Wear Threshold | Repair when wear >= X% | 5% |
| Min Cash After Repair | Keep at least this amount | 0 |

---

### auto-happy-stuff.user.js - Auto Happy Staff

**Version:** 1.40 | **Background Job:** Yes

Automatically adjusts salaries to keep crew and management morale at target levels.

---

### auto-coop-tickets-display.user.js - Auto CO-OP

**Version:** 5.38 | **Background Job:** Yes

Shows Co-Op tickets in header and automatically sends COOP vessels.

---

### auto-marketing-reputation-display.user.js - Auto Reputation

**Version:** 5.29

Shows reputation in header and auto-renews expired marketing campaigns.

---

### auto-drydock.user.js - Auto Drydock

**Version:** 1.6 | **Background Job:** Yes

Automatically sends vessels to drydock when antifouling hours drop below threshold. Also prevents the drydock bug by saving and restoring route settings.

#### Accessing Settings

RebelShip Menu > **"Auto Drydock"**

#### Features

| Setting | Description | Default |
|---------|-------------|---------|
| Enabled | Enables auto-drydock | Off |
| Hours Threshold | Send to drydock when hours_until_check <= X | 200 |
| Action Mode | Drydock or Moor (mutually exclusive) | Drydock |
| Drydock Speed | Minimum (cheaper) or Maximum (faster) | Minimum |
| Maintenance Type | Major (100%) or Minor (60% antifouling) | Major |
| Min Cash Balance | Keep at least this amount after drydock | 1,000,000 |

#### How It Works

Every 15 minutes:
1. Fetches all vessels via API
2. Filters vessels with hours_until_check <= threshold
3. For **Drydock Mode**: Checks cash, saves route settings, sends to drydock
4. For **Moor Mode**: Parks the vessel (or marks for mooring on arrival)

**Drydock Bug Prevention:** Always active - saves route settings (speed, guards, prices) before drydock and restores them automatically after drydock completes.

---

### smugglers-eye.user.js - Smuggler's Eye

**Version:** 1.9 | **Background Job:** Yes

Automatic price optimization system for cargo routes.

#### Accessing Settings

RebelShip Menu > **"Smuggler's Eye"**

#### Features

| Setting | Description | Default |
|---------|-------------|---------|
| Enable Smuggler's Eye | Main toggle | Off |
| 4% Instant Markup | Sets prices to 4% above auto-price | On |
| Gradual Increase | Slowly increases prices over time | Off |
| Step Size | Increase per step | 1% |
| Interval | Time between increases | 25 hours |
| Target Percent | Maximum price target | 8% |
| Max Guards on Pirate Routes | Sets guards to 10 on risky routes | On |

#### How It Works

- For enroute vessels: Changes saved as "pending" and applied at next departure
- For port vessels: Changes applied immediately via API

---

### fleet-manager.user.js - Fleet Manager

**Version:** 4.15

Mass moor and resume vessels with checkbox selection.

#### Features

- Adds checkboxes to vessel lists in **At Port**, **Anchored**, and **At Sea** tabs
- **All** / **None** buttons for quick selection
- **Moor** button: Parks selected vessels (only works for vessels in port)
- **Resume** button: Resumes selected moored vessels
- Automatically filters: Moor only works on non-moored vessels, Resume only on moored vessels
- Shows toast notifications for success/failure

---

### vessel-cart.user.js - Vessel Shopping Cart

**Version:** 4.29

Shopping cart for bulk vessel purchases and builds.

#### Features

- Add vessels to cart from the marketplace or shipyard
- Adjust quantity per vessel type
- Bulk purchase/build all cart items at once
- Cart persists across sessions (saved in RebelShipBridge storage)
- Shows total cost before purchase
- Cart button appears in header on mobile

---

### vessel-sell.user.js - Vessel Sell Cart

**Version:** 1.0

Select and bulk-sell vessels with lazy-loaded sell prices.

**Access:** RebelShip Menu > **"Sell Vessels"**

#### Features

- Shows all sellable vessels (status: port or anchored)
- Lazy-loads sell prices per vessel from API (with progress indicator)
- Select individual vessels or use Select All/None
- Search/filter vessels by name
- Shows sell price and original price per vessel
- Footer displays total sell value of selected vessels
- Bulk-sell all selected vessels with confirmation
- Price cache to avoid redundant API calls

---

### bunker-price-display.user.js - Bunker Prices

**Version:** 3.20

Shows current fuel and CO2 prices with fill levels in header.

#### Features

- Replaces original fuel/CO2 icons with 3-line display:
  - Line 1: Label (Fuel / CO2)
  - Line 2: Fill level % (color-coded: red < 30%, green >= 30%)
  - Line 3: Current price per ton
- Price colors: Green (cheap) → Blue → Orange → Red (expensive)
- Updates automatically at :00:45 and :30:45 (after game price changes)
- Subscribes to Pinia store for instant fill level updates

---

### forecast-calendar.user.js - Forecast Calendar

**Version:** 3.39

Visual page-flip calendar with fuel and CO2 price forecasts.

**Access:** RebelShip Menu > **"Bunker Forecast"**

#### Features

- Interactive page-flip calendar (swipe or click arrows)
- Shows 24-hour price forecast per day
- Highlights current hour row
- Color-coded prices (green = cheap, red = expensive)
- Converts UTC times to your local timezone
- Data fetched from external forecast API

---

### demand-summary.user.js - Demand Summary

**Version:** 4.81

Shows port demand with capacity overview and alliance rankings.

**Access:** RebelShip Menu > **"Demand Summary"**

#### Features

- Lists all 360 ports with current cargo demand (TEU/BBL)
- Shows your fleet capacity allocated to each port
- Alliance ranking per port (collect via button)
- Filter by: All, With Vessels, No Vessels, Container, Tanker
- Sortable columns (click headers)
- Mobile-optimized compact table layout
- Export data as JSON

#### Tooltips

- **Harbor Map:** Hover over port markers (desktop) or long-press (mobile) to see demand, vessels, and ranking info
- **Rank Column:** Click on any rank cell (desktop) or long-press (mobile) to see detailed alliance rankings including top 3 alliances with TEU/BBL stats

---

### api-stats.user.js - API Stats Monitor

**Version:** 1.9 | **Run-at:** document-start

Monitors all API calls to shippingmanager.cc in the background. Useful for debugging, rate limit monitoring, and understanding game API patterns.

**Access:** RebelShip Menu > **"API Stats"** or press **Alt+A**

#### Features

- Intercepts all fetch and XHR requests to track API usage
- Shows call counts per endpoint over configurable time ranges (5/15/30/60 min)
- Color-coded endpoints: GET (blue), POST (green), PUT (orange), DELETE (red)
- Persists data across sessions via RebelShipBridge storage
- Auto-cleanup of calls older than 61 minutes
- Debounced saving to minimize storage overhead

#### Use Cases

- Monitor how often scripts are calling specific endpoints
- Identify potential rate limiting issues (game limits: 1000 req/15min global, 45 msg/min for messages)
- Debug script behavior by seeing which API calls are made
- Understand game API structure

---

### enable-distance-filter.user.js - Distance Filter

**Version:** 9.19

Filters destination ports by distance when creating new routes.

#### Features

- Adds distance filter dropdown to route creation modal
- Filter options: All, < 500nm, < 1000nm, < 2000nm, etc.
- Helps find efficient short-distance routes
- Works with all cargo types

---

### map-unlock.user.js - Premium Features

**Version:** 1.10

Unlocks premium map features without VIP subscription.

#### Unlocked Features

- Map Themes (different visual styles)
- Tanker Operations view
- Metropolis overlay
- Extended zoom levels

**Note:** Visual only - does not grant actual VIP benefits.

---

### fast-delivery.user.js - Fast Delivery

**Version:** 1.11

Uses a game bug to reduce vessel delivery time from days to 60 minutes.

#### How It Works

1. When a vessel is being built/delivered, sends it to drydock
2. The drydock journey resets the delivery timer
3. Vessel arrives at drydock location in ~60 minutes instead of days

**v1.11:** Uses XMLHttpRequest instead of fetch for drydock API calls to avoid conflicts with Auto Drydock's fetch interceptor.

**Note:** Exploits a known game bug. Use at your own discretion.

---

### depart-all-loop.user.js - Depart All Loop

**Version:** 2.6

Repeatedly clicks "Depart All" until all vessels have departed.

#### Features

- Adds "Loop" button next to "Depart All"
- Keeps clicking Depart All every few seconds
- Stops when all vessels have departed or manually cancelled
- Useful when waiting for fuel purchases to complete

---

### alliance-chat-notification.user.js - Chat Notification

**Version:** 2.14

Shows a red notification dot when there are unread alliance messages.

#### Features

- Red dot appears on Alliance button in header
- Checks for new messages periodically
- Clears when you open the alliance chat
- Works on both desktop and mobile

---

### alliance-search.user.js - Alliance Search

**Version:** 3.47

Search and browse all open alliances.

**Access:** RebelShip Menu > **"Alliance Search"**

#### Features

- Fetches all open alliances from API
- Search by alliance name
- Filter by member count, requirements, etc.
- View alliance details before joining
- Quick join button

---

### alliance-id-display.user.js - Alliance ID Display

**Version:** 1.0

Shows the alliance ID next to the alliance name in modals. Click the ID to copy it to clipboard.

#### Features

- Displays alliance ID as a badge next to the alliance name
- Click to copy the ID to clipboard
- Hover effect for visual feedback
- Toast notification on copy
- Auto-detects alliance modal via MutationObserver

---

### cleanup-system-messages.user.js - Cleanup System Messages

**Version:** 1.0

Bulk delete alliance join and donation system messages from your inbox.

**Access:** RebelShip Menu > **"Cleanup Messages"**

#### Features

| Option | Deletes |
|--------|---------|
| Delete Join Messages | Messages about players joining/applying to the alliance |
| Delete Donations | Alliance donation notification messages |

- Fetches all chats via API, filters system messages by body content
- Deletes in batches of 50 with retry logic
- Progress overlay shows current status
- Useful when inbox is flooded with automated system notifications

---

### auto-anchor.user.js - Auto Anchor

**Version:** 1.4 | **Background Job:** Yes

Automatically purchases anchor points when the build timer expires.

**Access:** RebelShip Menu > **"Auto Anchor"**

#### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enable Auto-Buy | Main toggle | Off |
| Purchase Amount | Buy 1 or 10 anchor points at a time | 1 |
| Minimum Cash Balance | Keep at least this amount after purchase | 5,000,000 |
| Notifications | Ingame toast and/or system notification | Ingame on |

#### How It Works

- Checks every 15 minutes whether the anchor point timer has expired
- If expired, checks cash balance and purchases the configured amount
- Intercepts anchor purchase and timer reset API responses for immediate state updates
- Syncs game modal slider to match last purchase amount

---

### auto-stock.user.js - Auto Stock

**Version:** 2.9 | **Background Job:** Yes

IPO alerts, auto-buy, auto-sell, and investment tracking in the Finance modal.

**Access:** RebelShip Menu > **"Auto Stocks"**

#### Features

- **IPO Alerts Tab** in Finance modal showing fresh IPOs (accounts younger than configurable days)
- **Investments Tab** showing current portfolio with P/L and sell buttons
- **Auto-Buy:** Automatically purchases shares from fresh IPOs within price threshold
- **Auto-Sell:** Automatically sells stocks that drop below a configurable percentage from purchase price

#### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Auto-Buy | Enable automatic stock purchases | Off |
| Min Cash Reserve | Keep at least this amount | 1,000,000 |
| Max Stock Price | Only buy shares under this price | 500 |
| Auto-Sell | Enable automatic selling of falling stocks | Off |
| Drop Threshold | Sell if stock drops X% from purchase price | 15% |
| IPO Max Age | Show IPOs from accounts younger than X days | 7 |
| IPO Check Limit | How many recent IPOs to scan | 10 |

---

### chatbot.user.js - ChatBot

**Version:** 2.16 | **Background Job:** Yes

Automated chatbot for alliance chat and DMs with an extensible command system.

**Access:** RebelShip Menu > **"ChatBot"**

#### Features

- Responds to commands in both DMs and alliance chat
- Built-in `!help` command listing all available commands
- Custom static-response commands configurable in settings
- Other scripts can register commands via `window.RebelShipChatBot.registerCommand()`
- Per-command DM/Alliance toggles and role-based access control
- Role hierarchy: All > Member > Management > COO > Interim CEO > CEO

#### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enable ChatBot | Main toggle | Off |
| Command Prefix | Character before commands | ! |
| Built-in Commands | Enable/disable !help with role and channel settings | On |
| Custom Commands | Add static response commands with role restrictions | None |
| Notifications | Ingame and/or system notifications | Ingame on |

#### Rate Limits

| Limit | Value |
|-------|-------|
| DM cooldown | 45 seconds |
| Alliance cooldown | 30 seconds |
| Command delay | 5 seconds |
| Max message length | 1000 characters |
| Polling interval | 10 seconds (60s in background) |

---

### harbor-improvements.user.js - Harbor Improvements

**Version:** 2.7

Fixes UI issues in the harbor/port menu.

#### Features

- Repositions the "Details" button to prevent overlap
- Improves button accessibility on smaller screens

---

### at-port-refresh.user.js - Auto Port Refresh

**Version:** 1.4

Automatically refreshes the "At Port" vessel list.

#### Features

- Refreshes the At Port list every 30 seconds
- Keeps vessel status up-to-date without manual refresh
- Useful when waiting for vessels to arrive

---

### buy-vip-vessel.user.js - VIP Vessel Shop

**Version:** 2.25

Access to VIP-exclusive vessels.

**Access:** RebelShip Menu > **"VIP Vessel Shop"**

#### Features

- Browse VIP-exclusive vessel models
- View specifications and prices
- Purchase VIP vessels directly

---

### Export Scripts

#### export-vessels-csv.user.js

**Version:** 1.19

Export your entire fleet as a CSV file.

**Access:** RebelShip Menu > **"Export Vessels"**

- Includes vessel name, type, capacity, current route, status, wear, etc.
- CSV format for easy import into Excel or Google Sheets

#### export-messages.user.js

**Version:** 1.25

Export your messages as CSV or JSON.

**Access:** RebelShip Menu > **"Export Messages"**

- Export inbox, sent, or all messages
- Choose between CSV and JSON format
- Includes sender, subject, date, and content

#### export-vessel-history.user.js

**Version:** 3.5

Save vessel voyage history as CSV.

**Access:** Via vessel detail modal

- Records voyage data: routes, cargo, earnings
- Export historical performance data
- Useful for profit analysis

---

### Bug Fix Scripts

#### fix-alliance-member-exclude.user.js

**Version:** 1.6

Fixes the exclude/kick buttons in alliance member management.

- Buttons were not working for CEO role
- This script restores functionality

#### fix-alliance-interimCEO.user.js

**Version:** 1.6

Adds missing edit buttons for Interim CEO role.

- Game bug: Interim CEOs couldn't edit alliance settings
- This script adds the missing UI buttons

#### fix-missing-vessel-details.user.js - Vessel Details Fix

**Version:** 2.5

Fixes missing vessel details in the vessel modal (Engine type, Port name, Fuel Factor).

- Observes DOM changes and fills in missing data from the Pinia vessel store
- Adds a Fuel Factor row below Year of Construction
- Expands abbreviated port codes to full names

---

### admin-view.user.js - Admin View

**Version:** 8.7

Shows Admin/Moderator UI elements for testing purposes.

**VISUAL ONLY** - does NOT grant any actual permissions or abilities.

#### Features

- Shows admin menu items
- Displays moderator tools in UI
- Useful for UI development/testing only

---

## Developer Guide

This section explains how to create your own scripts that integrate with the RebelShip Menu system.

### Script Header Template

```javascript
// ==UserScript==
// @name         ShippingManager - My Script
// @namespace    https://rebelship.org/
// @version      1.0
// @description  Description of your script
// @author       Your Name
// @order        30
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// @background-job-required true
// @RequireRebelShipMenu true
// ==/UserScript==
/* globals addMenuItem */
```

#### The `/* globals */` Comment

The `/* globals ... */` comment tells your code editor (ESLint) which variables are provided by the RebelShip Browser, so it won't show "undefined variable" warnings.

**Available globals you can declare:**

| Global | When to use |
|--------|-------------|
| `addMenuItem` | When using `@RequireRebelShipMenu true` |
| `addSubMenu` | When using submenus with `@RequireRebelShipMenu true` |
| `MutationObserver` | When observing DOM changes (standard browser API) |
| `CustomEvent` | When dispatching custom events (standard browser API) |

**Example with multiple globals:**
```javascript
/* globals addMenuItem, addSubMenu, MutationObserver */
```

#### Header Fields Explained

**Standard Userscript Fields:**

| Field | Description |
|-------|-------------|
| `@name` | Script name displayed in manager. Convention: `ShippingManager - [Name]` |
| `@namespace` | Unique identifier namespace (e.g., `http://tampermonkey.net/`) |
| `@version` | Version number (e.g., `1.0`, `2.34`) |
| `@description` | Short description of what the script does |
| `@author` | Author name or GitHub URL |
| `@match` | URL pattern where script runs. Always `https://shippingmanager.cc/*` |
| `@grant` | Permissions needed. Use `none` for RebelShip scripts |
| `@run-at` | When to inject. Use `document-end` (after DOM ready) |

**RebelShip-specific Fields:**

| Field | Description |
|-------|-------------|
| `@order` | Menu position (lower = higher in menu). Range: 1-999. Use 20-30 for custom scripts |
| `@enabled` | Initial state when first loaded (`true` or `false`) |
| `@background-job-required` | Set to `true` if script needs background execution on mobile |
| `@RequireRebelShipMenu` | Set to `true` to use `addMenuItem()` / `addSubMenu()` APIs |

### Available Global APIs

The RebelShip Browser provides these global APIs for userscripts:

| Global | Description |
|--------|-------------|
| `addMenuItem(label, callback, order)` | Add item to RebelShip Menu |
| `addSubMenu(parentLabel, items)` | Add a submenu with multiple items |
| `window.RebelShipBridge.storage` | IndexedDB storage API (get/set/delete) |
| `window.RebelShipNotify.notify(message)` | Send system notification (mobile) |
| `window.rebelshipBackgroundJobs` | Array to register background jobs |

### Adding a Menu Item

```javascript
/* globals addMenuItem */

// addMenuItem(label, callback, order)
addMenuItem('My Script', openSettingsModal, 30);
```

| Parameter | Description |
|-----------|-------------|
| `label` | Text shown in the menu |
| `callback` | Function called when clicked |
| `order` | Position in menu (same as @order header) |

### Adding a Submenu

```javascript
/* globals addSubMenu */

// addSubMenu(parentLabel, items)
addSubMenu('Export Data', [
    { label: 'Export as CSV', callback: exportCSV },
    { label: 'Export as JSON', callback: exportJSON }
]);
```

### Sending Notifications (Mobile)

```javascript
// Check if available, then send notification
if (typeof window.RebelShipNotify !== 'undefined' && window.RebelShipNotify.notify) {
    try {
        window.RebelShipNotify.notify('MyScript: Task completed!');
    } catch (e) {
        console.error('Notification failed:', e);
    }
}
```

### Using RebelShipBridge Storage

RebelShipBridge provides IndexedDB-based storage that persists across sessions and syncs with mobile apps.

```javascript
var SCRIPT_NAME = 'MyScript';
var STORE_NAME = 'data';

// Read from storage
async function dbGet(key) {
    try {
        var result = await window.RebelShipBridge.storage.get(SCRIPT_NAME, STORE_NAME, key);
        if (result) {
            return JSON.parse(result);
        }
        return null;
    } catch (e) {
        console.error('[MyScript] dbGet error:', e);
        return null;
    }
}

// Write to storage
async function dbSet(key, value) {
    try {
        await window.RebelShipBridge.storage.set(SCRIPT_NAME, STORE_NAME, key, JSON.stringify(value));
        return true;
    } catch (e) {
        console.error('[MyScript] dbSet error:', e);
        return false;
    }
}

// Usage
var settings = await dbGet('settings');
await dbSet('settings', { enabled: true, threshold: 50 });
```

#### Storage Namespacing

Each script should use its own namespace:
- `SCRIPT_NAME` = unique identifier (e.g., 'AutoRepair', 'SmugglersEye')
- `STORE_NAME` = usually 'data'
- `key` = data key within the namespace (e.g., 'settings', 'cache')

#### Shared Storage Pattern

Some scripts need to share data. Example: Smuggler's Eye writes pending route settings that DepartManager reads.

```javascript
// Writing to another script's storage (shared data)
async function dbGetShared() {
    try {
        var result = await window.RebelShipBridge.storage.get('DepartManager', 'data', 'storage');
        if (result) { return JSON.parse(result); }
        return null;
    } catch (e) { return null; }
}

async function dbSetShared(data) {
    try {
        await window.RebelShipBridge.storage.set('DepartManager', 'data', 'storage', JSON.stringify(data));
        return true;
    } catch (e) { return false; }
}

// Save pending route settings for a vessel
async function savePendingRouteSettings(vesselId, data) {
    var storage = await dbGetShared();
    if (!storage) {
        storage = { settings: {}, pendingRouteSettings: {} };
    }
    if (!storage.pendingRouteSettings) {
        storage.pendingRouteSettings = {};
    }
    storage.pendingRouteSettings[vesselId] = {
        name: data.name,
        speed: data.speed,
        guards: data.guards,
        prices: data.prices,
        savedAt: Date.now()
    };
    await dbSetShared(storage);
}
```

### Registering Background Jobs

Background jobs allow scripts to run periodically even when the app is in the background (mobile).

**Step 1:** Add the header field:
```javascript
// @background-job-required true
```

**Step 2:** Create a run function and register the job:
```javascript
// Create the run function
window.rebelshipRunMyScript = async function() {
    console.log('[MyScript] Background job running');

    // Do your background work here
    await checkAndProcess();

    return { success: true, message: 'Completed' };
};

// Register with background job system
if (!window.rebelshipBackgroundJobs) {
    window.rebelshipBackgroundJobs = [];
}
window.rebelshipBackgroundJobs.push({
    name: 'MyScript',
    interval: 15 * 60 * 1000, // Run every 15 minutes
    run: async function() {
        return await window.rebelshipRunMyScript();
    }
});
```

| Property | Description |
|----------|-------------|
| `name` | Unique identifier for the job |
| `interval` | Time between runs in milliseconds |
| `run` | Async function that performs the work |

### Creating a Settings Modal

Use the game-style modal pattern for consistent UI:

```javascript
function openSettingsModal() {
    // Create modal wrapper
    var wrapper = document.createElement('div');
    wrapper.id = 'myscript-modal-wrapper';
    wrapper.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100001;display:flex;align-items:center;justify-content:center;';

    // Background overlay
    var bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);';
    bg.addEventListener('click', closeModal);
    wrapper.appendChild(bg);

    // Content wrapper (for animation)
    var contentWrapper = document.createElement('div');
    contentWrapper.style.cssText = 'position:relative;z-index:1;animation:myscript-fade-in 0.2s ease-out;';
    wrapper.appendChild(contentWrapper);

    // Main container
    var container = document.createElement('div');
    container.style.cssText = 'background:#c6cbdb;border-radius:12px;overflow:hidden;width:400px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
    contentWrapper.appendChild(container);

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'background:#626b90;color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;';
    header.innerHTML = '<span style="font-size:18px;font-weight:700;">My Script Settings</span>';

    var closeBtn = document.createElement('button');
    closeBtn.innerHTML = 'X';
    closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0;width:30px;height:30px;';
    closeBtn.addEventListener('click', closeModal);
    header.appendChild(closeBtn);
    container.appendChild(header);

    // Content area
    var content = document.createElement('div');
    content.style.cssText = 'flex:1;overflow-y:auto;padding:0;';
    container.appendChild(content);

    // Central container (main settings area)
    var centralContainer = document.createElement('div');
    centralContainer.style.cssText = 'background:#e9effd;margin:16px;border-radius:8px;padding:20px;';
    content.appendChild(centralContainer);

    // Add your settings HTML here
    centralContainer.innerHTML = buildSettingsHTML();

    // Add CSS animation
    var style = document.createElement('style');
    style.textContent = '@keyframes myscript-fade-in { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }';
    wrapper.appendChild(style);

    document.body.appendChild(wrapper);
    attachEventListeners();
}

function closeModal() {
    var wrapper = document.getElementById('myscript-modal-wrapper');
    if (wrapper) wrapper.remove();
}
```

### Input Styling (Game-Style)

```html
<!-- Checkbox -->
<label style="display:flex;align-items:center;cursor:pointer;">
    <input type="checkbox" id="my-checkbox"
           style="width:20px;height:20px;margin-right:12px;accent-color:#0db8f4;cursor:pointer;">
    <span style="font-weight:600;">Setting Label</span>
</label>

<!-- Number Input -->
<input type="number" id="my-number" min="1" max="100" value="50"
       class="redesign"
       style="width:100%;height:2rem;padding:0 0.5rem;background:#ebe9ea;border:0;border-radius:7px;color:#01125d;font-size:14px;font-family:Lato,sans-serif;text-align:center;box-sizing:border-box;">

<!-- Select Dropdown -->
<select id="my-select" class="redesign"
        style="width:100%;height:2rem;padding:0 0.5rem;background:#ebe9ea;border:0;border-radius:7px;color:#01125d;font-size:14px;font-family:Lato,sans-serif;text-align:center;box-sizing:border-box;cursor:pointer;">
    <option value="option1">Option 1</option>
    <option value="option2">Option 2</option>
</select>

<!-- Save Button -->
<button id="my-save"
        style="padding:10px 24px;background:linear-gradient(180deg,#46ff33,#129c00);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:16px;font-weight:500;font-family:Lato,sans-serif;">
    Save
</button>

<!-- Run Now Button -->
<button id="my-run"
        style="padding:10px 24px;background:linear-gradient(180deg,#3b82f6,#1d4ed8);border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:500;font-family:Lato,sans-serif;">
    Run Now
</button>
```

### Disabling Sub-Options

When a main toggle is off, disable related sub-options:

```javascript
// In HTML template
var disabledAttr = settings.enabled ? '' : ' disabled';
var wrapperStyle = settings.enabled ? '' : 'opacity:0.5;pointer-events:none;';

html += '<div id="options-wrapper" style="' + wrapperStyle + '">';
html += '<input type="checkbox" id="sub-option"' + disabledAttr + '>';
html += '</div>';

// Event listener for main toggle
document.getElementById('main-toggle').addEventListener('change', function() {
    var wrapper = document.getElementById('options-wrapper');
    var inputs = wrapper.querySelectorAll('input');
    if (this.checked) {
        wrapper.style.opacity = '';
        wrapper.style.pointerEvents = '';
        inputs.forEach(function(inp) { inp.disabled = false; });
    } else {
        wrapper.style.opacity = '0.5';
        wrapper.style.pointerEvents = 'none';
        inputs.forEach(function(inp) { inp.disabled = true; });
    }
});
```

### Background Job Pattern

For scripts that run periodically:

```javascript
var CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
var monitorInterval = null;

function startMonitoring() {
    if (monitorInterval) return;
    monitorInterval = setInterval(runCheck, CHECK_INTERVAL_MS);
    console.log('[MyScript] Monitoring started');
}

function stopMonitoring() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
    console.log('[MyScript] Monitoring stopped');
}

async function runCheck() {
    if (!settings.enabled) return;
    // Your periodic logic here
}

// Expose for Android background service
window.rebelshipRunMyScript = async function() {
    if (!settings.enabled) {
        return { skipped: true, reason: 'disabled' };
    }
    await runCheck();
    return { success: true };
};
```

### Pinia Store Access

Access game state via Vue's Pinia stores:

```javascript
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

// Available stores: 'user', 'vessel', 'modal', 'toast', 'game', 'port', etc.
var userStore = getStore('user');
var cash = userStore.user.cash;
```

### Fetch Interceptor Pattern

Intercept API calls to hook into game events:

```javascript
var originalFetch = window.fetch;

window.fetch = async function() {
    var url = arguments[0];
    var options = arguments[1];

    // Pre-request hook
    if (url.includes('/api/vessel/depart')) {
        await beforeDepart(options);
    }

    var response = await originalFetch.apply(this, arguments);

    // Post-response hook
    if (url.includes('/api/vessel/data')) {
        var clone = response.clone();
        var data = await clone.json();
        handleVesselData(data);
    }

    return response;
};
```

---

## Background Execution

Scripts with `@background-job-required true` support background execution:

| Script | Background Function |
|--------|---------------------|
| departmanager.user.js | Auto-Bunker, Auto-Depart |
| auto-repair.user.js | Auto-Repair |
| auto-happy-stuff.user.js | Auto salary adjustment |
| auto-coop-tickets-display.user.js | Auto-COOP sending |
| auto-drydock.user.js | Auto-Drydock/Moor |
| smugglers-eye.user.js | Price optimization |

These scripts sync settings with RebelShip Browser via `RebelShipBridge`.

---

## Compatibility

- Tested with Shipping Manager as of February 2026
- **Requires RebelShip Browser** (Windows or Android)
- Does NOT work with Tampermonkey, Violentmonkey or Greasemonkey
- Scripts depend on RebelShipBridge API and SQLCipher database

## Disclaimer

These scripts interact with the Shipping Manager game interface. Use at your own risk.

## License

MIT License - See [LICENSE](LICENSE) for details.
