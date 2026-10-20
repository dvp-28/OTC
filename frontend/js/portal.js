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

// Immediately initialize theme on script load
initTheme();

// ============================================================
// INIT PORTAL
// ============================================================
function initPortal() {
    initTheme();
    renderUserHeader();
    applyRoleUI();
    updateOfficerWatermark();
    setupTabs();
    setupFilters();
    setupVideoPlayerEvents();
    loadDashboardData();
    loadCourses();
    initCommandersSlider();
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

    // Add Image option for Previous Commanders is visible EXCLUSIVELY to Institute Admin
    const cmdAddBtn = document.getElementById('cmd-slider-add-btn');
    if (cmdAddBtn) {
        cmdAddBtn.style.display = isInstAdmin ? 'inline-flex' : 'none';
    }

    // Show add section button in classroom for editors
    if (canEdit) {
        const addSecBtn = document.getElementById('classroom-add-section-btn');
        if (addSecBtn) addSecBtn.style.display = 'block';
    }

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

    const countEl = document.getElementById('dashboard-batches-count');
    if (countEl) {
        countEl.textContent = `${courses.length} TOTAL BATCHES REGISTERED`;
    }

    const instructors = [
        { name: 'Col Rajesh Mehta', role: 'Lead Instructor' },
        { name: 'Lt Col A Sharma', role: 'Chief Educator' },
        { name: 'Maj V K Patel', role: 'Senior Instructor' },
        { name: 'Col S K Singh', role: 'Course Administrator' }
    ];

    courses.forEach((c, index) => {
        const enrolledCount = (parseInt(c.id) * 7 + 3) % 35 + 2;
        const progress = ((parseInt(c.id) * 19 + 25) % 65) + 25;
        const educator = instructors[index % instructors.length];
        const deptName = c.category_name || 'Officers Training College';
        const sessionYear = `SESSION 2026-27`;

        const card = document.createElement('div');
        card.className = 'mockup-course-card';
        card.innerHTML = `
            <div class="mockup-card-top">
                <div class="mockup-card-title">${esc(c.fullname)}</div>
            </div>
            <div class="mockup-sub-info">
                <div class="mockup-sub-row">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                    <span>${esc(deptName)}</span>
                </div>
                <div class="mockup-sub-row session">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    <span>${esc(sessionYear)}</span>
                </div>
            </div>

            <!-- Institute Overview Option under every course -->
            <div class="mockup-inst-overview">
                <div class="inst-overview-header">
                    <span class="inst-tag">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                        INSTITUTE OVERVIEW
                    </span>
                    <span class="inst-progress-percent">${progress}% COMPLETED</span>
                </div>
                <div class="inst-progress-bar">
                    <div class="inst-progress-fill" style="width: ${progress}%;"></div>
                </div>
            </div>

            <div class="mockup-stat-boxes">
                <div class="mockup-stat-col">
                    <div class="mockup-stat-lbl">ENROLLED</div>
                    <div>
                        <span class="mockup-stat-val-num">${enrolledCount}</span>
                        <span class="mockup-stat-val-text">STUDENTS</span>
                    </div>
                </div>
                <div class="mockup-stat-col">
                    <div class="mockup-stat-lbl">EDUCATOR</div>
                    <div class="mockup-educator-name">${esc(educator.name)}</div>
                    <div class="mockup-educator-role">${esc(educator.role)}</div>
                </div>
            </div>
            <button class="btn-mockup-console" onclick="openClassroom(${c.id})">
                <span>Class Console</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
        `;
        grid.appendChild(card);
    });
}

function renderCourses(filter) {
    const grid = document.getElementById('courses-grid');
    grid.innerHTML = '';

    const filtered = courses.filter(c => {
        if (filter === 'all') return true;
        if (filter === 'med') return (c.category_code || '').includes('MED');
        if (filter === 'nur') return (c.category_code || '').includes('NUR');
        if (filter === 'nt') return (c.category_code || '').includes('NT');
        return true;
    });

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

    // Load sections from DB
    try {
        const res = await fetch('/api/sections?course_id=' + activeCourseId);
        const data = await res.json();
        if (data.status === 'success') {
            renderSections(data.data);
        }
    } catch (e) {
        console.warn('Failed to load sections:', e);
    }

    // Load presentations for this specific course
    loadCoursePpts(activeCourseId);
}

