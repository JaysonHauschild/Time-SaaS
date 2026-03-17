const API = 'http://localhost:3000';

// Show/hide login UI based on session
async function checkAuth() {
    const res = await fetch(`${API}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        return;
    }

    const user = await res.json();

    if (user) {
        document.getElementById('logged-out').style.display = 'none';
        document.getElementById('logged-in').style.display = 'flex';
        document.getElementById('user-name').textContent = user.name;
        document.getElementById('user-photo').src = user.photo;
    }
}

async function logout() {
    await fetch(`${API}/auth/logout`, { credentials: 'include' });
    document.getElementById('logged-in').style.display = 'none';
    document.getElementById('logged-out').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuth().catch(error => {
        console.error('Error checking auth:', error);
    });

    const form = document.querySelector('form');
    const timeInput = document.getElementById('time-input');
    const timeDisplay = document.getElementById('time-display');

    form.addEventListener('submit', event => {
        event.preventDefault();

        const hours = Number.parseFloat(timeInput.value);
        if (Number.isNaN(hours) || hours < 0) {
            return;
        }

        timeDisplay.textContent = `${hours.toFixed(1)} hours logged`;
        timeInput.value = '';
    });
});