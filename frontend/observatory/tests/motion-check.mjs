import assert from 'node:assert/strict';

/** Exercise visible feedback and its interruption paths. @param {import('playwright').Page} page Preview page @returns {Promise<void>} Completed assertions @since 0.14.1 */
export async function checkMotion(page) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on('pageerror', onError);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    document.documentElement.classList.remove('no-motion');
    document.documentElement.dataset.motion = 'full';
    localStorage.setItem('aegis-motion', 'full');
  });
  await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
  await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  const sweep = await page.locator('.dial-sweep').evaluate(async (node) => {
    const before = getComputedStyle(node).transform;
    await new Promise((resolve) => setTimeout(resolve, 160));
    return { before, after: getComputedStyle(node).transform };
  });
  assert.notEqual(sweep.before, sweep.after, 'live sweep is stationary');

  const marker = page.locator('.radar-blip:not([aria-pressed="true"])').first();
  const key = await marker.getAttribute('data-group');
  await page.getByRole('button', { name: 'Pause view', exact: true }).click();
  await marker.scrollIntoViewIfNeeded();
  const beforeHover = await marker.boundingBox();
  await marker.hover();
  const geometry = async (target = marker) =>
    target.evaluate(async (node) => {
      const frames = [];
      for (let frame = 0; frame < 20; frame++) {
        await new Promise(requestAnimationFrame);
        const { x, y, width, height } = node.getBoundingClientRect();
        frames.push({ x, y, width, height });
      }
      return frames;
    });
  const stable = (frames, expected, reason) => {
    for (const rect of frames)
      for (const key of ['x', 'y', 'width', 'height'])
        assert(Math.abs(rect[key] - expected[key]) < 0.5, reason + ': ' + key);
  };
  stable(await geometry(), beforeHover, 'hover moved or resized the marker');
  await page.mouse.down();
  stable(await geometry(), beforeHover, 'press moved or resized the marker');
  await page.mouse.up();
  await page.locator('.agent-workspace:visible').waitFor();
  await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  const context = page.locator('.agent-context');
  assert.equal(await context.getByLabel('Selected agent', { exact: true }).inputValue(), key);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await context.getByLabel('Selected agent', { exact: true }).selectOption('');
  await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
  await page.getByRole('button', { name: 'Resume view', exact: true }).click();

  const layers = page.locator('.radar-layers');
  const pillBefore = await layers.evaluate((node) => getComputedStyle(node, '::before').transform);
  await layers.getByRole('button', { name: 'Files', exact: true }).click();
  await layers.evaluate((node) =>
    Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))),
  );
  const pillAfter = await layers.evaluate((node) => getComputedStyle(node, '::before').transform);
  assert.notEqual(pillBefore, pillAfter, 'layer indicator did not move');
  await page.getByRole('button', { name: 'Pause view', exact: true }).click();
  assert.equal(await page.locator('.radar-links').evaluate((svg) => svg.animationsPaused()), true);
  assert.equal(
    await page.locator('.dial-sweep').evaluate((node) => getComputedStyle(node).animationPlayState),
    'paused',
  );
  assert.equal(
    await page
      .locator('.radar-blip')
      .first()
      .evaluate((node) => getComputedStyle(node, '::after').animationPlayState),
    'paused',
  );
  await page.getByRole('button', { name: 'Resume view', exact: true }).click();
  assert.equal(await page.locator('.radar-links').evaluate((svg) => svg.animationsPaused()), false);
  await layers.getByRole('button', { name: 'Radar', exact: true }).click();

  const lastKey = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.radar-agent-card')];
    const expected = document.querySelector('.radar-blip').dataset.group;
    cards[0].click();
    cards[1].click();
    cards[0].click();
    return expected;
  });
  await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  assert.equal(await context.getByLabel('Selected agent', { exact: true }).inputValue(), lastKey);
  assert.equal(
    await page.locator('.agent-workspace:visible').count(),
    1,
    'rapid selection accumulated pages',
  );
  await context.getByLabel('Selected agent', { exact: true }).selectOption('');
  await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.locator('.dial-sweep').evaluate((node) => getComputedStyle(node).animationName),
    'none',
  );
  await page.locator('.radar-agent-card').nth(1).click();
  await page.locator('.agent-workspace:visible').waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await context.getByLabel('Selected agent', { exact: true }).selectOption('');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
  const animationToggle = page.getByLabel(/Animations/);
  await animationToggle.uncheck();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.motion),
    'reduce',
    'motion preference has no immediate preview',
  );
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'full');
  assert.equal(await animationToggle.isChecked(), true);
  await animationToggle.uncheck();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem('aegis-motion') === 'reduce');
  await page.reload();
  await page.getByRole('button', { name: 'Detailed monitoring', exact: true }).click();
  await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
  assert.equal(
    await page.locator('.dial-sweep').evaluate((node) => getComputedStyle(node).animationName),
    'none',
    'disabled motion did not survive restart',
  );
  await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel(/Animations/).check();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem('aegis-motion') === 'full');
  await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
  await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.sidebar button')];
    buttons.find((button) => button.textContent.trim().startsWith('Events')).click();
    buttons.find((button) => button.textContent.trim().startsWith('Monitoring')).click();
  });
  await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  assert.equal(
    await page.getByRole('heading', { level: 1 }).innerText(),
    'Monitoring',
    'interrupted navigation ignored the final click',
  );
  await page.keyboard.press('Alt+ArrowLeft');
  await page.getByRole('heading', { level: 1, name: 'Events', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.transitionSurface),
    undefined,
    'Back should not capture and slide the reading surface',
  );
  await page.keyboard.press('Alt+ArrowRight');
  await page.getByRole('heading', { level: 1, name: 'Monitoring', exact: true }).waitFor();
  await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  const navigation = page
    .locator('.sidebar')
    .getByRole('button', { name: 'Statistics', exact: true });
  const navBefore = await navigation.boundingBox();
  await navigation.hover();
  stable(await geometry(navigation), navBefore, 'hover moved navigation');
  await page.mouse.down();
  stable(await geometry(navigation), navBefore, 'press shrank navigation');
  await page.mouse.up();
  await page.getByRole('heading', { level: 1, name: 'Statistics', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Performance', exact: true }).click();
  await page
    .getByRole('tab', { name: 'Performance', exact: true })
    .evaluate((node) => node.focus({ preventScroll: true }));
  const keyboardScroll = await page.locator('#main').evaluate((node) => {
    node.scrollTop = 220;
    return node.scrollTop;
  });
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Sensors');
  assert.equal(
    await page.locator('#main').evaluate((node) => node.scrollTop),
    keyboardScroll,
    'keyboard tab navigation scrolled the surrounding workspace',
  );
  await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
  page.off('pageerror', onError);
  assert.deepEqual(errors, [], 'motion generated a runtime error');
}
