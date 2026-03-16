let currentLang = 'ko';

function toggleLanguage() {
    currentLang = currentLang === 'ko' ? 'en' : 'ko';
    document.documentElement.lang = currentLang;
    applyTranslation();

    // Notify other modules (e.g. detail.js) that the language has changed
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: currentLang } }));
}

/**
 * Apply the current language to ALL [data-ko][data-en] elements in the document.
 * Called on toggle and can also be called after dynamic DOM injection.
 */
function applyTranslation() {
    // Update the toggle button label
    document.querySelectorAll('.nav-icon-btn span').forEach(span => {
        span.textContent = currentLang === 'ko' ? 'KO' : 'EN';
    });

    // Update text content of all translated elements
    document.querySelectorAll('[data-en][data-ko]').forEach(el => {
        const value = currentLang === 'en'
            ? el.getAttribute('data-en')
            : el.getAttribute('data-ko');
        el.innerHTML = value;
    });

    // Update placeholder attributes (search inputs, etc.)
    document.querySelectorAll('[data-placeholder-en][data-placeholder-ko]').forEach(el => {
        el.placeholder = currentLang === 'en'
            ? el.getAttribute('data-placeholder-en')
            : el.getAttribute('data-placeholder-ko');
    });
}
