/**
 * app.js — App Initialization & Shared UI Logic
 *
 * Handles:
 *  - Active nav link highlighting
 *  - Stub link interception (data-stub attributes)
 *  - Shared micro-interactions (tooltips, modal, etc.)
 *
 * FUTURE:
 *  - Client-side routing (single-page navigation)
 *  - Auth state check → redirect to login if unauthenticated
 *  - Global notification toast system
 *  - Service Worker registration (PWA / offline support)
 *  - Analytics event tracking
 */

(function () {
  'use strict';

  // ── Active Nav Link ───────────────────────────────────────────
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .sidebar a').forEach(link => {
    const linkPath = link.getAttribute('href')?.split('/').pop();
    if (linkPath && linkPath === currentPath) {
      link.classList.add('active');
    }
  });


  // ── Stub Link Interception ────────────────────────────────────
  // Intercept clicks on [data-stub] elements and show a coming-soon toast
  document.querySelectorAll('[data-stub]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const feature = el.getAttribute('data-stub');
      showToast(`"${feature}" — coming soon!`, 'info');
    });
  });


  // ── Toast Notification ────────────────────────────────────────
  /**
   * showToast(message, type)
   * @param {string} message
   * @param {'success'|'warning'|'danger'|'info'} type
   * FUTURE: Queue multiple toasts, support actions (Undo, View)
   */
  function showToast(message, type = 'info') {
    const colors = {
      success: { bg: 'var(--color-success-light)', border: '#bbf7d0', text: '#14532d' },
      warning: { bg: 'var(--color-warning-light)', border: '#fde68a', text: '#78350f' },
      danger:  { bg: 'var(--color-danger-light)',  border: '#fecaca', text: '#7f1d1d' },
      info:    { bg: 'var(--color-primary-light)', border: '#bfdbfe', text: '#1e3a8a' },
    };
    const c = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      background: ${c.bg};
      border: 1px solid ${c.border};
      color: ${c.text};
      border-radius: 8px;
      padding: 12px 20px;
      font-size: 13px;
      font-weight: 500;
      font-family: var(--font-family, Inter, sans-serif);
      box-shadow: 0 4px 16px rgba(0,0,0,.10);
      max-width: 320px;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 200ms ease, transform 200ms ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // Auto-dismiss after 3s
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 220);
    }, 3000);
  }


  // ── Generic Modal Helper ──────────────────────────────────────
  /**
   * openModal(overlayId) / closeModal(overlayId)
   * FUTURE: Focus trap, keyboard Escape to close, stacked modals
   */
  function openModal(overlayId) {
    const el = document.getElementById(overlayId);
    if (el) el.classList.add('open');
  }
  function closeModal(overlayId) {
    const el = document.getElementById(overlayId);
    if (el) el.classList.remove('open');
  }
  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });


  // ── Tab System ────────────────────────────────────────────────
  // Generic tab handler for any .tabs/.tab-btn/.tab-panel group
  // (pages can also call showTab() directly for custom routing)
  document.querySelectorAll('.tabs').forEach(tabGroup => {
    tabGroup.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        if (!panel) return;
        tabGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Look for panels in closest common ancestor
        const parent = tabGroup.closest('[data-tab-group]') || document;
        parent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const target = document.getElementById(panel);
        if (target) target.classList.add('active');
      });
    });
  });


  // ── Keyboard Shortcuts (global) ───────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Escape closes any open modal
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
    // FUTURE: / to focus search, ? to open help
  });


  // ── Exports ───────────────────────────────────────────────────
  window.RidePoolApp = {
    showToast,
    openModal,
    closeModal,
    // FUTURE: navigate(path) → client-side router
    // FUTURE: getAuthUser() → current user object from session
    // FUTURE: registerServiceWorker() → PWA offline support
  };

  console.log('[RidePool] App initialized on:', currentPath);

}());
