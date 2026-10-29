/**
 * Air-Gapped Wi-Fi Integrity Guard - Client-Side Controller
 * Officers Training College (OTC), AMC Centre & College, Lucknow
 * Zero External Dependencies (Air-gapped compliant)
 *
 * Enforces strict network-fence policies:
 * - Continuously polls backend /api/wifi-heartbeat every 2.5 seconds
 * - Immediately intercepts Wi-Fi disconnects or network switches
 * - Displays an impenetrable, non-dismissible military lockdown screen
 * - Automatically resumes when connection to authorized Wi-Fi is restored
 */

(function () {
    'use strict';

    // State container
    const state = {
        isLocked: false,
        isPolling: false,
        pollIntervalMs: 2500,
        timerId: null,
        pausedMedia: [],
        lastViolationReason: '',
        diagnostics: {
            authorizedSsid: '',
            authorizedSubnet: '',
            clientIp: '',
            currentSsid: '',
            gateway: ''
        }
    };

    // Initialize once DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWifiGuard);
    } else {
        initWifiGuard();
    }

    function initWifiGuard() {
        createLockdownDom();
        bindNetworkEvents();
        startPolling();
    }

    // Create the overlay DOM if not already present
    function createLockdownDom() {
        if (document.getElementById('wifi-lockdown-overlay')) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'wifi-lockdown-overlay';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'wifi-lock-title');
        overlay.setAttribute('aria-describedby', 'wifi-lock-desc');

        overlay.innerHTML = `
            <div class="wifi-lock-card" id="wifi-lock-card">
                <div class="wifi-lock-header">
                    <img src="/college-crest.png" alt="OTC Crest" class="wifi-lock-emblem" onerror="this.src='/OTC.png'; this.onerror=null;">
                    <div class="wifi-lock-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        <span>Air-Gap Integrity Fence</span>
                    </div>
                    <h2 class="wifi-lock-title" id="wifi-lock-title">Wi-Fi Network Lockdown</h2>
                    <p class="wifi-lock-subtitle">Officers Training College, AMC Centre &amp; College, Lucknow</p>
                </div>

                <div class="wifi-radar-box" id="wifi-radar-box">
                    <div class="wifi-radar-circle c1"></div>
                    <div class="wifi-radar-circle c2"></div>
                    <div class="wifi-radar-sweep" id="wifi-radar-sweep"></div>
                    <div class="wifi-radar-icon" id="wifi-radar-icon">
                        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                            <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                            <line x1="12" y1="20" x2="12.01" y2="20"></line>
                        </svg>
                    </div>
                </div>

                <div class="wifi-lock-notice">
                    <div class="wifi-lock-reason" id="wifi-lock-desc">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0; margin-top:2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        <span id="wifi-lock-reason-text">Application halted: Not connected to the authorized OTC Wi-Fi network.</span>
                    </div>

                    <div class="wifi-diagnostics-grid">
                        <div class="wifi-diag-item">
                            <span class="wifi-diag-label">Authorized Wi-Fi</span>
                            <span class="wifi-diag-val highlight" id="wifi-diag-auth-ssid">Configuring...</span>
                        </div>
                        <div class="wifi-diag-item">
                            <span class="wifi-diag-label">Detected Status</span>
                            <span class="wifi-diag-val" id="wifi-diag-status" style="color: #ef4444;">UNAUTHORIZED / OFFLINE</span>
                        </div>
                        <div class="wifi-diag-item">
                            <span class="wifi-diag-label">Authorized Subnet</span>
                            <span class="wifi-diag-val" id="wifi-diag-subnet">--</span>
                        </div>
                        <div class="wifi-diag-item">
                            <span class="wifi-diag-label">Client IP Address</span>
                            <span class="wifi-diag-val" id="wifi-diag-client-ip">--</span>
                        </div>
                    </div>
                </div>

                <div class="wifi-lock-directive">
                    <strong>RESTRICTED DEFENCE AIR-GAP POLICY (CERT-In / ACG)</strong><br>
                    Instructional content, tactical lectures, and assessments are legally restricted to the designated military Wi-Fi network. Reconnect your device to the designated Wi-Fi access point to resume training.
                </div>

                <div class="wifi-lock-actions">
                    <button type="button" class="btn-wifi-scan" id="btn-wifi-retry" onclick="window.WifiGuard.checkNow()">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                        <span>Scan &amp; Re-verify Network</span>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    // Attach OS/Browser network status event listeners
    function bindNetworkEvents() {
        window.addEventListener('offline', () => {
            activateLockdown('Physical Wi-Fi / Local Area Connection disconnected.');
        });

        window.addEventListener('online', () => {
            checkHeartbeat();
        });
    }

    // Start background poller
    function startPolling() {
        if (state.timerId) {
            clearInterval(state.timerId);
        }
        checkHeartbeat();
        state.timerId = setInterval(checkHeartbeat, state.pollIntervalMs);
    }

    // Perform verification against /api/wifi-heartbeat
    async function checkHeartbeat() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);

            const res = await fetch('/api/wifi-heartbeat?_t=' + Date.now(), {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.status === 200) {
                const data = await res.json();
                if (data.allowed) {
                    if (state.isLocked) {
                        deactivateLockdown(data.data);
                    } else {
                        updateDiagnosticsData(data.data);
                    }
                    return;
                }
            }

            // HTTP 403 or allowed: false
            let errData = null;
            try {
                errData = await res.json();
            } catch (_) {}

            const reason = (errData && errData.message)
                ? errData.message
                : 'Connected to an untrusted Wi-Fi network or access point.';

            activateLockdown(reason, errData ? errData.data : null);

        } catch (fetchErr) {
            // Server is unreachable - client left local Wi-Fi or router dropped
            activateLockdown('Offline server unreachable. Verify your device is connected to the authorized OTC Wi-Fi network.');
        }
    }

    // Activate Lockdown Screen
    function activateLockdown(reason, details) {
        state.lastViolationReason = reason;
        state.isLocked = true;

        pauseActiveMedia();

        const overlay = document.getElementById('wifi-lockdown-overlay');
        const card = document.getElementById('wifi-lock-card');
        const reasonEl = document.getElementById('wifi-lock-reason-text');
        const statusEl = document.getElementById('wifi-diag-status');
        const iconBox = document.getElementById('wifi-radar-icon');

        if (overlay) {
            overlay.classList.add('active');
            document.body.classList.add('wifi-locked');
        }

        if (card) {
            card.classList.remove('restored');
        }

        if (reasonEl) {
            reasonEl.textContent = reason;
        }

        if (statusEl) {
            statusEl.textContent = 'ACCESS LOCKED';
            statusEl.style.color = '#ef4444';
        }

        if (iconBox) {
            iconBox.innerHTML = `
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                    <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                </svg>
            `;
        }

        if (details) {
            updateDiagnosticsData(details);
        }

        window.dispatchEvent(new CustomEvent('wifiguard:lock', { detail: { reason, details } }));
    }

    // Deactivate Lockdown Screen (Self-Healing / Reconnected)
    function deactivateLockdown(details) {
        state.isLocked = false;
        updateDiagnosticsData(details);

        const card = document.getElementById('wifi-lock-card');
        const reasonEl = document.getElementById('wifi-lock-reason-text');
        const statusEl = document.getElementById('wifi-diag-status');
        const iconBox = document.getElementById('wifi-radar-icon');

        if (card) {
            card.classList.add('restored');
        }

        if (reasonEl) {
            reasonEl.innerHTML = '<strong style="color:#10b981;">Authorized Wi-Fi Verified:</strong> Network integrity confirmed. Resuming session...';
        }

        if (statusEl) {
            statusEl.textContent = 'AUTHORIZED & ACTIVE';
            statusEl.style.color = '#10b981';
        }

        if (iconBox) {
            iconBox.innerHTML = `
                <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                    <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <polyline points="9 11 12 14 22 4" stroke-width="2.5"></polyline>
                </svg>
            `;
        }

        // Smoothly fade out overlay after visual confirmation
        setTimeout(() => {
            const overlay = document.getElementById('wifi-lockdown-overlay');
            if (overlay && !state.isLocked) {
                overlay.classList.remove('active');
                document.body.classList.remove('wifi-locked');
            }
        }, 550);

        window.dispatchEvent(new CustomEvent('wifiguard:unlock', { detail: { details } }));
    }

    // Update diagnostic fields
    function updateDiagnosticsData(data) {
        if (!data) return;

        const authSsidEl = document.getElementById('wifi-diag-auth-ssid');
        const subnetEl = document.getElementById('wifi-diag-subnet');
        const clientIpEl = document.getElementById('wifi-diag-client-ip');

        if (authSsidEl) {
            authSsidEl.textContent = data.authorized_ssid || (data.is_locked ? 'Strict Wi-Fi Lock' : 'Auto-Discovery Mode');
        }
        if (subnetEl) {
            subnetEl.textContent = data.authorized_subnet || 'LAN Subnet';
        }
        if (clientIpEl) {
            clientIpEl.textContent = data.client_ip || '--';
        }

        state.diagnostics = {
            authorizedSsid: data.authorized_ssid || '',
            authorizedSubnet: data.authorized_subnet || '',
            clientIp: data.client_ip || '',
            currentSsid: data.current_ssid || '',
            gateway: data.current_gateway || ''
        };
    }

    // Pause any playing media immediately
    function pauseActiveMedia() {
        state.pausedMedia = [];
        const mediaElements = document.querySelectorAll('video, audio');
        mediaElements.forEach(el => {
            if (!el.paused) {
                state.pausedMedia.push(el);
                try {
                    el.pause();
                } catch (_) {}
            }
        });
    }

    // Public API
    window.WifiGuard = {
        checkNow: async function () {
            const btn = document.getElementById('btn-wifi-retry');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    <span>Verifying Wi-Fi...</span>
                `;
            }
            await checkHeartbeat();
            if (btn) {
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                        <span>Scan &amp; Re-verify Network</span>
                    `;
                }, 400);
            }
        },

        lock: function (reason, details) {
            activateLockdown(reason || 'Manual security lock triggered.', details);
        },

        unlock: function (details) {
            deactivateLockdown(details || state.diagnostics);
        },

        simulateLock: function (seconds = 5) {
            activateLockdown('SIMULATION TEST: Wi-Fi network change detected (Auto-recovering in ' + seconds + 's)...');
            setTimeout(() => {
                checkHeartbeat();
            }, seconds * 1000);
        },

        getStatus: function () {
            return {
                isLocked: state.isLocked,
                diagnostics: state.diagnostics,
                lastReason: state.lastViolationReason
            };
        }
    };

})();
