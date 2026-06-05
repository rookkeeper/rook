/* eslint-disable no-console */

const MARKER = '__host_split_extension_v1';
const LOG_PREFIX = '[host-split]';

/** Right iframe URL — keep in sync with `postMessage` target origin. */
const LOCALHOST_PANEL_URL = 'http://localhost:3000';
const LOCALHOST_ORIGIN = new URL(LOCALHOST_PANEL_URL).origin;

/** Current registered site (set after successful resolve). */
let activeSiteId = null;
let environmentActive = false;

const LOG_LEVELS = new Set(['log', 'info', 'debug', 'warn', 'error']);

function log(level, msg, meta) {
  const line = `${LOG_PREFIX} ${msg}`;
  const fn = LOG_LEVELS.has(level) && typeof console[level] === 'function' ? console[level] : console.log;
  if (meta !== undefined) {
    fn.call(console, line, meta);
  } else {
    fn.call(console, line);
  }
}

function showFailureBanner(title, detail) {
  try {
    const pre = document.createElement('pre');
    pre.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'inset:auto 8px auto 8px',
      'top:8px',
      'max-height:40vh',
      'overflow:auto',
      'margin:0',
      'padding:12px',
      'background:#2a0710',
      'color:#ffd4dc',
      'border:1px solid #f44',
      'font:12px/1.4 ui-monospace,monospace',
      'border-radius:6px',
      'box-shadow:0 4px 24px rgba(0,0,0,.35)',
      'pointer-events:auto',
    ].join(';');

    let text = `${LOG_PREFIX} ${title}`;
    if (detail) text += `\n\n${detail instanceof Error ? detail.stack || detail.message : String(detail)}`;
    text += `\n\nOpen DevTools on THIS tab → Console → look for "${LOG_PREFIX}" lines.`;
    pre.textContent = text;
    (document.documentElement || document.body || document.head).appendChild(pre);
  } catch (_) {
    // last resort
  }
}

function clearBodyPreserveExtensionSafe() {
  const body = document.body;
  if (!body) return;
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }
}

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const last = chrome.runtime.lastError;
      if (last) {
        reject(new Error(last.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error(response?.error || 'background error'));
        return;
      }
      resolve(response);
    });
  });
}

/** Resolve `site-registry.json` entry for this tab’s hostname (service worker). */
async function resolveSiteFromBackground() {
  const response = await sendToBackground({
    type: 'resolveSite',
    hostname: window.location.hostname,
  });
  return response.site;
}

function isWikipediaHostname(hostname) {
  if (hostname === 'wikipedia.org' || hostname === 'www.wikipedia.org') return true;
  return hostname.endsWith('.wikipedia.org');
}

