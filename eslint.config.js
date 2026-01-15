module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        Notification: 'readonly',
        Promise: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        JSON: 'readonly',
        Math: 'readonly',
        Date: 'readonly',
        Number: 'readonly',
        parseInt: 'readonly',
        parseFloat: 'readonly',
        isNaN: 'readonly',
        encodeURIComponent: 'readonly',
        alert: 'readonly',
        navigator: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        MutationObserver: 'readonly',
        location: 'readonly',
        confirm: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-shadow': 'error'
    }
  }
];
