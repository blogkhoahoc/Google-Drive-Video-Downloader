(() => {
  if (window.__playbackOverlay) return;
  window.__playbackOverlay = true;

  /* ===== Root + Shadow ===== */
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", zIndex: 2147483647, right: "12px", bottom: "12px" });
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  /* ===== Styles ===== */
  const css = document.createElement("style");
  css.textContent = `
    :host,*{box-sizing:border-box}

    /* Floating Action Button (FAB) */
    .fab{
      position:fixed; right:12px; bottom:12px;
      width:56px; height:56px; border-radius:50%;
      background:#111827; color:#fff; display:grid; place-items:center;
      cursor:pointer; box-shadow:0 8px 24px rgba(0,0,0,.25);
      user-select:none; border:1px solid #1f2937;
    }
    .fab:hover{ background:#0f172a }
    .fab img{ width:30px; height:30px; pointer-events:none; transition: filter .15s ease; }
    .fab:hover img{ filter: brightness(1.1); }
    .badge{
      position:absolute; top:-6px; right:-6px; min-width:22px; height:22px;
      padding:0 5px; border-radius:11px; background:#16a34a; color:#fff;
      font:700 12px/22px ui-sans-serif,system-ui,Arial; text-align:center;
      box-shadow:0 0 0 2px #0b1220; display:none;
    }

    /* Panel — ngang, thấp, không cuộn nội bộ */
    .wrap{
      position:fixed; right:12px; bottom:12px;
      width:520px;
      border-radius:12px; overflow:hidden;
      display:none;
      box-shadow:0 8px 24px rgba(0,0,0,.25);
      background:#0b1220; color:#d1d5db; border:1px solid #1f2937;
      font:13px/1.4 ui-sans-serif,system-ui,Arial;
    }
    .head{background:#111827;color:#fff;padding:8px 10px;display:flex;align-items:center;gap:8px;user-select:none;cursor:move}
    .title{font-weight:600;flex:1}
    .btn{border:0;background:#374151;color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer}
    .btn:hover{background:#4b5563}
    .body{padding:10px; overflow:visible}
    .group-title{color:#a7f3d0;font-weight:700;margin-bottom:8px}

    /* One-line grid (3 columns) */
    .grid{
      display:grid;
      grid-template-columns: repeat(3, 1fr);
      gap:8px;
      align-items:stretch;
    }
    .card{
      background:#0f172a;
      border:1px solid #1f2937;
      border-radius:10px;
      padding:8px;
      text-align:center;
      display:flex;
      flex-direction:column;
      justify-content:center;
      gap:6px;
      min-height:80px;
    }
    .qlabel{
      font-weight:900; letter-spacing:.2px; color:#c7d2fe; font-size:15px;
    }
    .actions{ display:flex; justify-content:center; gap:8px; }
    .qbtn{border:0;background:#065f46;color:#fff;padding:6px 12px;border-radius:8px;cursor:pointer}
    .qbtn:hover{background:#047857}
    .qbtn.outline{background:#1f2937}
    .qbtn.outline:hover{background:#374151}

    .footer{
      background:#0f172a; color:#9ca3af; padding:6px 8px; font-size:12px;
      display:flex; justify-content:space-between; align-items:center;
      border-top:1px solid #1f2937;
    }
    .footer a{ color:#93c5fd; text-decoration:underline }
    .footer a:hover{ color:#bfdbfe }

    /* Toast "Đã copy" */
    .toast{
      position:fixed; right:12px; bottom:80px;   /* nằm trên FAB/panel */
      background:#16a34a; color:#fff;
      padding:8px 12px; border-radius:8px;
      box-shadow:0 8px 24px rgba(0,0,0,.25);
      font:600 12px/1 ui-sans-serif,system-ui,Arial;
      opacity:0; transform:translateY(6px);
      pointer-events:none;
      transition:opacity .2s ease, transform .2s ease;
      z-index:2147483647;
    }
    .toast.show{ opacity:1; transform:translateY(0); }
  `;
  shadow.appendChild(css);

  /* ===== FAB ===== */
  const fab = document.createElement("div");
  fab.className = "fab";
  const fabIconUrl = chrome.runtime.getURL("icons/fab.png");
  fab.innerHTML = `<img src="${fabIconUrl}" alt="open" class="fab-icon" /><span class="badge" id="badge"></span>`;
  shadow.appendChild(fab);
  const badgeEl = fab.querySelector("#badge");

  /* ===== Panel ===== */
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <div class="head">
      <div class="title">Progressive Transcodes</div>
      <button id="hide" class="btn">Hide</button>
      <button id="clr" class="btn">Clear</button>
    </div>
    <div class="body">
      <div class="group-title">Links</div>
      <div id="rows" class="grid"></div>
      <div id="empty" style="margin-top:6px;color:#9ca3af">Chưa có dữ liệu. Hãy phát video để lấy link.</div>
    </div>
    <div class="footer">
      <div>Bản quyền thuộc về: <a href="https://fb.com/adminbkh" target="_blank" rel="noopener">fb.com/adminbkh</a></div>
      <div id="stat">—</div>
    </div>
  `;
  shadow.appendChild(wrap);

  const rowsEl = wrap.querySelector("#rows");
  const emptyEl = wrap.querySelector("#empty");
  const hideBtn = wrap.querySelector("#hide");
  const clrBtn  = wrap.querySelector("#clr");
  const statEl  = wrap.querySelector("#stat");

  // Toast
  const toast = document.createElement('div');
  toast.className = 'toast';
  shadow.appendChild(toast);
  let toastTimer = null;
  function showToast(text = 'Đã copy', ms = 3000){
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  }

  // Toggle panel
  function showPanel(){ wrap.style.display = "block"; fab.style.display = "none"; }
  function hidePanel(){ wrap.style.display = "none"; fab.style.display = "grid"; }
  fab.onclick = showPanel;
  hideBtn.onclick = hidePanel;

  // Clear list
  clrBtn.onclick = () => {
    rowsEl.innerHTML = "";
    emptyEl.style.display = "";
    badgeEl.style.display = "none";
  };

  // Drag panel
  (() => {
    let dragging=false,sx=0,sy=0,rx=0,ry=0;
    const head = wrap.querySelector(".head");
    head.addEventListener("mousedown", e => {
      dragging=true; sx=e.clientX; sy=e.clientY;
      const r=wrap.getBoundingClientRect(); rx=r.right; ry=r.bottom; e.preventDefault();
    });
    window.addEventListener("mousemove", e=>{
      if(!dragging) return;
      const dx=e.clientX-sx, dy=e.clientY-sy;
      const right = Math.max(0, window.innerWidth - (rx + dx));
      const bottom= Math.max(0, window.innerHeight - (ry + dy));
      wrap.style.right = right + "px";
      wrap.style.bottom= bottom + "px";
      fab.style.right  = (right + 8) + "px";
      fab.style.bottom = (bottom + 8) + "px";
    });
    window.addEventListener("mouseup", ()=> dragging=false);
  })();

  /* ===== Extract + Render ===== */
  const ITAG_QUALITY = { 18:"360p", 22:"720p", 37:"1080p" };
  const parseJsonSafe = (t)=>{ try{ return JSON.parse(String(t)); }catch{ return null; } };

  function extractProgressiveTranscodes(txt){
    const obj = parseJsonSafe(txt); if (!obj) return {};
    let pt = obj?.formatStreamingData?.progressiveTranscodes;
    if (!pt) {
      (function walk(o,d=0){ if(pt||!o||d>6)return;
        if(Array.isArray(o)) return o.forEach(x=>walk(x,d+1));
        if(typeof o==="object"){
          if(Array.isArray(o.progressiveTranscodes)){ pt = o.progressiveTranscodes; return; }
          for(const k in o) walk(o[k],d+1);
        }
      })(obj);
    }
    if (!Array.isArray(pt)) return {};

    const urls = {};
    for (const it of pt) {
      const url = it?.url || it?.redirector || ""; if (!url) continue;
      let q = it?.qualityLabel || ITAG_QUALITY[it?.itag] || ITAG_QUALITY[Number(it?.itag)];
      if (!q) continue;
      q = String(q).toLowerCase();
      if (q.includes("360")) q="360p";
      else if (q.includes("720")) q="720p";
      else if (q.includes("1080")) q="1080p";
      else continue;
      if (!urls[q]) urls[q] = url;
    }
    return urls;
  }

  function renderLinks(urlsByQ){
    rowsEl.innerHTML = "";
    const qualities = ["360p","720p","1080p"].filter(q => urlsByQ[q]);
    if (qualities.length === 0) {
      emptyEl.style.display = "";
      badgeEl.style.display = "none";
      return;
    }
    emptyEl.style.display = "none";

    const frag = document.createDocumentFragment();
    for (const q of qualities){
      const u = urlsByQ[q];

      const card = document.createElement("div");
      card.className = "card";

      const label = document.createElement("div");
      label.className = "qlabel";
      label.textContent = q.toUpperCase();

      const actions = document.createElement("div");
      actions.className = "actions";

      const dlBtn = document.createElement("button");
      dlBtn.className = "qbtn";
      dlBtn.textContent = "Download";
      dlBtn.onclick = () =>
        chrome.runtime.sendMessage(
          { type: "DOWNLOAD_URL", url: u, filename: `drive-${q}.mp4`, saveAs: true },
          (res) => { if (res && !res.ok && res.error) alert("Tải xuống thất bại: " + res.error); }
        );

      const copyBtn = document.createElement("button");
      copyBtn.className = "qbtn outline";
      copyBtn.textContent = "Copy";
      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(u); showToast("Đã copy"); }
        catch { showToast("Không copy được", 3000); }
      };

      actions.append(dlBtn, copyBtn);
      card.append(label, actions);
      frag.append(card);
    }
    rowsEl.append(frag);

    // Badge trên FAB = số chất lượng sẵn có
    badgeEl.textContent = String(qualities.length);
    badgeEl.style.display = "block";
  }

  /* ===== Receive messages from background ===== */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "PLAYBACK_RESPONSE") {
      const urls = extractProgressiveTranscodes(msg.body || "");
      renderLinks(urls);
    }
    if (msg?.type === "DBG_STATUS") {
      statEl.textContent = msg.message; // ví dụ: Events: 1
    }
  });

  try { console.debug("[Overlay] one-line cards + FAB icon + toast loaded"); } catch {}
})();