function renderSections(sections) {
    const list = document.getElementById('classroom-section-list');
    if (!list) return;
    list.innerHTML = '';

    if (sections.length === 0) {
        list.innerHTML = '<li style="padding: 1rem; color: var(--text-muted); font-size: 0.85rem;">No sections yet. ' +
            (currentUser.can_edit ? 'Use "Add Section" to create content.' : 'Content is being prepared.') + '</li>';
        return;
    }

    sections.forEach((sec, idx) => {
        if (idx === 0 && !sec.name) return; // skip empty general section
        const item = document.createElement('li');
        item.className = 'module-item' + (idx === 1 ? ' active' : '');
        item.onclick = () => {
            document.querySelectorAll('.module-item').forEach(m => m.classList.remove('active'));
            item.classList.add('active');
            const secTitle = sec.name || 'Section ' + sec.section;
            document.getElementById('classroom-section-title').textContent = secTitle;
            const playStatus = document.getElementById('video-play-status');
            if (playStatus && !isVideoPlaying) {
                playStatus.textContent = 'Ready: ' + secTitle;
            }
        };
        item.innerHTML = `
            <div class="module-check">${idx < 2 ? '✓' : ''}</div>
            <div class="module-info">
                <span class="module-name">${sec.section}. ${esc(sec.name || 'General')}</span>
                <span class="module-duration">${esc(sec.summary || 'Lecture content')}</span>
            </div>
        `;
        list.appendChild(item);
    });
}

