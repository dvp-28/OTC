/**
 * DRONACHARYA LMS - Authenticated Portal Logic
 * Role-based UI: Institute Admin | Course Admin | Student Officer
 * Connected to Moodle MySQL via /api/ endpoints
 */

let currentUser = null;
let courses = [];
let activeCourseId = null;
let allUsers = [];

// Central HTML sanitization & escaping utilities (SEC-D01)
function esc(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
const escapeHtml = esc;

function escJs(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}

// Video player state variables
let activePlayingPptId = null;
let activePlayingPptTitle = '';
let isVideoPlaying = false;
let videoCurrentTime = 0;
let videoDuration = 1800; // 30 mins standard lecture duration
let videoPlaybackTimer = null;
let videoCanvasAnimId = null;
let canvasAnimTime = 0;
let currentLoadedPpts = [];
let activeMediaMode = 'simulated'; // 'video' | 'audio' | 'simulated'

let csrfToken = sessionStorage.getItem('ek_csrf_token') || '';

// Central request interceptor: attach anti-CSRF token to mutating requests (SEC-C01)
const _nativeFetch = window.fetch;
window.fetch = function(url, options = {}) {
    const opts = Object.assign({}, options);
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const token = csrfToken || sessionStorage.getItem('ek_csrf_token') || '';
        if (token) {
            if (opts.headers instanceof Headers) {
                if (!opts.headers.has('X-CSRF-Token')) {
                    opts.headers.set('X-CSRF-Token', token);
                }
            } else if (Array.isArray(opts.headers)) {
                const hasToken = opts.headers.some(h => h[0].toLowerCase() === 'x-csrf-token');
                if (!hasToken) {
                    opts.headers.push(['X-CSRF-Token', token]);
                }
            } else {
                opts.headers = Object.assign({}, opts.headers, {
                    'X-CSRF-Token': token
                });
            }
        }
    }
    return _nativeFetch(url, opts);
};

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

// ============================================================
// AUTH
// ============================================================
async function checkSession() {
    try {
        const res = await fetch('/api/session');
        const data = await res.json();
        if (data.status === 'success' && data.data) {
            currentUser = data.data;
            if (data.csrf_token) {
                csrfToken = data.csrf_token;
                sessionStorage.setItem('ek_csrf_token', csrfToken);
            }
            initPortal();
        } else {
            window.location.href = '/login.html';
        }
    } catch (e) {
        window.location.href = '/login.html';
    }
}

async function logout() {
    await fetch('/api/logout');
    window.location.href = '/login.html';
}

// Theme Engine (Dark / Light Mode - Matching Login Page)
let _themeToggling = false;

function toggleTheme(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (_themeToggling) return;
    _themeToggling = true;
    setTimeout(() => { _themeToggling = false; }, 200);

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('dronacharya_theme', newTheme);
    localStorage.setItem('ekalavya_theme', newTheme);
    applyTheme(newTheme);
}
window.toggleTheme = toggleTheme;

function initTheme() {
    const savedTheme = localStorage.getItem('dronacharya_theme') || localStorage.getItem('ekalavya_theme') || 'dark';
    applyTheme(savedTheme);

    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        themeBtn.onclick = toggleTheme;
    }
}

function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        document.body.classList.add('theme-light');
        document.body.classList.remove('theme-dark');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.body.classList.add('theme-dark');
        document.body.classList.remove('theme-light');
    }

    // Action label: In dark mode, show "Light" (action to switch to light).
    // In light mode, show "Dark" (action to switch to dark).
    const label = document.getElementById('theme-label-text');
    if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';

    const menuText = document.getElementById('menu-theme-text');
    if (menuText) menuText.textContent = theme === 'dark' ? 'Light' : 'Dark';

    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) {
        toggleBtn.setAttribute('title', theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme');
        if (theme === 'dark') {
            toggleBtn.classList.remove('active');
        } else {
            toggleBtn.classList.add('active');
        }
    }
}

// ============================================================
// TIME FORMAT ENGINE (12-Hour AM/PM vs 24-Hour)
// ============================================================
let currentLoadedCanUpload = false;

function getTimeFormat() {
    return localStorage.getItem('otc_time_format') || '12h';
}

function setTimeFormat(format) {
    const valid = (format === '24h') ? '24h' : '12h';
    localStorage.setItem('otc_time_format', valid);
    try {
        document.cookie = `otc_time_format=${valid}; path=/; max-age=31536000; SameSite=Lax`;
    } catch (e) {}
    applyTimeFormatUI(valid);
    refreshAllFormattedTimes();
}
window.setTimeFormat = setTimeFormat;

function toggleTimeFormat() {
    const current = getTimeFormat();
    setTimeFormat(current === '12h' ? '24h' : '12h');
}
window.toggleTimeFormat = toggleTimeFormat;

function applyTimeFormatUI(format) {
    const is12 = (format === '12h');
    
    // Header toggle button label
    const label = document.getElementById('time-format-label-text');
    if (label) {
        label.textContent = is12 ? '12-Hour' : '24-Hour';
    }

    const btn = document.getElementById('time-format-toggle-btn');
    if (btn) {
        btn.setAttribute('title', is12 ? 'Current: 12-Hour (AM/PM) • Click to switch to 24-Hour' : 'Current: 24-Hour • Click to switch to 12-Hour (AM/PM)');
    }

    // Settings popup buttons active state
    const opt12 = document.getElementById('opt-time-12h');
    const opt24 = document.getElementById('opt-time-24h');
    if (opt12) {
        opt12.style.background = is12 ? 'var(--gold-primary)' : 'transparent';
        opt12.style.color = is12 ? '#000000' : 'var(--text-muted)';
        opt12.style.fontWeight = is12 ? '700' : '500';
    }
    if (opt24) {
        opt24.style.background = !is12 ? 'var(--gold-primary)' : 'transparent';
        opt24.style.color = !is12 ? '#000000' : 'var(--text-muted)';
        opt24.style.fontWeight = !is12 ? '700' : '500';
    }
}

function formatTimeOnly(dateObj) {
    const d = (dateObj instanceof Date) ? dateObj : new Date(dateObj);
    if (isNaN(d.getTime())) return '';
    const is12 = (getTimeFormat() === '12h');
    const hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');

    if (is12) {
        const ampm = hours >= 12 ? 'PM' : 'AM';
        let h12 = hours % 12;
        if (h12 === 0) h12 = 12;
        const hStr = String(h12).padStart(2, '0');
        return `${hStr}:${minutes} ${ampm}`;
    } else {
        const hStr = String(hours).padStart(2, '0');
        return `${hStr}:${minutes}`;
    }
}

function formatDateTime(val) {
    if (!val) return '-';
    let d;
    if (typeof val === 'number') {
        d = new Date(val > 1e11 ? val : val * 1000);
    } else if (typeof val === 'string') {
        const trimmed = val.trim();
        if (/^\d+$/.test(trimmed)) {
            const num = Number(trimmed);
            d = new Date(num > 1e11 ? num : num * 1000);
        } else {
            d = new Date(trimmed.replace(',', ''));
            if (isNaN(d.getTime())) {
                d = new Date(trimmed);
            }
        }
    } else if (val instanceof Date) {
        d = val;
    }

    if (!d || isNaN(d.getTime())) {
        return val;
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const timeStr = formatTimeOnly(d);

    return `${day} ${month} ${year}, ${timeStr}`;
}
window.formatDateTime = formatDateTime;
window.formatTimeOnly = formatTimeOnly;

function refreshAllFormattedTimes() {
    document.querySelectorAll('.ppt-time-val').forEach(el => {
        const rawTime = el.getAttribute('data-raw-time');
        if (rawTime) {
            el.textContent = formatDateTime(rawTime);
        }
    });

    if (Array.isArray(currentLoadedPpts) && currentLoadedPpts.length > 0) {
        renderCoursePpts(currentLoadedPpts, currentLoadedCanUpload);
    }
}

function initTimeFormat() {
    const saved = getTimeFormat();
    applyTimeFormatUI(saved);
}

// Immediately initialize theme and time format on script load
initTheme();
initTimeFormat();

// ============================================================
// INIT PORTAL
// ============================================================
function initPortal() {
    initTheme();
    initTimeFormat();
    renderUserHeader();
    applyRoleUI();
    updateOfficerWatermark();
    setupTabs();
    setupFilters();
    setupVideoPlayerEvents();
    loadDashboardData();
    loadCourses();
    initCommandersSlider();

    const phoneInput = document.getElementById('user-form-phone');
    if (phoneInput && !phoneInput.dataset.bound) {
        phoneInput.dataset.bound = 'true';
        phoneInput.addEventListener('blur', () => {
            if (phoneInput.value.trim()) {
                phoneInput.value = formatMobileNumber(phoneInput.value.trim());
            }
        });
    }
}

// Dynamic Officer Visual Identification Watermark Overlay (SEC-F03)
function updateOfficerWatermark() {
    const wm = document.getElementById('dynamic-officer-watermark');
    if (!wm || !currentUser) return;
    const now = new Date().toISOString().split('T')[0];
    const userRole = esc(currentUser.role || 'Officer');
    const uName = esc(currentUser.username || '').toUpperCase();
    const full = esc(`${currentUser.firstname || ''} ${currentUser.lastname || ''}`);
    const text = `RESTRICTED DEFENCE USE ONLY // ${uName} (${full} - ${userRole}) // OTC AMC CENTRE // ${now}`;
    wm.innerHTML = `
        <div style="transform: rotate(-12deg); transform-origin: center; white-space: nowrap; margin-left: -5%;">${text}</div>
        <div style="transform: rotate(-12deg); transform-origin: center; white-space: nowrap; margin-left: 10%;">${text}</div>
        <div style="transform: rotate(-12deg); transform-origin: center; white-space: nowrap; margin-left: -15%;">${text}</div>
    `;
}

function renderUserHeader() {
    const initials = (currentUser.firstname[0] || '') + (currentUser.lastname[0] || '');
    const fullName = currentUser.firstname + ' ' + currentUser.lastname;
    const fullDisplayName = fullName + ' (' + currentUser.username + ')';

    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl) avatarEl.textContent = initials;

    const menuAvatarEl = document.getElementById('menu-avatar');
    if (menuAvatarEl) menuAvatarEl.textContent = initials;

    const nameEl = document.getElementById('user-display-name');
    if (nameEl) nameEl.textContent = fullDisplayName;

    const menuNameEl = document.getElementById('menu-user-name');
    if (menuNameEl) menuNameEl.textContent = fullDisplayName;

    const badge = document.getElementById('user-role-badge');
    if (badge) {
        badge.textContent = currentUser.role_label;
        if (currentUser.role === 'instituteadmin') {
            badge.className = 'role-badge-header inst';
        } else if (currentUser.role === 'courseadmin') {
            badge.className = 'role-badge-header course';
        } else {
            badge.className = 'role-badge-header student';
        }
    }
}

function toggleSettingsMenu(e) {
    if (e) e.stopPropagation();
    closeAdminQuickActionsMenu();
    const popup = document.getElementById('settings-menu-popup');
    if (popup) popup.classList.toggle('visible');
}

function closeSettingsMenu() {
    const popup = document.getElementById('settings-menu-popup');
    if (popup) popup.classList.remove('visible');
}

function toggleAdminQuickActionsMenu(e) {
    if (e) e.stopPropagation();
    closeSettingsMenu();
    const popup = document.getElementById('admin-quick-actions-popup');
    if (popup) popup.classList.toggle('visible');
}

function closeAdminQuickActionsMenu() {
    const popup = document.getElementById('admin-quick-actions-popup');
    if (popup) popup.classList.remove('visible');
}

document.addEventListener('click', (e) => {
    const userWrapper = document.getElementById('settings-trigger')?.closest('.settings-dropdown-wrapper');
    const adminWrapper = document.getElementById('admin-settings-wrapper');
    
    if (userWrapper && !userWrapper.contains(e.target)) {
        closeSettingsMenu();
    }
    if (adminWrapper && !adminWrapper.contains(e.target)) {
        closeAdminQuickActionsMenu();
    }
});

function applyRoleUI() {
    const canEdit = currentUser.can_edit;
    const isInstAdmin = currentUser.role === 'instituteadmin';

    // Show top-right Settings button for editors
    if (canEdit) {
        const adminWrapper = document.getElementById('admin-settings-wrapper');
        if (adminWrapper) adminWrapper.style.display = 'inline-block';
    }

    // Show user management options and commander portrait upload exclusively for institute admin
    if (isInstAdmin) {
        document.querySelectorAll('.tab-admin-only, .menu-admin-only').forEach(el => el.style.display = '');
        const quickUsersBtn = document.getElementById('popup-quick-manage-users');
        if (quickUsersBtn) quickUsersBtn.style.display = 'flex';
        const addCourseBtnWrapper = document.getElementById('inst-add-course-btn-wrapper');
        if (addCourseBtnWrapper) addCourseBtnWrapper.style.display = 'block';
    }

    // Unified Image Management icon (Add & Delete) for Previous & Current Commanders (Institute Admin only)
    const cmdManageWrapper = document.getElementById('cmd-manage-wrapper');
    if (cmdManageWrapper) {
        cmdManageWrapper.style.display = isInstAdmin ? 'inline-flex' : 'none';
    }
    const currCmdManageWrapper = document.getElementById('curr-cmd-manage-wrapper');
    if (currCmdManageWrapper) {
        currCmdManageWrapper.style.display = isInstAdmin ? 'inline-flex' : 'none';
    }
    const currCmdEditBioBtn = document.getElementById('btn-edit-current-commander-bio');
    if (currCmdEditBioBtn) {
        currCmdEditBioBtn.style.display = isInstAdmin ? 'inline-flex' : 'none';
    }

    // Section additions removed - sidebar acts as YouTube playlist for course presentations

    // Adjust resume banner text based on role (if banner exists)
    const resumeTagEl = document.getElementById('resume-tag-text');
    if (resumeTagEl) {
        if (isInstAdmin) {
            resumeTagEl.textContent = 'INSTITUTE OVERVIEW • ALL 7 COURSES';
        } else if (currentUser.role === 'courseadmin') {
            resumeTagEl.textContent = 'COURSE ADMIN • ASSIGNED COURSES';
        }
    }
}

// ============================================================
// TABS & GLOBAL PAGE NAVIGATION (Back / Next)
// ============================================================
let tabOrder = ['home', 'dashboard', 'courses', 'classroom', 'users'];
let navHistory = ['home'];
let currentHistoryIndex = 0;

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    updateNavButtonsState();
    updateBreadcrumb('home');
}

function switchTab(tabId, pushHistory = true) {
    if (!tabOrder.includes(tabId)) return;

    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-pane').forEach(p =>
        p.classList.toggle('active', p.id === 'tab-' + tabId));

    if (pushHistory) {
        if (currentHistoryIndex < navHistory.length - 1) {
            navHistory = navHistory.slice(0, currentHistoryIndex + 1);
        }
        if (navHistory[navHistory.length - 1] !== tabId) {
            navHistory.push(tabId);
            currentHistoryIndex = navHistory.length - 1;
        }
    }

    updateNavButtonsState();
    updateBreadcrumb(tabId);

    if (tabId === 'users' && currentUser.role === 'instituteadmin') {
        loadUsers();
    }
}

function goBack() {
    if (currentHistoryIndex > 0) {
        currentHistoryIndex--;
        switchTab(navHistory[currentHistoryIndex], false);
    } else {
        const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'home';
        let idx = tabOrder.indexOf(activeTab);
        if (idx > 0) {
            switchTab(tabOrder[idx - 1], false);
        }
    }
}

function goNext() {
    if (currentHistoryIndex < navHistory.length - 1) {
        currentHistoryIndex++;
        switchTab(navHistory[currentHistoryIndex], false);
    } else {
        const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'home';
        let idx = tabOrder.indexOf(activeTab);
        if (idx < tabOrder.length - 1) {
            let nextTab = tabOrder[idx + 1];
            if (nextTab === 'users' && currentUser.role !== 'instituteadmin') {
                return;
            }
            switchTab(nextTab, false);
        }
    }
}

function updateNavButtonsState() {
    const backBtn = document.getElementById('btn-global-back');
    const nextBtn = document.getElementById('btn-global-next');
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'home';
    
    const canGoBack = currentHistoryIndex > 0 || tabOrder.indexOf(activeTab) > 0;
    const maxIdx = (currentUser && currentUser.role !== 'instituteadmin') ? tabOrder.indexOf('classroom') : tabOrder.length - 1;
    const canGoNext = currentHistoryIndex < navHistory.length - 1 || tabOrder.indexOf(activeTab) < maxIdx;

    if (backBtn) backBtn.disabled = !canGoBack;
    if (nextBtn) nextBtn.disabled = !canGoNext;
}

function updateBreadcrumb(tabId) {
    const el = document.getElementById('page-breadcrumb-text');
    if (!el) return;
    const names = {
        'home': 'Home Portal Overview',
        'dashboard': 'Dashboard Overview',
        'courses': 'My Assigned Courses',
        'classroom': 'Classroom Player & Content',
        'users': 'User Management & Batches'
    };
    el.textContent = names[tabId] || tabId.toUpperCase();
}

// ============================================================
// FILTERS
// ============================================================
function setupFilters() {
    document.querySelectorAll('.pill-btn').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.pill-btn').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            renderCourses(pill.dataset.filter);
        });
    });
}

