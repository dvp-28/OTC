/**
 * EKALAVYA LMS - OTC, AMC CENTRE AND COLLEGE, LUCKNOW
 * Front-end Logic - Pure Vanilla ES6 JavaScript
 * Zero External Dependencies (Air-gapped compliant)
 */

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// App State
const state = {
    activeTab: 'dashboard',
    courseFilter: 'all',
    activeCourse: 'MOBC',
    activeModuleIndex: 1, // Battlefield Trauma Management
    currentRole: 'student', // student | courseadmin | instituteadmin
    courses: [],
    systemStatus: null,
    isPlaying: false,
    videoCurrentTime: 420, // 07:00
    videoDuration: 1800,   // 30:00
    playbackInterval: null
};

// Fallback Data in case API is cold-starting
const fallbackData = {
    courses: [
        {
            id: 2,
            shortname: 'MOBC',
            fullname: 'Medical Officers Basic Course',
            category_code: 'OTC-MED',
            category_name: 'Medical Officers',
            cadre: 'Medical Officers (Captains/Lieutenants)',
            duration: '10 Weeks',
            completed_modules: 2,
            total_modules: 7,
            progress_pct: 29,
            modules: [
                { title: 'Tactical Combat Casualty Care (TCCC)', duration: '45 mins', completed: true },
                { title: 'Battlefield Trauma Management & Haemorrhage Control', duration: '60 mins', completed: true },
                { title: 'Field Hygiene, Sanitation & Vector Control', duration: '40 mins', completed: false },
                { title: 'Medical Logistics & Casualty Evacuation (CASEVAC)', duration: '50 mins', completed: false },
                { title: 'Regimental Medical Officer (RMO) Duties in Field Formations', duration: '55 mins', completed: false },
                { title: 'Chemical, Biological, Radiological, and Nuclear (CBRN) Care', duration: '70 mins', completed: false },
                { title: 'High Altitude Medicine & Cold Climate Injuries', duration: '65 mins', completed: false }
            ]
        },
        {
            id: 3,
            shortname: 'MOJCC',
            fullname: 'Medical Officers Junior Command Course',
            category_code: 'OTC-MED',
            category_name: 'Medical Officers',
            cadre: 'Junior Command (Majors)',
            duration: '6 Weeks',
            completed_modules: 1,
            total_modules: 4,
            progress_pct: 25,
            modules: [
                { title: 'Staff Duties & Operation Planning in Corps Zones', duration: '50 mins', completed: true },
                { title: 'Advanced Trauma Life Support & Triage Systems', duration: '60 mins', completed: false },
                { title: 'Medical Battalion Deployment in Mountainous Terrain', duration: '55 mins', completed: false },
                { title: 'Health Information Systems & Telemedicine in Combat', duration: '45 mins', completed: false }
            ]
        },
        {
            id: 4,
            shortname: 'MOSCC',
            fullname: 'Medical Officers Senior Command Course',
            category_code: 'OTC-MED',
            category_name: 'Medical Officers',
            cadre: 'Senior Command (Lt. Colonels)',
            duration: '4 Weeks',
            completed_modules: 1,
            total_modules: 3,
            progress_pct: 33,
            modules: [
                { title: 'Strategic Health Logistics at Command & Army HQ Level', duration: '60 mins', completed: true },
                { title: 'Disaster Management & Joint Humanitarian Assistance Operations', duration: '55 mins', completed: false },
                { title: 'Hospital Administration & High-Readiness Military Healthcare', duration: '50 mins', completed: false }
            ]
        },
        {
            id: 5,
            shortname: 'BNOC',
            fullname: 'Basic Nursing Officers Course',
            category_code: 'OTC-NUR',
            category_name: 'Nursing Officers',
            cadre: 'Military Nursing Service (Lieutenants)',
            duration: '8 Weeks',
            completed_modules: 1,
            total_modules: 3,
            progress_pct: 33,
            modules: [
                { title: 'Military Nursing Administration & Triage Protocols', duration: '50 mins', completed: true },
                { title: 'Field Ambulance & Resuscitation Center Nursing', duration: '60 mins', completed: false },
                { title: 'Combat Surgical Nursing & Post-Operative ICU Support', duration: '55 mins', completed: false }
            ]
        },
        {
            id: 6,
            shortname: 'SNOC',
            fullname: 'Senior Nursing Officers Course',
            category_code: 'OTC-NUR',
            category_name: 'Nursing Officers',
            cadre: 'Senior Nursing Officers (Captains/Majors)',
            duration: '4 Weeks',
            completed_modules: 0,
            total_modules: 2,
            progress_pct: 0,
            modules: [
                { title: 'Nursing Directorate Management & Staff Leadership', duration: '50 mins', completed: false },
                { title: 'Infection Prevention & Quality Control in Field Hospitals', duration: '45 mins', completed: false }
            ]
        },
        {
            id: 7,
            shortname: 'NTPCC',
            fullname: 'Non-Tech Post Commissioning Course',
            category_code: 'OTC-NT',
            category_name: 'Non-Technical',
            cadre: 'Non-Technical Officers Post-Commissioning',
            duration: '6 Weeks',
            completed_modules: 0,
            total_modules: 2,
            progress_pct: 0,
            modules: [
                { title: 'Military Law, Quartermaster Duties & Medical Stores', duration: '50 mins', completed: false },
                { title: 'Regimental Accounts, Ordnance & Transport Planning', duration: '60 mins', completed: false }
            ]
        },
        {
            id: 8,
            shortname: 'NTADM',
            fullname: 'Non-Tech Administration',
            category_code: 'OTC-NT',
            category_name: 'Non-Technical',
            cadre: 'Non-Tech Administrative Cadre',
            duration: '4 Weeks',
            completed_modules: 0,
            total_modules: 2,
            progress_pct: 0,
            modules: [
                { title: 'Military Hospital Office Procedures & Record Security', duration: '45 mins', completed: false },
                { title: 'Pension, Claims & Personnel Administration', duration: '50 mins', completed: false }
            ]
        }
    ]
};

