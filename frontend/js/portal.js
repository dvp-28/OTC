/**
 * EKALAVYA LMS - Authenticated Portal Logic
 * Role-based UI: Institute Admin | Course Admin | Student Officer
 * Connected to Moodle MySQL via /api/ endpoints
 */

let currentUser = null;
let courses = [];
let activeCourseId = null;
let allUsers = [];

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

// Theme Engine (Dark / Normal Light Mode)
function initTheme() {
    const savedTheme = localStorage.getItem('ekalavya_theme') || 'dark';
    applyTheme(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ekalavya_theme', newTheme);
    applyTheme(newTheme);
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

    const label = document.getElementById('theme-label-text');
    if (label) label.textContent = theme === 'dark' ? 'Dark Mode' : 'Normal Mode';

    const menuText = document.getElementById('menu-theme-text');
    if (menuText) menuText.textContent = theme === 'dark' ? 'Dark Mode' : 'Normal (White)';

    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) {
        if (theme === 'dark') {
            toggleBtn.classList.add('active');
        } else {
            toggleBtn.classList.remove('active');
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
    setupTabs();
    setupFilters();
    loadDashboardData();
    loadCourses();
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

    // Show user management options for institute admin
    if (isInstAdmin) {
        document.querySelectorAll('.tab-admin-only, .menu-admin-only').forEach(el => el.style.display = '');
        const quickUsersBtn = document.getElementById('popup-quick-manage-users');
        if (quickUsersBtn) quickUsersBtn.style.display = 'flex';
        const addCourseBtnWrapper = document.getElementById('inst-add-course-btn-wrapper');
        if (addCourseBtnWrapper) addCourseBtnWrapper.style.display = 'block';
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
let tabOrder = ['dashboard', 'courses', 'classroom', 'users', 'governance'];
let navHistory = ['dashboard'];
let currentHistoryIndex = 0;

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    updateNavButtonsState();
    updateBreadcrumb('dashboard');
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
        const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'dashboard';
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
        const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'dashboard';
        let idx = tabOrder.indexOf(activeTab);
        if (idx < tabOrder.length - 1) {
            let nextTab = tabOrder[idx + 1];
            if (nextTab === 'users' && currentUser.role === 'student') {
                nextTab = 'governance';
            }
            switchTab(nextTab, false);
        }
    }
}

function updateNavButtonsState() {
    const backBtn = document.getElementById('btn-global-back');
    const nextBtn = document.getElementById('btn-global-next');
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'dashboard';
    
    const canGoBack = currentHistoryIndex > 0 || tabOrder.indexOf(activeTab) > 0;
    const canGoNext = currentHistoryIndex < navHistory.length - 1 || tabOrder.indexOf(activeTab) < tabOrder.length - 1;

    if (backBtn) backBtn.disabled = !canGoBack;
    if (nextBtn) nextBtn.disabled = !canGoNext;
}

function updateBreadcrumb(tabId) {
    const el = document.getElementById('page-breadcrumb-text');
    if (!el) return;
    const names = {
        'dashboard': 'Dashboard Overview',
        'courses': 'My Assigned Courses',
        'classroom': 'Classroom Player & Content',
        'users': 'User Management & Batches',
        'governance': 'Security Governance & Roles'
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
                <span class="mockup-status-badge">ACTIVE</span>
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
                    ${isInstAdmin ? `<button class="btn-card danger" style="color:#ef4444; border-color:rgba(239,68,68,0.4);" onclick="openDeleteCourseModal(${c.id}, '${esc(c.fullname).replace(/'/g, "\\'")}')">🗑 Delete</button>` : ''}
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
    activeCourseId = courseId;
    switchTab('classroom');

    const course = courses.find(c => parseInt(c.id) === courseId);
    if (course) {
        document.getElementById('classroom-course-title').textContent =
            course.shortname + ' - ' + course.fullname;
        document.getElementById('sidebar-course-name').textContent = course.fullname;
    }

    // Load sections from DB
    try {
        const res = await fetch('/api/sections?course_id=' + courseId);
        const data = await res.json();
        if (data.status === 'success') {
            renderSections(data.data);
        }
    } catch (e) {
        console.warn('Failed to load sections:', e);
    }
}

function renderSections(sections) {
    const list = document.getElementById('classroom-section-list');
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
            document.getElementById('classroom-section-title').textContent = sec.name || 'Section ' + sec.section;
            document.getElementById('video-play-status').textContent = 'Ready: ' + (sec.name || 'Section ' + sec.section);
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
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">No users found.</td></tr>';
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

        const assignedCourseCount = (u.assigned_courses || []).length;
        const assignedCourseBadge = assignedCourseCount > 0
            ? `<span style="background: var(--bg-hover); color: var(--gold-light); border: 1px solid var(--border-subtle); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.78rem; font-weight: 600;">${assignedCourseCount} Course${assignedCourseCount > 1 ? 's' : ''}</span>`
            : `<span style="color: var(--text-muted); font-size: 0.8rem;">None</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${esc(u.username)}</code></td>
            <td style="font-weight: 600;">${esc(u.firstname)} ${esc(u.lastname)}</td>
            <td>${esc(u.email || '-')}</td>
            <td>${esc(u.phone1 || u.phone2 || '-')}</td>
            <td>${roleLabels}</td>
            <td>${statusTag}</td>
            <td>${assignedCourseBadge}</td>
            <td>
                <button class="btn-card" style="padding: 0.3rem 0.65rem; font-size: 0.78rem;" onclick="openEditUserModal(${u.id})">
                    ✏ Edit & Assign
                </button>
            </td>
        `;
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
    document.getElementById('user-form-phone').value = user.phone1 || user.phone2 || '';
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
                body: JSON.stringify({ username, password, firstname, lastname, email, phone, role, suspended })
            });
            const data = await res.json();
            if (data.status !== 'success') {
                showToast(data.message || 'Failed to create user', 'error');
                return;
            }
            currentUserId = data.data.id;
        } else {
            const updatePayload = { user_id: currentUserId, firstname, lastname, email, phone, suspended };
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
