'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TEAM,
  inboxUrl,
  TAMSIN,
  build,
  row,
  rowFor,
  isMarked,
  chipText,
} = require('../support/duplicate-conversations-harness');

const TIMING_LIST_STATE_GRACE_MS = 2000;

const settleListState = (win) => {
  const past = Date.now() + TIMING_LIST_STATE_GRACE_MS + 1000;
  win.listStateClock = () => past;
};

const learnListState = (win, state, teamId = TEAM) =>
  win.rememberListState('team', teamId, state);

test('a list filtered to Open is marked as before', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], { state: 'Open', count: '133' });
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), true);
  assert.equal(chipText(win, '1'), '\u29c92');
});

test('a list filtered to Closed is not marked', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], { state: 'Closed', count: '34,459' });
  settleListState(win);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false);
  assert.equal(chipText(win, '1'), null);
  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);
});

test('switching from Open to Closed clears the marks already drawn', () => {
  const win = build([row('900', TAMSIN), row('2', TAMSIN)], { state: 'Open' });
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '900'), true);
  assert.ok(win.document.querySelector('.isa-duplicate-customer-strip'), 'strip drawn while Open');

  const control = win.document.querySelector('[data-intercom-target="filter-button"] span');
  control.textContent = '\n      34,459\n      Closed\n    ';
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '900'), false);
  assert.equal(chipText(win, '900'), null);
  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null,
    'the strip claims open conversations, so it must go too');
  assert.equal(rowFor(win, '900').hasAttribute('data-isa-duplicate-group'), false);
});

test('an extra filter alongside Open still marks', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], { state: 'Open Unassigned' });
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), true);
});

test('an unresolvable state holds off marking, then marks once it has settled', () => {
  for (const state of [null, '']) {
    const win = build([row('1', TAMSIN), row('2', TAMSIN)], { state, count: '133' });
    win.refreshDuplicateCustomerHighlights();
    assert.equal(isMarked(win, '1'), false, `held off while unresolved: ${state}`);

    settleListState(win);
    win.refreshDuplicateCustomerHighlights();
    assert.equal(isMarked(win, '1'), true, `marks once settled: ${state}`);
  }
});

test('a network state of closed suppresses marking', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  learnListState(win, 'closed');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false);
});

test('a network state of open marks', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  learnListState(win, 'open');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), true);
  assert.equal(chipText(win, '1'), '\u29c92');
});

test('a network state of snoozed suppresses marking', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  learnListState(win, 'snoozed');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false);
});

test('a state word in another language reads as unknown and never suppresses', () => {
  for (const state of ['Offen', 'Geschlossen', 'Ouvert', 'Otwarte']) {
    const win = build([row('1', TAMSIN), row('2', TAMSIN)], { state });
    settleListState(win);
    win.refreshDuplicateCustomerHighlights();
    assert.equal(isMarked(win, '1'), true, state);
  }
});

test('the network state resolves a label the display text cannot', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], { state: 'Geschlossen' });
  learnListState(win, 'closed');
  const later = Date.now() + 10 * TIMING_LIST_STATE_GRACE_MS;
  win.listStateClock = () => later;
  win.refreshDuplicateCustomerHighlights();
  win.listStateClock = () => later + 10 * TIMING_LIST_STATE_GRACE_MS;
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false, 'the network state suppresses where the label could not');
});

test('an English All or Snoozed label suppresses without a network state', () => {
  for (const state of ['All', 'Snoozed', 'Closed']) {
    const win = build([row('1', TAMSIN), row('2', TAMSIN)], { state });
    settleListState(win);
    win.refreshDuplicateCustomerHighlights();
    assert.equal(isMarked(win, '1'), false, state);
  }
});

test('the network state beats a stale display text saying Closed', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], { state: 'Closed' });
  learnListState(win, 'open');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), true);
});

test('a network state for another inbox is ignored', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  learnListState(win, 'closed', '9009870');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), true, 'another team\u2019s filter says nothing about this one');
});

test('learning a state redecorates without waiting for a mutation', () => {
  const win = build([row('900', TAMSIN), row('2', TAMSIN)], { state: 'Closed' });
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '900'), false);

  learnListState(win, 'open');

  assert.equal(isMarked(win, '900'), true, 'no explicit refresh call in between');
  assert.ok(win.document.querySelector('.isa-duplicate-customer-strip'));
});

test('switching the network state from open to closed clears the marks', () => {
  const win = build([row('900', TAMSIN), row('2', TAMSIN)]);
  learnListState(win, 'open');
  assert.equal(isMarked(win, '900'), true);

  learnListState(win, 'closed');

  assert.equal(isMarked(win, '900'), false);
  assert.equal(chipText(win, '900'), null);
  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);
});

