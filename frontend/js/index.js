// Dronacharya LMS - Index redirect logic
document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/session').then(r => r.json()).then(data => {
        if (data.status === 'success' && data.data) {
            if (data.csrf_token) {
                sessionStorage.setItem('ek_csrf_token', data.csrf_token);
            }
            window.location.href = '/portal.html';
        } else {
            window.location.href = '/login.html';
        }
    }).catch(() => {
        window.location.href = '/login.html';
    });
});
