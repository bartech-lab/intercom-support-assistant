document.addEventListener('DOMContentLoaded', function () {
  const status = document.getElementById('popupStatus');
  document.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', function () {
      status.textContent = '';
      try {
        chrome.runtime.sendMessage({ type: 'open-preview', section: button.dataset.section }, () => {
          if (chrome.runtime.lastError) {
            status.textContent = 'Could not open the workspace. Try again.';
          }
        });
      } catch (_) {
        status.textContent = 'Could not open the workspace. Try again.';
      }
    });
  });
});