// ============================================================
// DASHBOARD DATA
// ============================================================
async function loadDashboardData() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (data.status === 'success') {
            const mc = document.getElementById('metric-courses');
            if (mc) mc.textContent = data.data.stats.courses;
            const mch = document.getElementById('metric-cohorts');
            if (mch) mch.textContent = data.data.stats.cohorts;
        }
    } catch (e) { /* silent */ }

    // Set resume banner from first enrolled course (if banner exists)
    if (currentUser.enrolled_courses && currentUser.enrolled_courses.length > 0) {
        const first = currentUser.enrolled_courses[0];
        const rName = document.getElementById('resume-course-name');
        if (rName) rName.textContent = first.shortname + ' - ' + first.fullname;
        const rMod = document.getElementById('resume-module-text');
        if (rMod) rMod.textContent = 'Continue your training in ' + first.fullname;
        const rBar = document.getElementById('resume-progress-bar');
        if (rBar) rBar.style.width = '29%';
        activeCourseId = parseInt(first.id);
    } else {
        const rName = document.getElementById('resume-course-name');
        if (rName) rName.textContent = 'No courses assigned';
        const rMod = document.getElementById('resume-module-text');
        if (rMod) rMod.textContent = 'Contact your Institute Admin for course enrolment.';
    }
}

// ============================================================
// COURSES
// ============================================================
async function loadCourses() {
    try {
        const res = await fetch('/api/courses');
        const data = await res.json();
        if (data.status === 'success') {
            courses = data.data;
            renderDashboardMockupGrid();
            renderCourses('all');
        }
    } catch (e) {
        console.warn('Failed to load courses:', e);
    }
}

function renderDashboardMockupGrid() {
    const grid = document.getElementById('dashboard-courses-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const isStudent = currentUser && currentUser.role === 'student';
    const countEl = document.getElementById('dashboard-batches-count');
    if (countEl) {
        if (isStudent) {
            countEl.textContent = `${courses.length} ASSIGNED BATCHES`;
        } else {
            countEl.textContent = `${courses.length} TOTAL BATCHES REGISTERED`;
        }
    }

    if (courses.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1.5rem; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 12px; color: var(--text-muted);">
                <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-main); margin-bottom: 0.35rem;">No Assigned Batches</div>
                <div style="font-size: 0.85rem;">You do not have any course batches assigned to your account yet.</div>
            </div>
        `;
        return;
    }

    const instructors = [
        { name: 'Col Rajesh Mehta', role: 'Lead Instructor', initials: 'RM' },
        { name: 'Lt Col A Sharma', role: 'Chief Educator', initials: 'AS' },
        { name: 'Maj V K Patel', role: 'Senior Instructor', initials: 'VP' },
        { name: 'Col S K Singh', role: 'Course Administrator', initials: 'SS' }
    ];

    courses.forEach((c, index) => {
        const enrolledCount = (parseInt(c.id) * 7 + 3) % 35 + 2;
        const progress = ((parseInt(c.id) * 19 + 25) % 65) + 25;
        const educator = instructors[index % instructors.length];
        const deptName = c.category_name || 'Officers Training College';
        const sessionYear = `SESSION 2026-27`;

        let cadre = 'med';
        let cadreLabel = 'Medical Officers';
        let cadreIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M5 7h14M8 12h8M6 17h12"/></svg>`;

        const catCode = (c.category_code || '').toUpperCase();
        const catName = (c.category_name || '').toLowerCase();
        const fullName = (c.fullname || '').toLowerCase();

        if (catCode.includes('NUR') || catName.includes('nurs') || fullName.includes('nursing')) {
            cadre = 'nur';
            cadreLabel = 'Nursing Officers';
            cadreIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
        } else if (catCode.includes('NT') || catName.includes('non-tech') || fullName.includes('non-tech')) {
            cadre = 'nt';
            cadreLabel = 'Non-Technical';
            cadreIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        }

        const shortCode = esc(c.shortname || 'COURSE');

        const card = document.createElement('div');
        card.className = `mockup-course-card cadre-${cadre}`;
        card.innerHTML = `
            <div class="mockup-card-accent-bar"></div>
            <div class="mockup-card-header">
                <span class="mockup-code-pill cadre-${cadre}">${shortCode}</span>
            </div>

            <div class="mockup-card-title-section">
                <h3 class="mockup-card-title" title="${esc(c.fullname)}">${esc(c.fullname)}</h3>
                <div class="mockup-meta-row">
                    <span class="mockup-meta-item">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        ${esc(sessionYear)}
                    </span>
                </div>
            </div>

            <div class="mockup-inst-overview cadre-${cadre}">
                <div class="inst-overview-header">
                    <span class="inst-tag">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                        TRAINING OVERVIEW
                    </span>
                    <span class="inst-progress-percent">${progress}% COMPLETED</span>
                </div>
                <div class="inst-progress-bar">
                    <div class="inst-progress-fill" style="width: ${progress}%;"></div>
                </div>
            </div>

            <div class="mockup-stat-boxes">
                <div class="mockup-stat-col">
                    <div class="mockup-stat-lbl">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        ENROLLED
                    </div>
                    <div class="mockup-stat-val-group">
                        <span class="mockup-stat-val-num">${enrolledCount}</span>
                        <span class="mockup-stat-val-text">OFFICERS</span>
                    </div>
                </div>
                <div class="mockup-stat-col mockup-educator-col">
                    <div class="mockup-stat-lbl">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        DIRECTING STAFF
                    </div>
                    <div class="mockup-educator-wrap">
                        <div class="mockup-avatar-badge cadre-${cadre}">${educator.initials}</div>
                        <div class="mockup-educator-info">
                            <div class="mockup-educator-name" title="${esc(educator.name)}">${esc(educator.name)}</div>
                            <div class="mockup-educator-role">${esc(educator.role)}</div>
                        </div>
                    </div>
                </div>
            </div>

            <button class="btn-mockup-console cadre-${cadre}" onclick="openClassroom(${c.id})">
                <span>Class Console</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
        `;
        grid.appendChild(card);
    });
}

