const REGISTRY_URL = 'site-registry.json';
const AGENT_STATION_URL = 'http://127.0.0.1:3000';

/** @type {object | null} */
let registryCache = null;

/** @type {Map<number, { environmentId: string, siteId: string }>} */
const activeEnvironmentByTabId = new Map();

async function loadRegistry() {
  if (!registryCache) {
    const res = await fetch(chrome.runtime.getURL(REGISTRY_URL));
    if (!res.ok) {
      throw new Error(`registry HTTP ${res.status}`);
    }
    registryCache = await res.json();
  }
  return registryCache;
}

function hostnameMatchesSite(hostname, site) {
  if (site.hostsExact?.includes(hostname)) return true;
  if (site.hostSuffixes?.some((suf) => hostname.endsWith(suf))) return true;
  return false;
}

function environmentIdForSite(site) {
  return typeof site.environmentId === 'string' && site.environmentId.trim()
    ? site.environmentId.trim()
    : `web:${site.id}`;
}

async function resolveSiteForHostname(hostname) {
  const reg = await loadRegistry();
  for (const site of reg.sites || []) {
    if (hostnameMatchesSite(hostname, site)) return site;
  }
  return null;
}

async function getSiteById(siteId) {
  const reg = await loadRegistry();
  return (reg.sites || []).find((site) => site.id === siteId) ?? null;
}

async function postAgentStation(path, payload) {
  const res = await fetch(`${AGENT_STATION_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Agent Station HTTP ${res.status} for ${path}`);
  }
}

async function activateEnvironmentForTab(tabId, siteId, canonicalSourceUrl) {
  const site = await getSiteById(siteId);
  if (!site) throw new Error(`unknown site id: ${siteId}`);
  const environmentId = environmentIdForSite(site);
  activeEnvironmentByTabId.set(tabId, { environmentId, siteId: site.id });
  await postAgentStation('/api/environments/register', {
    id: environmentId,
    metadata: {
      siteId: site.id,
      canonicalSourceUrl,
      sourceName: site.sourceName,
    },
    canonicalSourceUrl,
    ...(site.sourceName ? { sourceName: site.sourceName } : {}),
  });
  return { environmentId, sourceName: site.sourceName };
}

async function deactivateEnvironmentForTab(tabId) {
  const active = activeEnvironmentByTabId.get(tabId);
  if (!active) return false;
  activeEnvironmentByTabId.delete(tabId);
  await postAgentStation('/api/environments/unavailable', { id: active.environmentId });
  return true;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void deactivateEnvironmentForTab(tabId).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (typeof changeInfo.url !== 'string') return;
  const active = activeEnvironmentByTabId.get(tabId);
  if (!active) return;
  void (async () => {
    const site = await getSiteById(active.siteId);
    if (!site) {
      await deactivateEnvironmentForTab(tabId);
      return;
    }
    let hostname = '';
    try {
      hostname = new URL(changeInfo.url).hostname;
    } catch {
      await deactivateEnvironmentForTab(tabId);
      return;
    }
    if (!hostnameMatchesSite(hostname, site)) {
      await deactivateEnvironmentForTab(tabId);
    }
  })().catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'resolveSite') {
    void resolveSiteForHostname(String(message.hostname || ''))
      .then((site) => {
        sendResponse({ ok: true, site });
      })
      .catch((e) => {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });
    return true;
  }

  if (message?.type === 'activateEnvironment') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: 'missing sender tab id' });
      return false;
    }
    void activateEnvironmentForTab(tabId, String(message.siteId || ''), String(message.canonicalSourceUrl || ''))
      .then((payload) => {
        sendResponse({ ok: true, payload });
      })
      .catch((e) => {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });
    return true;
  }

  if (message?.type === 'deactivateEnvironment') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: 'missing sender tab id' });
      return false;
    }
    void deactivateEnvironmentForTab(tabId)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((e) => {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });
    return true;
  }

  return false;
});