test('the list state cache is bounded', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  for (let i = 0; i < 55; i += 1) learnListState(win, 'closed', `${8000 + i}`);
  learnListState(win, 'closed', TEAM);
  assert.equal(isMarked(win, '1'), false, 'the current inbox survives eviction');

  const stateOfTeam = (teamId) => {
    win.history.pushState({}, '', inboxUrl.replace(`/team/${TEAM}`, `/team/${teamId}`));
    return win.networkListStateForCurrentInbox();
  };
  assert.equal(stateOfTeam('8054'), 'closed', 'a recent inbox is still remembered');
  assert.equal(stateOfTeam('8000'), null, 'the oldest inbox was evicted');
});

test('a state change does not mark until the list has re-rendered', () => {
  const win = build([row('900', TAMSIN), row('2', TAMSIN)], { state: 'Closed' });
  learnListState(win, 'closed');
  assert.equal(isMarked(win, '900'), false);

  learnListState(win, 'open');
  assert.equal(isMarked(win, '900'), false,
    'the rows on screen still belong to the previous filter');

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = `${row('900', TAMSIN)}\n${row('7', TAMSIN)}`;
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '900'), true, 'the new rows are marked');
});

test('a same-state refetch never clears what is already marked', () => {
  const win = build([row('900', TAMSIN), row('2', TAMSIN)], { state: 'Open' });
  learnListState(win, 'open');
  assert.equal(isMarked(win, '900'), true);

  learnListState(win, 'open');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '900'), true, 'no flicker on a routine refetch');
  assert.equal(chipText(win, '900'), '⧉2');
});

test('opening an inbox whose state is not yet known does not blink the marks off', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  learnListState(win, 'open');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), true);

  const otherTeam = '9009870';
  win.history.pushState({}, '', `/a/inbox/demo1234/inbox/team/${otherTeam}/conversation/900?view=List`);
  const filter = win.document.querySelector('[data-intercom-target="filter-button"]');
  filter.remove();

  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), true, 'no clear while the new inbox state is unknown');

  learnListState(win, 'open', otherTeam);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), true, 'still marked once the state arrives');
});

test('a definite closed state still clears immediately, so unknown is not a blanket keep', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  learnListState(win, 'open');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), true);

  learnListState(win, 'closed');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), false);
});

test('an unresolvable state still marks nothing on a cold load, then marks once settled', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], { state: null });
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), false, 'nothing was drawn, so nothing appears');

  settleListState(win);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), true);
});

test('an unknown state leaves a support marker on screen alone', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  learnListState(win, 'open');
  win.rememberInboundAddresses('1', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  assert.equal(rowFor(win, '1').classList.contains('isa-support-origin-row'), true);

  win.history.pushState({}, '', '/a/inbox/demo1234/inbox/team/9009869/conversation/900?view=List');
  win.document.querySelector('[data-intercom-target="filter-button"]').remove();

  win.refreshSupportOriginHighlights();
  assert.equal(rowFor(win, '1').classList.contains('isa-support-origin-row'), true,
    'the envelope must not blink off either');
});

const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

function buildWithTimers(rows, { url = inboxUrl, state = null } = {}) {
  const timers = [];
  const win = loadExtension(
    fx.inboxHtml({
      list: fx.conversationList(rows, { state, count: '27' }),
      composer: fx.composer({ mode: 'email' })
    }),
    {
      url,
      beforeScripts(w) {
        w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
        w.clearTimeout = () => {};
      }
    }
  );
  let now = Date.now();
  win.listStateClock = () => now;
  win.eval('listStateUnknownSince.clear()');
  const graceTimers = () => timers.filter(timer => timer.ms === TIMING_LIST_STATE_GRACE_MS);
  return { win, graceTimers, advance: ms => { now += ms; } };
}

test('an unknown state redraws by itself once the grace period ends, with one timer per wait', () => {
  const { win, graceTimers, advance } = buildWithTimers([row('1', TAMSIN), row('2', TAMSIN)]);
  assert.equal(graceTimers().length, 1, 'loading an unknown list schedules one wait');
  win.refreshDuplicateCustomerHighlights();
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), false);
  assert.equal(graceTimers().length, 1, 'a wait already scheduled is not scheduled again');

  advance(TIMING_LIST_STATE_GRACE_MS);
  graceTimers().at(-1).fn();
  assert.equal(isMarked(win, '1'), true, 'marked without any further mutation');

  win.history.pushState({}, '', inboxUrl.replace(TEAM, '9001983'));
  win.refreshDuplicateCustomerHighlights();
  assert.equal(graceTimers().length, 2, 'a new wait after the last one fired gets its own timer');
});

test('the grace period counts per inbox and ends exactly at its length', () => {
  const { win, advance } = buildWithTimers([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  advance(TIMING_LIST_STATE_GRACE_MS);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), true, 'settled at exactly the grace length');

  win.history.pushState({}, '', inboxUrl.replace(TEAM, '9001983'));
  assert.equal(win.computeConversationListVerdict(), 'unknown', 'another inbox starts its own wait');
});