function renderCourses(filter) {
    const grid = document.getElementById('courses-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const isStudent = currentUser && currentUser.role === 'student';
    const userAssignedIds = isStudent
        ? ((currentUser.assigned_courses && currentUser.assigned_courses.length > 0)
            ? currentUser.assigned_courses.map(Number)
            : (currentUser.enrolled_courses || []).map(c => Number(c.id)))
        : null;

    const filtered = courses.filter(c => {
        if (userAssignedIds && !userAssignedIds.includes(Number(c.id))) {
            return false;
        }
        if (filter === 'all') return true;
        if (filter === 'med') return (c.category_code || '').includes('MED');
        if (filter === 'nur') return (c.category_code || '').includes('NUR');
        if (filter === 'nt') return (c.category_code || '').includes('NT');
        return true;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1.5rem; background: var(--bg-card); border: 1px dashed var(--border-subtle); border-radius: 12px; color: var(--text-muted);">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="margin-bottom: 0.75rem; opacity: 0.5;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                <div style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin-bottom: 0.4rem;">
                    ${isStudent ? 'No Assigned Courses' : 'No Courses Available'}
                </div>
                <div style="font-size: 0.88rem; max-width: 420px; margin: 0 auto; line-height: 1.5;">
                    ${isStudent
                        ? 'You have not been assigned to any courses in this category. Please contact your Institute Administrator.'
                        : 'No courses match the selected category filter.'}
                </div>
            </div>
        `;
        return;
    }

    filtered.forEach(c => {
        let typeClass = 'med';
        if ((c.category_code || '').includes('NUR')) typeClass = 'nur';
        if ((c.category_code || '').includes('NT')) typeClass = 'nt';

        const canEdit = c.can_edit;
        const isInstAdmin = currentUser && currentUser.role === 'instituteadmin';

        const card = document.createElement('div');
        card.className = 'course-card ' + typeClass;
        card.innerHTML = `
            <div class="course-header">
                <span class="course-badge ${typeClass}">${esc(c.shortname)}</span>
                <span class="course-category-tag">${esc(c.category_name || '')}</span>
            </div>
            <h3 class="course-title">${esc(c.fullname)}</h3>
            <div class="course-meta">
                <span>${esc(c.summary || 'Officer training course')}</span>
            </div>
            <div class="course-progress-section">
                <div class="card-actions">
                    <button class="btn-card primary" onclick="openClassroom(${c.id})">
                        ${currentUser.role === 'student' ? 'View Course' : 'Open Course'}
                    </button>
                    ${canEdit ? `<button class="btn-card" onclick="openEditCourseModal(${c.id})">✏ Edit</button>` : ''}
                    ${isInstAdmin ? `<button class="btn-card danger" style="color:#ef4444; border-color:rgba(239,68,68,0.4);" onclick="openDeleteCourseModal(${c.id}, '${escJs(c.fullname)}')">🗑 Delete</button>` : ''}
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ============================================================
// CLASSROOM
// ============================================================
async function openClassroom(courseId) {
    activeCourseId = parseInt(courseId);
    switchTab('classroom');

    // Hide video player so classroom starts cleanly in PPT list mode
    closeClassroomVideo();

    let course = courses.find(c => parseInt(c.id) === activeCourseId);
    if (!course && currentUser && currentUser.enrolled_courses) {
        course = currentUser.enrolled_courses.find(c => parseInt(c.id) === activeCourseId);
    }
    if (course) {
        document.getElementById('classroom-course-title').textContent =
            course.shortname + ' - ' + course.fullname;
        document.getElementById('sidebar-course-name').textContent = course.fullname;
        const pptSub = document.getElementById('classroom-ppt-subhead');
        if (pptSub) {
            pptSub.textContent = `Tactical instructional slide decks and presentations for ${course.fullname}`;
        }
    }

    // Role-based upload button visibility for this specific course
    const canUpload = (currentUser && currentUser.role === 'instituteadmin') ||
        (currentUser && currentUser.role === 'courseadmin' && (currentUser.assigned_courses || []).map(Number).includes(activeCourseId));

    const addPptInline = document.getElementById('classroom-add-ppt-inline-wrapper');
    if (addPptInline) addPptInline.style.display = canUpload ? 'block' : 'none';

    // Load presentations and populate sidebar playlist for this specific course
    loadCoursePpts(activeCourseId);
}

function renderClassroomPlaylist(ppts) {
    const list = document.getElementById('classroom-section-list');
    if (!list) return;
    list.innerHTML = '';

    const titleEl = document.getElementById('classroom-sidebar-title');
    if (titleEl) {
        titleEl.textContent = 'Course Playlist & Chapters';
    }

    if (!ppts || ppts.length === 0) {
        list.innerHTML = `
            <li style="padding: 1.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem; line-height: 1.5;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color: var(--text-dim); margin-bottom: 0.5rem; display: block; margin: 0 auto 0.5rem auto;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                No presentations or lecture chapters uploaded for this course yet.
            </li>
        `;
        return;
    }

    ppts.forEach((ppt, idx) => {
        const isPlayingThis = (activePlayingPptId === parseInt(ppt.id));
        const safeTitle = escJs(ppt.title);
        const slideCnt = parseInt(ppt.slide_count) || 1;

        const item = document.createElement('li');
        item.className = 'module-item yt-playlist-item' + (isPlayingThis ? ' active playing' : '');
        item.setAttribute('data-ppt-id', ppt.id);
        item.setAttribute('title', `Play "${esc(ppt.title)}"`);
        item.onclick = () => {
            playPptVideo(ppt.id, safeTitle);
        };

        let mediaTag = '';
        if (ppt.has_media) {
            if (ppt.media_type === 'video') {
                mediaTag = `<span class="yt-badge video" style="font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.35); font-weight: 600;">Video</span>`;
            } else if (ppt.media_type === 'audio') {
                mediaTag = `<span class="yt-badge audio" style="font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-weight: 600;">Audio</span>`;
            }
        }

        const iconCol = isPlayingThis 
            ? `<div class="yt-play-icon" style="color: var(--amc-crimson); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex-shrink: 0; background: rgba(136, 0, 21, 0.2); border-radius: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>`
            : `<div class="yt-item-index" style="width: 24px; height: 24px; border-radius: 4px; background: rgba(255,255,255,0.06); color: var(--text-muted); font-size: 0.76rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${idx + 1}</div>`;

        item.innerHTML = `
            ${iconCol}
            <div class="module-info" style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.4rem; justify-content: space-between;">
                    <span class="module-name" style="font-weight: 600; font-size: 0.88rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(ppt.title)}</span>
                    ${isPlayingThis ? '<span style="font-size: 0.64rem; font-weight: 700; color: var(--amc-crimson); text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; background: rgba(136,0,21,0.15); padding: 1px 5px; border-radius: 3px;">Playing</span>' : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 0.45rem; font-size: 0.74rem; color: var(--text-muted); margin-top: 3px;">
                    <span>${slideCnt} ${slideCnt === 1 ? 'Slide' : 'Slides'}</span>
                    ${mediaTag ? `<span>•</span> ${mediaTag}` : ''}
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}
window.renderClassroomPlaylist = renderClassroomPlaylist;

function playNextPlaylistPpt() {
    if (!currentLoadedPpts || currentLoadedPpts.length === 0) return;
    const currentIdx = currentLoadedPpts.findIndex(p => parseInt(p.id) === activePlayingPptId);
    if (currentIdx !== -1 && currentIdx + 1 < currentLoadedPpts.length) {
        const nextPpt = currentLoadedPpts[currentIdx + 1];
        playPptVideo(nextPpt.id, nextPpt.title);
    }
}
window.playNextPlaylistPpt = playNextPlaylistPpt;

function playPrevPlaylistPpt() {
    if (!currentLoadedPpts || currentLoadedPpts.length === 0) return;
    const currentIdx = currentLoadedPpts.findIndex(p => parseInt(p.id) === activePlayingPptId);
    if (currentIdx > 0) {
        const prevPpt = currentLoadedPpts[currentIdx - 1];
        playPptVideo(prevPpt.id, prevPpt.title);
    }
}
window.playPrevPlaylistPpt = playPrevPlaylistPpt;

// ============================================================
// VIDEO THEATER & PLAYER CONTROLLER
// ============================================================
function playPptVideo(pptId, pptTitle) {
    activePlayingPptId = parseInt(pptId);
    activePlayingPptTitle = pptTitle || 'Course Presentation';
    updateOfficerWatermark();

    // Immediately update sidebar playlist to highlight currently playing presentation (YouTube-style)
    renderClassroomPlaylist(currentLoadedPpts);

    // Update section/chapter title in classroom header
    const secTitle = document.getElementById('classroom-section-title');
    if (secTitle) secTitle.textContent = activePlayingPptTitle;

    // Find the PPT object from loaded cache
    const ppt = currentLoadedPpts.find(p => parseInt(p.id) === activePlayingPptId);

    // Reveal the video player theater section
    const theaterWrapper = document.getElementById('classroom-video-theater-wrapper');
    if (theaterWrapper) {
        theaterWrapper.style.display = 'block';
        theaterWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const backBtn = document.getElementById('classroom-back-to-ppts-btn');
    if (backBtn) backBtn.style.display = 'inline-flex';

    // Hide the PPT Library card below so ONLY the video is visible
    const pptCard = document.getElementById('classroom-ppt-card');
    if (pptCard) {
        pptCard.style.display = 'none';
    }

    // Hide Add presentation button while video is active
    const addPptInline = document.getElementById('classroom-add-ppt-inline-wrapper');
    if (addPptInline) {
        addPptInline.style.display = 'none';
    }

    // Update active video indicators
    const titleEl = document.getElementById('theater-active-ppt-title');
    if (titleEl) titleEl.textContent = activePlayingPptTitle;

    const playStatus = document.getElementById('video-play-status');
    if (playStatus) playStatus.textContent = 'STREAMING: ' + activePlayingPptTitle;

    const subText = document.getElementById('video-sub-text');
    const canvas = document.getElementById('tactical-video-canvas');
    const videoEl = document.getElementById('classroom-html5-video');
    const audioEl = document.getElementById('classroom-html5-audio');

    // Reset previous playback timers and animations
    if (videoPlaybackTimer) {
        clearInterval(videoPlaybackTimer);
        videoPlaybackTimer = null;
    }
    stopTacticalCanvasAnimation();

    if (ppt && ppt.has_media && ppt.media_type === 'video') {
        // Video mode: play real HTML5 video
        activeMediaMode = 'video';
        if (subText) subText.textContent = `Lecture Video • ${esc(ppt.media_filename || 'Video')} • ${esc(ppt.media_file_size_formatted || '720p HD')}`;
        if (canvas) canvas.style.display = 'none';
        if (audioEl) { audioEl.pause(); audioEl.style.display = 'none'; audioEl.removeAttribute('src'); }

        if (videoEl) {
            videoEl.style.display = 'block';
            videoEl.src = ppt.media_stream_url || `/api/course-ppts/${activePlayingPptId}/stream`;
            videoEl.currentTime = 0;
            videoEl.load();
        }
        videoDuration = 1800; // default until loadedmetadata fires
    } else if (ppt && ppt.has_media && ppt.media_type === 'audio') {
        // Audio mode: play real HTML5 audio + tactical audio spectrum canvas
        activeMediaMode = 'audio';
        if (subText) subText.textContent = `Lecture Audio Briefing • ${esc(ppt.media_filename || 'Audio')} • ${esc(ppt.media_file_size_formatted || '')}`;
        if (videoEl) { videoEl.pause(); videoEl.style.display = 'none'; videoEl.removeAttribute('src'); }
        if (canvas) canvas.style.display = 'block';

        if (audioEl) {
            audioEl.src = ppt.media_stream_url || `/api/course-ppts/${activePlayingPptId}/stream`;
            audioEl.currentTime = 0;
            audioEl.load();
        }
        videoDuration = 1800;
    } else {
        // Simulated tactical briefing fallback
        activeMediaMode = 'simulated';
        if (subText) subText.textContent = 'Interactive Tactical Stream • 720p HD • En Subtitles';
        if (videoEl) { videoEl.pause(); videoEl.style.display = 'none'; videoEl.removeAttribute('src'); }
        if (audioEl) { audioEl.pause(); audioEl.style.display = 'none'; audioEl.removeAttribute('src'); }
        if (canvas) canvas.style.display = 'block';
        videoDuration = 1800;
    }

    // Reset video progress to beginning
    videoCurrentTime = 0;
    updateVideoTimeDisplay();

    // Resize canvas if needed
    if (canvas && canvas.parentElement) {
        const rect = canvas.parentElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            canvas.width = rect.width;
            canvas.height = rect.height;
        }
    }

    // Automatically start playback
    startVideoPlayback();
}

function closeClassroomVideo() {
    pauseVideoPlayback();
    activePlayingPptId = null;
    activePlayingPptTitle = '';
    renderClassroomPlaylist(currentLoadedPpts);

    // Stop and reset HTML5 media elements
    const videoEl = document.getElementById('classroom-html5-video');
    if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl.style.display = 'none';
    }
    const audioEl = document.getElementById('classroom-html5-audio');
    if (audioEl) {
        audioEl.pause();
        audioEl.removeAttribute('src');
        audioEl.load();
        audioEl.style.display = 'none';
    }
    const canvas = document.getElementById('tactical-video-canvas');
    if (canvas) canvas.style.display = 'block';

    activeMediaMode = 'simulated';

    // Exit fullscreen if currently active
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }

    const theaterWrapper = document.getElementById('classroom-video-theater-wrapper');
    if (theaterWrapper) {
        theaterWrapper.style.display = 'none';
    }

    const backBtn = document.getElementById('classroom-back-to-ppts-btn');
    if (backBtn) backBtn.style.display = 'none';

    // Reveal the PPT Library card below
    const pptCard = document.getElementById('classroom-ppt-card');
    if (pptCard) {
        pptCard.style.display = 'block';
        pptCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Restore Add button if authorized
    const canUpload = (currentUser && currentUser.role === 'instituteadmin') ||
        (currentUser && currentUser.role === 'courseadmin' && (currentUser.assigned_courses || []).map(Number).includes(activeCourseId));
    const addPptInline = document.getElementById('classroom-add-ppt-inline-wrapper');
    if (addPptInline) {
        addPptInline.style.display = canUpload ? 'block' : 'none';
    }

    // Re-render PPT rows to clear playing highlight
    if (currentLoadedPpts && currentLoadedPpts.length > 0) {
        renderCoursePpts(currentLoadedPpts, canUpload);
    }
}

function togglePlayVideo() {
    if (isVideoPlaying) {
        pauseVideoPlayback();
    } else {
        startVideoPlayback();
    }
}

let videoIdleTimer = null;
function resetVideoControlsIdle() {
    const screen = document.getElementById('classroom-video-screen');
    if (!screen) return;
    screen.classList.remove('controls-idle');
    if (videoIdleTimer) clearTimeout(videoIdleTimer);
    if (isVideoPlaying) {
        videoIdleTimer = setTimeout(() => {
            if (isVideoPlaying) {
                screen.classList.add('controls-idle');
            }
        }, 2800);
    }
}

function startVideoPlayback() {
    isVideoPlaying = true;
    const playBtn = document.getElementById('btn-play-pause');
    const playStatus = document.getElementById('video-play-status');
    const bigRing = document.getElementById('play-ring-trigger');

    resetVideoControlsIdle();

    if (playBtn) {
        playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
        playBtn.title = 'Pause (Space)';
    }
    if (playStatus) {
        playStatus.textContent = 'STREAMING: ' + (activePlayingPptTitle || 'Tactical Lecture');
    }
    if (bigRing) {
        bigRing.style.opacity = '0';
        bigRing.style.pointerEvents = 'none';
    }

    if (activeMediaMode === 'video') {
        const videoEl = document.getElementById('classroom-html5-video');
        if (videoEl && videoEl.paused) {
            videoEl.play().catch(e => console.warn(e));
        }
    } else if (activeMediaMode === 'audio') {
        const audioEl = document.getElementById('classroom-html5-audio');
        if (audioEl && audioEl.paused) {
            audioEl.play().catch(e => console.warn(e));
        }
        startTacticalCanvasAnimation();
    } else {
        if (videoPlaybackTimer) clearInterval(videoPlaybackTimer);
        videoPlaybackTimer = setInterval(() => {
            if (videoCurrentTime < videoDuration) {
                videoCurrentTime += 1;
                updateVideoTimeDisplay();
            } else {
                pauseVideoPlayback();
            }
        }, 1000);
        startTacticalCanvasAnimation();
    }
}

function pauseVideoPlayback() {
    isVideoPlaying = false;
    const playBtn = document.getElementById('btn-play-pause');
    const playStatus = document.getElementById('video-play-status');
    const bigRing = document.getElementById('play-ring-trigger');
    const screen = document.getElementById('classroom-video-screen');

    if (screen) {
        screen.classList.remove('controls-idle');
    }
    if (videoIdleTimer) clearTimeout(videoIdleTimer);

    if (playBtn) {
        playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        playBtn.title = 'Play (Space)';
    }
    if (playStatus) {
        playStatus.textContent = 'PAUSED: ' + (activePlayingPptTitle || 'Lecture Paused');
    }
    if (bigRing) {
        bigRing.style.opacity = '1';
        bigRing.style.pointerEvents = 'auto';
    }

    if (activeMediaMode === 'video') {
        const videoEl = document.getElementById('classroom-html5-video');
        if (videoEl && !videoEl.paused) {
            videoEl.pause();
        }
    } else if (activeMediaMode === 'audio') {
        const audioEl = document.getElementById('classroom-html5-audio');
        if (audioEl && !audioEl.paused) {
            audioEl.pause();
        }
        stopTacticalCanvasAnimation();
        drawTacticalCanvasFeed(false);
    } else {
        if (videoPlaybackTimer) {
            clearInterval(videoPlaybackTimer);
            videoPlaybackTimer = null;
        }
        stopTacticalCanvasAnimation();
        drawTacticalCanvasFeed(false);
    }
}

function updateVideoTimeDisplay() {
    const timeEl = document.getElementById('video-time-display');
    const progressEl = document.getElementById('timeline-progress');

    const curM = String(Math.floor(videoCurrentTime / 60)).padStart(2, '0');
    const curS = String(videoCurrentTime % 60).padStart(2, '0');
    const durM = String(Math.floor(videoDuration / 60)).padStart(2, '0');
    const durS = String(videoDuration % 60).padStart(2, '0');

    if (timeEl) timeEl.textContent = `${curM}:${curS} / ${durM}:${durS}`;
    if (progressEl) {
        const pct = Math.min(100, Math.max(0, (videoCurrentTime / videoDuration) * 100));
        progressEl.style.width = pct + '%';
    }
}

// Fullscreen API implementation
function toggleFullscreen() {
    const player = document.getElementById('classroom-media-player');
    if (!player) return;

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (player.requestFullscreen) {
            player.requestFullscreen().catch(err => console.warn(err));
        } else if (player.webkitRequestFullscreen) {
            player.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(err => console.warn(err));
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

function handleFullscreenChange() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const enterIcon = document.getElementById('icon-fs-enter');
    const exitIcon = document.getElementById('icon-fs-exit');
    const fsBtn = document.getElementById('btn-fullscreen');
    if (enterIcon && exitIcon) {
        enterIcon.style.display = isFs ? 'none' : 'block';
        exitIcon.style.display = isFs ? 'block' : 'none';
    }
    if (fsBtn) {
        fsBtn.title = isFs ? 'Exit Full Screen (Esc / F)' : 'Full Screen (F)';
    }

    // Trigger canvas resize for fullscreen dimensions
    const canvas = document.getElementById('tactical-video-canvas');
    if (canvas && canvas.parentElement) {
        setTimeout(() => {
            const rect = canvas.parentElement.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                canvas.width = rect.width;
                canvas.height = rect.height;
                drawTacticalCanvasFeed(isVideoPlaying);
            }
        }, 100);
    }
}

let currentVideoVolume = 1.0;
let previousVideoVolume = 1.0;
let volumeOsdTimer = null;
let volumeActiveTimer = null;

function showVolumeOsd(pct, isMuted) {
    const osd = document.getElementById('yt-volume-osd');
    const osdVal = document.getElementById('yt-volume-osd-val');
    const osdIcon = document.getElementById('yt-volume-osd-icon');
    if (!osd || !osdVal) return;

    osdVal.textContent = isMuted ? 'Muted (0%)' : `${pct}%`;
    if (osdIcon) {
        if (isMuted || pct === 0) {
            osdIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`;
        } else if (pct < 50) {
            osdIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
        } else {
            osdIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
        }
    }

    osd.classList.add('active');
    if (volumeOsdTimer) clearTimeout(volumeOsdTimer);
    volumeOsdTimer = setTimeout(() => {
        osd.classList.remove('active');
    }, 1100);

    // Keep volume control expanded while adjusting
    const volCtrl = document.getElementById('yt-volume-control');
    if (volCtrl) {
        volCtrl.classList.add('active');
        if (volumeActiveTimer) clearTimeout(volumeActiveTimer);
        volumeActiveTimer = setTimeout(() => {
            volCtrl.classList.remove('active');
        }, 1200);
    }
}

function setVideoVolume(vol, triggerOsd = false) {
    vol = Math.max(0, Math.min(1, vol));
    currentVideoVolume = vol;
    const pct = Math.round(vol * 100);

    const videoEl = document.getElementById('classroom-html5-video');
    const audioEl = document.getElementById('classroom-html5-audio');
    const slider = document.getElementById('video-volume-slider');
    const percentEl = document.getElementById('video-volume-percent');
    const volHigh = document.getElementById('icon-vol-high');
    const volLow = document.getElementById('icon-vol-low');
    const volMuted = document.getElementById('icon-vol-muted');
    const volBtn = document.getElementById('btn-volume');

    if (videoEl) {
        videoEl.volume = vol;
        videoEl.muted = (vol === 0);
    }
    if (audioEl) {
        audioEl.volume = vol;
        audioEl.muted = (vol === 0);
    }

    if (slider) {
        slider.value = pct;
        slider.style.background = `linear-gradient(90deg, #ef4444 ${pct}%, rgba(255, 255, 255, 0.3) ${pct}%)`;
        slider.title = `Volume: ${pct}% (Up/Down Arrow)`;
        slider.setAttribute('aria-valuenow', pct);
    }

    if (percentEl) {
        percentEl.textContent = `${pct}%`;
        percentEl.title = `Volume: ${pct}%`;
    }

    if (volHigh && volLow && volMuted) {
        if (vol === 0) {
            volHigh.style.display = 'none';
            volLow.style.display = 'none';
            volMuted.style.display = 'block';
            if (volBtn) volBtn.title = 'Unmute (M) - 0%';
        } else if (vol < 0.5) {
            volHigh.style.display = 'none';
            volLow.style.display = 'block';
            volMuted.style.display = 'none';
            if (volBtn) volBtn.title = `Volume ${pct}% (M to mute)`;
        } else {
            volHigh.style.display = 'block';
            volLow.style.display = 'none';
            volMuted.style.display = 'none';
            if (volBtn) volBtn.title = `Volume ${pct}% (M to mute)`;
        }
    }

    if (triggerOsd) {
        showVolumeOsd(pct, vol === 0);
    }
}

function toggleVideoMute() {
    if (currentVideoVolume > 0) {
        previousVideoVolume = currentVideoVolume;
        setVideoVolume(0, true);
    } else {
        setVideoVolume(previousVideoVolume > 0 ? previousVideoVolume : 1.0, true);
    }
}

// Clean pure black video canvas (YouTube style, no tactical background/equalizer)
function drawTacticalCanvasFeed(isPlaying) {
    const canvas = document.getElementById('tactical-video-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
}

function startTacticalCanvasAnimation() {
    stopTacticalCanvasAnimation();
    drawTacticalCanvasFeed(true);
}

function stopTacticalCanvasAnimation() {
    if (videoCanvasAnimId) {
        cancelAnimationFrame(videoCanvasAnimId);
        videoCanvasAnimId = null;
    }
}

function setupVideoPlayerEvents() {
    const scrubber = document.getElementById('timeline-scrubber');
    if (scrubber) {
        scrubber.addEventListener('click', (e) => {
            const rect = scrubber.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            videoCurrentTime = Math.floor(pos * videoDuration);
            if (activeMediaMode === 'video') {
                const videoEl = document.getElementById('classroom-html5-video');
                if (videoEl && !isNaN(videoEl.duration)) {
                    videoEl.currentTime = videoCurrentTime;
                }
            } else if (activeMediaMode === 'audio') {
                const audioEl = document.getElementById('classroom-html5-audio');
                if (audioEl && !isNaN(audioEl.duration)) {
                    audioEl.currentTime = videoCurrentTime;
                }
            }
            updateVideoTimeDisplay();
        });
    }

    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) {
        playBtn.addEventListener('click', togglePlayVideo);
    }

    const volSlider = document.getElementById('video-volume-slider');
    if (volSlider) {
        volSlider.addEventListener('input', (e) => {
            setVideoVolume(parseFloat(e.target.value) / 100);
        });
    }

    const volGroup = document.getElementById('yt-volume-control');
    if (volGroup) {
        volGroup.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = e.deltaY < 0 ? 0.05 : -0.05;
            setVideoVolume(currentVideoVolume + step, true);
        }, { passive: false });
    }

    const playBig = document.getElementById('play-ring-trigger');
    if (playBig) {
        playBig.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayVideo();
        });
    }

    // YouTube-style Seeking & Double Click 10s Skip Gesture
    let seekRippleTimers = { left: null, right: null };
    function showSeekRipple(side) {
        const el = document.getElementById(side === 'right' ? 'yt-seek-ripple-right' : 'yt-seek-ripple-left');
        if (!el) return;
        if (seekRippleTimers[side]) {
            clearTimeout(seekRippleTimers[side]);
        }
        el.classList.remove('active');
        void el.offsetWidth; // trigger reflow
        el.classList.add('active');
        seekRippleTimers[side] = setTimeout(() => {
            el.classList.remove('active');
            seekRippleTimers[side] = null;
        }, 650);
    }

    function seekVideoBy(deltaSeconds) {
        videoCurrentTime = Math.max(0, Math.min(videoDuration, videoCurrentTime + deltaSeconds));
        if (activeMediaMode === 'video') {
            const videoEl = document.getElementById('classroom-html5-video');
            if (videoEl && !isNaN(videoEl.duration)) {
                videoEl.currentTime = videoCurrentTime;
            }
        } else if (activeMediaMode === 'audio') {
            const audioEl = document.getElementById('classroom-html5-audio');
            if (audioEl && !isNaN(audioEl.duration)) {
                audioEl.currentTime = videoCurrentTime;
            }
        }
        updateVideoTimeDisplay();
    }

    let lastScreenClickTime = 0;
    let screenClickTimeout = null;

    function handleVideoScreenClick(e) {
        if (e.target.closest('.custom-controls-bar') || e.target.closest('#play-ring-trigger')) return;

        const screen = document.getElementById('classroom-video-screen');
        if (!screen) return;
        const rect = screen.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const isRightSide = clickX > (rect.width / 2);
        const now = Date.now();
        const timeDiff = now - lastScreenClickTime;

        if (timeDiff > 0 && timeDiff < 320) {
            // Double Click detected! Cancel play/pause and seek 10 seconds
            if (screenClickTimeout) {
                clearTimeout(screenClickTimeout);
                screenClickTimeout = null;
            }
            lastScreenClickTime = 0;

            if (isRightSide) {
                seekVideoBy(10);
                showSeekRipple('right');
            } else {
                seekVideoBy(-10);
                showSeekRipple('left');
            }
        } else {
            // First click: queue play/pause toggle
            lastScreenClickTime = now;
            screenClickTimeout = setTimeout(() => {
                togglePlayVideo();
                screenClickTimeout = null;
            }, 260);
        }
    }

    // Bind real HTML5 Video element events
    const videoEl = document.getElementById('classroom-html5-video');
    if (videoEl) {
        videoEl.addEventListener('click', (e) => {
            e.stopPropagation();
            handleVideoScreenClick(e);
        });
        videoEl.addEventListener('loadedmetadata', () => {
            if (activeMediaMode === 'video' && videoEl.duration && !isNaN(videoEl.duration)) {
                videoDuration = Math.round(videoEl.duration) || 1800;
                updateVideoTimeDisplay();
            }
        });
        videoEl.addEventListener('timeupdate', () => {
            if (activeMediaMode === 'video') {
                videoCurrentTime = Math.round(videoEl.currentTime);
                updateVideoTimeDisplay();
            }
        });
        videoEl.addEventListener('ended', () => {
            if (activeMediaMode === 'video') {
                pauseVideoPlayback();
                // Play next presentation/chapter in playlist like YouTube
                playNextPlaylistPpt();
            }
        });
    }

    // Bind real HTML5 Audio element events
    const audioEl = document.getElementById('classroom-html5-audio');
    if (audioEl) {
        audioEl.addEventListener('loadedmetadata', () => {
            if (activeMediaMode === 'audio' && audioEl.duration && !isNaN(audioEl.duration)) {
                videoDuration = Math.round(audioEl.duration) || 1800;
                updateVideoTimeDisplay();
            }
        });
        audioEl.addEventListener('timeupdate', () => {
            if (activeMediaMode === 'audio') {
                videoCurrentTime = Math.round(audioEl.currentTime);
                updateVideoTimeDisplay();
            }
        });
        audioEl.addEventListener('ended', () => {
            if (activeMediaMode === 'audio') {
                pauseVideoPlayback();
                // Play next presentation/chapter in playlist like YouTube
                playNextPlaylistPpt();
            }
        });
    }

    const videoScreen = document.getElementById('classroom-video-screen');
    if (videoScreen) {
        videoScreen.addEventListener('click', (e) => {
            handleVideoScreenClick(e);
        });
        videoScreen.addEventListener('mousemove', resetVideoControlsIdle);
        videoScreen.addEventListener('mouseenter', resetVideoControlsIdle);
        videoScreen.addEventListener('mouseleave', () => {
            if (isVideoPlaying) {
                videoScreen.classList.add('controls-idle');
            }
        });
        videoScreen.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlayVideo();
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                seekVideoBy(10);
                showSeekRipple('right');
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                seekVideoBy(-10);
                showSeekRipple('left');
            } else if (e.code === 'ArrowUp') {
                e.preventDefault();
                setVideoVolume(currentVideoVolume + 0.05, true);
            } else if (e.code === 'ArrowDown') {
                e.preventDefault();
                setVideoVolume(currentVideoVolume - 0.05, true);
            } else if (e.code === 'KeyF') {
                e.preventDefault();
                toggleFullscreen();
            } else if (e.code === 'KeyM') {
                e.preventDefault();
                toggleVideoMute();
            } else if (e.code === 'Escape') {
                closeClassroomVideo();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const theaterWrapper = document.getElementById('classroom-video-theater-wrapper');
            if (theaterWrapper && theaterWrapper.style.display !== 'none' && !document.fullscreenElement && !document.webkitFullscreenElement) {
                closeClassroomVideo();
            }
        }
    });

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    // Initial canvas dimensions
    const canvas = document.getElementById('tactical-video-canvas');
    if (canvas && canvas.parentElement) {
        const resizeCanvas = () => {
            const rect = canvas.parentElement.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                canvas.width = rect.width;
                canvas.height = rect.height;
                drawTacticalCanvasFeed(isVideoPlaying);
            }
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }
}

