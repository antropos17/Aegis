/** @file activity-feed.js @module activity-feed @description Feed entries, event processing, permissions enforcement, show-more, clear. @since v0.1.0 */

// ═══ ACTIVITY FEED ═══

/** Create a DOM element for a single feed entry. @param {Object} ev @returns {HTMLDivElement} */
function createFeedEntry(ev) {
  const entry = document.createElement('div');
  const isDenied = ev._denied;
  const isConfigAccess = !isDenied && ev.sensitive && ev.reason && ev.reason.startsWith('AI agent config');
  entry.className = isDenied ? 'feed-entry denied' : isConfigAccess ? 'feed-entry config-access' : ev.sensitive ? 'feed-entry sensitive' : 'feed-entry';
  if (selectedAgent && ev.agent !== selectedAgent) entry.classList.add('filter-hidden');
  const timeStr = formatTime(new Date(ev.timestamp));
  const sevClass = isDenied ? 'sev-sensitive' : getSeverityClass(ev);
  const action = isDenied ? 'DENIED' : (ev.action || 'accessed');
  let html = `<span class="feed-severity-dot ${sevClass}"></span>`;
  html += `<span class="feed-type-icon">${getFileTypeIcon(ev.file)}</span>`;
  html += `<span class="feed-time">[${timeStr}]</span>`;
  html += `<span class="feed-agent">${escapeHtml(ev.agent)}</span>`;
  html += `<span class="feed-action action-${isDenied ? 'deleted' : action}">${action}:</span>`;
  html += `<span class="feed-file" title="${escapeHtml(ev.file)}">${escapeHtml(shortenPath(ev.file))}</span>`;
  if (isDenied) html += `<span class="denied-tag">BLOCKED</span>`;
  else if (isConfigAccess) html += `<span class="config-access-tag">&#128272; CONFIG ACCESS</span>`;
  else if (ev.sensitive) html += `<span class="sensitive-tag">&#9888; ${escapeHtml(ev.reason)}</span>`;
  entry.innerHTML = html;
  return entry;
}

/** Create a DOM element for an anomaly alert feed entry. @param {Object} w - Warning object @returns {HTMLDivElement} */
function createAnomalyFeedEntry(w) {
  const entry = document.createElement('div');
  entry.className = 'feed-entry anomaly';
  const timeStr = formatTime(new Date());
  let html = `<span class="feed-severity-dot sev-config"></span>`;
  html += `<span class="feed-type-icon">\u26A0\uFE0F</span>`;
  html += `<span class="feed-time">[${timeStr}]</span>`;
  html += `<span class="feed-agent">${escapeHtml(w.agent)}</span>`;
  html += `<span class="feed-action action-modified">anomaly:</span>`;
  html += `<span class="feed-file">${escapeHtml(w.message)}</span>`;
  html += `<span class="anomaly-tag">${escapeHtml(formatAnomalyReason(w))}</span>`;
  entry.innerHTML = html;
  return entry;
}

