// SEISMIC WATCH — Service Worker
const CACHE_NAME = 'seismic-watch-v1';
const CHECK_INTERVAL = 30 * 60 * 1000; // 30分ごとにチェック

// ── インストール ──
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// ── フェッチ（オフライン対応）──
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).catch(() => cached);
    })
  );
});

// ── バックグラウンド同期（定期チェック）──
self.addEventListener('periodicsync', event => {
  if (event.tag === 'seismic-check') {
    event.waitUntil(checkSeismicActivity());
  }
});

// ── メッセージ受信（メインページからの指示）──
self.addEventListener('message', event => {
  const { type, data } = event.data || {};

  if (type === 'NOTIFY') {
    // メインページから通知を要求された場合
    sendNotification(data.title, data.body, data.level);
  }

  if (type === 'START_CHECK') {
    // 定期チェック開始
    startPeriodicCheck(data.intervalMinutes || 30);
  }
});

// ── 地震活動チェック（USGSデータ）──
async function checkSeismicActivity() {
  try {
    const now = new Date();
    const past = new Date(now - 24 * 60 * 60 * 1000);
    const fmt = d => d.toISOString().slice(0, 10);

    const url = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson'
      + '&starttime=' + fmt(past) + '&endtime=' + fmt(now)
      + '&minlatitude=24&maxlatitude=46'
      + '&minlongitude=122&maxlongitude=146'
      + '&minmagnitude=4.0&orderby=time&limit=10';

    const res = await fetch(url);
    if (!res.ok) return;
    const json = await res.json();
    const features = json.features || [];

    // 南海トラフ域・富士山周辺のM5以上を検出
    const ZONES = {
      nankai: { latMin:30, latMax:36, lonMin:129, lonMax:137 },
      fuji:   { latMin:34.8, latMax:36.2, lonMin:138, lonMax:139.5 },
    };

    for (const f of features) {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates || [];
      const lon = coords[0], lat = coords[1], mag = p.mag || 0;
      const name = p.place || '不明';

      const inNankai = lat >= ZONES.nankai.latMin && lat <= ZONES.nankai.latMax
                    && lon >= ZONES.nankai.lonMin && lon <= ZONES.nankai.lonMax;
      const inFuji   = lat >= ZONES.fuji.latMin   && lat <= ZONES.fuji.latMax
                    && lon >= ZONES.fuji.lonMin   && lon <= ZONES.fuji.lonMax;

      if (inNankai && mag >= 5) {
        await sendNotification(
          '🚨 南海トラフ域 M' + mag.toFixed(1) + ' 検出',
          name + ' で規模の大きな地震が発生しました。気象庁情報を確認してください。',
          'alert'
        );
      } else if (inFuji && mag >= 4) {
        await sendNotification(
          '🌋 富士山周辺 M' + mag.toFixed(1) + ' 検出',
          name + ' で地震が発生しました。',
          'warning'
        );
      } else if (mag >= 6) {
        await sendNotification(
          '⚠️ 日本近海 M' + mag.toFixed(1) + ' 大地震',
          name + ' で大きな地震が発生しました。',
          'warning'
        );
      }
    }
  } catch (e) {
    // チェック失敗は無視
  }
}

// ── 通知送信 ──
async function sendNotification(title, body, level) {
  const icons = {
    alert:   '🚨',
    warning: '⚠️',
    info:    'ℹ️',
  };

  const options = {
    body,
    icon: level === 'alert'
      ? 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="%23ff2244" rx="12"/><text y="48" font-size="48" text-anchor="middle" x="32">🚨</text></svg>'
      : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="%23060c14" rx="12"/><text y="48" font-size="48" text-anchor="middle" x="32">🌊</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ff2244"/></svg>',
    vibrate: level === 'alert' ? [300, 100, 300, 100, 300] : [200, 100, 200],
    requireInteraction: level === 'alert',
    tag: 'seismic-' + level,
    renotify: true,
    actions: [
      { action: 'open', title: '気象庁を確認' },
      { action: 'dismiss', title: '閉じる' },
    ],
    data: { url: 'https://www.data.jma.go.jp/multi/quake/index.html?lang=jp' },
  };

  await self.registration.showNotification(title, options);
}

// ── 通知クリック ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    const url = event.notification.data?.url || 'https://www.jma.go.jp/';
    event.waitUntil(clients.openWindow(url));
  }
});

// ── インターバルチェック（setIntervalの代替）──
let checkTimer = null;
function startPeriodicCheck(intervalMinutes) {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(() => {
    checkSeismicActivity();
  }, intervalMinutes * 60 * 1000);
  // 初回チェック
  checkSeismicActivity();
}
