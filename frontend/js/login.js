// Dronacharya LMS - Secure Login Handler
document.addEventListener('DOMContentLoaded', () => {
    // Apply saved theme preference (Dark / Light)
    let _themeToggling = false;
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        themeBtn.onclick = toggleTheme;
    }

    const savedTheme = localStorage.getItem('dronacharya_theme') || localStorage.getItem('ekalavya_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeLabel(savedTheme);

    function toggleTheme(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (_themeToggling) return;
        _themeToggling = true;
        setTimeout(() => { _themeToggling = false; }, 200);

        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('dronacharya_theme', next);
        localStorage.setItem('ekalavya_theme', next);
        updateThemeLabel(next);
    }

    function updateThemeLabel(theme) {
        const label = document.getElementById('theme-label-text');
        if (label) {
            label.textContent = theme === 'dark' ? 'Light' : 'Dark';
        }
        if (themeBtn) {
            themeBtn.setAttribute('title', theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme');
        }
    }

    // Check if already logged in
    fetch('/api/session').then(r => r.json()).then(data => {
        if (data.status === 'success' && data.data) {
            if (data.csrf_token) {
                sessionStorage.setItem('ek_csrf_token', data.csrf_token);
            }
            window.location.href = '/portal.html';
        }
    }).catch(() => {});

    // Show / Hide Password Toggle
    const togglePasswordBtn = document.getElementById('btn-toggle-password');
    const passwordInput = document.getElementById('password');
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isPassword = passwordInput.getAttribute('type') === 'password';
            passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
            
            const eyeShow = togglePasswordBtn.querySelector('.eye-show');
            const eyeHide = togglePasswordBtn.querySelector('.eye-hide');
            if (eyeShow && eyeHide) {
                eyeShow.style.display = isPassword ? 'none' : 'block';
                eyeHide.style.display = isPassword ? 'block' : 'none';
            }
            const label = isPassword ? 'Hide password' : 'Show password';
            togglePasswordBtn.setAttribute('title', label);
            togglePasswordBtn.setAttribute('aria-label', label);
            passwordInput.focus();
        });
    }

    let lockoutTimerInterval = null;

    function stopLockoutCountdown() {
        if (lockoutTimerInterval) {
            clearInterval(lockoutTimerInterval);
            lockoutTimerInterval = null;
        }
    }

    function startLockoutCountdown(totalSeconds, cleanUsername, lockoutMessage) {
        stopLockoutCountdown();

        const errEl = document.getElementById('login-error');
        const btn = document.getElementById('btn-login');

        let remaining = Math.max(1, parseInt(totalSeconds, 10) || 1800);

        if (cleanUsername) {
            sessionStorage.setItem('otc_lockout_' + cleanUsername, String(Date.now() + remaining * 1000));
        }

        // Keep the exact original text returned by the server, without changing it or adding other text
        if (lockoutMessage) {
            errEl.textContent = lockoutMessage;
        } else if (!errEl.textContent || errEl.innerHTML.includes('<svg') || errEl.innerHTML.includes('<strong')) {
            errEl.textContent = 'Account is temporarily locked due to multiple failed login attempts. Please try again in 30 minutes.';
        }
        errEl.classList.add('visible');

        function renderBtnTick() {
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `
                    <span style="display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        Locked (${timeStr})
                    </span>
                `;
            }
        }

        renderBtnTick();

        lockoutTimerInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                stopLockoutCountdown();
                if (cleanUsername) {
                    sessionStorage.removeItem('otc_lockout_' + cleanUsername);
                }
                errEl.classList.remove('visible');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Authenticate & Enter Portal';
                }
            } else {
                renderBtnTick();
            }
        }, 1000);
    }

    function checkStoredLockout() {
        const usernameInput = document.getElementById('username');
        if (!usernameInput) return;
        const cleanUser = usernameInput.value.trim().toLowerCase();
        if (!cleanUser) return;

        const storedExpiry = parseInt(sessionStorage.getItem('otc_lockout_' + cleanUser) || '0', 10);
        const now = Date.now();
        if (storedExpiry > now) {
            const remainingSecs = Math.ceil((storedExpiry - now) / 1000);
            startLockoutCountdown(remainingSecs, cleanUser);
        }
    }

    const usernameField = document.getElementById('username');
    if (usernameField) {
        usernameField.addEventListener('blur', checkStoredLockout);
        usernameField.addEventListener('input', () => {
            const cleanUser = usernameField.value.trim().toLowerCase();
            const storedExpiry = parseInt(sessionStorage.getItem('otc_lockout_' + cleanUser) || '0', 10);
            if (storedExpiry <= Date.now() && lockoutTimerInterval) {
                stopLockoutCountdown();
                const errEl = document.getElementById('login-error');
                if (errEl) errEl.classList.remove('visible');
                const btn = document.getElementById('btn-login');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Authenticate & Enter Portal';
                }
            }
        });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login');
            const errEl = document.getElementById('login-error');
            stopLockoutCountdown();
            errEl.classList.remove('visible');
            btn.disabled = true;
            btn.textContent = 'Authenticating...';

            const rawUsername = document.getElementById('username').value.trim();
            const cleanUser = rawUsername.toLowerCase();
            const password = document.getElementById('password').value;

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: rawUsername,
                        password: password
                    })
                });

                const data = await res.json();

                if (data.status === 'success') {
                    if (data.csrf_token) {
                        sessionStorage.setItem('ek_csrf_token', data.csrf_token);
                    }
                    sessionStorage.removeItem('otc_lockout_' + cleanUser);
                    btn.textContent = 'Access Granted ✓';
                    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                    setTimeout(() => {
                        window.location.href = '/portal.html';
                    }, 600);
                } else {
                    // Check if account is locked or rate-limited
                    const isLocked = data.locked === true || 
                        (data.retry_after !== undefined && data.retry_after > 0) ||
                        (typeof data.message === 'string' && /locked/i.test(data.message));

                    if (isLocked) {
                        let retrySecs = parseInt(data.retry_after, 10);
                        if (!retrySecs || isNaN(retrySecs)) {
                            // Extract minutes from message if present (e.g. "Please try again in 23 minutes")
                            const minMatch = typeof data.message === 'string' ? data.message.match(/(\d+)\s*minute/i) : null;
                            retrySecs = minMatch ? parseInt(minMatch[1], 10) * 60 : 1800;
                        }
                        startLockoutCountdown(retrySecs, cleanUser, data.message);
                    } else if (data.attempts_left !== undefined) {
                        // Display invalid credentials with remaining attempts pill
                        const attempts = parseInt(data.attempts_left, 10);
                        const attemptWord = attempts === 1 ? 'attempt' : 'attempts';

                        errEl.innerHTML = `
                            <div class="login-attempt-warning">
                                <div class="login-attempt-msg">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <line x1="12" y1="8" x2="12" y2="12"></line>
                                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                    </svg>
                                    <span>Invalid username or password.</span>
                                </div>
                                <div class="attempts-left-pill">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                    <span>${attempts} ${attemptWord} left</span>
                                </div>
                            </div>
                        `;
                        errEl.classList.add('visible');
                        btn.disabled = false;
                        btn.textContent = 'Authenticate & Enter Portal';
                    } else {
                        errEl.textContent = data.message || 'Authentication failed';
                        errEl.classList.add('visible');
                        btn.disabled = false;
                        btn.textContent = 'Authenticate & Enter Portal';
                    }
                }
            } catch (err) {
                errEl.textContent = 'Connection error. Ensure you are on the secure LAN.';
                errEl.classList.add('visible');
                btn.disabled = false;
                btn.textContent = 'Authenticate & Enter Portal';
            }
        });
    }
});
