/**
 * @file safe-storage.js
 * @module main/safe-storage
 * @description Encrypts/decrypts sensitive config values using Electron safeStorage.
 *   Falls back to plaintext when safeStorage is unavailable (CI, Linux without keyring).
 * @requires electron
 * @since v0.8.3
 */
'use strict';

const { safeStorage } = require('electron');
const logger = require('./logger');

/**
 * Check whether the OS keychain is available for encryption.
 * @returns {boolean}
 */
function isAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Encrypt a plaintext string into a base64-encoded blob.
 * Returns null if safeStorage is unavailable or input is empty.
 * @param {string} plaintext
 * @returns {string|null} base64-encoded encrypted blob, or null
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  if (!isAvailable()) {
    logger.warn('safe-storage', 'safeStorage unavailable, cannot encrypt');
    return null;
  }
  const buf = safeStorage.encryptString(plaintext);
  return buf.toString('base64');
}

/**
 * Decrypt a base64-encoded blob back to plaintext.
 * Returns empty string if safeStorage is unavailable or input is empty.
 * @param {string} base64Blob
 * @returns {string} decrypted plaintext, or empty string
 */
function decrypt(base64Blob) {
  if (!base64Blob) return '';
  if (!isAvailable()) {
    logger.warn('safe-storage', 'safeStorage unavailable, cannot decrypt');
    return '';
  }
  try {
    const buf = Buffer.from(base64Blob, 'base64');
    return safeStorage.decryptString(buf);
  } catch (err) {
    logger.error('safe-storage', 'Decryption failed', { error: err.message });
    return '';
  }
}

module.exports = { isAvailable, encrypt, decrypt };
