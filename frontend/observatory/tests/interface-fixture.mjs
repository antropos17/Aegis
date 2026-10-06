/** Keep the existing broad UI matrix explicit about the full technical interface.
 * Simple-mode behavior is checked separately using the unwrapped browser.
 * @param {import('playwright').Browser} browser Real browser
 * @returns {import('playwright').Browser} Browser with Advanced fixture pages
 * @since 0.19.2
 */
export function advancedFixture(browser) {
  return new Proxy(browser, {
    get(target, property) {
      if (property === 'newPage' || property === 'newContext') {
        return async (...args) => {
          const surface = await target[property](...args);
          await surface.addInitScript(() => localStorage.setItem('aegis-advanced-mode', 'true'));
          return surface;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