/** Process file-access events into AI/other feeds, enforce permissions, trigger radar. @param {Object[]} events */
function addFeedEntries(events) {
  if (events.length === 0) return;
  for (const ev of events) {
    allActivityEvents.push(ev);
    if (!agentActivityBins[ev.agent]) agentActivityBins[ev.agent] = new Array(30).fill(0);
    agentActivityBins[ev.agent][29]++;
  }
  while (allActivityEvents.length > 2000) allActivityEvents.shift();
  if (currentTab === 'activity') { renderFullActivityFeed(); populateAgentFilter(); }
  const aiEvents = events.filter(e => e.category === 'ai');
  const otherEvents = events.filter(e => e.category !== 'ai');
  if (aiEvents.length > 0) {
    if (!aiFeedHasEntries) { activityFeed.innerHTML = ''; aiFeedHasEntries = true; }
    for (const ev of aiEvents) {
      const permCat = ev.sensitive ? 'sensitive' : 'filesystem';
      const perm = getPermission(ev.agent, permCat);
      if (perm === 'allow') {
        aiFileCounts[ev.agent] = (aiFileCounts[ev.agent] || 0) + 1;
        eventLog.push({ agent: ev.agent, timestamp: ev.timestamp || Date.now(), type: 'file', file: ev.file });
        activityFeed.appendChild(createFeedEntry(ev));
        continue;
      }
      if (perm === 'block') {
        ev._denied = true;
        aiFileCounts[ev.agent] = (aiFileCounts[ev.agent] || 0) + 1;
        if (ev.sensitive) {
          aiSensitiveCounts[ev.agent] = (aiSensitiveCounts[ev.agent] || 0) + 1;
          aiTotalSensitive++;
          triggerRadarConnection(ev.agent, ev.reason, true);
        } else {
          triggerRadarConnection(ev.agent, ev.reason || 'Environment variables', true);
        }
        eventLog.push({ agent: ev.agent, timestamp: ev.timestamp || Date.now(), type: ev.sensitive ? 'sensitive' : 'file', file: ev.file });
        boostAgentSpeed(ev.agent);
        activityFeed.appendChild(createFeedEntry(ev));
        continue;
      }
      aiFileCounts[ev.agent] = (aiFileCounts[ev.agent] || 0) + 1;
      let evType = 'file';
      if (ev.sensitive) {
        aiSensitiveCounts[ev.agent] = (aiSensitiveCounts[ev.agent] || 0) + 1;
        aiTotalSensitive++;
        evType = 'sensitive';
        triggerRadarConnection(ev.agent, ev.reason, false);
      } else if (isConfigFile(ev.file)) {
        aiConfigCounts[ev.agent] = (aiConfigCounts[ev.agent] || 0) + 1;
        evType = 'config';
      }
      if (/[\\\/]\.ssh[\\\/]/i.test(ev.file) || /[\\\/]\.aws[\\\/]/i.test(ev.file)) {
        aiSshAwsCounts[ev.agent] = (aiSshAwsCounts[ev.agent] || 0) + 1;
      }
      eventLog.push({ agent: ev.agent, timestamp: ev.timestamp || Date.now(), type: evType, file: ev.file });
      boostAgentSpeed(ev.agent);
      activityFeed.appendChild(createFeedEntry(ev));
    }
    if (eventLog.length > 2000) eventLog.splice(0, eventLog.length - 2000);
    while (activityFeed.children.length > MAX_FEED_ENTRIES) activityFeed.removeChild(activityFeed.firstChild);
    updateFeedVisibility();
    activityFeed.scrollTop = activityFeed.scrollHeight;
    sensitiveCountEl.textContent = `${aiTotalSensitive} SENSITIVE`;
  }
  if (otherEvents.length > 0) {
    if (!otherFeedHasEntries) { otherActivityFeed.innerHTML = ''; otherFeedHasEntries = true; }
    for (const ev of otherEvents) {
      const permCat = ev.sensitive ? 'sensitive' : 'filesystem';
      const perm = getPermission(ev.agent, permCat);
      if (perm === 'allow') {
        otherFileCounts[ev.agent] = (otherFileCounts[ev.agent] || 0) + 1;
        eventLog.push({ agent: ev.agent, timestamp: ev.timestamp || Date.now(), type: 'file', file: ev.file });
        otherActivityFeed.appendChild(createFeedEntry(ev));
        continue;
      }
      if (perm === 'block') {
        ev._denied = true;
        otherFileCounts[ev.agent] = (otherFileCounts[ev.agent] || 0) + 1;
        if (ev.sensitive) {
          otherSensitiveCounts[ev.agent] = (otherSensitiveCounts[ev.agent] || 0) + 1;
          otherTotalSensitive++;
        }
        eventLog.push({ agent: ev.agent, timestamp: ev.timestamp || Date.now(), type: ev.sensitive ? 'sensitive' : 'file', file: ev.file });
        otherActivityFeed.appendChild(createFeedEntry(ev));
        continue;
      }
      otherFileCounts[ev.agent] = (otherFileCounts[ev.agent] || 0) + 1;
      let evType = 'file';
      if (ev.sensitive) {
        otherSensitiveCounts[ev.agent] = (otherSensitiveCounts[ev.agent] || 0) + 1;
        otherTotalSensitive++;
        evType = 'sensitive';
      } else if (isConfigFile(ev.file)) {
        otherConfigCounts[ev.agent] = (otherConfigCounts[ev.agent] || 0) + 1;
        evType = 'config';
      }
      if (/[\\\/]\.ssh[\\\/]/i.test(ev.file) || /[\\\/]\.aws[\\\/]/i.test(ev.file)) {
        otherSshAwsCounts[ev.agent] = (otherSshAwsCounts[ev.agent] || 0) + 1;
      }
      eventLog.push({ agent: ev.agent, timestamp: ev.timestamp || Date.now(), type: evType, file: ev.file });
      otherActivityFeed.appendChild(createFeedEntry(ev));
    }
    while (otherActivityFeed.children.length > MAX_OTHER_FEED_ENTRIES) otherActivityFeed.removeChild(otherActivityFeed.firstChild);
    otherActivityFeed.scrollTop = otherActivityFeed.scrollHeight;
    otherSensitiveCountEl.textContent = `${otherTotalSensitive} SENSITIVE`;
    otherPanel.style.display = '';
  }
}

/** Toggle feed entry visibility based on collapsed state. @returns {void} */
function updateFeedVisibility() {
  const entries = activityFeed.querySelectorAll('.feed-entry');
  const total = entries.length;
  if (total <= VISIBLE_FEED_ROWS || !feedCollapsed) {
    entries.forEach(e => e.style.display = '');
    showMoreBtn.style.display = 'none';
    return;
  }
  entries.forEach((e, i) => { e.style.display = i < total - VISIBLE_FEED_ROWS ? 'none' : ''; });
  showMoreBtn.style.display = '';
  showMoreBtn.textContent = `Show ${total - VISIBLE_FEED_ROWS} more entries...`;
}

showMoreBtn.addEventListener('click', () => { feedCollapsed = false; updateFeedVisibility(); });

clearBtn.addEventListener('click', () => {
  selectedAgent = null;
  document.querySelectorAll('.agent-card, .other-agent-card').forEach(c => c.classList.remove('selected'));
  activityFeed.innerHTML = '<div class="empty-state">Feed cleared</div>';
  otherActivityFeed.innerHTML = '<div class="empty-state">No activity from other agent processes</div>';
  aiFeedHasEntries = false; otherFeedHasEntries = false;
  [aiFileCounts, aiSensitiveCounts, aiSshAwsCounts, aiConfigCounts,
   otherFileCounts, otherSensitiveCounts, otherSshAwsCounts, otherConfigCounts,
   netUnknownDomainCounts].forEach(m => Object.keys(m).forEach(k => { m[k] = 0; }));
  aiTotalSensitive = 0; otherTotalSensitive = 0;
  sensitiveCountEl.textContent = '0 SENSITIVE';
  otherSensitiveCountEl.textContent = '0 SENSITIVE';
  eventLog.length = 0; highestRiskScore = 0;
  updateRadarGlow(0);
});