// ============================================================
// VIDEO THEATER & PLAYER CONTROLLER
// ============================================================
function playPptVideo(pptId, pptTitle) {
    activePlayingPptId = parseInt(pptId);
    activePlayingPptTitle = pptTitle || 'Course Presentation';
    updateOfficerWatermark();

    // Find the PPT object from loaded cache
    const ppt = currentLoadedPpts.find(p => parseInt(p.id) === activePlayingPptId);

    // Reveal the video player theater section
    const theaterWrapper = document.getElementById('classroom-video-theater-wrapper');
    if (theaterWrapper) {
        theaterWrapper.style.display = 'block';
        theaterWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

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

function startVideoPlayback() {
    isVideoPlaying = true;
    const playBtn = document.getElementById('btn-play-pause');
    const playStatus = document.getElementById('video-play-status');
    const bigRing = document.getElementById('play-ring-trigger');

    if (playBtn) {
        playBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
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

    if (playBtn) {
        playBtn.innerHTML = '▶';
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

// Tactical video canvas drawing & simulated military lecture feed
function drawTacticalCanvasFeed(isPlaying) {
    const canvas = document.getElementById('tactical-video-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    // Dark sleek tactical backdrop
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#04070e');
    bgGrad.addColorStop(1, '#020306');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle tactical grid
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 36;
    for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    // Top Header readout
    ctx.fillStyle = 'rgba(212, 175, 55, 0.75)';
    ctx.font = '11px "Courier New", monospace';
    const displayTitle = activePlayingPptTitle ? activePlayingPptTitle.toUpperCase() : 'TACTICAL BRIEFING';
    ctx.fillText('OTC EKALAVYA SECURE FEED // ' + displayTitle.substring(0, 45), 20, 26);

    ctx.fillStyle = isPlaying ? '#10b981' : '#f59e0b';
    ctx.beginPath();
    ctx.arc(w - 180, 22, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(isPlaying ? 'STREAM: LIVE [720p60]' : 'STREAM: PAUSED', w - 168, 26);

    // Center display: Academy Crest Watermark
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('AMC CENTRE & COLLEGE', w / 2, h / 2 - 25);

    // Dynamic Officer Identification Watermark (SEC-F03)
    if (currentUser) {
        ctx.fillStyle = 'rgba(212, 175, 55, 0.15)';
        ctx.font = 'bold 12px monospace';
        const officerWm = `RESTRICTED DEFENCE // OFFICER: ${(currentUser.username || '').toUpperCase()} // ID:${currentUser.id} // SECURE OTC LAN`;
        ctx.fillText(officerWm, w / 2, h / 2 + 15);
    }
    ctx.restore();

    // Audio spectrum equalizer bars at bottom
    const barCount = Math.min(48, Math.floor((w - 80) / 10));
    const barWidth = Math.max(3, (w - 80) / barCount - 3);
    const startX = 40;
    const baseY = h - 35;

    for (let i = 0; i < barCount; i++) {
        let barHeight = 4;
        if (isPlaying) {
            const freq = Math.sin((canvasAnimTime * 3.5) + i * 0.45) * Math.cos(i * 0.25 + canvasAnimTime * 2);
            barHeight = Math.max(5, Math.abs(freq) * 42 + Math.random() * 8);
        } else {
            barHeight = 4 + Math.sin(i * 0.3) * 2;
        }

        const barGrad = ctx.createLinearGradient(0, baseY - barHeight, 0, baseY);
        barGrad.addColorStop(0, '#d4af37');
        barGrad.addColorStop(1, 'rgba(139, 30, 47, 0.6)');
        ctx.fillStyle = barGrad;
        ctx.fillRect(startX + i * (barWidth + 3), baseY - barHeight, barWidth, barHeight);
    }
}

function startTacticalCanvasAnimation() {
    stopTacticalCanvasAnimation();
    function loop() {
        canvasAnimTime += 0.035;
        drawTacticalCanvasFeed(true);
        videoCanvasAnimId = requestAnimationFrame(loop);
    }
    loop();
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

    const playBig = document.getElementById('play-ring-trigger');
    if (playBig) {
        playBig.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayVideo();
        });
    }

    // Bind real HTML5 Video element events
    const videoEl = document.getElementById('classroom-html5-video');
    if (videoEl) {
        videoEl.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayVideo();
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
            }
        });
    }

    const videoScreen = document.getElementById('classroom-video-screen');
    if (videoScreen) {
        videoScreen.addEventListener('click', (e) => {
            if (e.target.closest('#play-ring-trigger') || e.target.closest('#classroom-html5-video')) return;
            togglePlayVideo();
        });
        videoScreen.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlayVideo();
            } else if (e.code === 'KeyF') {
                e.preventDefault();
                toggleFullscreen();
            }
        });
    }

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
        } else {
            currentLoadedPpts = [];
            if (countBadge) countBadge.textContent = '0 Presentations';
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
                    <th style="min-width: 260px;">PPT Name</th>
                    <th style="width: 140px;">Slides</th>
                    <th style="min-width: 180px;">Upload Date & Time</th>
                    <th style="min-width: ${canUpload ? '200px' : '110px'}; text-align: right;">Action</th>
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
                <td>
                    <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
                        <div class="ppt-title-link" onclick="playPptVideo(${p.id}, '${safeTitle}')" title="Click to watch lecture video">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color: var(--amc-crimson); flex-shrink: 0;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <span style="font-weight: 600; color: var(--text-main); font-size: 0.92rem;">${esc(p.title)}</span>
                        </div>
                        ${mediaBadge}
                        ${isPlayingThis ? '<span class="playing-pulse-indicator"><span class="playing-dot"></span>PLAYING</span>' : ''}
                    </div>
                </td>
                <td>
                    <span class="slide-count-badge">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                        <span>${slideCnt} ${slideCnt === 1 ? 'Slide' : 'Slides'}</span>
                    </span>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.45rem; color: var(--text-muted); font-size: 0.84rem;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-dim); flex-shrink: 0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        <span>${esc(p.timecreated_formatted || '-')}</span>
                    </div>
                </td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="btn-card" onclick="downloadCoursePpt(${p.id})" style="padding: 0.38rem 0.75rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem;" title="Download presentation file">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        <span>Download</span>
                    </button>
                    ${canUpload ? `
                    <button class="btn-card danger" onclick="openDeletePptModal(${p.id}, '${safeTitle}')" style="padding: 0.38rem 0.7rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem; margin-left: 0.4rem; color: #f87171; border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.1);" title="Delete presentation">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        <span>Delete</span>
                    </button>
                    ` : ''}
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

