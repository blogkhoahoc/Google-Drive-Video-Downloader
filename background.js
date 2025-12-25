// background.js — attach debugger trên Drive viewer, bắt response 'playback?key',
// gửi body về overlay, và hỗ trợ tải xuống qua chrome.downloads.download.

const PROTOCOL_VERSION = "1.3";
const HAS_PLAYBACK = (u) => (u || "").includes("playback?auditContext");
// Khớp cả 2 dạng URL: /file/d/... và /drive/u/{n}/file/d/...
const IS_DRIVE_VIEWER = (u) =>
  typeof u === "string" &&
  /^https:\/\/drive\.google\.com\/(?:drive\/[^/]+\/)?file\/d\//.test(u);

// ---- per-tab state ---------------------------------------------------------
const tabs = new Map(); // tabId -> { attached:boolean, req:Record<requestId,{url,status}>, events:number }

// Gửi message cho tất cả frame trong tab, nuốt lỗi nếu frame chưa có content script
async function broadcast(tabId, payload) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    await Promise.all(
      (frames || []).map((f) =>
        chrome.tabs
          .sendMessage(tabId, payload, { frameId: f.frameId })
          .catch(() => {})
      )
    );
  } catch {}
}

// Attach debugger cho 1 tab
async function attach(tabId) {
  let st = tabs.get(tabId);
  if (!st) {
    st = { attached: false, req: {}, events: 0 };
    tabs.set(tabId, st);
  }
  if (st.attached) return;

  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
    st.attached = true;
    st.events = 0;

    // Bật Network domain để theo dõi response
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
    // Tắt cache để tránh không đọc được body do cache
    await chrome.debugger.sendCommand(
      { tabId },
      "Network.setCacheDisabled",
      { cacheDisabled: true }
    );

    broadcast(tabId, { type: "DBG_STATUS", message: "Debugger attached" });
  } catch (e) {
    broadcast(tabId, {
      type: "DBG_STATUS",
      message: "Attach failed: " + e.message,
    });
  }
}

// Detach & dọn trạng thái khi đóng tab (hoặc khi bạn muốn tự gọi)
async function detach(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
  tabs.delete(tabId);
  broadcast(tabId, { type: "DBG_STATUS", message: "Debugger detached" });
}

// ---- lifecycle: gắn debugger khi vào trang Drive viewer --------------------
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const url = info.url || tab?.url;
  if (!url) return;
  if (
    (info.status === "loading" || info.status === "complete" || info.url) &&
    IS_DRIVE_VIEWER(url)
  ) {
    await attach(tabId);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const t = await chrome.tabs.get(tabId);
  if (t?.url && IS_DRIVE_VIEWER(t.url)) await attach(tabId);
});

chrome.webNavigation.onCommitted.addListener((d) => {
  if (IS_DRIVE_VIEWER(d.url)) attach(d.tabId);
});
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (IS_DRIVE_VIEWER(d.url)) attach(d.tabId);
});
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
  if (IS_DRIVE_VIEWER(d.url)) attach(d.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => detach(tabId));

// ---- CDP events: gom URL/status và lấy body khi tải xong -------------------
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source.tabId;
  const st = tabs.get(tabId);
  if (!tabId || !st?.attached) return;

  st.events++;
  if (st.events % 50 === 1) {
    broadcast(tabId, { type: "DBG_STATUS", message: `Events: ${st.events}` });
  }

  if (method === "Network.requestWillBeSent") {
    const { requestId, request } = params || {};
    if (requestId && request?.url) st.req[requestId] = { url: request.url, status: null };
  }

  if (method === "Network.responseReceived") {
    const { requestId, response } = params || {};
    const rec = st.req[requestId] || {};
    if (response) rec.status = response.status;
    st.req[requestId] = rec;
  }

  if (method === "Network.loadingFinished") {
    const { requestId } = params || {};
    const rec = st.req[requestId];
    if (!rec?.url || !HAS_PLAYBACK(rec.url)) return;

    let body = "", note = "";
    try {
      const r = await chrome.debugger.sendCommand(
        { tabId },
        "Network.getResponseBody",
        { requestId }
      );
      body = r.base64Encoded ? atob(r.body || "") : (r.body || "");
    } catch (e) {
      note = "Could not read body: " + e.message;
    } finally {
      delete st.req[requestId];
    }

    // Gửi cho overlay để trích Progressive Transcodes
    broadcast(tabId, {
      type: "PLAYBACK_RESPONSE",
      url: rec.url,
      status: rec.status,
      body,
      note,
    });

    // Nếu muốn tắt banner ngay sau khi có dữ liệu, bỏ comment 2 dòng dưới:
    // await chrome.debugger.detach({ tabId }).catch(()=>{});
    // tabs.delete(tabId);
  }
});

// ---- DOWNLOAD HANDLER: nhận lệnh tải từ overlay ---------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "DOWNLOAD_URL" && msg.url) {
    // Bạn có thể đổi tên file mặc định tại đây:
    const filename = msg.filename || "drive-video.mp4";
    const saveAs = msg.saveAs !== false; // mặc định hiện hộp thoại "Save As"

    chrome.downloads.download(
      { url: msg.url, filename, saveAs },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, id: downloadId });
        }
      }
    );
    return true; // giữ kênh mở để sendResponse async
  }
});

