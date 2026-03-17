const API = '';

// Show/hide login UI based on session
async function checkAuth() {
    const res = await fetch(`${API}/api/me`, { credentials: 'include' });
    if (!res.ok) return;

    const user = await res.json();
    if (user) showLoggedIn(user);
}

function showLoggedIn(user) {
    document.getElementById('logged-out').style.display = 'none';
    document.getElementById('logged-in').style.display = 'flex';
    document.getElementById('user-name').textContent = user.displayName;

    const photoEl = document.getElementById('user-photo');
    if (user.photo) {
        photoEl.src = user.photo;
        photoEl.style.display = '';
    } else {
        photoEl.style.display = 'none';
    }
}

async function logout() {
    await fetch(`${API}/auth/logout`, { credentials: 'include' });
    document.getElementById('logged-in').style.display = 'none';
    document.getElementById('logged-out').style.display = 'block';
}

// --- Auth modal ---

function showAuthModal() {
    const overlay = document.getElementById('auth-overlay');
    overlay.style.display = 'flex';
    clearAuthError();
}

function closeAuthModal() {
    document.getElementById('auth-overlay').style.display = 'none';
    clearAuthError();
}

function handleOverlayClick(e) {
    if (e.target === document.getElementById('auth-overlay')) closeAuthModal();
}

function showTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('login-form').style.display = isLogin ? '' : 'none';
    document.getElementById('register-form').style.display = isLogin ? 'none' : '';
    document.getElementById('tab-login').classList.toggle('active', isLogin);
    document.getElementById('tab-register').classList.toggle('active', !isLogin);
    clearAuthError();
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.style.display = 'block';
}

function clearAuthError() {
    const el = document.getElementById('auth-error');
    el.textContent = '';
    el.style.display = 'none';
}

async function localLogin(event) {
    event.preventDefault();
    clearAuthError();

    const form = event.target;
    const username = form.username.value.trim();
    const password = form.password.value;

    const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok) {
        showAuthError(data.error || 'Login failed');
        return;
    }

    closeAuthModal();
    showLoggedIn(data.user);
}

async function localRegister(event) {
    event.preventDefault();
    clearAuthError();

    const form = event.target;
    const displayName = form.displayName.value.trim();
    const username = form.username.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;

    const res = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName, username, email: email || undefined, password }),
    });

    const data = await res.json();
    if (!res.ok) {
        showAuthError(data.error || 'Registration failed');
        return;
    }

    closeAuthModal();
    showLoggedIn(data.user);
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuth().catch(error => {
        console.error('Error checking auth:', error);
    });

    const form = document.querySelector('#time-table form');
    const timeInput = document.getElementById('time-input');
    const timeDisplay = document.getElementById('time-display');

    form.addEventListener('submit', event => {
        event.preventDefault();

        const hours = Number.parseFloat(timeInput.value);
        if (Number.isNaN(hours) || hours < 0) return;

        timeDisplay.textContent = `${hours.toFixed(1)} hours logged`;
        timeInput.value = '';
    });
});