/** @returns {URL | null} */
function parseAllowedWikipediaUrl(urlString) {
  let u;
  try {
    u = new URL(String(urlString).trim(), window.location.href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!isWikipediaHostname(u.hostname)) return null;
  return u;
}

/**
 * `url_change` from localhost: update the **left** mirror only. Never navigates the
 * top window (so the shell and **right** localhost iframe stay alive). When the new
 * URL is **same origin** as the tab, also `history.replaceState` so the address bar
 * matches; cross-subdomain Wikipedia URLs still load in the left iframe but the bar
 * cannot be updated without a forbidden full reload.
 */
function applyUrlChangeFromChild(href, iframeSite) {
  const u = parseAllowedWikipediaUrl(href);
  if (!u) {
    log('error', 'url_change rejected: need http(s) URL on wikipedia.org', { href });
    return;
  }
  const next = u.href;
  iframeSite.src = next;
  if (u.origin === window.location.origin) {
    try {
      history.replaceState({}, '', next);
    } catch (e) {
      log('error', 'url_change: replaceState failed', e);
    }
    log('info', 'url_change: left iframe + address bar (same origin)', { next });
  } else {
    log('info', 'url_change: left iframe only (cross-origin vs tab; address bar unchanged)', {
      next,
      tabOrigin: window.location.origin,
    });
  }
}

/**
 * Messages from the localhost child: `url_change` updates the left iframe + URL bar.
 * Only the real right iframe and localhost origin are accepted.
 */
function attachLocalhostChildMessageHandler(iframeLocal, iframeSite) {
  window.addEventListener('message', (event) => {
    if (event.origin !== LOCALHOST_ORIGIN) return;
    if (event.source !== iframeLocal.contentWindow) return;
    const data = event.data;
    if (data && typeof data === 'object' && data.type === 'url_change' && typeof data.url === 'string') {
      applyUrlChangeFromChild(data.url, iframeSite);
      return;
    }
    log('debug', 'message from localhost panel (ignored)', { data });
  });
}

async function activateEnvironmentForCurrentTab(siteId) {
  const canonicalSourceUrl = window.location.href;
  await sendToBackground({ type: 'activateEnvironment', siteId, canonicalSourceUrl });
  environmentActive = true;
  log('info', 'environment registered with Agent Station', {
    siteId,
    canonicalSourceUrl,
  });
}

async function deactivateEnvironmentForCurrentTab() {
  if (!environmentActive || !activeSiteId) return;
  environmentActive = false;
  await sendToBackground({ type: 'deactivateEnvironment', siteId: activeSiteId });
  log('info', 'environment marked unavailable', { siteId: activeSiteId });
}

/**
 * Full-width mirrored site with a floating “chat with agent” control top-right on that
 * pane; no right column until click, then localhost iframe + existing behavior.
 * @param {{ id: string }} site
 */
function wireLocalhostIframe(iframeLocal, iframeSite) {
  attachLocalhostChildMessageHandler(iframeLocal, iframeSite);
  iframeLocal.addEventListener('error', (e) => log('error', 'right iframe error event', e));
}

const SPLIT_MIN_PANE_PX = 160;
const SPLIT_DEFAULT_LEFT_RATIO = 2 / 3;

/**
 * Draggable vertical divider between site mirror (left) and agent iframe (right).
 * @param {HTMLElement} wrap
 * @param {HTMLElement} leftWrap
 * @param {HTMLElement} divider
 * @param {HTMLElement} rightSlot
 */
function attachSplitResizer(wrap, leftWrap, divider, rightSlot) {
  let leftRatio = SPLIT_DEFAULT_LEFT_RATIO;
  let dragging = false;

  function applySplitRatio() {
    const total = wrap.getBoundingClientRect().width;
    const dividerW = divider.getBoundingClientRect().width;
    const available = Math.max(0, total - dividerW);
    const minLeft = Math.min(SPLIT_MIN_PANE_PX, available * 0.5);
    const maxLeft = Math.max(minLeft, available - SPLIT_MIN_PANE_PX);
    const left = Math.round(Math.min(maxLeft, Math.max(minLeft, available * leftRatio)));
    leftWrap.style.flex = `0 0 ${left}px`;
    leftWrap.style.width = `${left}px`;
    rightSlot.style.flex = '1 1 0';
    rightSlot.style.width = 'auto';
  }

  function setRatioFromPointer(clientX) {
    const rect = wrap.getBoundingClientRect();
    const dividerW = divider.getBoundingClientRect().width;
    const available = Math.max(1, rect.width - dividerW);
    const minLeft = Math.min(SPLIT_MIN_PANE_PX, available * 0.5);
    const maxLeft = Math.max(minLeft, available - SPLIT_MIN_PANE_PX);
    const left = Math.min(maxLeft, Math.max(minLeft, clientX - rect.left));
    leftRatio = left / available;
    applySplitRatio();
  }

  function stopDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (e?.pointerId != null && divider.hasPointerCapture(e.pointerId)) {
      divider.releasePointerCapture(e.pointerId);
    }
    divider.classList.remove('host-split-divider--dragging');
    wrap.classList.remove('host-split-resizing');
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    setRatioFromPointer(e.clientX);
  }

  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    dragging = true;
    divider.classList.add('host-split-divider--dragging');
    wrap.classList.add('host-split-resizing');
    setRatioFromPointer(e.clientX);
  });

  divider.addEventListener('pointermove', onPointerMove);
  divider.addEventListener('pointerup', stopDrag);
  divider.addEventListener('pointercancel', stopDrag);

  window.addEventListener('resize', applySplitRatio);
  applySplitRatio();
}

