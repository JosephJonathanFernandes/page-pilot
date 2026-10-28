/* Page Pilot content script: scan interactive elements + highlight. */
(function () {
  'use strict';

  const INTERACTIVE_SELECTOR = [
    'a', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="option"]',
    '[onclick]', '[tabindex="0"]', '[contenteditable="true"]'
  ].join(',');

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    let node = el;
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (parseFloat(style.opacity || '1') === 0) return false;
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }

  function cssEscape(v) { return (window.CSS && CSS.escape) ? CSS.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

  function getSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + cssEscape(el.id);
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 5) {
      let seg = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + cssEscape(node.id)); break; }
      const cls = (typeof node.className === 'string') ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) seg += cls.map(c => '.' + cssEscape(c)).join('');
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (siblings.length > 1) seg += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(seg);
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  function labelFor(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'input' && type === 'password') {
      return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || 'Password field';
    }
    const labelledBy = el.getAttribute('aria-labelledby');
    let fromLabelled = '';
    if (labelledBy) {
      fromLabelled = labelledBy.split(/\s+/).map(id => {
        const n = document.getElementById(id);
        return n ? (n.innerText || n.textContent || '') : '';
      }).join(' ').trim();
    }
    const candidates = [
      el.getAttribute('aria-label'),
      fromLabelled,
      (tag === 'input' || tag === 'textarea' || tag === 'select') ? (el.value || '') : (el.innerText || el.textContent || ''),
      el.getAttribute('placeholder'),
      el.getAttribute('title'),
      el.getAttribute('alt'),
      el.getAttribute('name')
    ];
    for (const c of candidates) {
      if (c && String(c).trim()) return String(c).trim().replace(/\s+/g, ' ');
    }
    return '';
  }

  function typeFor(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const t = (el.type || '').toLowerCase();
    if (tag === 'a' || role === 'link') return 'Link';
    if (tag === 'button' || role === 'button' || t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'Button';
    if (tag === 'select') return 'Select';
    if (tag === 'textarea') return 'Textarea';
    if (tag === 'input') {
      if (t === 'checkbox') return 'Checkbox';
      if (t === 'radio') return 'Radio';
      if (t === 'search') return 'Search';
      if (t === 'hidden') return 'Hidden';
      return 'Input';
    }
    if (role === 'tab') return 'Tab';
    if (role === 'menuitem' || role === 'option') return 'Menu';
    if (role === 'checkbox') return 'Checkbox';
    if (role === 'radio' || role === 'switch') return 'Radio';
    if (el.hasAttribute('contenteditable')) return 'Editable';
    if (el.hasAttribute('onclick')) return 'Clickable';
    return 'Action';
  }

  function scan() {
    const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
    const items = [];
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const type = typeFor(el);
      if (type === 'Hidden') continue;
      const text = labelFor(el);
      if (!text) continue;
      const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true');
      items.push({
        text: text.slice(0, 80),
        type,
        disabled,
        selector: getSelector(el),
        href: (el.tagName.toLowerCase() === 'a' && el.href) ? el.href : undefined
      });
    }

    // Dedupe by type+text (case-insensitive)
    const seen = new Set();
    const unique = [];
    for (const it of items) {
      const key = it.type + '|' + it.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(it);
    }

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => (h.innerText || h.textContent || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 8);

    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

    const mainRoot = document.querySelector('main, article, [role="main"]') || document.body;
    const pageText = (mainRoot.innerText || mainRoot.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 1800);

    const page = {
      title: (document.title || '').trim(),
      url: location.href,
      description: metaDesc.trim().slice(0, 240),
      headings,
      formsCount: document.forms ? document.forms.length : 0,
      contentSnippet: pageText
    };

    return { page, elements: unique.slice(0, 120) };
  }

  function highlight(selector, text, duration) {
    let el = null;
    if (selector) {
      try { el = document.querySelector(selector); } catch (e) { el = null; }
    }
    if (!el && text) {
      const candidates = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
      el = candidates.find(c => {
        const t = (c.innerText || c.value || c.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
        return t === text;
      }) || null;
    }
    if (!el) return false;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } catch (e) {}
    const prevOutline = el.style.outline;
    const prevShadow = el.style.boxShadow;
    const prevTransition = el.style.transition;
    el.style.transition = 'outline 0.15s, box-shadow 0.15s';
    el.style.outline = '3px solid #3b82f6';
    el.style.boxShadow = '0 0 0 5px rgba(59,130,246,0.28)';
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.boxShadow = prevShadow;
      el.style.transition = prevTransition;
    }, Math.max(800, duration || 2500));
    return true;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || !request.action) return false;
    if (request.action === 'scan') {
      try {
        sendResponse(scan());
      } catch (e) {
        sendResponse({ error: String(e && e.message || e) });
      }
      return true;
    }
    if (request.action === 'highlight') {
      const ok = highlight(request.selector, request.text, request.duration);
      sendResponse({ ok });
      return true;
    }
    return false;
  });
})();