async function initApp() {
    setupTabNavigation();
    setupFilters();
    setupVideoControls();
    setupQuiz();
    setupRoleSwitcher();

    // Fetch live data from backend API
    await loadApiData();

    renderCourses();
    renderClassroom();
}

async function loadApiData() {
    try {
        const [statusRes, coursesRes] = await Promise.all([
            fetch('/api/status').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('/api/courses').then(r => r.ok ? r.json() : null).catch(() => null)
        ]);

        if (statusRes && statusRes.status === 'success') {
            state.systemStatus = statusRes.data;
            updateMetrics(statusRes.data);
        }

        if (coursesRes && coursesRes.status === 'success' && coursesRes.data.length > 0) {
            state.courses = coursesRes.data;
        } else {
            state.courses = fallbackData.courses;
        }
    } catch (e) {
        console.warn('Using local store fallback for LMS courses:', e);
        state.courses = fallbackData.courses;
    }
}

function updateMetrics(data) {
    if (!data || !data.stats) return;
    const elCourses = document.getElementById('metric-courses');
    const elUsers = document.getElementById('metric-users');
    const elCohorts = document.getElementById('metric-cohorts');
    
    if (elCourses) elCourses.textContent = data.stats.courses;
    if (elUsers) elUsers.textContent = data.stats.users;
    if (elCohorts) elCohorts.textContent = data.stats.cohorts;
}

function setupTabNavigation() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            switchTab(target);
        });
    });

    const resumeBtn = document.getElementById('btn-resume-action');
    if (resumeBtn) {
        resumeBtn.addEventListener('click', () => {
            switchTab('classroom');
        });
    }
}

function switchTab(tabId) {
    state.activeTab = tabId;

    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === `tab-${tabId}`);
    });

    if (tabId === 'classroom') {
        renderClassroom();
    }
}

function setupFilters() {
    const pills = document.querySelectorAll('.pill-btn');
    pills.forEach(pill => {
        pill.addEventListener('click', () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            state.courseFilter = pill.dataset.filter;
            renderCourses();
        });
    });
}

