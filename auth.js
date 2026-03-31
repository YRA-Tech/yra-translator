const AUTH_BASE_URL = 'https://stage.yratech.com';

async function login(email, password) {
  // Step 1: Get CSRF token
  let csrfToken;
  try {
    const csrfRes = await fetch(AUTH_BASE_URL + '/api/auth/csrf', {
      credentials: 'include'
    });
    const csrfData = await csrfRes.json();
    csrfToken = csrfData.csrfToken;
  } catch (error) {
    throw new Error('Could not connect to authentication server');
  }

  // Step 2: POST credentials
  const callbackRes = await fetch(AUTH_BASE_URL + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email,
      password,
      csrfToken,
      callbackUrl: AUTH_BASE_URL + '/auth/signin'
    }),
    credentials: 'include',
    redirect: 'manual'
  });

  // A 302 redirect (opaqueredirect with status 0) means success.
  // A 200 means NextAuth rendered the sign-in page again (bad credentials).
  if (callbackRes.type !== 'opaqueredirect') {
    throw new Error('Invalid email or password');
  }

  // Step 3: Fetch session to verify and get user data
  const user = await getSession();
  if (!user) {
    throw new Error('Authentication failed');
  }

  await chrome.storage.local.set({ yraAuthToken: true, yraUser: user });
  return user;
}

async function logout() {
  try {
    const csrfRes = await fetch(AUTH_BASE_URL + '/api/auth/csrf', {
      credentials: 'include'
    });
    const csrfData = await csrfRes.json();

    await fetch(AUTH_BASE_URL + '/api/auth/signout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken: csrfData.csrfToken }),
      credentials: 'include',
      redirect: 'manual'
    });
  } catch (error) {
    console.warn('Server signout failed, clearing local state anyway:', error);
  }

  await chrome.storage.local.remove(['yraAuthToken', 'yraUser']);
}

async function getSession() {
  try {
    const res = await fetch(AUTH_BASE_URL + '/api/auth/session', {
      credentials: 'include'
    });
    const data = await res.json();
    return data?.user || null;
  } catch (error) {
    console.error('Session check failed:', error);
    return null;
  }
}

async function getStoredUser() {
  try {
    const result = await chrome.storage.local.get('yraUser');
    return result.yraUser || null;
  } catch (error) {
    return null;
  }
}

async function isUserLoggedIn() {
  try {
    const result = await chrome.storage.local.get('yraAuthToken');
    return !!result.yraAuthToken;
  } catch (error) {
    console.error('Auth check failed:', error);
    return false;
  }
}

function onAuthStateChanged(callback) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.yraAuthToken) {
      const isLoggedIn = !!changes.yraAuthToken.newValue;
      callback(isLoggedIn);
    }
  });
}