function mountFloatingAgentCta(leftWrap, wrap, iframeSite, site) {
  const cta = document.createElement('button');
  cta.type = 'button';
  cta.id = '__host_split_agent_cta';
  cta.className = 'host-split-agent-cta';
  cta.textContent = 'Chat with YOUR agent.';
  cta.addEventListener('click', () => {
    cta.remove();
    wrap.classList.add('host-split-with-right');
    const divider = document.createElement('div');
    divider.className = 'host-split-divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.setAttribute('aria-label', 'Resize panes');
    const rightSlot = document.createElement('div');
    rightSlot.className = 'host-split-right-slot';
    const iframeLocal = document.createElement('iframe');
    iframeLocal.id = '__host_split_local_iframe';
    iframeLocal.className = 'host-split-iframe host-split-iframe--local';
    iframeLocal.title = 'localhost:3000';
    iframeLocal.src = LOCALHOST_PANEL_URL;
    rightSlot.appendChild(iframeLocal);
    wrap.appendChild(divider);
    wrap.appendChild(rightSlot);
    attachSplitResizer(wrap, leftWrap, divider, rightSlot);
    wireLocalhostIframe(iframeLocal, iframeSite);
    void activateEnvironmentForCurrentTab(site.id).catch((e) => {
      log('error', 'could not register environment', e);
      showFailureBanner('Could not register environment', e);
    });
    log('info', 'agent panel opened — localhost iframe mounted');
  });
  leftWrap.appendChild(cta);
}

function injectSplitUi(site) {
  if (window[MARKER]) {
    log('info', 'already injected — exiting (marker set). Reload the tab to retry.');
    return;
  }

  activeSiteId = site.id;

  log('info', 'content script START', {
    siteId: site.id,
    href: window.location.href,
    readyState: document.readyState,
    hasBody: !!document.body,
    frameSelf: window === window.top ? 'top' : 'subframe',
  });

  try {
    if (!document.body) {
      throw new Error('document.body was null — cannot inject (unexpected at document_idle).');
    }

    const siteUrl = window.location.href;

    document.documentElement.classList.add('host-split-shell');
    document.body.classList.add('host-split-shell');

    clearBodyPreserveExtensionSafe();

    const root = document.createElement('div');
    root.id = '__host_split_root__';

    const wrap = document.createElement('div');
    wrap.className = 'host-split-iframes';

    const iframeSite = document.createElement('iframe');
    iframeSite.id = '__host_split_site_iframe';
    iframeSite.className = 'host-split-iframe host-split-iframe--site';
    iframeSite.title = 'Original page';
    iframeSite.src = siteUrl;

    const leftWrap = document.createElement('div');
    leftWrap.className = 'host-split-left-wrap';
    leftWrap.appendChild(iframeSite);

    wrap.appendChild(leftWrap);
    root.appendChild(wrap);

    document.body.appendChild(root);

    window[MARKER] = true;

    mountFloatingAgentCta(leftWrap, wrap, iframeSite, site);

    log('info', 'injection OK — full-width mirror; agent CTA top-right until clicked');
    log('info', 'After opening the agent panel, if localhost is blank:', {
      hint: 'Serve localhost:3000; mixed-content rules may block http inside https parent.',
      localUrl: LOCALHOST_PANEL_URL,
      siteIframeId: iframeSite.id,
    });

    iframeSite.addEventListener('load', () => log('info', 'left iframe loaded (site mirror)'));
    iframeSite.addEventListener('error', (e) => log('error', 'left iframe error event', e));
  } catch (err) {
    log('error', 'injection FAILED', err);
    showFailureBanner('Injection failed (see console)', err);
  }
}

async function tryInjectWhenReady() {
  let site;
  try {
    site = await resolveSiteFromBackground();
  } catch (e) {
    log('error', 'could not resolve site from registry', e);
    return;
  }
  if (!site) {
    log('debug', 'hostname not in site-registry — no split UI', {
      hostname: window.location.hostname,
    });
    return;
  }
  injectSplitUi(site);
}

function waitForBodyAndRun(retriesLeft) {
  if (document.body) {
    void tryInjectWhenReady();
    return;
  }
  log('debug', 'document.body not ready yet; retrying…', { retriesLeft });
  if (retriesLeft <= 0) {
    showFailureBanner('Never got document.body', 'Timed out.');
    log('error', 'gave up waiting for document.body');
    return;
  }
  requestAnimationFrame(() => waitForBodyAndRun(retriesLeft - 1));
}

window.addEventListener('pagehide', () => {
  void deactivateEnvironmentForCurrentTab().catch(() => undefined);
});

waitForBodyAndRun(90);