// ============================================================
// COURSE PRESENTATIONS / PPT LIBRARY
// ============================================================
async function loadCoursePpts(courseId) {
    const container = document.getElementById('classroom-ppt-container');
    const countBadge = document.getElementById('classroom-ppt-count-badge');
    if (!container) return;

    // Immediately clear stale data and show loading state
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2.5rem 1rem; color: var(--text-muted); font-size: 0.88rem; gap: 0.6rem;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon" style="color: var(--gold-light);"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
            <span>Loading course presentations...</span>
        </div>
    `;

    try {
        const res = await fetch('/api/course-ppts?course_id=' + courseId);
        const data = await res.json();

        // Prevent race conditions when user switches courses quickly
        if (activeCourseId !== courseId) return;

        if (data.status === 'success') {
            if (data.course) {
                const titleEl = document.getElementById('classroom-course-title');
                const sideEl = document.getElementById('sidebar-course-name');
                const pptSub = document.getElementById('classroom-ppt-subhead');
                if (titleEl && (!titleEl.textContent || titleEl.textContent === 'Select a course')) {
                    titleEl.textContent = `${data.course.shortname} - ${data.course.fullname}`;
                }
                if (sideEl && (!sideEl.textContent || sideEl.textContent.includes('Select a course'))) {
                    sideEl.textContent = data.course.fullname;
                }
                if (pptSub) {
                    pptSub.textContent = `Tactical instructional slide decks and presentations for ${data.course.fullname}`;
                }
            }

            currentLoadedPpts = data.data || [];
            if (countBadge) {
                countBadge.textContent = `${currentLoadedPpts.length} Presentation${currentLoadedPpts.length === 1 ? '' : 's'}`;
            }
            renderCoursePpts(currentLoadedPpts, data.can_upload);
            renderClassroomPlaylist(currentLoadedPpts);
        } else {
            currentLoadedPpts = [];
            if (countBadge) countBadge.textContent = '0 Presentations';
            renderClassroomPlaylist([]);
            container.innerHTML = `
                <div style="padding: 1.5rem; text-align: center; color: #ef4444; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; font-size: 0.88rem;">
                    <div style="font-weight: 600; margin-bottom: 0.35rem;">Unable to load presentations</div>
                    <div style="color: var(--text-muted); font-size: 0.82rem; margin-bottom: 0.75rem;">${esc(data.message || 'Server error')}</div>
                    <button class="btn-card" style="padding: 0.35rem 0.85rem; font-size: 0.8rem;" onclick="loadCoursePpts(${courseId})">Retry</button>
                </div>
            `;
        }
    } catch (e) {
        if (activeCourseId !== courseId) return;
        currentLoadedPpts = [];
        if (countBadge) countBadge.textContent = '0 Presentations';
        container.innerHTML = `
            <div style="padding: 1.5rem; text-align: center; color: #ef4444; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; font-size: 0.88rem;">
                <div style="font-weight: 600; margin-bottom: 0.35rem;">Connection error</div>
                <div style="color: var(--text-muted); font-size: 0.82rem; margin-bottom: 0.75rem;">Failed to connect to the LMS presentation repository.</div>
                <button class="btn-card" style="padding: 0.35rem 0.85rem; font-size: 0.8rem;" onclick="loadCoursePpts(${courseId})">Retry</button>
            </div>
        `;
    }
}

function renderCoursePpts(ppts, canUpload) {
    currentLoadedPpts = ppts || [];
    currentLoadedCanUpload = !!canUpload;
    const container = document.getElementById('classroom-ppt-container');
    if (!container) return;

    // If a video lecture is currently active, ensure the PPT library remains hidden below
    const pptCard = document.getElementById('classroom-ppt-card');
    if (pptCard) {
        pptCard.style.display = activePlayingPptId ? 'none' : 'block';
    }

    if (!ppts || ppts.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2.75rem 1.5rem; background: rgba(255,255,255,0.015); border: 1px dashed var(--border-subtle); border-radius: 10px;">
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="color: var(--text-dim); margin-bottom: 0.75rem;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                <div style="font-size: 0.95rem; font-weight: 600; color: var(--text-main); margin-bottom: 0.35rem;">
                    No presentations have been added to this course yet.
                </div>
                <div style="font-size: 0.82rem; color: var(--text-muted); max-width: 440px; margin: 0 auto; line-height: 1.45;">
                    ${canUpload ? 'Upload relevant PowerPoint training slide decks (.ppt / .pptx) for this course using the button below.' : 'Presentations and slide decks published by instructors will appear here for download.'}
                </div>
                ${canUpload ? `
                    <div style="margin-top: 1rem;">
                        <button class="btn-admin gold" onclick="openAddPptModal()" style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 1rem; font-weight: 600;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            <span>Add</span>
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
        return;
    }

    let html = `
        <table class="ppt-table">
            <thead>
                <tr>
                    <th style="width: 42%; min-width: 240px; text-align: left;">PPT Name</th>
                    <th style="width: 16%; min-width: 120px; text-align: left;">Slides</th>
                    <th style="width: 22%; min-width: 170px; text-align: left;">Upload Date & Time</th>
                    <th style="width: 20%; min-width: ${canUpload ? '180px' : '110px'}; text-align: left;">Action</th>
                </tr>
            </thead>
            <tbody>
    `;

    ppts.forEach(p => {
        const isPlayingThis = (activePlayingPptId === parseInt(p.id));
        const safeTitle = escJs(p.title);
        const slideCnt = parseInt(p.slide_count) || 1;

        let mediaBadge = '';
        if (p.has_media) {
            if (p.media_type === 'video') {
                mediaBadge = `<span class="media-tag video" title="Video Lecture Attached (${esc(p.media_file_size_formatted || '')})"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> Video</span>`;
            } else if (p.media_type === 'audio') {
                mediaBadge = `<span class="media-tag audio" title="Audio Lecture Attached (${esc(p.media_file_size_formatted || '')})"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> Audio</span>`;
            }
        }

        html += `
            <tr class="${isPlayingThis ? 'active-playing-row' : ''}">
                <td style="text-align: left;">
                    <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
                        <div class="ppt-title-link" onclick="playPptVideo(${p.id}, '${safeTitle}')" title="Click to watch lecture video">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color: var(--amc-crimson); flex-shrink: 0;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <span style="font-weight: 600; color: var(--text-main); font-size: 0.92rem;">${esc(p.title)}</span>
                        </div>
                        ${mediaBadge}
                        ${isPlayingThis ? '<span class="playing-pulse-indicator"><span class="playing-dot"></span>PLAYING</span>' : ''}
                    </div>
                </td>
                <td style="text-align: left;">
                    <span class="slide-count-badge">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                        <span>${slideCnt} ${slideCnt === 1 ? 'Slide' : 'Slides'}</span>
                    </span>
                </td>
                <td style="text-align: left;">
                    <div style="display: flex; align-items: center; gap: 0.45rem; color: var(--text-muted); font-size: 0.84rem;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-dim); flex-shrink: 0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        <span class="ppt-time-val" data-raw-time="${p.timecreated || p.timecreated_formatted}">${esc(formatDateTime(p.timecreated || p.timecreated_formatted))}</span>
                    </div>
                </td>
                <td style="text-align: left; white-space: nowrap;">
                    <div style="display: flex; align-items: center; gap: 0.45rem;">
                        <button class="btn-card" onclick="downloadCoursePpt(${p.id})" style="padding: 0.38rem 0.75rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem;" title="Download presentation file">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            <span>Download</span>
                        </button>
                        ${canUpload ? `
                        <button class="btn-card danger" onclick="openDeletePptModal(${p.id}, '${safeTitle}')" style="padding: 0.38rem 0.7rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem; color: #f87171; border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.1);" title="Delete presentation">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            <span>Delete</span>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function openAddPptModal() {
    if (!activeCourseId) {
        showToast('Please select a course first', 'error');
        return;
    }

    const course = courses.find(c => parseInt(c.id) === activeCourseId);
    const courseNameEl = document.getElementById('modal-ppt-course-name');
    if (courseNameEl && course) {
        courseNameEl.textContent = `${course.shortname} — ${course.fullname}`;
    }

    document.getElementById('ppt-form-course-id').value = activeCourseId;
    document.getElementById('ppt-form-title').value = '';
    document.getElementById('ppt-form-file').value = '';
    const mediaInput = document.getElementById('ppt-form-media-file');
    if (mediaInput) mediaInput.value = '';

    const slidesInp = document.getElementById('ppt-form-slides');
    if (slidesInp) slidesInp.value = '';

    const selInfo = document.getElementById('ppt-file-selected-info');
    if (selInfo) selInfo.style.display = 'none';

    const mediaSelInfo = document.getElementById('media-file-selected-info');
    if (mediaSelInfo) mediaSelInfo.style.display = 'none';

    const prog = document.getElementById('ppt-upload-progress-container');
    if (prog) prog.style.display = 'none';

    const errMsg = document.getElementById('ppt-upload-error-msg');
    if (errMsg) errMsg.style.display = 'none';

    const submitBtn = document.getElementById('btn-submit-ppt-upload');
    if (submitBtn) {
        submitBtn.disabled = false;
        document.getElementById('btn-submit-ppt-text').textContent = 'Upload Presentation';
    }
    const cancelBtn = document.getElementById('btn-cancel-ppt-upload');
    if (cancelBtn) cancelBtn.disabled = false;

    document.getElementById('modal-add-ppt').classList.add('visible');
}

function handlePptFileSelect(input) {
    const selInfo = document.getElementById('ppt-file-selected-info');
    const nameEl = document.getElementById('ppt-selected-filename');
    const sizeEl = document.getElementById('ppt-selected-filesize');
    const titleInput = document.getElementById('ppt-form-title');
    const errMsg = document.getElementById('ppt-upload-error-msg');

    if (errMsg) errMsg.style.display = 'none';

    if (input.files && input.files[0]) {
        const file = input.files[0];
        const ext = file.name.split('.').pop().toLowerCase();

        if (ext !== 'ppt' && ext !== 'pptx') {
            showToast('Invalid file format. Only .ppt and .pptx files are allowed.', 'error');
            input.value = '';
            if (selInfo) selInfo.style.display = 'none';
            return;
        }

        if (file.size > 50 * 1024 * 1024) {
            showToast('File exceeds 50MB limit', 'error');
            input.value = '';
            if (selInfo) selInfo.style.display = 'none';
            return;
        }

        const sizeFormatted = file.size > 1048576
            ? (file.size / 1048576).toFixed(1) + ' MB'
            : Math.round(file.size / 1024) + ' KB';

        if (nameEl) nameEl.textContent = file.name;
        if (sizeEl) sizeEl.textContent = `Size: ${sizeFormatted} • Type: ${ext.toUpperCase()}`;
        if (selInfo) selInfo.style.display = 'block';

        // Auto-fill presentation title if empty
        if (titleInput && !titleInput.value.trim()) {
            const rawBase = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
            titleInput.value = rawBase.replace(/[-_]+/g, ' ').trim();
        }
    } else {
        if (selInfo) selInfo.style.display = 'none';
    }
}

function handleMediaFileSelect(input) {
    const selInfo = document.getElementById('media-file-selected-info');
    const nameEl = document.getElementById('media-selected-filename');
    const sizeEl = document.getElementById('media-selected-filesize');
    const titleInput = document.getElementById('ppt-form-title');
    const errMsg = document.getElementById('ppt-upload-error-msg');

    if (errMsg) errMsg.style.display = 'none';

    if (input.files && input.files[0]) {
        const file = input.files[0];
        const ext = file.name.split('.').pop().toLowerCase();
        const allowedMedia = ['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];

        if (!allowedMedia.includes(ext)) {
            showToast('Invalid media format. Supported: .mp4, .webm, .mov, .mkv, .mp3, .wav, .m4a', 'error');
            input.value = '';
            if (selInfo) selInfo.style.display = 'none';
            return;
        }

        if (file.size > 256 * 1024 * 1024) {
            showToast('Media file exceeds 250MB limit', 'error');
            input.value = '';
            if (selInfo) selInfo.style.display = 'none';
            return;
        }

        const isVideo = ['mp4', 'webm', 'mov', 'mkv'].includes(ext);
        const sizeFormatted = file.size > 1048576
            ? (file.size / 1048576).toFixed(1) + ' MB'
            : Math.round(file.size / 1024) + ' KB';

        if (nameEl) nameEl.textContent = file.name;
        if (sizeEl) sizeEl.textContent = `Size: ${sizeFormatted} • Type: ${isVideo ? 'VIDEO' : 'AUDIO'} (.${ext.toUpperCase()})`;
        if (selInfo) selInfo.style.display = 'block';

        // Auto-fill presentation title if still empty
        if (titleInput && !titleInput.value.trim()) {
            const rawBase = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
            titleInput.value = rawBase.replace(/[-_]+/g, ' ').trim();
        }
    } else {
        if (selInfo) selInfo.style.display = 'none';
    }
}

async function submitAddPpt() {
    const courseId = parseInt(document.getElementById('ppt-form-course-id').value);
    const title = document.getElementById('ppt-form-title').value.trim();
    const fileInput = document.getElementById('ppt-form-file');
    const mediaInput = document.getElementById('ppt-form-media-file');
    const errMsg = document.getElementById('ppt-upload-error-msg');
    const submitBtn = document.getElementById('btn-submit-ppt-upload');
    const cancelBtn = document.getElementById('btn-cancel-ppt-upload');
    const btnText = document.getElementById('btn-submit-ppt-text');
    const progContainer = document.getElementById('ppt-upload-progress-container');
    const progBar = document.getElementById('ppt-progress-bar');
    const progPercent = document.getElementById('ppt-progress-percent');
    const progLabel = document.getElementById('ppt-progress-label');

    if (!courseId) {
        showToast('Invalid course selection', 'error');
        return;
    }

    const hasPpt = (fileInput && fileInput.files && fileInput.files[0]);
    const hasMedia = (mediaInput && mediaInput.files && mediaInput.files[0]);

    if (!hasPpt && !hasMedia) {
        showToast('Please select a PowerPoint presentation (.ppt/.pptx) or lecture video/audio file', 'error');
        return;
    }

    if (!title) {
        showToast('Presentation title is required', 'error');
        return;
    }

    // Prepare FormData
    const formData = new FormData();
    formData.append('course_id', courseId);
    formData.append('title', title);

    if (hasPpt) {
        const file = fileInput.files[0];
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext !== 'ppt' && ext !== 'pptx') {
            showToast('Invalid presentation format. Only .ppt and .pptx are supported.', 'error');
            return;
        }
        formData.append('file', file);
    }

    if (hasMedia) {
        const mediaFile = mediaInput.files[0];
        const mExt = mediaFile.name.split('.').pop().toLowerCase();
        const allowedMedia = ['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
        if (!allowedMedia.includes(mExt)) {
            showToast('Invalid media format. Supported formats: .mp4, .webm, .mov, .mkv, .mp3, .wav, .m4a', 'error');
            return;
        }
        formData.append('media_file', mediaFile);
    }

    const slidesInp = document.getElementById('ppt-form-slides');
    if (slidesInp && slidesInp.value.trim()) {
        formData.append('slide_count', slidesInp.value.trim());
    }

    // Prevent duplicate submits & set loading state
    if (submitBtn) submitBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (btnText) btnText.textContent = 'Uploading...';
    if (progLabel) progLabel.textContent = (hasMedia ? 'Uploading media & presentation...' : 'Uploading presentation...');
    if (errMsg) errMsg.style.display = 'none';
    if (progContainer) progContainer.style.display = 'block';
    if (progBar) progBar.style.width = '10%';
    if (progPercent) progPercent.textContent = '10%';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/course-ppts/upload', true);
    const pptUploadToken = csrfToken || sessionStorage.getItem('ek_csrf_token') || '';
    if (pptUploadToken) {
        xhr.setRequestHeader('X-CSRF-Token', pptUploadToken);
    }

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const pct = Math.min(95, Math.round((e.loaded / e.total) * 100));
            if (progBar) progBar.style.width = pct + '%';
            if (progPercent) progPercent.textContent = pct + '%';
        }
    };

    xhr.onload = () => {
        let resp = null;
        try {
            resp = JSON.parse(xhr.responseText);
        } catch (e) {
            resp = null;
        }

        if (xhr.status >= 200 && xhr.status < 300 && resp && resp.status === 'success') {
            if (progBar) progBar.style.width = '100%';
            if (progPercent) progPercent.textContent = '100%';
            showToast(resp.message || 'Presentation uploaded successfully', 'success');
            closeModal('modal-add-ppt');
            if (activeCourseId === courseId) {
                loadCoursePpts(courseId);
            }
        } else {
            const err = (resp && resp.message) ? resp.message : ('Upload failed (HTTP ' + xhr.status + ')');
            if (errMsg) {
                errMsg.textContent = err;
                errMsg.style.display = 'block';
            }
            showToast(err, 'error');
            if (submitBtn) submitBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
            if (btnText) btnText.textContent = 'Upload Presentation';
            if (progContainer) progContainer.style.display = 'none';
        }
    };

    xhr.onerror = () => {
        const err = 'Network or connection error during upload';
        if (errMsg) {
            errMsg.textContent = err;
            errMsg.style.display = 'block';
        }
        showToast(err, 'error');
        if (submitBtn) submitBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (btnText) btnText.textContent = 'Upload Presentation';
        if (progContainer) progContainer.style.display = 'none';
    };

    xhr.send(formData);
}

function downloadCoursePpt(pptId) {
    if (!pptId) return;
    const downloadUrl = '/api/course-ppts/' + pptId + '/download';
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function openDeletePptModal(pptId, pptTitle) {
    document.getElementById('delete-ppt-id').value = pptId;
    const titleEl = document.getElementById('delete-ppt-title-display');
    if (titleEl) titleEl.textContent = `"${pptTitle}"`;
    document.getElementById('modal-delete-ppt-confirm').classList.add('visible');
}

async function submitDeletePpt() {
    const pptId = parseInt(document.getElementById('delete-ppt-id').value);
    if (!pptId) return;

    const btn = document.getElementById('btn-confirm-delete-ppt');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Deleting...';
    }

    try {
        const res = await fetch(`/api/course-ppts/${pptId}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: pptId })
        });
        const data = await res.json();

        if (data.status === 'success') {
            showToast(data.message || 'Presentation deleted', 'success');
            closeModal('modal-delete-ppt-confirm');

            // If the deleted PPT is currently playing in the video player, close the video player
            if (activePlayingPptId === pptId) {
                closeClassroomVideo();
            }

            // Refresh PPT library
            if (activeCourseId) {
                loadCoursePpts(activeCourseId);
            }
        } else {
            showToast(data.message || 'Failed to delete presentation', 'error');
        }
    } catch (err) {
        showToast('Connection error while deleting presentation', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>Delete Presentation</span>';
        }
    }
}

// ============================================================
// USERS (Institute Admin)
// ============================================================
async function loadUsers() {
    try {
        const res = await fetch('/api/users');
        const data = await res.json();
        if (data.status === 'success') {
            allUsers = data.data;
            renderUsers(allUsers);
        } else {
            showToast(data.message || 'Failed to fetch users', 'error');
        }
    } catch (e) {
        console.warn('Failed to load users:', e);
    }
}

function formatMobileNumber(raw) {
    if (!raw) return '-';
    const str = String(raw).trim();
    if (!str || str === '-') return '-';

    const digits = str.replace(/\D/g, '');

    // 10 digits standard mobile number (e.g. 3698520147 or 9415012001)
    if (digits.length === 10) {
        return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    }

    // 12 digits starting with country code 91
    if (digits.length === 12 && digits.startsWith('91')) {
        return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
    }

    // 11 digits starting with 0
    if (digits.length === 11 && digits.startsWith('0')) {
        return `+91 ${digits.slice(1, 6)} ${digits.slice(6)}`;
    }

    if (str.startsWith('+')) {
        return str;
    }

    return `+91 ${str}`;
}

function renderUsers(users) {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">No users found.</td></tr>';
        return;
    }

    users.forEach(u => {
        let userRolesList = [];
        if (Array.isArray(u.roles) && u.roles.length > 0) {
            userRolesList = u.roles;
        } else if (u.role) {
            userRolesList = [{ shortname: u.role, name: u.role_label || u.role }];
        } else {
            userRolesList = [{ shortname: 'student', name: 'Student Officer' }];
        }

        const roleLabels = userRolesList.map(r => {
            let cls = 'stud';
            let label = r.name || r.shortname || 'Student Officer';
            const s = (r.shortname || r.name || '').toLowerCase();
            if (s === 'instituteadmin' || s.includes('inst')) {
                cls = 'inst';
                label = 'Institute Admin';
            } else if (s === 'courseadmin' || s.includes('course')) {
                cls = 'course';
                label = 'Course Admin';
            } else {
                cls = 'stud';
                label = 'Student Officer';
            }
            return `<span class="role-tag ${cls}">${esc(label)}</span>`;
        }).join(' ');

        const statusTag = u.suspended == 1
            ? `<span class="badge-status-suspended"><span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#ef4444;"></span>Permanently Suspended</span>`
            : `<span class="badge-status-active"><span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#22c55e;"></span>Active</span>`;

        const isSelf = currentUser && parseInt(currentUser.id) === parseInt(u.id);
        const isProtected = isSelf || u.username === 'siteadmin' || parseInt(u.id) <= 2;

        const formattedMobile = formatMobileNumber(u.mobile || u.phone1 || u.phone2);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${esc(u.username)}</code></td>
            <td style="font-weight: 600;">${esc(u.firstname)} ${esc(u.lastname)}</td>
            <td>${esc(u.email || '-')}</td>
            <td style="font-family: var(--font-mono); font-size: 0.85rem; letter-spacing: 0.3px; white-space: nowrap;">${esc(formattedMobile)}</td>
            <td>${roleLabels}</td>
            <td>${statusTag}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.45rem;">
                    <button type="button" class="btn-card btn-edit-user" data-id="${u.id}" style="padding: 0.3rem 0.65rem; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.35rem; white-space: nowrap;" onclick="openEditUserModal(${u.id})">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        <span>Edit</span>
                    </button>
                    ${isProtected ? `
                    <button type="button" class="btn-card" disabled title="${isSelf ? 'Cannot delete your active session account' : 'Protected administrator'}" style="padding: 0.3rem 0.65rem; font-size: 0.78rem; opacity: 0.35; cursor: not-allowed; display: inline-flex; align-items: center; gap: 0.35rem; white-space: nowrap;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        <span>Delete</span>
                    </button>
                    ` : `
                    <button type="button" class="btn-card danger btn-delete-user" data-id="${u.id}" style="padding: 0.3rem 0.65rem; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.35rem; white-space: nowrap;" onclick="confirmDeleteUser(${u.id}, '${esc(u.username)}', '${esc(u.firstname + ' ' + u.lastname)}')">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        <span>Delete</span>
                    </button>
                    `}
                </div>
            </td>
        `;
        const editBtn = tr.querySelector('.btn-edit-user');
        if (editBtn) {
            editBtn.addEventListener('click', () => openEditUserModal(u.id));
        }
        tbody.appendChild(tr);
    });
}

// ============================================================
// USER MANAGEMENT MODAL HANDLERS
// ============================================================
function renderCoursesChecklist(selectedCourseIds = []) {
    const container = document.getElementById('user-form-courses-container');
    if (!container) return;

    if (!courses || courses.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted); font-size: 0.85rem;">No courses available</span>';
        return;
    }

    const selectedNums = (selectedCourseIds || []).map(id => parseInt(id));

    container.innerHTML = courses.map(c => {
        const cid = parseInt(c.id);
        const isChecked = selectedNums.includes(cid) ? 'checked' : '';
        return `
            <label style="display: flex; align-items: center; gap: 0.6rem; padding: 0.35rem 0; font-size: 0.88rem; cursor: pointer; color: var(--text-primary); border-bottom: 1px border-subtle;">
                <input type="checkbox" class="user-course-checkbox" value="${cid}" ${isChecked} style="accent-color: var(--gold-primary); width: 16px; height: 16px; cursor: pointer;">
                <span><strong>${esc(c.shortname)}</strong> — ${esc(c.fullname)}</span>
            </label>
        `;
    }).join('');
}

function toggleUserFormPassword() {
    const passwordInput = document.getElementById('user-form-password');
    const toggleBtn = document.getElementById('btn-toggle-user-password');
    if (!passwordInput || !toggleBtn) return;

    const isPassword = passwordInput.getAttribute('type') === 'password';
    passwordInput.setAttribute('type', isPassword ? 'text' : 'password');

    const eyeShow = toggleBtn.querySelector('.eye-show');
    const eyeHide = toggleBtn.querySelector('.eye-hide');
    if (eyeShow && eyeHide) {
        eyeShow.style.display = isPassword ? 'none' : 'block';
        eyeHide.style.display = isPassword ? 'block' : 'none';
    }
    const label = isPassword ? 'Hide password' : 'Show password';
    toggleBtn.setAttribute('title', label);
    toggleBtn.setAttribute('aria-label', label);
    passwordInput.focus();
}

function resetUserFormPasswordVisibility() {
    const passwordInput = document.getElementById('user-form-password');
    const toggleBtn = document.getElementById('btn-toggle-user-password');
    if (!passwordInput || !toggleBtn) return;
    passwordInput.setAttribute('type', 'password');
    const eyeShow = toggleBtn.querySelector('.eye-show');
    const eyeHide = toggleBtn.querySelector('.eye-hide');
    if (eyeShow && eyeHide) {
        eyeShow.style.display = 'block';
        eyeHide.style.display = 'none';
    }
    toggleBtn.setAttribute('title', 'Show password');
    toggleBtn.setAttribute('aria-label', 'Show password');
}

function openCreateUserModal() {
    resetUserFormPasswordVisibility();
    document.getElementById('modal-user-title').innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--gold-light);"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="17" y1="11" x2="23" y2="11"></line></svg>
        Add New User
    `;
    document.getElementById('user-form-id').value = '';
    document.getElementById('user-form-username').value = '';
    document.getElementById('user-form-username').removeAttribute('readonly');
    document.getElementById('user-form-password').value = '';
    document.getElementById('user-password-label-hint').textContent = '(required)';
    document.getElementById('user-form-firstname').value = '';
    document.getElementById('user-form-lastname').value = '';
    document.getElementById('user-form-email').value = '';
    document.getElementById('user-form-phone').value = '';
    document.getElementById('user-form-suspended').value = '0';
    document.getElementById('user-form-role').value = 'student';

    const deleteBtn = document.getElementById('btn-user-form-delete');
    if (deleteBtn) deleteBtn.style.display = 'none';

    renderCoursesChecklist([]);
    document.getElementById('modal-user-form').classList.add('visible');
}

function openEditUserModal(userId) {
    resetUserFormPasswordVisibility();
    const user = allUsers.find(u => parseInt(u.id) === parseInt(userId));
    if (!user) {
        showToast('User record not found', 'error');
        return;
    }

    document.getElementById('modal-user-title').innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--gold-light);"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        Configure User: ${esc(user.username)}
    `;

    document.getElementById('user-form-id').value = user.id;
    document.getElementById('user-form-username').value = user.username;
    document.getElementById('user-form-username').setAttribute('readonly', 'readonly');
    document.getElementById('user-form-password').value = '';
    document.getElementById('user-password-label-hint').textContent = '(leave blank to keep current)';
    document.getElementById('user-form-firstname').value = user.firstname || '';
    document.getElementById('user-form-lastname').value = user.lastname || '';
    document.getElementById('user-form-email').value = user.email || '';
    document.getElementById('user-form-phone').value = formatMobileNumber(user.mobile || user.phone1 || user.phone2);
    document.getElementById('user-form-suspended').value = user.suspended || '0';

    // Primary role
    let primaryRole = user.role || 'student';
    if (user.roles && user.roles.length > 0) {
        const r = user.roles[0].shortname;
        if (['instituteadmin', 'courseadmin', 'student'].includes(r)) {
            primaryRole = r;
        }
    }
    document.getElementById('user-form-role').value = primaryRole;

    const deleteBtn = document.getElementById('btn-user-form-delete');
    if (deleteBtn) {
        const isSelfOrSiteAdmin = (currentUser && parseInt(currentUser.id) === parseInt(user.id)) || user.username === 'siteadmin' || parseInt(user.id) <= 2;
        deleteBtn.style.display = isSelfOrSiteAdmin ? 'none' : 'inline-flex';
    }

    renderCoursesChecklist(user.assigned_courses || []);
    document.getElementById('modal-user-form').classList.add('visible');
}

function handleDeleteFromUserModal() {
    const userId = parseInt(document.getElementById('user-form-id').value);
    const user = allUsers.find(u => parseInt(u.id) === userId);
    if (!user) return;
    closeModal('modal-user-form');
    confirmDeleteUser(user.id, user.username, `${user.firstname} ${user.lastname}`);
}

function confirmDeleteUser(userId, username, fullName) {
    document.getElementById('delete-user-id').value = userId;
    const nameStr = fullName ? `${fullName} (${username})` : username;
    document.getElementById('delete-user-display').textContent = nameStr;
    document.getElementById('modal-delete-user-confirm').classList.add('visible');
}

async function submitDeleteUser() {
    const userId = parseInt(document.getElementById('delete-user-id').value);
    if (!userId) {
        showToast('Invalid user ID', 'error');
        return;
    }

    const btn = document.getElementById('btn-confirm-delete-user');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting...';
    }

    try {
        const res = await fetch('/api/users/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(data.message || 'User deleted successfully', 'success');
            closeModal('modal-delete-user-confirm');
            loadUsers();
        } else {
            showToast(data.message || 'Failed to delete user', 'error');
        }
    } catch (e) {
        showToast('Connection error: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Delete User';
        }
    }
}

async function submitUserForm() {
    const userId = document.getElementById('user-form-id').value;
    const isCreate = !userId;

    const username = document.getElementById('user-form-username').value.trim();
    const password = document.getElementById('user-form-password').value;
    const firstname = document.getElementById('user-form-firstname').value.trim();
    const lastname = document.getElementById('user-form-lastname').value.trim();
    const email = document.getElementById('user-form-email').value.trim();
    const rawPhone = document.getElementById('user-form-phone').value.trim();
    const phone = rawPhone ? formatMobileNumber(rawPhone) : '';
    const suspended = parseInt(document.getElementById('user-form-suspended').value);
    const role = document.getElementById('user-form-role').value;

    if (isCreate) {
        if (!username || !password || !firstname || !lastname || !email) {
            showToast('Username, password, name, and email are required', 'error');
            return;
        }
    } else {
        if (!firstname || !lastname || !email) {
            showToast('First name, last name, and email are required', 'error');
            return;
        }
    }

    try {
        let currentUserId = userId;

        if (isCreate) {
            const res = await fetch('/api/users/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, firstname, lastname, email, phone, mobile: phone, role, suspended })
            });
            const data = await res.json();
            if (data.status !== 'success') {
                showToast(data.message || 'Failed to create user', 'error');
                return;
            }
            currentUserId = data.data.id;
        } else {
            const updatePayload = { user_id: currentUserId, firstname, lastname, email, phone, mobile: phone, suspended };
            if (password && password.trim().length > 0) {
                updatePayload.password = password;
            }
            const res = await fetch('/api/users/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatePayload)
            });
            const data = await res.json();
            if (data.status !== 'success') {
                showToast(data.message || 'Failed to update user', 'error');
                return;
            }

            // Update Role
            const roleRes = await fetch('/api/users/update-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUserId, role })
            });
            const roleData = await roleRes.json();
            if (roleData.status !== 'success') {
                showToast('User updated but role assignment failed: ' + roleData.message, 'warning');
            }
        }

        // Process Course Enrolment Assignments
        const checkedBoxes = Array.from(document.querySelectorAll('.user-course-checkbox:checked')).map(cb => parseInt(cb.value));
        const originalUser = allUsers.find(u => parseInt(u.id) === parseInt(currentUserId));
        const originalCourseIds = (originalUser && originalUser.assigned_courses) ? originalUser.assigned_courses.map(id => parseInt(id)) : [];

        // Courses to add
        const toAdd = checkedBoxes.filter(cid => !originalCourseIds.includes(cid));
        // Courses to remove
        const toRemove = originalCourseIds.filter(cid => !checkedBoxes.includes(cid));

        for (const cid of toAdd) {
            await fetch(`/api/users/${currentUserId}/courses/assign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: cid })
            });
        }

        for (const cid of toRemove) {
            await fetch(`/api/users/${currentUserId}/courses/remove`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: cid })
            });
        }

        showToast(`User ${isCreate ? 'created' : 'updated'} successfully`, 'success');
        closeModal('modal-user-form');
        loadUsers();
    } catch (e) {
        showToast('Connection error: ' + e.message, 'error');
    }
}

