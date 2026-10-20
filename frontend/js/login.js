// Dronacharya LMS - Secure Login Handler
document.addEventListener('DOMContentLoaded', () => {
    // Apply saved theme preference (Dark / Light)
    const savedTheme = localStorage.getItem('dronacharya_theme') || localStorage.getItem('ekalavya_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeLabel(savedTheme);

    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }

    function toggleTheme() {
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
            label.textContent = theme === 'dark' ? 'Dark' : 'Light';
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

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login');
            const errEl = document.getElementById('login-error');
            errEl.classList.remove('visible');
            btn.disabled = true;
            btn.textContent = 'Authenticating...';

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: document.getElementById('username').value.trim(),
                        password: document.getElementById('password').value
                    })
                });

                const data = await res.json();

                if (data.status === 'success') {
                    if (data.csrf_token) {
                        sessionStorage.setItem('ek_csrf_token', data.csrf_token);
                    }
                    btn.textContent = 'Access Granted ✓';
                    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                    setTimeout(() => {
                        window.location.href = '/portal.html';
                    }, 600);
                } else {
                    errEl.textContent = data.message || 'Authentication failed';
                    errEl.classList.add('visible');
                    btn.disabled = false;
                    btn.textContent = 'Authenticate & Enter Portal';
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
