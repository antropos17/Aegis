/**
 * @file analysis.js
 * @module analysis
 * @description Analysis modal open/close logic and overlay dismiss handlers.
 * @since v0.1.0
 */

// ═══ ANALYSIS MODAL ═══

/**
 * Open the analysis overlay and set its title.
 * @param {string} title - Title text shown in the analysis modal header.
 * @returns {void}
 * @since v0.1.0
 */
function openAnalysis(title) {
  analysisTitle.textContent = title;
  analysisOverlay.classList.remove('hidden');
}

/**
 * Close the analysis overlay.
 * @returns {void}
 * @since v0.1.0
 */
function closeAnalysis() {
  analysisOverlay.classList.add('hidden');
}

analysisClose.addEventListener('click', closeAnalysis);
analysisOverlay.addEventListener('click', (e) => {
  if (e.target === analysisOverlay) closeAnalysis();
});