// ============================================================
// COURSE MANAGEMENT (ADD / DELETE) MODAL HANDLERS
// ============================================================
function openAddCourseModal() {
    document.getElementById('add-course-fullname').value = '';
    document.getElementById('add-course-shortname').value = '';
    document.getElementById('add-course-summary').value = '';
    document.getElementById('add-course-category').value = '1';
    document.getElementById('add-course-visible').value = '1';
    document.getElementById('modal-add-course').classList.add('visible');
}

async function submitAddCourse() {
    const fullname = document.getElementById('add-course-fullname').value.trim();
    const shortname = document.getElementById('add-course-shortname').value.trim();
    const category_id = parseInt(document.getElementById('add-course-category').value);
    const summary = document.getElementById('add-course-summary').value.trim();
    const visible = parseInt(document.getElementById('add-course-visible').value);

    if (!fullname || !shortname) {
        showToast('Course name and short name are required', 'error');
        return;
    }

    try {
        const res = await fetch('/api/courses/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullname, shortname, category_id, summary, visible })
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('Course created successfully', 'success');
            closeModal('modal-add-course');
            loadCourses();
        } else {
            showToast(data.message || 'Failed to create course', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    }
}

function openDeleteCourseModal(courseId, courseName) {
    document.getElementById('delete-course-id').value = courseId;
    document.getElementById('delete-course-prompt').innerHTML =
        `Are you sure you want to delete course <strong>"${esc(courseName)}"</strong>? This action cannot be undone.`;
    document.getElementById('modal-delete-course-confirm').classList.add('visible');
}

async function submitDeleteCourse() {
    const courseId = parseInt(document.getElementById('delete-course-id').value);
    if (!courseId) {
        showToast('Invalid course ID', 'error');
        return;
    }

    try {
        const res = await fetch('/api/courses/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ course_id: courseId })
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('Course deleted successfully', 'success');
            closeModal('modal-delete-course-confirm');
            loadCourses();
        } else {
            showToast(data.message || 'Failed to delete course', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    }
}

// ============================================================
// MODALS: Edit Course
// ============================================================
function openEditCourseModal(preselect) {
    const select = document.getElementById('edit-course-select');
    select.innerHTML = '';

    const editableCourses = courses.filter(c => c.can_edit);
    editableCourses.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.shortname + ' - ' + c.fullname;
        if (preselect && parseInt(c.id) === preselect) opt.selected = true;
        select.appendChild(opt);
    });

    // Pre-fill
    const sel = editableCourses.find(c => parseInt(c.id) === (preselect || parseInt(select.value)));
    if (sel) {
        document.getElementById('edit-course-fullname').value = sel.fullname;
        document.getElementById('edit-course-summary').value = sel.summary || '';
    }

    select.onchange = () => {
        const s = editableCourses.find(c => c.id == select.value);
        if (s) {
            document.getElementById('edit-course-fullname').value = s.fullname;
            document.getElementById('edit-course-summary').value = s.summary || '';
        }
    };

    document.getElementById('modal-edit-course').classList.add('visible');
}

async function submitEditCourse() {
    const courseId = parseInt(document.getElementById('edit-course-select').value);
    const fullname = document.getElementById('edit-course-fullname').value.trim();
    const summary = document.getElementById('edit-course-summary').value.trim();

    if (!fullname) { showToast('Course name is required', 'error'); return; }

    try {
        const res = await fetch('/api/course-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ course_id: courseId, fullname, summary })
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('Course updated successfully', 'success');
            closeModal('modal-edit-course');
            loadCourses();
        } else {
            showToast(data.message || 'Failed to update', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    }
}

// ============================================================
// MODALS: Add Section
// ============================================================
function openAddSectionModal() {
    const select = document.getElementById('section-course-select');
    select.innerHTML = '';

    const editableCourses = courses.filter(c => c.can_edit);
    editableCourses.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.shortname + ' - ' + c.fullname;
        if (activeCourseId && parseInt(c.id) === activeCourseId) opt.selected = true;
        select.appendChild(opt);
    });

    document.getElementById('section-name').value = '';
    document.getElementById('section-summary').value = '';
    document.getElementById('modal-add-section').classList.add('visible');
}

async function submitAddSection() {
    const courseId = parseInt(document.getElementById('section-course-select').value);
    const name = document.getElementById('section-name').value.trim();
    const summary = document.getElementById('section-summary').value.trim();

    if (!name) { showToast('Section name is required', 'error'); return; }

    try {
        const res = await fetch('/api/section-add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ course_id: courseId, name, summary })
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(data.message, 'success');
            closeModal('modal-add-section');
            if (activeCourseId === courseId) openClassroom(courseId);
        } else {
            showToast(data.message || 'Failed to add section', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    }
}

// ============================================================
// MODAL HELPERS & BODY SCROLL LOCK
// ============================================================
function updateBodyScrollState() {
    const isAnyModalOpen = !!(
        document.querySelector('.modal-overlay.visible') ||
        document.querySelector('.commander-modal-overlay[style*="display: flex"]') ||
        document.querySelector('.commander-modal-overlay[style*="display:flex"]')
    );
    if (isAnyModalOpen) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('visible');
        updateBodyScrollState();
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('visible');
    updateBodyScrollState();
}

// Observe all modal overlays to automatically lock/unlock background scroll
const modalObserver = new MutationObserver(() => {
    updateBodyScrollState();
});

document.querySelectorAll('.modal-overlay, .commander-modal-overlay').forEach(overlay => {
    modalObserver.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('visible');
            if (overlay.id === 'commander-lightbox-modal') {
                closeCommanderLightbox();
            }
            updateBodyScrollState();
        }
    });
});

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast ' + type + ' visible';
    setTimeout(() => toast.classList.remove('visible'), 3500);
}

