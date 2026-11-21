const ALERT_HISTORY_KEY = 'isaAlertHistory';
const NO_TAB = 'No Intercom tab is open.';
const OPEN_FAILED = 'Could not open the workspace. Try again.';

function twoDigits(value) {
  return String(value).padStart(2, '0');
}

function alertTimeLabel(at, now) {
  const when = new Date(at);
  const time = `${twoDigits(when.getHours())}:${twoDigits(when.getMinutes())}`;
  const sameDay = when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth()
    && when.getDate() === now.getDate();
  return sameDay ? time : `${twoDigits(when.getDate())}.${twoDigits(when.getMonth() + 1)} ${time}`;
}

function alertRow(entry, now, status) {
  const item = document.createElement('li');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'rang-row';
  row.dataset.unseen = entry.seen ? 'false' : 'true';
  const time = document.createElement('span');
  time.className = 'rang-time';
  time.textContent = alertTimeLabel(entry.at, now);
  const label = document.createElement('span');
  label.className = 'rang-label';
  label.textContent = entry.label || 'Intercom';
  row.append(time, label);
  row.addEventListener('click', () => {
    status.textContent = '';
    try {
      chrome.runtime.sendMessage({ type: 'alert-history-open' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          status.textContent = NO_TAB;
        }
      });
    } catch (error) {
      status.textContent = NO_TAB;
    }
  });
  item.appendChild(row);
  return item;
}

function renderAlertHistory(history, status) {
  const list = document.getElementById('rangList');
  const empty = document.getElementById('rangEmpty');
  const count = document.getElementById('rangCount');
  const now = new Date();
  const entries = history.filter(entry => entry && Number.isFinite(entry.at)).slice().reverse();
  const unseen = entries.filter(entry => !entry.seen);
  const seen = entries.filter(entry => entry.seen);

  list.textContent = '';
  unseen.forEach(entry => list.appendChild(alertRow(entry, now, status)));
  if (seen.length) {
    const heading = document.createElement('li');
    heading.className = 'rang-earlier';
    heading.textContent = 'Earlier';
    list.appendChild(heading);
    seen.forEach(entry => list.appendChild(alertRow(entry, now, status)));
  }
  count.textContent = unseen.length ? String(unseen.length) : '';
  empty.hidden = unseen.length > 0;
}

function loadAlertHistory(status) {
  const storage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  if (!storage) {
    renderAlertHistory([], status);
    return;
  }
  try {
    storage.get([ALERT_HISTORY_KEY], (stored) => {
      const history = !chrome.runtime.lastError && stored && Array.isArray(stored[ALERT_HISTORY_KEY])
        ? stored[ALERT_HISTORY_KEY] : [];
      renderAlertHistory(history, status);
      if (history.some(entry => entry && !entry.seen)) {
        chrome.runtime.sendMessage({ type: 'alert-history-seen' }, () => void chrome.runtime.lastError);
      }
    });
  } catch (error) {
    renderAlertHistory([], status);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const status = document.getElementById('popupStatus');
  document.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', function () {
      status.textContent = '';
      try {
        chrome.runtime.sendMessage({ type: 'open-preview', section: button.dataset.section }, () => {
          if (chrome.runtime.lastError) {
            status.textContent = OPEN_FAILED;
          }
        });
      } catch (_) {
        status.textContent = OPEN_FAILED;
      }
    });
  });
  loadAlertHistory(status);
});