function renderUsers(users) {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">No users found.</td></tr>';
        return;
    }

    users.forEach(u => {
        const roleLabels = (u.roles || []).map(r => {
            let cls = 'stud';
            let label = r.shortname;
            if (r.shortname === 'instituteadmin') { cls = 'inst'; label = 'Institute Admin'; }
            else if (r.shortname === 'courseadmin') { cls = 'course'; label = 'Course Admin'; }
            else { label = 'Student Officer'; }
            return `<span class="role-tag ${cls}">${esc(label)}</span>`;
        }).join(' ') || '<span class="role-tag stud">Student Officer</span>';

        const statusTag = u.suspended == 1
            ? `<span style="color: #ef4444; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.2rem 0.55rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Inactive</span>`
            : `<span style="color: #22c55e; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3); padding: 0.2rem 0.55rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Active</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${esc(u.username)}</code></td>
            <td style="font-weight: 600;">${esc(u.firstname)} ${esc(u.lastname)}</td>
            <td>${esc(u.email || '-')}</td>
            <td style="font-family: var(--font-mono); font-size: 0.85rem;">${esc(u.mobile || u.phone1 || u.phone2 || '-')}</td>
            <td>${roleLabels}</td>
            <td>${statusTag}</td>
            <td>
                <button type="button" class="btn-card btn-edit-user" data-id="${u.id}" style="padding: 0.3rem 0.65rem; font-size: 0.78rem;" onclick="openEditUserModal(${u.id})">
                    ✏ Edit User
                </button>
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

function openCreateUserModal() {
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

    renderCoursesChecklist([]);
    document.getElementById('modal-user-form').classList.add('visible');
}

function openEditUserModal(userId) {
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
    document.getElementById('user-form-phone').value = user.mobile || user.phone1 || user.phone2 || '';
    document.getElementById('user-form-suspended').value = user.suspended || '0';

    // Primary role
    let primaryRole = 'student';
    if (user.roles && user.roles.length > 0) {
        const r = user.roles[0].shortname;
        if (['instituteadmin', 'courseadmin', 'student'].includes(r)) {
            primaryRole = r;
        }
    }
    document.getElementById('user-form-role').value = primaryRole;

    renderCoursesChecklist(user.assigned_courses || []);
    document.getElementById('modal-user-form').classList.add('visible');
}

async function submitUserForm() {
    const userId = document.getElementById('user-form-id').value;
    const isCreate = !userId;

    const username = document.getElementById('user-form-username').value.trim();
    const password = document.getElementById('user-form-password').value;
    const firstname = document.getElementById('user-form-firstname').value.trim();
    const lastname = document.getElementById('user-form-lastname').value.trim();
    const email = document.getElementById('user-form-email').value.trim();
    const phone = document.getElementById('user-form-phone').value.trim();
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
// MODAL HELPERS
// ============================================================
function closeModal(id) {
    document.getElementById(id).classList.remove('visible');
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('visible');
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
let cmdSliderPlaying = true;
let cmdSliderUserPaused = false;
let cmdSliderRafId = null;
const cmdSliderSpeed = 0.75; // px per frame (~45px/sec)
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

async function fetchCommandersList() {
    try {
        const res = await fetch('/api/commanders');
        if (res.ok) {
            const data = await res.json();
            if (data && data.status === 'success' && Array.isArray(data.commanders) && data.commanders.length > 0) {
                allCommanders = data.commanders;
                return;
            }
        }
    } catch (e) {
        console.warn('Could not fetch commanders list from API, using baseline:', e);
    }
    allCommanders = getBaselineCommanders();
}

function renderCommandersTrack() {
    const track = document.getElementById('cmd-slider-track');
    if (!track) return;

    if (!allCommanders || allCommanders.length === 0) {
        allCommanders = getBaselineCommanders();
    }

    // Render two full sets for seamless infinite loop
    let cardsHtml = '';
    for (let set = 0; set < 2; set++) {
        allCommanders.forEach((cmd, idx) => {
            const safeTitle = esc(cmd.title || 'Previous Commander of Officers Training College');
            cardsHtml += `
                <div class="commander-card" onclick="openCommanderLightbox(${idx})" title="View Portrait">
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

    await fetchCommandersList();
    renderCommandersTrack();

    // Hover pauses auto-scroll
    viewport.addEventListener('mouseenter', () => {
        cmdSliderPlaying = false;
    });
    viewport.addEventListener('mouseleave', () => {
        if (!cmdSliderUserPaused) {
            cmdSliderPlaying = true;
        }
    });

    // Mouse drag support
    let isMouseDown = false;
    let startX = 0;
    let scrollLeftStart = 0;

    viewport.addEventListener('mousedown', (e) => {
        isMouseDown = true;
        cmdSliderPlaying = false;
        startX = e.pageX - viewport.offsetLeft;
        scrollLeftStart = viewport.scrollLeft;
    });

    window.addEventListener('mouseup', () => {
        if (isMouseDown) {
            isMouseDown = false;
            if (!cmdSliderUserPaused) {
                cmdSliderPlaying = true;
            }
        }
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
        cmdSliderPlaying = false;
        touchStartX = e.touches[0].pageX;
        touchScrollStart = viewport.scrollLeft;
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
        const x = e.touches[0].pageX;
        const walk = (x - touchStartX) * 1.4;
        viewport.scrollLeft = touchScrollStart - walk;
    }, { passive: true });

    viewport.addEventListener('touchend', () => {
        if (!cmdSliderUserPaused) {
            cmdSliderPlaying = true;
        }
    });

    initCommanderUploadDropzone();
    startCommanderSliderLoop();
}

function startCommanderSliderLoop() {
    if (cmdSliderRafId) cancelAnimationFrame(cmdSliderRafId);

    function step() {
        const viewport = document.getElementById('cmd-slider-viewport');
        const track = document.getElementById('cmd-slider-track');
        if (viewport && track) {
            const halfWidth = track.scrollWidth / 2;
            if (cmdSliderPlaying && halfWidth > 0) {
                viewport.scrollLeft += cmdSliderSpeed;
                if (viewport.scrollLeft >= halfWidth) {
                    viewport.scrollLeft -= halfWidth;
                }
            }
        }
        cmdSliderRafId = requestAnimationFrame(step);
    }
    cmdSliderRafId = requestAnimationFrame(step);
}

function toggleCommanderSliderPlay() {
    cmdSliderUserPaused = !cmdSliderUserPaused;
    cmdSliderPlaying = !cmdSliderUserPaused;

    const iconPause = document.getElementById('cmd-slider-icon-pause');
    const iconPlay = document.getElementById('cmd-slider-icon-play');
    const statusText = document.getElementById('cmd-slider-status-text');

    if (cmdSliderPlaying) {
        if (iconPause) iconPause.style.display = 'inline';
        if (iconPlay) iconPlay.style.display = 'none';
        if (statusText) statusText.textContent = 'Pause';
    } else {
        if (iconPause) iconPause.style.display = 'none';
        if (iconPlay) iconPlay.style.display = 'inline';
        if (statusText) statusText.textContent = 'Play';
    }
}

function stepCommanderSlider(direction) {
    const viewport = document.getElementById('cmd-slider-viewport');
    const track = document.getElementById('cmd-slider-track');
    if (!viewport || !track) return;

    const stepSize = 380; // step by approx 2 cards
    const halfWidth = track.scrollWidth / 2;

    viewport.scrollBy({ left: direction * stepSize, behavior: 'smooth' });

    setTimeout(() => {
        if (viewport.scrollLeft >= halfWidth) {
            viewport.scrollLeft -= halfWidth;
        } else if (viewport.scrollLeft <= 0) {
            viewport.scrollLeft += halfWidth;
        }
    }, 450);
}

// Lightbox modal methods
function openCommanderLightbox(index) {
    if (!allCommanders || allCommanders.length === 0) {
        allCommanders = getBaselineCommanders();
    }
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

function closeCommanderLightbox() {
    const modal = document.getElementById('commander-lightbox-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

function handleCommanderLightboxOverlayClick(e) {
    if (e.target.id === 'commander-lightbox-modal') {
        closeCommanderLightbox();
    }
}

function navigateCommanderLightbox(dir) {
    if (!allCommanders || allCommanders.length === 0) return;
    cmdLightboxIndex += dir;
    if (cmdLightboxIndex >= allCommanders.length) cmdLightboxIndex = 0;
    if (cmdLightboxIndex < 0) cmdLightboxIndex = allCommanders.length - 1;
    updateCommanderLightboxView();
}

function updateCommanderLightboxView() {
    const img = document.getElementById('commander-modal-img');
    const caption = document.getElementById('commander-modal-caption');
    const cmd = allCommanders[cmdLightboxIndex];
    if (!cmd) return;

    if (img) {
        img.src = cmd.image_url;
        img.alt = cmd.title || 'Previous Commander of Officers Training College';
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

    const titleInput = document.getElementById('cmd-input-title');
    if (titleInput) titleInput.value = '';

    const subInput = document.getElementById('cmd-input-subtitle');
    if (subInput) subInput.value = '';

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
        document.body.style.overflow = '';
    }
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

    const titleInput = document.getElementById('cmd-input-title');
    const subInput = document.getElementById('cmd-input-subtitle');
    const titleVal = titleInput ? titleInput.value.trim() : '';
    const subVal = subInput ? subInput.value.trim() : '';

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

// Global key controls for lightbox & modals
window.addEventListener('keydown', (e) => {
    const modal = document.getElementById('commander-lightbox-modal');
    if (modal && modal.style.display === 'flex') {
        if (e.key === 'Escape') closeCommanderLightbox();
        else if (e.key === 'ArrowLeft') navigateCommanderLightbox(-1);
        else if (e.key === 'ArrowRight') navigateCommanderLightbox(1);
    }
    const addModal = document.getElementById('modal-add-commander');
    if (addModal && addModal.classList.contains('visible')) {
        if (e.key === 'Escape') closeAddCommanderModal();
    }
});

// Auto-boot slider on document readiness
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCommandersSlider);
} else {
    initCommandersSlider();
}