// ============================================================
// UTILS
// ============================================================
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function escJs(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}

// ============================================================
// PREVIOUS COMMANDERS AUTO-SLIDER, LIGHTBOX & UPLOAD
// ============================================================
let cmdSliderPlaying = false; // Auto-scrolling disabled per user requirement
let cmdSliderUserPaused = true;
let cmdSliderRafId = null;
const cmdSliderSpeed = 0;
let cmdLightboxIndex = 0;
let allCommanders = [];
let cmdSliderInitialized = false;
let selectedCommanderFile = null;

function formatCmdFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getBaselineCommanders() {
    const list = [];
    for (let i = 1; i <= 31; i++) {
        list.push({
            id: i,
            type: 'base',
            image_url: `previouscomd/${i}.jpg`,
            title: 'Previous Commander of Officers Training College',
            sub_title: 'Officers Training College, AMC Centre and College, Lucknow'
        });
    }
    return list;
}

let commandersLoaded = false;

async function fetchCommandersList() {
    try {
        const res = await fetch('/api/commanders');
        if (res.ok) {
            const data = await res.json();
            if (data && data.status === 'success' && Array.isArray(data.commanders)) {
                allCommanders = data.commanders;
                commandersLoaded = true;
                return;
            }
        }
    } catch (e) {
        console.warn('Could not fetch commanders list from API, using baseline:', e);
    }
    if (!commandersLoaded && (!allCommanders || allCommanders.length === 0)) {
        allCommanders = getBaselineCommanders();
    }
}

function renderCommandersTrack() {
    const track = document.getElementById('cmd-slider-track');
    if (!track) return;

    if (!allCommanders || allCommanders.length === 0) {
        track.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; min-height:160px; color:var(--text-muted); font-size:0.85rem; text-align:center; padding:1.5rem; gap:0.4rem;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <div style="font-weight:600;">No previous commander portraits currently displayed.</div>
                <div style="font-size:0.75rem; opacity:0.75;">Click the <strong>[ 🖼️ ▾ ]</strong> button above to add a portrait.</div>
            </div>
        `;
        return;
    }

    // Render two full sets for seamless infinite loop
    let cardsHtml = '';
    for (let set = 0; set < 2; set++) {
        allCommanders.forEach((cmd, idx) => {
            const safeTitle = esc(cmd.title || 'Previous Commander of Officers Training College');
            cardsHtml += `
                <div class="commander-card" data-idx="${idx}" onclick="openCommanderLightbox(${idx})" title="View Portrait">
                    <div class="commander-img-frame">
                        <img src="${esc(cmd.image_url)}" alt="${safeTitle}" loading="lazy" class="commander-portrait" onerror="this.src='previouscomd/1.jpg'">
                    </div>
                </div>
            `;
        });
    }
    track.innerHTML = cardsHtml;
}

async function initCommandersSlider() {
    if (cmdSliderInitialized) return;
    const track = document.getElementById('cmd-slider-track');
    const viewport = document.getElementById('cmd-slider-viewport');
    if (!track || !viewport) return;

    cmdSliderInitialized = true;
    cmdSliderPlaying = false;
    cmdSliderUserPaused = true;

    await fetchCommandersList();
    renderCommandersTrack();
    initCurrentCommandersSlider();

    // Normalizing wrap on user scroll (drag or touch)
    viewport.addEventListener('scroll', () => {
        const halfWidth = track.scrollWidth / 2;
        if (halfWidth > 0) {
            if (viewport.scrollLeft >= halfWidth * 1.5) {
                viewport.scrollLeft -= halfWidth;
            } else if (viewport.scrollLeft < 0) {
                viewport.scrollLeft += halfWidth;
            }
        }
    }, { passive: true });

    // Mouse drag support
    let isMouseDown = false;
    let startX = 0;
    let scrollLeftStart = 0;

    viewport.addEventListener('mousedown', (e) => {
        isMouseDown = true;
        startX = e.pageX - viewport.offsetLeft;
        scrollLeftStart = viewport.scrollLeft;
    });

    window.addEventListener('mouseup', () => {
        isMouseDown = false;
    });

    viewport.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        e.preventDefault();
        const x = e.pageX - viewport.offsetLeft;
        const walk = (x - startX) * 1.4;
        viewport.scrollLeft = scrollLeftStart - walk;
    });

    // Touch swipe support
    let touchStartX = 0;
    let touchScrollStart = 0;
    viewport.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].pageX;
        touchScrollStart = viewport.scrollLeft;
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
        const x = e.touches[0].pageX;
        const walk = (x - touchStartX) * 1.4;
        viewport.scrollLeft = touchScrollStart - walk;
    }, { passive: true });

    initCommanderUploadDropzone();
}

function startCommanderSliderLoop() {
    // Auto-scroll disabled per user request
    if (cmdSliderRafId) {
        cancelAnimationFrame(cmdSliderRafId);
        cmdSliderRafId = null;
    }
}

function toggleCommanderSliderPlay() {
    // Kept for backward compatibility if ever called
    cmdSliderUserPaused = !cmdSliderUserPaused;
    cmdSliderPlaying = !cmdSliderUserPaused;
}

function stepCommanderSlider(direction) {
    const viewport = document.getElementById('cmd-slider-viewport');
    const track = document.getElementById('cmd-slider-track');
    if (!viewport || !track) return;

    const card = track.querySelector('.commander-card');
    const cardWidth = card ? (card.offsetWidth + 18) : 200;
    const stepSize = cardWidth * 2; // step by 2 cards (~400px)
    const halfWidth = track.scrollWidth / 2;

    if (direction < 0 && viewport.scrollLeft <= stepSize) {
        // Wrap to second identical set before scrolling left
        viewport.scrollLeft += halfWidth;
    } else if (direction > 0 && viewport.scrollLeft >= halfWidth - stepSize) {
        // Wrap to first identical set before scrolling right
        viewport.scrollLeft -= halfWidth;
    }

    viewport.scrollBy({ left: direction * stepSize, behavior: 'smooth' });
}

let activeCommanderLightboxMode = 'previous'; // 'previous' or 'current'

// Lightbox modal methods
function openCommanderLightbox(index) {
    if (!allCommanders || allCommanders.length === 0) return;
    activeCommanderLightboxMode = 'previous';
    cmdLightboxIndex = parseInt(index) || 0;
    if (cmdLightboxIndex < 0) cmdLightboxIndex = 0;
    if (cmdLightboxIndex >= allCommanders.length) cmdLightboxIndex = allCommanders.length - 1;

    updateCommanderLightboxView();
    const modal = document.getElementById('commander-lightbox-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function openCurrentCommanderLightbox(index) {
    if (!allCurrentCommanders || allCurrentCommanders.length === 0) return;
    activeCommanderLightboxMode = 'current';
    cmdLightboxIndex = parseInt(index) || 0;
    if (cmdLightboxIndex < 0) cmdLightboxIndex = 0;
    if (cmdLightboxIndex >= allCurrentCommanders.length) cmdLightboxIndex = allCurrentCommanders.length - 1;

    updateCommanderLightboxView();
    const modal = document.getElementById('commander-lightbox-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeCommanderLightbox() {
    const modal = document.getElementById('commander-lightbox-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    updateBodyScrollState();
}

function handleCommanderLightboxOverlayClick(e) {
    if (e.target.id === 'commander-lightbox-modal') {
        closeCommanderLightbox();
    }
}

let lastCmdLightboxNavTime = 0;
function navigateCommanderLightbox(dir) {
    const list = activeCommanderLightboxMode === 'current' ? allCurrentCommanders : allCommanders;
    if (!list || list.length === 0) return;
    const now = Date.now();
    if (now - lastCmdLightboxNavTime < 150) return;
    lastCmdLightboxNavTime = now;

    cmdLightboxIndex += dir;
    if (cmdLightboxIndex >= list.length) cmdLightboxIndex = 0;
    if (cmdLightboxIndex < 0) cmdLightboxIndex = list.length - 1;
    updateCommanderLightboxView();
}

function updateCommanderLightboxView() {
    const img = document.getElementById('commander-modal-img');
    const caption = document.getElementById('commander-modal-caption');
    const heading = document.querySelector('.commander-modal-heading');
    const list = activeCommanderLightboxMode === 'current' ? allCurrentCommanders : allCommanders;
    const cmd = list[cmdLightboxIndex];
    if (!cmd) return;

    if (heading) {
        heading.textContent = activeCommanderLightboxMode === 'current'
            ? 'Officers Training College — Current Leadership'
            : 'Officers Training College — Roll of Honour';
    }
    if (img) {
        img.src = cmd.image_url;
        img.alt = cmd.title || (activeCommanderLightboxMode === 'current' ? 'Current Commander of Officers Training College' : 'Previous Commander of Officers Training College');
    }
    if (caption) {
        caption.textContent = cmd.sub_title || 'Officers Training College, AMC Centre and College, Lucknow';
    }
}

// ============================================================
// ADD COMMANDER MODAL & UPLOAD HANDLING (Institute Admin Only)
// ============================================================
function openAddCommanderModal() {
    if (!currentUser || currentUser.role !== 'instituteadmin') {
        showToast('Access restricted: Only Institute Administrators can add commander portraits.', 'error');
        return;
    }
    selectedCommanderFile = null;
    const fileInput = document.getElementById('cmd-file-input');
    if (fileInput) fileInput.value = '';

    const promptEl = document.getElementById('cmd-dropzone-prompt');
    if (promptEl) promptEl.style.display = 'block';

    const prevContainer = document.getElementById('cmd-preview-container');
    if (prevContainer) prevContainer.style.display = 'none';

    const errEl = document.getElementById('cmd-upload-error');
    if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
    }

    const progContainer = document.getElementById('cmd-upload-progress');
    if (progContainer) progContainer.style.display = 'none';

    const modal = document.getElementById('modal-add-commander');
    if (modal) {
        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';
    }
}

function closeAddCommanderModal() {
    const modal = document.getElementById('modal-add-commander');
    if (modal) {
        modal.classList.remove('visible');
    }
    updateBodyScrollState();
    selectedCommanderFile = null;
}

function handleCommanderModalOverlayClick(e) {
    if (e.target.id === 'modal-add-commander') {
        closeAddCommanderModal();
    }
}

function initCommanderUploadDropzone() {
    const dropzone = document.getElementById('cmd-upload-dropzone');
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
            handleCommanderFileSelected(dt.files[0]);
        }
    }, false);
}

function handleCommanderFileSelect(event) {
    if (event.target && event.target.files && event.target.files.length > 0) {
        handleCommanderFileSelected(event.target.files[0]);
    }
}

function handleCommanderFileSelected(file) {
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type.toLowerCase()) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
        const errEl = document.getElementById('cmd-upload-error');
        if (errEl) {
            errEl.textContent = 'Invalid file format. Please select a JPG, PNG, or WEBP image.';
            errEl.style.display = 'block';
        }
        return;
    }

    if (file.size > 15 * 1024 * 1024) {
        const errEl = document.getElementById('cmd-upload-error');
        if (errEl) {
            errEl.textContent = 'Image exceeds 15MB limit. Please select a smaller photo.';
            errEl.style.display = 'block';
        }
        return;
    }

    selectedCommanderFile = file;

    const errEl = document.getElementById('cmd-upload-error');
    if (errEl) errEl.style.display = 'none';

    const reader = new FileReader();
    reader.onload = function(e) {
        const prevImg = document.getElementById('cmd-preview-img');
        const prevName = document.getElementById('cmd-preview-name');
        const prevSize = document.getElementById('cmd-preview-size');
        const prevContainer = document.getElementById('cmd-preview-container');
        const promptEl = document.getElementById('cmd-dropzone-prompt');

        if (prevImg) prevImg.src = e.target.result;
        if (prevName) prevName.textContent = file.name;
        if (prevSize) prevSize.textContent = formatCmdFileSize(file.size);
        if (prevContainer) prevContainer.style.display = 'flex';
        if (promptEl) promptEl.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function submitAddCommander(event) {
    if (event) event.preventDefault();

    if (!currentUser || currentUser.role !== 'instituteadmin') {
        showToast('Access denied: Only Institute Administrators can upload commander portraits.', 'error');
        closeAddCommanderModal();
        return;
    }

    const errEl = document.getElementById('cmd-upload-error');
    if (!selectedCommanderFile) {
        if (errEl) {
            errEl.textContent = 'Please choose a commander portrait image to upload.';
            errEl.style.display = 'block';
        }
        return;
    }

    const titleVal = '';
    const subVal = '';

    const submitBtn = document.getElementById('cmd-modal-submit-btn');
    const submitText = document.getElementById('cmd-modal-submit-text');
    const cancelBtn = document.getElementById('cmd-modal-cancel-btn');
    const progContainer = document.getElementById('cmd-upload-progress');
    const progBar = document.getElementById('cmd-upload-bar');
    const progPercent = document.getElementById('cmd-upload-percent');

    if (submitBtn) submitBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (submitText) submitText.textContent = 'Uploading...';
    if (progContainer) progContainer.style.display = 'block';
    if (progBar) progBar.style.width = '0%';
    if (progPercent) progPercent.textContent = '0%';
    if (errEl) errEl.style.display = 'none';

    const formData = new FormData();
    formData.append('image', selectedCommanderFile);
    if (titleVal) formData.append('title', titleVal);
    if (subVal) formData.append('sub_title', subVal);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/commanders/upload', true);
    const cmdUploadToken = csrfToken || sessionStorage.getItem('ek_csrf_token') || '';
    if (cmdUploadToken) {
        xhr.setRequestHeader('X-CSRF-Token', cmdUploadToken);
    }

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            if (progBar) progBar.style.width = percent + '%';
            if (progPercent) progPercent.textContent = percent + '%';
        }
    };

    xhr.onload = () => {
        let resp = null;
        try {
            resp = JSON.parse(xhr.responseText);
        } catch (ex) {
            resp = null;
        }

        if (xhr.status >= 200 && xhr.status < 300 && resp && resp.status === 'success') {
            if (progBar) progBar.style.width = '100%';
            if (progPercent) progPercent.textContent = '100%';

            if (resp.commander) {
                allCommanders.push(resp.commander);
            } else {
                allCommanders.push({
                    id: allCommanders.length + 1,
                    image_url: 'previouscomd/1.jpg',
                    title: titleVal || 'Previous Commander of Officers Training College',
                    sub_title: subVal || 'Officers Training College, AMC Centre and College, Lucknow'
                });
            }

            // Re-render slider track with new commander included
            renderCommandersTrack();

            showToast(resp.message || 'Commander portrait added successfully', 'success');
            closeAddCommanderModal();
        } else {
            const msg = (resp && resp.message) ? resp.message : ('Upload failed (HTTP ' + xhr.status + ')');
            if (errEl) {
                errEl.textContent = msg;
                errEl.style.display = 'block';
            }
            showToast(msg, 'error');
        }

        if (submitBtn) submitBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (submitText) submitText.textContent = 'Add Commander';
    };

    xhr.onerror = () => {
        const msg = 'Network connection error while uploading commander image.';
        if (errEl) {
            errEl.textContent = msg;
            errEl.style.display = 'block';
        }
        showToast(msg, 'error');
        if (submitBtn) submitBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (submitText) submitText.textContent = 'Add Commander';
    };

    xhr.send(formData);
}

// ============================================================
// COMMANDER IMAGE MANAGEMENT DROPDOWN (Add & Delete Controls)
// ============================================================
function toggleCommanderManageMenu(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const menu = document.getElementById('cmd-manage-menu');
    if (!menu) return;
    const isShowing = menu.style.display === 'flex' || menu.style.display === 'block';
    menu.style.display = isShowing ? 'none' : 'flex';
}

function closeCommanderManageMenu() {
    const menu = document.getElementById('cmd-manage-menu');
    if (menu) menu.style.display = 'none';
}

// Close commander management dropdown when clicking anywhere outside
document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('cmd-manage-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        closeCommanderManageMenu();
    }
    const currWrapper = document.getElementById('curr-cmd-manage-wrapper');
    if (currWrapper && !currWrapper.contains(e.target)) {
        closeCurrentCommanderManageMenu();
    }
});

// ============================================================
// DELETE COMMANDER MODAL & ACTIONS (Institute Admin Only)
// ============================================================
function openDeleteCommanderModal() {
    if (!currentUser || currentUser.role !== 'instituteadmin') {
        showToast('Access restricted: Only Institute Administrators can delete commander portraits.', 'error');
        return;
    }
    const modal = document.getElementById('modal-delete-commander');
    if (modal) {
        renderDeleteCommanderGrid();
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeDeleteCommanderModal() {
    const modal = document.getElementById('modal-delete-commander');
    if (modal) modal.style.display = 'none';
    updateBodyScrollState();
}

function handleCommanderDeleteModalOverlayClick(e) {
    if (e.target.id === 'modal-delete-commander') {
        closeDeleteCommanderModal();
    }
}

function renderDeleteCommanderGrid() {
    const grid = document.getElementById('cmd-delete-grid');
    if (!grid) return;
    if (!allCommanders || allCommanders.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-muted);">No commander portraits found.</div>';
        return;
    }
    let html = '';
    allCommanders.forEach((cmd, idx) => {
        const title = esc(cmd.title || `Commander #${cmd.id}`);
        const isCustom = cmd.type === 'custom';
        const typeBadge = isCustom ? '<span style="font-size:0.65rem; background:rgba(212,175,55,0.2); color:#f3d779; padding:2px 6px; border-radius:4px; font-weight:700;">Uploaded</span>' : '';
        html += `
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color, rgba(255,255,255,0.1)); border-radius: 8px; padding: 0.5rem; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.4rem;">
                <div style="width: 100%; aspect-ratio: 3/4; overflow: hidden; border-radius: 6px; background: #000;">
                    <img src="${esc(cmd.image_url)}" alt="${title}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='previouscomd/1.jpg'">
                </div>
                ${typeBadge}
                <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-main); line-height: 1.2; max-height: 2.4em; overflow: hidden; text-overflow: ellipsis; width: 100%;">
                    ${title}
                </div>
                <button type="button" class="btn-slider-ctrl btn-slider-delete" style="width: 100%; justify-content: center; padding: 0.3rem 0.4rem; font-size: 0.72rem;" onclick="executeDeleteCommander(${idx})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    <span>Delete</span>
                </button>
            </div>
        `;
    });
    grid.innerHTML = html;
}