function renderCourses() {
    const grid = document.getElementById('courses-grid');
    if (!grid) return;

    grid.innerHTML = '';

    const filtered = state.courses.filter(c => {
        if (state.courseFilter === 'all') return true;
        if (state.courseFilter === 'med') return c.category_code === 'OTC-MED' || c.shortname.startsWith('MO');
        if (state.courseFilter === 'nur') return c.category_code === 'OTC-NUR' || c.shortname.includes('NOC');
        if (state.courseFilter === 'nt') return c.category_code === 'OTC-NT' || c.shortname.startsWith('NT');
        return true;
    });

    filtered.forEach(c => {
        let typeClass = 'med';
        if (c.category_code === 'OTC-NUR' || c.shortname.includes('NOC')) typeClass = 'nur';
        if (c.category_code === 'OTC-NT' || c.shortname.startsWith('NT')) typeClass = 'nt';

        const card = document.createElement('div');
        card.className = `course-card ${typeClass}`;
        card.innerHTML = `
            <div class="course-header">
                <span class="course-badge ${typeClass}">${escapeHtml(c.shortname)}</span>
                <span class="course-category-tag">${escapeHtml(c.category_name || 'Officers Course')}</span>
            </div>
            <h3 class="course-title">${escapeHtml(c.fullname)}</h3>
            <div class="course-meta">
                <span>⏱ ${escapeHtml(c.duration || '6 Weeks')}</span>
                <span>🎖 ${escapeHtml(c.cadre ? c.cadre.split('(')[0].trim() : 'Officers')}</span>
            </div>
            <div class="course-progress-section">
                <div class="progress-header">
                    <span>Course Progress</span>
                    <span style="font-weight: 700; color: #fff;">${c.progress_pct || 0}%</span>
                </div>
                <div class="progress-bar-small">
                    <div class="progress-bar-fill" style="width: ${c.progress_pct || 0}%;"></div>
                </div>
                <div class="card-actions">
                    <button class="btn-card primary" onclick="enterCourse('${c.shortname}')">Enter Classroom</button>
                    <button class="btn-card" onclick="viewSyllabus('${c.shortname}')">Syllabus (${c.modules ? c.modules.length : 0})</button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

window.enterCourse = function(courseCode) {
    state.activeCourse = courseCode;
    state.activeModuleIndex = 0;
    switchTab('classroom');
};

window.viewSyllabus = function(courseCode) {
    state.activeCourse = courseCode;
    switchTab('classroom');
};

function renderClassroom() {
    const course = state.courses.find(c => c.shortname === state.activeCourse) || state.courses[0];
    if (!course) return;

    // Update titles
    const titleEl = document.getElementById('classroom-course-title');
    const badgeEl = document.getElementById('classroom-course-badge');
    const moduleTitleEl = document.getElementById('active-module-title');
    const sidebarTitleEl = document.getElementById('sidebar-course-name');
    
    if (titleEl) titleEl.textContent = `${course.shortname} - ${course.fullname}`;
    if (badgeEl) badgeEl.textContent = course.shortname;
    if (sidebarTitleEl) sidebarTitleEl.textContent = `${course.fullname} (${course.duration})`;

    const modules = course.modules || [];
    const activeMod = modules[state.activeModuleIndex] || modules[0] || { title: 'Introductory Lecture', duration: '30 mins' };
    
    if (moduleTitleEl) moduleTitleEl.textContent = activeMod.title;

    // Render modules in sidebar
    const list = document.getElementById('classroom-module-list');
    if (!list) return;

    list.innerHTML = '';
    modules.forEach((mod, idx) => {
        const item = document.createElement('li');
        item.className = `module-item ${idx === state.activeModuleIndex ? 'active' : ''} ${mod.completed ? 'completed' : ''}`;
        item.innerHTML = `
            <div class="module-check" onclick="toggleModuleComplete(${idx}, event)">
                ${mod.completed ? '✓' : ''}
            </div>
            <div class="module-info" onclick="selectModule(${idx})">
                <span class="module-name">${idx + 1}. ${escapeHtml(mod.title)}</span>
                <span class="module-duration">⏱ ${escapeHtml(mod.duration)} • Video & Slides</span>
            </div>
        `;
        list.appendChild(item);
    });
}

window.selectModule = function(idx) {
    state.activeModuleIndex = idx;
    state.videoCurrentTime = 0;
    updateVideoTimeDisplay();
    renderClassroom();
};

window.toggleModuleComplete = function(idx, event) {
    event.stopPropagation();
    const course = state.courses.find(c => c.shortname === state.activeCourse);
    if (!course || !course.modules || !course.modules[idx]) return;

    course.modules[idx].completed = !course.modules[idx].completed;
    
    // Recalculate progress
    const completed = course.modules.filter(m => m.completed).length;
    course.completed_modules = completed;
    course.progress_pct = Math.round((completed / course.modules.length) * 100);

    renderClassroom();
    renderCourses();
};

function setupVideoControls() {
    const playBtn = document.getElementById('btn-play-pause');
    const playBig = document.getElementById('play-ring-trigger');
    const scrubber = document.getElementById('timeline-scrubber');

    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (playBig) playBig.addEventListener('click', togglePlay);

    if (scrubber) {
        scrubber.addEventListener('click', (e) => {
            const rect = scrubber.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            state.videoCurrentTime = Math.floor(pos * state.videoDuration);
            updateVideoTimeDisplay();
        });
    }

    const skipBack = document.getElementById('btn-skip-back');
    const skipFwd = document.getElementById('btn-skip-fwd');
    if (skipBack) skipBack.addEventListener('click', () => {
        state.videoCurrentTime = Math.max(0, state.videoCurrentTime - 10);
        updateVideoTimeDisplay();
    });
    if (skipFwd) skipFwd.addEventListener('click', () => {
        state.videoCurrentTime = Math.min(state.videoDuration, state.videoCurrentTime + 10);
        updateVideoTimeDisplay();
    });
}

function togglePlay() {
    state.isPlaying = !state.isPlaying;
    const playBtn = document.getElementById('btn-play-pause');
    const playStatus = document.getElementById('video-play-status');
    const bigRing = document.getElementById('play-ring-trigger');

    if (state.isPlaying) {
        if (playBtn) playBtn.innerHTML = '⏸';
        if (playStatus) playStatus.textContent = 'STREAMING: 720p HLS Tactical Feed';
        if (bigRing) bigRing.style.opacity = '0.3';
        state.playbackInterval = setInterval(() => {
            if (state.videoCurrentTime < state.videoDuration) {
                state.videoCurrentTime += 1;
                updateVideoTimeDisplay();
            } else {
                togglePlay();
            }
        }, 1000);
    } else {
        if (playBtn) playBtn.innerHTML = '▶';
        if (playStatus) playStatus.textContent = 'PAUSED - Click to resume lecture';
        if (bigRing) bigRing.style.opacity = '1';
        clearInterval(state.playbackInterval);
    }
}

function updateVideoTimeDisplay() {
    const timeEl = document.getElementById('video-time-display');
    const progressEl = document.getElementById('timeline-progress');

    const curM = Math.floor(state.videoCurrentTime / 60);
    const curS = state.videoCurrentTime % 60;
    const durM = Math.floor(state.videoDuration / 60);
    const durS = state.videoDuration % 60;

    const pad = (n) => String(n).padStart(2, '0');
    if (timeEl) timeEl.textContent = `${pad(curM)}:${pad(curS)} / ${pad(durM)}:${pad(durS)}`;

    if (progressEl) {
        const pct = (state.videoCurrentTime / state.videoDuration) * 100;
        progressEl.style.width = `${pct}%`;
    }
}

function setupQuiz() {
    const submitBtn = document.getElementById('btn-submit-quiz');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', () => {
        const answers = {
            q1: document.querySelector('input[name="q1"]:checked')?.value,
            q2: document.querySelector('input[name="q2"]:checked')?.value,
            q3: document.querySelector('input[name="q3"]:checked')?.value
        };

        const correct = { q1: 'b', q2: 'a', q3: 'c' };
        let score = 0;

        for (let q in correct) {
            const card = document.getElementById(`card-${q}`);
            const feedback = document.getElementById(`feedback-${q}`);
            if (answers[q] === correct[q]) {
                score++;
                if (feedback) {
                    feedback.textContent = '✓ Correct (Adheres to TCCC Field Medical Directive).';
                    feedback.style.color = '#10b981';
                }
            } else {
                if (feedback) {
                    feedback.textContent = '✗ Incorrect. Review Battlefield Protocol Module 2.';
                    feedback.style.color = '#ef4444';
                }
            }
        }

        const scoreBanner = document.getElementById('quiz-score-banner');
        if (scoreBanner) {
            scoreBanner.style.display = 'block';
            scoreBanner.textContent = `Knowledge Check Score: ${score}/3 (${Math.round((score/3)*100)}%) - Recorded in Offline Assessment Log`;
        }
    });
}

function setupRoleSwitcher() {
    const switcher = document.getElementById('role-switcher-btn');
    if (!switcher) return;

    const roles = ['student', 'courseadmin', 'instituteadmin'];
    const roleLabels = {
        student: 'Student Officer',
        courseadmin: 'Course Admin',
        instituteadmin: 'Institute Admin'
    };

    switcher.addEventListener('click', () => {
        const curIdx = roles.indexOf(state.currentRole);
        const nextIdx = (curIdx + 1) % roles.length;
        state.currentRole = roles[nextIdx];

        const roleText = document.getElementById('user-role-text');
        if (roleText) roleText.textContent = roleLabels[state.currentRole];

        const banner = document.getElementById('role-indicator-banner');
        if (banner) {
            banner.textContent = `Active Role View: ${roleLabels[state.currentRole]} (Context: ${state.currentRole === 'instituteadmin' ? 'OTC Category Level' : (state.currentRole === 'courseadmin' ? 'Assigned Course Level' : 'Batch Cohort')})`;
            banner.style.display = 'block';
        }
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
