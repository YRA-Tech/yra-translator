async function isUserLoggedIn() {
  try {
    const result = await chrome.storage.local.get('yraAuthToken');
    return !!result.yraAuthToken;
  } catch (error) {
    console.error('Auth check failed:', error);
    return false;
  }
}

async function login() {
  await chrome.storage.local.set({ yraAuthToken: 'yra-session-placeholder' });
}

async function logout() {
  await chrome.storage.local.remove('yraAuthToken');
}

function onAuthStateChanged(callback) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.yraAuthToken) {
      const isLoggedIn = !!changes.yraAuthToken.newValue;
      callback(isLoggedIn);
    }
  });
}