async function executeDeleteCommander(index) {
    if (!currentUser || currentUser.role !== 'instituteadmin') {
        showToast('Access denied: Only Institute Administrators can delete commander portraits.', 'error');
        return;
    }
    const cmd = allCommanders[index];
    if (!cmd) return;
    const name = cmd.title || `Commander #${cmd.id}`;
    if (!confirm(`Are you sure you want to delete "${name}" from the Roll of Honour?`)) {
        return;
    }
    try {
        const payload = {
            id: cmd.id,
            db_id: cmd.db_id || 0,
            base_id: cmd.base_id || (cmd.type === 'base' ? cmd.id : 0),
            type: cmd.type || 'base'
        };
        const token = csrfToken || sessionStorage.getItem('ek_csrf_token') || '';
        const res = await fetch('/api/commanders/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            showToast(data.message || 'Commander portrait deleted successfully', 'success');
            await fetchCommandersList();
            renderCommandersTrack();
            renderDeleteCommanderGrid();
            const lbModal = document.getElementById('commander-lightbox-modal');
            if (lbModal && lbModal.style.display !== 'none') {
                closeCommanderLightbox();
            }
        } else {
            showToast(data.message || 'Failed to delete portrait', 'error');
        }
    } catch (err) {
        console.error('Error deleting commander portrait:', err);
        showToast('Network error while deleting commander portrait', 'error');
    }
}

async function deleteCurrentLightboxCommander() {
    await executeDeleteCommander(cmdLightboxIndex);
}

// ============================================================
// CURRENT COMMANDERS AUTO-SLIDER, MANAGEMENT & UPLOAD
// ============================================================
let allCurrentCommanders = [];
let currCmdSliderInitialized = false;
let selectedCurrentCommanderFile = null;

function getBaselineCurrentCommanders() {
    return [{
        id: 1,
        base_id: 1,
        type: 'base',
        image_url: 'currentcomd/1.jpg',
        title: 'Current Commander of Officers Training College',
        sub_title: 'Officers Training College, AMC Centre and College, Lucknow'
    }];
}

let currentCommandersLoaded = false;

async function fetchCurrentCommandersList() {
    try {
        const res = await fetch('/api/current-commanders');
        if (res.ok) {
            const data = await res.json();
            if (data && data.status === 'success' && Array.isArray(data.commanders)) {
                allCurrentCommanders = data.commanders;
                currentCommandersLoaded = true;
                return;
            }
        }
    } catch (e) {
        console.warn('Could not fetch current commanders list from API, using baseline:', e);
    }
    if (!currentCommandersLoaded && (!allCurrentCommanders || allCurrentCommanders.length === 0)) {
        allCurrentCommanders = getBaselineCurrentCommanders();
    }
}

function renderCurrentCommandersTrack() {
    const track = document.getElementById('curr-cmd-slider-track');
    if (!track) return;

    if (!allCurrentCommanders || allCurrentCommanders.length === 0) {
        track.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; min-height:180px; color:var(--text-muted); font-size:0.88rem; text-align:center; padding:2rem; gap:0.5rem;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <div style="font-weight:700;">No current commander portraits uploaded yet.</div>
                <div style="font-size:0.75rem; opacity:0.75;">Click the <strong>[ 🖼️ ▾ ]</strong> button above to upload the active Commandant portrait.</div>
            </div>
        `;
        return;
    }

    let cardsHtml = '';
    allCurrentCommanders.forEach((cmd, idx) => {
        const safeTitle = esc(cmd.title || 'Lt Gen Shivinder Singh, AVSM');
        const safeSub = esc(cmd.sub_title || 'Comdt AMC C & C & OIC Records');
        cardsHtml += `
            <div class="curr-cmd-executive-card" data-idx="${idx}" onclick="openCurrentCommanderDetails(${idx})" title="Click to view details & bio-data">
                <div class="curr-cmd-photo-frame">
                    <img src="${esc(cmd.image_url)}" alt="${safeTitle}" loading="lazy" class="curr-cmd-photo" onerror="this.src='previouscomd/sample_commander.jpg'">
                    <div class="curr-cmd-hover-action">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                        <span>View Details & Bio</span>
                    </div>
                </div>
            </div>
        `;
    });
    track.innerHTML = cardsHtml;
}

let activeCurrentCommanderDetailIndex = 0;

function openCurrentCommanderDetails(index) {
    if (!allCurrentCommanders || allCurrentCommanders.length === 0) return;
    const idx = parseInt(index) || 0;
    activeCurrentCommanderDetailIndex = idx;
    const cmd = allCurrentCommanders[idx];
    if (!cmd) return;

    const modal = document.getElementById('modal-current-commander-details');
    if (!modal) return;

    const photoEl = document.getElementById('curr-cmd-detail-photo');
    const nameEl = document.getElementById('curr-cmd-detail-name');
    const roleEl = document.getElementById('curr-cmd-detail-role');
    const bannerEl = document.getElementById('curr-cmd-detail-banner');
    const bioTitleEl = document.getElementById('curr-cmd-detail-bio-title');
    const bioSubEl = document.getElementById('curr-cmd-detail-bio-sub');
    const bodyEl = document.getElementById('curr-cmd-detail-body');
    const editBtn = document.getElementById('btn-edit-current-commander-bio');

    const name = cmd.title || 'Lt Gen Shivinder Singh, AVSM';
    const role = cmd.sub_title || 'Comdt AMC C & C & OIC Records';
    const banner = cmd.banner_title || "AMC CENTRE & COLLEGE COMMANDANT'S PAGE";
    const bioData = cmd.bio_data || `1.   Lt Gen Shivinder Singh is an alumnus of the prestigious Armed Forces Medical College, Pune and was commissioned in the Army Medical Corps on 25 Dec 1987.\n\n2.   After completion of internship from Army Hosp R&R, during the initial phase of his service, the Gen Offr served with the Indian Peace Keeping Force (IPKF) in Sri Lanka as MO of 336 Fd Hosp, 36 Div deployed there and then 357 Fd Hosp, 57 Inf Div (IPKF & 3 Corps). The Gen Offr thereafter completed post graduation in Anaesthesiology from AFMC Pune in 1995. The Gen offr did Post Doctoral Certificate Course (Cardiac Critical Care) from the Escorts Heart Institute & Research Centre in 2003, Diploma in Critical Care Medicine from Indian Society of Critical Care Medicine in 2004 and Expeditionary Medical Support Course with US AF, from San Antonio, Texas in 2007. He also did Post Graduate Diploma in Healthcare Management from Baba Bhim Rao Ambedkar University in 2010.\n\n3.   In his 37 yrs of distinguished career, the Gen offr served as a Spl (Anaesthesiology) in multiple AFMS establishments first as a Graded Specialist at 181 MH (HQ, 5 Mtn Div), MH Jaipur, MH Ahmedabad and with UN mission at Sierra Leone and then as a Classified Specialist at Base Hospital Delhi Cantt, AFMC Pune and CH(EC). He was also appointed as Senior Advisor (Anaesthesiology) at CH(WC) Chandimandir, Professor & HOD at AFMC Pune and Consultant (Anaesthesiology) at Army Hosp (R&R) Delhi Cantt. Later he was appointed as Dy Comdt & CI at AMC Centre & College, Lucknow.`;

    if (photoEl) photoEl.src = cmd.image_url;
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;
    if (bannerEl) bannerEl.innerHTML = `<span>${esc(banner)}</span>`;
    if (bioTitleEl) bioTitleEl.textContent = `BIO-DATA : ${name.toUpperCase()}`;
    if (bioSubEl) bioSubEl.textContent = role.toUpperCase();

    // Render numbered bio paragraphs matching the uploaded design
    if (bodyEl) {
        const paragraphs = bioData.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        let bioHtml = '';
        paragraphs.forEach((p, pIdx) => {
            const trimmed = p.trim();
            const numMatch = trimmed.match(/^(\d+)[\.\)]\s*([\s\S]*)$/);
            let numStr = String(pIdx + 1).padStart(2, '0');
            let contentStr = trimmed;
            if (numMatch) {
                numStr = String(numMatch[1]).padStart(2, '0');
                contentStr = numMatch[2].trim();
            }
            bioHtml += `
                <div class="commandant-bio-paragraph">
                    <div class="commandant-bio-num">${esc(numStr)}</div>
                    <div class="commandant-bio-text">${esc(contentStr)}</div>
                </div>
            `;
        });
        bodyEl.innerHTML = bioHtml;
    }

    if (editBtn) {
        editBtn.style.display = (currentUser && currentUser.role === 'instituteadmin') ? 'inline-flex' : 'none';
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeCurrentCommanderDetails() {
    const modal = document.getElementById('modal-current-commander-details');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

function handleCurrentCommanderDetailsOverlayClick(e) {
    if (e.target.id === 'modal-current-commander-details') {
        closeCurrentCommanderDetails();
    }
}

function openEditCurrentCommanderBioModal() {
    const cmd = allCurrentCommanders[activeCurrentCommanderDetailIndex];
    if (!cmd) return;

    const idInput = document.getElementById('edit-curr-cmd-id');
    const dbIdInput = document.getElementById('edit-curr-cmd-db-id');
    const typeInput = document.getElementById('edit-curr-cmd-type');
    const nameInput = document.getElementById('edit-curr-cmd-name');
    const roleInput = document.getElementById('edit-curr-cmd-role');
    const bannerInput = document.getElementById('edit-curr-cmd-banner');
    const bioInput = document.getElementById('edit-curr-cmd-biodata');

    if (idInput) idInput.value = cmd.id || 0;
    if (dbIdInput) dbIdInput.value = cmd.db_id || 0;
    if (typeInput) typeInput.value = cmd.type || '';
    if (nameInput) nameInput.value = cmd.title || 'Lt Gen Shivinder Singh, AVSM';
    if (roleInput) roleInput.value = cmd.sub_title || 'Comdt AMC C & C & OIC Records';
    if (bannerInput) bannerInput.value = cmd.banner_title || "AMC CENTRE & COLLEGE COMMANDANT'S PAGE";
    if (bioInput) bioInput.value = cmd.bio_data || `1.   Lt Gen Shivinder Singh is an alumnus of the prestigious Armed Forces Medical College, Pune and was commissioned in the Army Medical Corps on 25 Dec 1987.\n\n2.   After completion of internship from Army Hosp R&R, during the initial phase of his service, the Gen Offr served with the Indian Peace Keeping Force (IPKF) in Sri Lanka as MO of 336 Fd Hosp, 36 Div deployed there and then 357 Fd Hosp, 57 Inf Div (IPKF & 3 Corps). The Gen Offr thereafter completed post graduation in Anaesthesiology from AFMC Pune in 1995. The Gen offr did Post Doctoral Certificate Course (Cardiac Critical Care) from the Escorts Heart Institute & Research Centre in 2003, Diploma in Critical Care Medicine from Indian Society of Critical Care Medicine in 2004 and Expeditionary Medical Support Course with US AF, from San Antonio, Texas in 2007. He also did Post Graduate Diploma in Healthcare Management from Baba Bhim Rao Ambedkar University in 2010.\n\n3.   In his 37 yrs of distinguished career, the Gen offr served as a Spl (Anaesthesiology) in multiple AFMS establishments first as a Graded Specialist at 181 MH (HQ, 5 Mtn Div), MH Jaipur, MH Ahmedabad and with UN mission at Sierra Leone and then as a Classified Specialist at Base Hospital Delhi Cantt, AFMC Pune and CH(EC). He was also appointed as Senior Advisor (Anaesthesiology) at CH(WC) Chandimandir, Professor & HOD at AFMC Pune and Consultant (Anaesthesiology) at Army Hosp (R&R) Delhi Cantt. Later he was appointed as Dy Comdt & CI at AMC Centre & College, Lucknow.`;

    // Hide details modal so edit box opens directly front-and-center
    const detailsModal = document.getElementById('modal-current-commander-details');
    if (detailsModal) {
        detailsModal.style.display = 'none';
    }

    const editModal = document.getElementById('modal-edit-current-commander-bio');
    if (editModal) {
        editModal.style.display = 'flex';
        editModal.classList.add('visible');
    }
}

function closeEditCurrentCommanderBioModal() {
    const editModal = document.getElementById('modal-edit-current-commander-bio');
    if (editModal) {
        editModal.style.display = 'none';
        editModal.classList.remove('visible');
    }
    // Return to the details modal view
    openCurrentCommanderDetails(activeCurrentCommanderDetailIndex);
}

function handleEditCurrentCommanderBioOverlayClick(e) {
    if (e.target.id === 'modal-edit-current-commander-bio') {
        closeEditCurrentCommanderBioModal();
    }
}

async function submitEditCurrentCommanderBio(e) {
    if (e) e.preventDefault();
    if (!currentUser || currentUser.role !== 'instituteadmin') {
        showToast('Access denied: Only Institute Administrators can edit commander details.', 'error');
        return;
    }

    const saveBtn = document.getElementById('btn-save-curr-cmd-bio');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const payload = {
            id: parseInt(document.getElementById('edit-curr-cmd-id').value) || 0,
            db_id: parseInt(document.getElementById('edit-curr-cmd-db-id').value) || 0,
            type: document.getElementById('edit-curr-cmd-type').value || '',
            title: document.getElementById('edit-curr-cmd-name').value.trim(),
            sub_title: document.getElementById('edit-curr-cmd-role').value.trim(),
            banner_title: document.getElementById('edit-curr-cmd-banner').value.trim(),
            bio_data: document.getElementById('edit-curr-cmd-biodata').value.trim()
        };

        const token = csrfToken || sessionStorage.getItem('ek_csrf_token') || '';
        const res = await fetch('/api/current-commanders/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && data.status === 'success') {
            showToast(data.message || 'Details updated successfully', 'success');
            const editModal = document.getElementById('modal-edit-current-commander-bio');
            if (editModal) {
                editModal.style.display = 'none';
                editModal.classList.remove('visible');
            }
            await fetchCurrentCommandersList();
            renderCurrentCommandersTrack();
            openCurrentCommanderDetails(activeCurrentCommanderDetailIndex);
        } else {
            showToast(data.message || 'Failed to update details', 'error');
        }
    } catch (err) {
        console.error('Error updating commander details:', err);
        showToast('Network error while saving details', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        }
    }
}

async function initCurrentCommandersSlider() {
    if (currCmdSliderInitialized) return;
    const track = document.getElementById('curr-cmd-slider-track');
    if (!track) return;

    currCmdSliderInitialized = true;
    await fetchCurrentCommandersList();
    renderCurrentCommandersTrack();
    initCurrentCommanderUploadDropzone();
}

function stepCurrentCommanderSlider(direction) {
    // Retained for backward compatibility
}

function toggleCurrentCommanderManageMenu(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const menu = document.getElementById('curr-cmd-manage-menu');
    if (!menu) return;
    const isShowing = menu.style.display === 'flex' || menu.style.display === 'block';
    menu.style.display = isShowing ? 'none' : 'flex';
}

function closeCurrentCommanderManageMenu() {
    const menu = document.getElementById('curr-cmd-manage-menu');
    if (menu) menu.style.display = 'none';
}

function openAddCurrentCommanderModal() {
    if (!currentUser || currentUser.role !== 'instituteadmin') {
        showToast('Access restricted: Only Institute Administrators can add commander portraits.', 'error');
        return;
    }
    selectedCurrentCommanderFile = null;
    const fileInput = document.getElementById('curr-cmd-file-input');
    if (fileInput) fileInput.value = '';

    const promptEl = document.getElementById('curr-cmd-dropzone-prompt');
    if (promptEl) promptEl.style.display = 'block';

    const prevContainer = document.getElementById('curr-cmd-preview-container');
    if (prevContainer) prevContainer.style.display = 'none';

    const errEl = document.getElementById('curr-cmd-upload-error');
    if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
    }

    const progContainer = document.getElementById('curr-cmd-upload-progress');
    if (progContainer) progContainer.style.display = 'none';

    const submitBtn = document.getElementById('curr-cmd-modal-submit-btn');
    if (submitBtn) submitBtn.disabled = false;

    const modal = document.getElementById('modal-add-current-commander');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeAddCurrentCommanderModal() {
    const modal = document.getElementById('modal-add-current-commander');
    if (modal) modal.style.display = 'none';
    updateBodyScrollState();
}

function handleCurrentCommanderModalOverlayClick(e) {
    if (e.target.id === 'modal-add-current-commander') {
        closeAddCurrentCommanderModal();
    }
}

function initCurrentCommanderUploadDropzone() {
    const dropzone = document.getElementById('curr-cmd-upload-dropzone');
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('drag-active');
        }, false);
    });

    ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('drag-active');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
            validateAndSelectCurrentCommanderFile(dt.files[0]);
        }
    }, false);
}

function handleCurrentCommanderFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
        validateAndSelectCurrentCommanderFile(e.target.files[0]);
    }
}

function validateAndSelectCurrentCommanderFile(file) {
    const errEl = document.getElementById('curr-cmd-upload-error');
    if (errEl) errEl.style.display = 'none';

    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type.toLowerCase())) {
        if (errEl) {
            errEl.textContent = 'Invalid file type. Please choose a JPG, PNG or WEBP image.';
            errEl.style.display = 'block';
        }
        return;
    }

    if (file.size > 15 * 1024 * 1024) {
        if (errEl) {
            errEl.textContent = 'Selected image is too large. Maximum file size is 15MB.';
            errEl.style.display = 'block';
        }
        return;
    }

    selectedCurrentCommanderFile = file;

    const promptEl = document.getElementById('curr-cmd-dropzone-prompt');
    const prevContainer = document.getElementById('curr-cmd-preview-container');
    const prevImg = document.getElementById('curr-cmd-preview-img');
    const prevName = document.getElementById('curr-cmd-preview-name');
    const prevSize = document.getElementById('curr-cmd-preview-size');

    if (promptEl) promptEl.style.display = 'none';
    if (prevName) prevName.textContent = file.name;
    if (prevSize) prevSize.textContent = formatCmdFileSize(file.size);

    const reader = new FileReader();
    reader.onload = (event) => {
        if (prevImg) prevImg.src = event.target.result;
        if (prevContainer) prevContainer.style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

function submitAddCurrentCommander(event) {
    if (event) event.preventDefault();

    if (!currentUser || currentUser.role !== 'instituteadmin') {
        showToast('Access denied: Only Institute Administrators can upload commander portraits.', 'error');
        closeAddCurrentCommanderModal();
        return;
    }

    const errEl = document.getElementById('curr-cmd-upload-error');
    if (!selectedCurrentCommanderFile) {
        if (errEl) {
            errEl.textContent = 'Please choose a commander portrait image to upload.';
            errEl.style.display = 'block';
        }
        return;
    }

    const submitBtn = document.getElementById('curr-cmd-modal-submit-btn');
    const submitText = document.getElementById('curr-cmd-modal-submit-text');
    const cancelBtn = document.getElementById('curr-cmd-modal-cancel-btn');
    const progContainer = document.getElementById('curr-cmd-upload-progress');
    const progBar = document.getElementById('curr-cmd-upload-bar');
    const progPercent = document.getElementById('curr-cmd-upload-percent');

    if (submitBtn) submitBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (submitText) submitText.textContent = 'Uploading...';
    if (progContainer) progContainer.style.display = 'block';
    if (progBar) progBar.style.width = '0%';
    if (progPercent) progPercent.textContent = '0%';
    if (errEl) errEl.style.display = 'none';

    const formData = new FormData();
    formData.append('image', selectedCurrentCommanderFile);
    formData.append('title', 'Current Commander of Officers Training College');
    formData.append('sub_title', 'Officers Training College, AMC Centre and College, Lucknow');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/current-commanders/upload', true);
    const cmdUploadToken = csrfToken || sessionStorage.getItem('ek_csrf_token') || '';
    if (cmdUploadToken) {
        xhr.setRequestHeader('X-CSRF-Token', cmdUploadToken);
    }

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            if (progBar) progBar.style.width = percent + '%';
            if (progPercent) progPercent.textContent = percent + '%';
        }
    };

    xhr.onload = () => {
        let resp = null;
        try {
            resp = JSON.parse(xhr.responseText);
        } catch (ex) {
            resp = null;
        }

        if (xhr.status >= 200 && xhr.status < 300 && resp && resp.status === 'success') {
            if (progBar) progBar.style.width = '100%';
            if (progPercent) progPercent.textContent = '100%';

            if (resp.commander) {
                allCurrentCommanders.push(resp.commander);
            }

            renderCurrentCommandersTrack();
            showToast(resp.message || 'Current commander portrait added successfully', 'success');
            closeAddCurrentCommanderModal();
        } else {
            const msg = (resp && resp.message) ? resp.message : ('Upload failed (HTTP ' + xhr.status + ')');
            if (errEl) {
                errEl.textContent = msg;
                errEl.style.display = 'block';
            }
            showToast(msg, 'error');
        }

        if (submitBtn) submitBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (submitText) submitText.textContent = 'Add Commander';
    };

    xhr.onerror = () => {
        const msg = 'Network connection error while uploading commander image.';
        if (errEl) {
            errEl.textContent = msg;
            errEl.style.display = 'block';
        }
        showToast(msg, 'error');
        if (submitBtn) submitBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (submitText) submitText.textContent = 'Add Commander';
    };

    xhr.send(formData);
}

// Current Commander Delete functions
function openDeleteCurrentCommanderModal() {
    if (!currentUser || currentUser.role !== 'instituteadmin') {
        showToast('Access restricted: Only Institute Administrators can delete commander portraits.', 'error');
        return;
    }
    const modal = document.getElementById('modal-delete-current-commander');
    if (modal) {
        renderDeleteCurrentCommanderGrid();
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeDeleteCurrentCommanderModal() {
    const modal = document.getElementById('modal-delete-current-commander');
    if (modal) modal.style.display = 'none';
    updateBodyScrollState();
}

function handleCurrentCommanderDeleteModalOverlayClick(e) {
    if (e.target.id === 'modal-delete-current-commander') {
        closeDeleteCurrentCommanderModal();
    }
}

function renderDeleteCurrentCommanderGrid() {
    const grid = document.getElementById('curr-cmd-delete-grid');
    if (!grid) return;
    if (!allCurrentCommanders || allCurrentCommanders.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-muted);">No current commander portraits found.</div>';
        return;
    }
    let html = '';
    allCurrentCommanders.forEach((cmd, idx) => {
        const title = esc(cmd.title || `Commander #${cmd.id}`);
        const isCustom = cmd.type === 'custom';
        const typeBadge = isCustom ? '<span style="font-size:0.65rem; background:rgba(212,175,55,0.2); color:#f3d779; padding:2px 6px; border-radius:4px; font-weight:700;">Uploaded</span>' : '';
        html += `
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color, rgba(255,255,255,0.1)); border-radius: 8px; padding: 0.5rem; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.4rem;">
                <div style="width: 100%; aspect-ratio: 3/4; overflow: hidden; border-radius: 6px; background: #000;">
                    <img src="${esc(cmd.image_url)}" alt="${title}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='previouscomd/sample_commander.jpg'">
                </div>
                ${typeBadge}
                <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-main); line-height: 1.2; max-height: 2.4em; overflow: hidden; text-overflow: ellipsis; width: 100%;">
                    ${title}
                </div>
                <button type="button" class="btn-slider-ctrl btn-slider-delete" style="width: 100%; justify-content: center; padding: 0.3rem 0.4rem; font-size: 0.72rem;" onclick="executeDeleteCurrentCommander(${idx})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    <span>Delete</span>
                </button>
            </div>
        `;
    });
    grid.innerHTML = html;
}

async function executeDeleteCurrentCommander(index) {
    if (!currentUser || currentUser.role !== 'instituteadmin') {
        showToast('Access denied: Only Institute Administrators can delete commander portraits.', 'error');
        return;
    }
    const cmd = allCurrentCommanders[index];
    if (!cmd) return;
    const name = cmd.title || `Commander #${cmd.id}`;
    if (!confirm(`Are you sure you want to delete "${name}" from the Current Commanders?`)) {
        return;
    }
    try {
        const payload = {
            id: cmd.id,
            db_id: cmd.db_id || 0,
            base_id: cmd.base_id || (cmd.type === 'base' ? cmd.id : 0),
            type: cmd.type || 'base'
        };
        const token = csrfToken || sessionStorage.getItem('ek_csrf_token') || '';
        const res = await fetch('/api/current-commanders/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            showToast(data.message || 'Current commander portrait deleted successfully', 'success');
            await fetchCurrentCommandersList();
            renderCurrentCommandersTrack();
            renderDeleteCurrentCommanderGrid();
            const lbModal = document.getElementById('commander-lightbox-modal');
            if (lbModal && lbModal.style.display !== 'none' && activeCommanderLightboxMode === 'current') {
                closeCommanderLightbox();
            }
        } else {
            showToast(data.message || 'Failed to delete portrait', 'error');
        }
    } catch (err) {
        console.error('Error deleting current commander portrait:', err);
        showToast('Network error while deleting commander portrait', 'error');
    }
}

// Global key controls for lightbox & modals
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const cmdDetailsModal = document.getElementById('modal-current-commander-details');
        if (cmdDetailsModal && cmdDetailsModal.style.display === 'flex') {
            closeCurrentCommanderDetails();
            updateBodyScrollState();
            return;
        }
        const editBioModal = document.getElementById('modal-edit-current-commander-bio');
        if (editBioModal && editBioModal.style.display === 'flex') {
            closeEditCurrentCommanderBioModal();
            updateBodyScrollState();
            return;
        }
        const lbModal = document.getElementById('commander-lightbox-modal');
        if (lbModal && (lbModal.style.display === 'flex' || lbModal.classList.contains('visible'))) {
            closeCommanderLightbox();
            updateBodyScrollState();
            return;
        }
        const delModal = document.getElementById('modal-delete-commander');
        if (delModal && delModal.style.display === 'flex') {
            closeDeleteCommanderModal();
            return;
        }
        const currDelModal = document.getElementById('modal-delete-current-commander');
        if (currDelModal && currDelModal.style.display === 'flex') {
            closeDeleteCurrentCommanderModal();
            return;
        }
        const openModals = document.querySelectorAll('.modal-overlay.visible');
        if (openModals.length > 0) {
            const topModal = openModals[openModals.length - 1];
            if (topModal.id === 'modal-add-commander') {
                closeAddCommanderModal();
            } else if (topModal.id === 'modal-delete-commander') {
                closeDeleteCommanderModal();
            } else if (topModal.id === 'modal-add-current-commander') {
                closeAddCurrentCommanderModal();
            } else if (topModal.id === 'modal-delete-current-commander') {
                closeDeleteCurrentCommanderModal();
            } else if (topModal.id === 'modal-wifi-security') {
                closeWifiSecurityModal();
            } else {
                closeModal(topModal.id);
            }
            updateBodyScrollState();
        }
    } else {
        const modal = document.getElementById('commander-lightbox-modal');
        if (modal && modal.style.display === 'flex') {
            if (e.key === 'ArrowLeft') navigateCommanderLightbox(-1);
            else if (e.key === 'ArrowRight') navigateCommanderLightbox(1);
        }
    }
});

// Auto-boot slider on document readiness
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCommandersSlider);
} else {
    initCommandersSlider();
}

// ============================================================
// WI-FI AIR-GAP SECURITY GUARD MODAL & ADMIN CONTROLS
// ============================================================
async function openWifiSecurityModal() {
    const modal = document.getElementById('modal-wifi-security');
    if (!modal) return;
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
    await refreshWifiSecurityModal();
}

function closeWifiSecurityModal() {
    const modal = document.getElementById('modal-wifi-security');
    if (!modal) return;
    modal.classList.remove('visible');
    updateBodyScrollState();
}

async function refreshWifiSecurityModal() {
    const badgeEl = document.getElementById('wifi-modal-status-badge');
    const authSsidEl = document.getElementById('wifi-modal-auth-ssid');
    const currSsidEl = document.getElementById('wifi-modal-curr-ssid');
    const subnetEl = document.getElementById('wifi-modal-auth-subnet');
    const gwEl = document.getElementById('wifi-modal-gateway');

    try {
        const res = await fetch('/api/wifi-status');
        const json = await res.json();
        if (json.status === 'success' && json.data) {
            const d = json.data;
            if (badgeEl) {
                if (!d.is_enabled) {
                    badgeEl.className = 'wifi-guard-status-badge unlocked';
                    badgeEl.textContent = 'BYPASS / INACTIVE';
                } else if (!d.is_locked) {
                    badgeEl.className = 'wifi-guard-status-badge unlocked';
                    badgeEl.textContent = 'DISCOVERY MODE';
                } else if (!d.allowed) {
                    badgeEl.className = 'wifi-guard-status-badge violation';
                    badgeEl.textContent = 'VIOLATION / LOCKED';
                } else {
                    badgeEl.className = 'wifi-guard-status-badge active';
                    badgeEl.textContent = 'ACTIVE & LOCKED';
                }
            }

            if (authSsidEl) authSsidEl.textContent = d.authorized_ssid || '(Auto-Discovery)';
            if (currSsidEl) currSsidEl.textContent = d.current_ssid || '(Host not reported)';
            if (subnetEl) subnetEl.textContent = d.authorized_subnet || '(Any Subnet)';
            if (gwEl) gwEl.textContent = d.current_gateway || d.authorized_gateway || '--';

            const inSsid = document.getElementById('wifi-input-ssid');
            const inSub = document.getElementById('wifi-input-subnet');
            const inGw = document.getElementById('wifi-input-gateway');
            if (inSsid && d.authorized_ssid) inSsid.value = d.authorized_ssid;
            if (inSub && d.authorized_subnet) inSub.value = d.authorized_subnet;
            if (inGw && d.authorized_gateway) inGw.value = d.authorized_gateway;
        }
    } catch (e) {
        console.error('Failed to load Wi-Fi config:', e);
    }
}

async function triggerAutoLockWifi() {
    const csrfToken = sessionStorage.getItem('ek_csrf_token') || '';
    try {
        const res = await fetch('/api/wifi-lock-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                sub_action: 'auto_lock',
                csrf_token: csrfToken
            })
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(data.message || 'Application locked to current Wi-Fi network.', 'success');
            await refreshWifiSecurityModal();
        } else {
            showToast(data.message || 'Auto-lock failed', 'error');
        }
    } catch (e) {
        showToast('Communication error during Wi-Fi auto-lock', 'error');
    }
}

async function triggerUnlockWifi() {
    const csrfToken = sessionStorage.getItem('ek_csrf_token') || '';
    try {
        const res = await fetch('/api/wifi-lock-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                sub_action: 'unlock',
                csrf_token: csrfToken
            })
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('Wi-Fi lock released. Application in discovery mode.', 'success');
            await refreshWifiSecurityModal();
        } else {
            showToast(data.message || 'Unlock failed', 'error');
        }
    } catch (e) {
        showToast('Communication error during Wi-Fi unlock', 'error');
    }
}

async function submitManualWifiConfig(e) {
    if (e) e.preventDefault();
    const csrfToken = sessionStorage.getItem('ek_csrf_token') || '';
    const ssid = document.getElementById('wifi-input-ssid')?.value.trim() || '';
    const subnet = document.getElementById('wifi-input-subnet')?.value.trim() || '';
    const gateway = document.getElementById('wifi-input-gateway')?.value.trim() || '';

    try {
        const res = await fetch('/api/wifi-lock-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                sub_action: 'update_manual',
                authorized_ssid: ssid,
                authorized_subnet: subnet,
                authorized_gateway: gateway,
                csrf_token: csrfToken
            })
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('Wi-Fi security policy updated successfully.', 'success');
            await refreshWifiSecurityModal();
        } else {
            showToast(data.message || 'Failed to update policy', 'error');
        }
    } catch (e) {
        showToast('Communication error while updating policy', 'error');
    }
}


