const state = { catalog: { version: 2, settings: {}, channels: [], genres: [], videos: [] }, toastTimer: null, timelines: new Map(), playback: null, editing: null, scanning: false };
const Schedule = USBTvSchedule;
const CUSTOMS_CHANNEL = "Interdimensional Customs";
function assignableChannelNames() { return channelNames().filter(name=>name !== CUSTOMS_CHANNEL); }
const broadcastState = {channels:{}, revision:0, ready:false};
let broadcastQueue = Promise.resolve();
function persistBroadcasts(channels) {
  const snapshot = JSON.stringify(channels);
  const task = broadcastQueue.catch(() => {}).then(async () => {
    const response = await apiFetch('/api/broadcasts', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({revision:broadcastState.revision,channels:JSON.parse(snapshot)})});
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) {
        const fresh = await apiFetch('/api/broadcasts', {cache:'no-store'});
        const saved = await fresh.json();
        broadcastState.channels = saved.channels; broadcastState.revision = saved.revision;
        invalidateSchedule(); renderGuide(); renderChannels();
      }
      throw new Error(result.error || 'Could not save channel ordering.');
    }
    broadcastState.revision = result.revision;
  });
  broadcastQueue = task;
  return task;
}
function reconcileBroadcasts() {
  if (!broadcastState.ready) return;
  const updated = USBTvPlans.reconcile(state.catalog,broadcastState.channels);
  if (JSON.stringify(updated) !== JSON.stringify(broadcastState.channels)) {
    broadcastState.channels = updated;
    persistBroadcasts(updated).catch(error => showToast(error.message));
  }
}
const guidePreview = {channel:null, key:null, loaded:false, failed:false, blocked:false};
const directFile = location.protocol === "file:";
async function apiFetch(path, options) {
  if (directFile) throw new Error("Open USB.tv using its launcher to load and save your library.");
  try { return await fetch(path, options); }
  catch (error) {
    if (error instanceof TypeError) throw new Error("Cannot reach USB.tv’s local server. Restart the launcher and use the page it opens; keep its terminal running.");
    throw error;
  }
}
const palette = ["#c7f36b", "#69b9ff", "#ff6f91", "#bc9bff", "#ffc56f", "#70e0c0"];

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const videoUrl = (file) => "/" + file.split("/").map(encodeURIComponent).join("/");

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds} SEC`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}` : `${minutes} MIN`;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
}

function updateClock() {
  const now = new Date();
  $("#clock").textContent = formatTime(now);
  $("#guide-date").textContent = now.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

async function loadCatalog() {
  const [response, broadcasts] = await Promise.all([
    apiFetch("/api/catalog", { cache: "no-store" }), apiFetch('/api/broadcasts', {cache:'no-store'})
  ]);
  if (!response.ok) throw new Error("USB.tv could not read catalog.json");
  state.catalog = await response.json();
  if (broadcasts.ok) {
    const saved = await broadcasts.json();
    Object.assign(broadcastState,{channels:saved.channels,revision:saved.revision,ready:true});
  } else {
    broadcastState.ready = false;
    const notice = $('#server-notice');
    notice.querySelector('strong').textContent = 'Restart USB.tv to enable saved channel ordering';
    notice.querySelector('p').textContent = 'Your library is available, but the running server needs an update. Close its terminal and open USB.tv using the launcher, then use the new browser page it opens.';
    notice.hidden = false;
  }
  applyThemeSetting();
  renderAll();
  if (!broadcasts.ok && broadcasts.status !== 404) throw new Error('Could not read saved channel ordering. Your library is still available; check broadcasts.json before reshuffling.');
}

// Serialize writes so rapid theme/metadata edits cannot overwrite each other out of order.
let saveQueue = Promise.resolve();
function saveCatalog() {
  const snapshot = JSON.stringify(state.catalog);
  const task = saveQueue.catch(() => {}).then(async () => {
    $("#save-status").textContent = "SAVING…";
    const response = await apiFetch("/api/catalog", {method:"POST", headers:{"Content-Type":"application/json"}, body:snapshot});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Save failed");
    $("#save-status").textContent = "SAVED TO USB";
    return data;
  });
  saveQueue = task;
  return task.catch(error => {
    $("#save-status").textContent = "SAVE FAILED";
    showToast(error.message);
    throw error;
  });
}

function setPage(pageName) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.page === pageName));
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === `page-${pageName}`));
  syncGuidePreview();
}

let cinemaHideTimer = null, cinemaNative = false;
function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
function videoFillsScreen() { return $("#player-dialog").classList.contains("video-fills-screen"); }
function updateFullscreenButtons() {
  const active = Boolean(fullscreenElement()) || videoFillsScreen();
  $("#fullscreen-toggle").setAttribute("aria-pressed",String(active));
  $("#fullscreen-toggle span").textContent = active ? "EXIT FULL" : "FULL SCREEN";
  const label = active ? "Exit fullscreen" : state.catalog.settings?.fullscreen_mode === "app" ? "Fullscreen app" : "Fullscreen video";
  $("#video-fullscreen").title = label;
  $("#video-fullscreen").setAttribute("aria-label",label);
}
function revealPlayerControls() {
  const dialog = $("#player-dialog");
  dialog.classList.add("controls-visible");
  clearTimeout(cinemaHideTimer);
  if (videoFillsScreen()) cinemaHideTimer = setTimeout(()=>{
    if (!$("#quick-label-panel").hidden || dialog.querySelector('.player-top:hover,.playback-controls:hover') || dialog.querySelector('input:focus')) return;
    dialog.classList.remove("controls-visible");
  },2500);
}
async function exitAppFullscreen() {
  $("#player-dialog").classList.remove("video-fills-screen","controls-visible");
  clearTimeout(cinemaHideTimer); cinemaNative = false;
  if (fullscreenElement()) {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } catch (_) {}
  }
  updateFullscreenButtons();
}
async function toggleFullscreen() {
  if (fullscreenElement() || videoFillsScreen()) {await exitAppFullscreen();return;}
  const immersive = $("#player-dialog").open && state.catalog.settings?.fullscreen_mode !== "app";
  // Fill the viewport independently of browser fullscreen support. Always keep
  // the HTML player (and tuning overlays) rather than the native video surface.
  $("#player-dialog").classList.toggle("video-fills-screen",immersive);
  revealPlayerControls(); updateFullscreenButtons();
  try {
    const target = document.documentElement;
    if (target.requestFullscreen) await target.requestFullscreen({navigationUI:"hide"});
    else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
    else if (!immersive) showToast("Browser fullscreen unavailable; use your browser's fullscreen command.");
    cinemaNative = Boolean(fullscreenElement());
  } catch (_) {
    if (!immersive) showToast("Use your browser's fullscreen command to expand the app.");
  }
  updateFullscreenButtons();
}
function fullscreenChanged() {
  if (fullscreenElement()) cinemaNative = true;
  else if (cinemaNative) {
    cinemaNative = false;
    $("#player-dialog").classList.remove("video-fills-screen","controls-visible");
  }
  updateFullscreenButtons();
}
for (const name of ["fullscreenchange","webkitfullscreenchange"]) document.addEventListener(name,fullscreenChanged);
for (const name of ["pointermove","pointerdown","focusin"]) $("#player-dialog").addEventListener(name,revealPlayerControls);
window.addEventListener("keydown",event=>{
  if (event.key === "Escape" && videoFillsScreen() && $("#quick-label-panel").hidden) {
    event.preventDefault();event.stopImmediatePropagation();exitAppFullscreen();
  } else if (videoFillsScreen()) revealPlayerControls();
},true);
function updatePlaybackControls() {
  const player = $("#player");
  $("#playback-toggle").textContent = player.paused ? "PLAY" : "PAUSE";
  $("#playback-mute").textContent = player.muted ? "UNMUTE" : "MUTE";
  $("#playback-mute").setAttribute("aria-label",player.muted ? "Unmute audio" : "Mute audio");
  $("#playback-volume").value = player.volume;
  $("#playback-time").textContent = `${stamp(player.currentTime || 0)} / ${Number.isFinite(player.duration) ? stamp(player.duration) : "—"}`;
  const preview = state.playback?.mode === "preview";
  $("#preview-seek-label").hidden = !preview;
  $("#preview-seek").max = Number.isFinite(player.duration) ? player.duration : 1;
  $("#preview-seek").value = player.currentTime || 0;
}
$("#playback-toggle").addEventListener("click",()=>{
  const player = $("#player");
  if (player.paused) player.play().catch(()=>showToast("Unable to start this video"));else player.pause();
});
$("#playback-mute").addEventListener("click",()=>{$("#player").muted=!$("#player").muted;});
$("#playback-volume").addEventListener("input",event=>{const player=$("#player");player.volume=Number(event.target.value);player.muted=false;});
$("#preview-seek").addEventListener("input",event=>{if(state.playback?.mode === "preview") $("#player").currentTime=Number(event.target.value);});
for (const name of ["play","pause","timeupdate","loadedmetadata","volumechange","emptied"]) $("#player").addEventListener(name,updatePlaybackControls);

function applyCrtSetting() {
  const enabled = Boolean(state.catalog.settings?.crt);
  document.body.classList.toggle("crt-on", enabled);
  $("#crt-toggle").setAttribute("aria-pressed", String(enabled));
}

function applyThemeSetting() {
  const themes = ["satellite", "teletext", "goblin"];
  const theme = themes.includes(state.catalog.settings?.theme) ? state.catalog.settings.theme : "satellite";
  document.body.dataset.theme = theme;
  document.querySelectorAll('input[name="fullscreen-mode"]').forEach(input=>{input.checked=input.value === (state.catalog.settings?.fullscreen_mode || "video");});
  updateFullscreenButtons();
  document.querySelectorAll('input[name="theme"]').forEach((input) => { input.checked = input.value === theme; });
  const goblin = theme === "goblin";
  $(".brand-name").textContent = goblin ? "GOBLIN CABLE" : theme === "teletext" ? "USB TEXT" : "USB.tv";
  $(".brand-tag").textContent = goblin ? "BROADCASTING UNDER THE FLOORBOARDS" : theme === "teletext" ? "P100 · YOUR PERSONAL BROADCAST" : "YOUR PERSONAL BROADCAST";
  $("#page-guide h1").textContent = goblin ? "Tonight on Goblin Cable" : theme === "teletext" ? "100 TV GUIDE" : "The channel guide";
  $("#page-guide .subheading").textContent = goblin ? "A hoard of good tapes. A slightly suspicious signal." : "A shuffled rotation, tuned to your collection.";
  document.querySelector('meta[name="theme-color"]').content = { satellite: "#09236c", teletext: "#080808", goblin: "#141a16" }[theme];
}

function displayTitle(video) { return video.title?.trim() || `Untitled ${video.type === "advert" ? "advert" : "programme"} #${video.id}`; }
function activeMedia() { return state.catalog.videos.filter(video => !video.missing); }
function channelNames() { return [...new Set((state.catalog.channels || []).map(channel => channel.name))].sort((a,b) => a.localeCompare(b)); }
function invalidateSchedule() { state.timelines.clear(); }
function timeline(channel) {
  if (!state.timelines.has(channel)) state.timelines.set(channel, Schedule.build({...state.catalog,broadcasts:broadcastState.channels}, channel));
  return state.timelines.get(channel);
}
function reviewReasons(video) {
  return [!video.title?.trim() && "Needs title", !(video.duration > 0) && "Unreadable length / codec", video.type !== "advert" && !video.channels?.length && "Choose channels", !video.genres?.length && "Choose genres", video.duplicate_of && `Duplicate of #${video.duplicate_of}`, video.missing && "Missing file"].filter(Boolean);
}
function guideMinutes() {
  const value = Number(state.catalog.settings?.guide_minutes ?? 120);
  return Number.isFinite(value) ? Math.max(30, Math.min(240, Math.round(value / 30) * 30)) : 120;
}
// Absolute browsing time stays put as the clock advances; null follows live TV.
const guideNavigation = {start:null, channel:null, time:null, kind:"programme"};
function liveGuideStart() { return Math.floor(Date.now() / 1800000) * 1800000; }
function applyAdvancedMode() {
  const enabled = Boolean(state.catalog.settings?.advanced_mode);
  $("#advanced-toggle").setAttribute("aria-pressed", String(enabled));
  $("#advanced-toggle").title = enabled ? "Hide advanced controls" : "Show advanced controls";
  document.querySelectorAll("[data-advanced]").forEach(panel => { panel.hidden = !enabled; });
}
function renderGuide() {
  applyAdvancedMode();
  const now = Date.now();
  const minutes = guideMinutes(), horizon = minutes * 60;
  if (guideNavigation.start !== null && guideNavigation.start <= liveGuideStart()) guideNavigation.start = null;
  const guideStart = guideNavigation.start ?? liveGuideStart();
  const guideEnd = guideStart + horizon * 1000;
  const gridHadFocus = $("#guide-rows").contains(document.activeElement);
  $("#guide-earlier").disabled = guideNavigation.start === null;
  $("#guide-now").setAttribute("aria-pressed", String(guideNavigation.start === null));
  $("#guide-window-label").textContent = `${new Date(guideStart).toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"})} · ${formatTime(new Date(guideStart))}–${formatTime(new Date(guideEnd))}${guideNavigation.start === null ? " · LIVE" : " · BROWSING"}`;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  const spanLabel = [hours && `${hours} ${hours === 1 ? "hour" : "hours"}`, remainder && `${remainder} minutes`].filter(Boolean).join(" ");
  $("#guide-span").value = minutes;
  $("#guide-span").setAttribute("aria-valuetext", spanLabel);
  $("#guide-span-value").textContent = spanLabel;
  const focusedKey = document.activeElement?.closest("#guide-rows [data-guide-key]")?.dataset.guideKey;
  const names = playableChannels();
  $("#guide-empty").classList.toggle("hidden", names.length > 0);
  $("#guide-rows").classList.toggle("hidden", names.length === 0);
  const halfHours = minutes / 30;
  const maxLabels = Math.max(2, Math.floor($("#time-ruler").clientWidth / 65));
  const labelStep = Math.max(1, Math.ceil(halfHours / (maxLabels - 1)));
  const ticks = Array.from({length:halfHours+1}, (_,n) => n).filter(n => n % labelStep === 0 || n === halfHours);
  if (ticks.length > 2 && halfHours - ticks.at(-2) < labelStep) ticks.splice(-2,1);
  $("#time-ruler").innerHTML = ticks.map(n => `<span style="left:${n / halfHours * 100}%">${formatTime(new Date(guideStart + n * 1800000))}</span>`).join("");
  $("#guide-rows").innerHTML = names.map((channel, index) => {
    const slots = Schedule.guide(timeline(channel), guideStart, horizon);
    const color = palette[index % palette.length];
    const programmes = slots.map(slot => {
      slot.current = slot.start <= now && slot.end > now;
      slot.progress = slot.current ? (now - slot.start) / (slot.end - slot.start) : 0;
      const width = (Math.min(slot.end, guideEnd) - Math.max(slot.start, guideStart)) / (horizon * 1000) * 100;
      return `<button class="programme ${slot.current ? "current" : "next"} ${width < 12 ? "compact" : ""}" style="width:${width}%;--progress:${Math.round(slot.progress*100)}%" data-channel="${esc(channel)}" data-start="${slot.start}" data-end="${slot.end}" data-guide-key="${esc(JSON.stringify([channel,slot.video.id,slot.start]))}" data-programme-title="${esc(displayTitle(slot.video))}" data-programme-time="${formatTime(new Date(slot.start))}–${formatTime(new Date(slot.end))}" title="${esc(displayTitle(slot.video))} · ${formatTime(new Date(slot.start))}–${formatTime(new Date(slot.end))} · Tune into ${esc(channel)}"><span class="programme-tag">${slot.current ? "ON NOW" : esc((slot.video.genres || []).join(" / ").toUpperCase())}</span><span class="programme-title"><span class="programme-title-text">${esc(displayTitle(slot.video))}</span></span><span class="programme-time">${formatTime(new Date(slot.start))} — ${formatTime(new Date(slot.end))}</span></button>`;
    }).join("");
    return `<div class="guide-row"><button class="channel-card" data-channel="${esc(channel)}" aria-label="Tune into ${esc(channel)}"><span class="channel-number">${String(index + 1).padStart(3,"0")}</span><span class="channel-logo" style="color:${color};background:${color}18">${esc(channel.slice(0,1).toUpperCase())}</span><span class="channel-info"><span class="channel-name">${esc(channel)}</span><span class="channel-meta">TUNE IN LIVE</span></span></button><div class="schedule-track">${programmes}</div></div>`;
  }).join("");
  $("#guide-rows").querySelectorAll("[data-channel]").forEach(button => {
    button.addEventListener("click", () => tuneChannel(button.dataset.channel));
    button.addEventListener("pointerenter", () => selectGuideChannel(button.dataset.channel));
    button.addEventListener("focus", () => selectGuideChannel(button.dataset.channel));
  });
  const preferred = guideTarget(guideNavigation.channel || guidePreview.channel, guideNavigation.time ?? now, guideNavigation.kind);
  $("#guide-rows").querySelectorAll("[data-channel]").forEach(button => { button.tabIndex = button === preferred ? 0 : -1; });
  if (gridHadFocus) {
    const restored = focusedKey && [...$("#guide-rows").querySelectorAll("[data-guide-key]")].find(button => button.dataset.guideKey === focusedKey);
    (restored || preferred)?.focus({preventScroll:true});
  }
  if (!names.includes(guidePreview.channel)) selectGuideChannel(names[0] || null);
  else { markGuideSelection(); syncGuidePreview(); }
}
function guideRows() { return [...$("#guide-rows").querySelectorAll(".guide-row")]; }
function programmeAt(row, time) {
  const buttons = [...row.querySelectorAll(".programme")];
  return buttons.find(button => Number(button.dataset.start) <= time && Number(button.dataset.end) > time)
    || buttons.reduce((best, button) => !best || Math.abs(Number(button.dataset.start) - time) < Math.abs(Number(best.dataset.start) - time) ? button : best, null);
}
function guideTarget(channel, time, kind = "programme") {
  const rows = guideRows();
  const row = rows.find(row => row.querySelector(".channel-card").dataset.channel === channel) || rows[0];
  return row ? (kind === "channel" ? row.querySelector(".channel-card") : programmeAt(row,time)) : null;
}
function focusGuide(button, time = null) {
  if (!button) return false;
  guideNavigation.channel = button.dataset.channel;
  guideNavigation.kind = button.classList.contains("channel-card") ? "channel" : "programme";
  if (time !== null) guideNavigation.time = time;
  $("#guide-rows").querySelectorAll("[data-channel]").forEach(item => { item.tabIndex = item === button ? 0 : -1; });
  button.focus({preventScroll:true});
  button.scrollIntoView({block:"nearest",inline:"nearest",behavior:"auto"});
  return true;
}
function browseGuide(minutes) {
  const next = Math.max(liveGuideStart(), (guideNavigation.start ?? liveGuideStart()) + minutes * 60000);
  guideNavigation.start = next === liveGuideStart() ? null : next;
  guideNavigation.time = next;
  renderGuide();
}
function guideInput(action) {
  if (!$("#page-guide").classList.contains("active") || document.querySelector("dialog[open]") || $("#page-guide").closest("[inert]")) return false;
  const rows = guideRows();
  if (!rows.length) return false;
  let button = document.activeElement?.closest("#guide-rows [data-channel]");
  if (action === "live") {
    guideNavigation.start = null; guideNavigation.time = Date.now();
    renderGuide();
    return focusGuide(guideTarget(guideNavigation.channel, guideNavigation.time), guideNavigation.time);
  }
  if (!button) {
    button = guideTarget(guideNavigation.channel || guidePreview.channel, guideNavigation.time ?? Date.now(), guideNavigation.kind);
    if (action !== "select") return focusGuide(button, guideNavigation.time ?? Date.now());
  }
  if (action === "select") { tuneChannel(button.dataset.channel); return true; }
  const row = button.closest(".guide-row");
  const rowIndex = rows.indexOf(row);
  const isChannel = button.classList.contains("channel-card");
  const time = guideNavigation.time ?? Math.max(Number(button.dataset.start) || Date.now(), guideNavigation.start ?? liveGuideStart());
  if (action === "up" || action === "down") {
    const targetRow = rows[Math.max(0, Math.min(rows.length-1,rowIndex + (action === "up" ? -1 : 1)))];
    return focusGuide(isChannel ? targetRow.querySelector(".channel-card") : programmeAt(targetRow,time),time);
  }
  if (action !== "left" && action !== "right") return false;
  if (isChannel) return action === "right" ? focusGuide(programmeAt(row,time),time) : true;
  const line = timeline(button.dataset.channel);
  const targetTime = action === "right" ? Number(button.dataset.end) + 1 : Number(button.dataset.start) - 1;
  if (targetTime < liveGuideStart()) return focusGuide(row.querySelector(".channel-card"),time);
  const slot = Schedule.locate(line,targetTime);
  if (!slot) return false;
  const windowStart = guideNavigation.start ?? liveGuideStart();
  const windowEnd = windowStart + guideMinutes() * 60000;
  if (targetTime < windowStart || targetTime >= windowEnd) {
    const next = Math.max(liveGuideStart(),Math.floor(targetTime / 1800000) * 1800000);
    guideNavigation.start = next === liveGuideStart() ? null : next;
    guideNavigation.time = targetTime;
    renderGuide();
  }
  return focusGuide(guideTarget(button.dataset.channel,targetTime),targetTime);
}
// Remote adapters can call the same small action API as the keyboard.
window.USBTvGuideInput = Object.freeze({dispatch:guideInput});
function markGuideSelection() {
  $("#guide-rows").querySelectorAll(".guide-row").forEach(row => {
    row.classList.toggle("preview-selected", row.querySelector("[data-channel]")?.dataset.channel === guidePreview.channel);
  });
}
function selectGuideChannel(channel) {
  if (guidePreview.channel !== channel) {
    Object.assign(guidePreview, {channel, key:null, loaded:false, failed:false, blocked:false});
    $("#preview-message").hidden = true;
    $("#preview-play").hidden = true;
  }
  markGuideSelection(); syncGuidePreview();
}
function syncGuidePreview() {
  const player = $("#guide-preview-video");
  const current = guidePreview.channel ? Schedule.locate(timeline(guidePreview.channel)) : null;
  $("#channel-preview").classList.toggle("hidden", !current);
  if (!current) {
    player.onloadedmetadata = null;
    if (player.hasAttribute("src")) { player.pause(); player.removeAttribute("src"); player.load(); }
    guidePreview.key = null;
    return;
  }
  const visible = $("#page-guide").classList.contains("active") && !document.hidden && !$("#player-dialog").open;
  if (!visible) { player.pause(); return; }
  const video = current.segment.video;
  $("#preview-channel").textContent = `${guidePreview.channel} · ${current.segment.advert ? "ADVERTISEMENT BREAK" : "ON AIR"}`;
  $("#preview-title").textContent = displayTitle(video);
  $("#preview-description").textContent = current.segment.advert ? `Advert break during ${displayTitle(current.block.video)}.` : video.description || "Now showing on your personal broadcast.";
  $("#preview-meta").textContent = `${formatTime(new Date(current.start))}–${formatTime(new Date(current.end))} · ${(video.genres || []).join(" / ") || "Uncategorised"}`;
  const key = `${guidePreview.channel}:${current.key}`;
  if (guidePreview.key !== key) {
    Object.assign(guidePreview, {key, loaded:false, failed:false, blocked:false});
    $("#preview-message").hidden = true; $("#preview-play").hidden = true;
    player.onloadedmetadata = () => {
      if (guidePreview.key !== key) return;
      guidePreview.loaded = true;
      syncGuidePreview();
    };
    player.muted = true;
    player.src = videoUrl(video.file); player.load();
  } else if (guidePreview.loaded && !guidePreview.failed) {
    if (player.paused || Math.abs(player.currentTime - current.position) > 3) seekToLive(current.position, player);
    if (player.paused && !guidePreview.blocked) {
      player.play().catch(() => {
        if (guidePreview.key !== key || !$("#page-guide").classList.contains("active") || document.hidden || $("#player-dialog").open) return;
        guidePreview.blocked = true; $("#preview-play").hidden = false;
      });
    }
  }
}
const libraryView = {page:0}, bulkView = {page:0};
const unassigned = video => video.type !== "advert" && !video.channels?.length;
function searchMedia(video, text) {
  const haystack = [video.id,video.file,video.title,video.description,...(video.tags||[]),...(video.genres||[]),...(video.channels||[])].join(" ").toLocaleLowerCase();
  return text.trim().toLocaleLowerCase().split(/\s+/).every(word => haystack.includes(word));
}
function labelFilters(prefix) {
  for (const [field,values] of [["channel",channelNames()],["genre",state.catalog.genres || []]]) {
    const select = $("#"+prefix+"-"+field), previous = select.value;
    select.innerHTML = `<option value="">All ${field}s</option>` + values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("");
    if (values.includes(previous)) select.value = previous;
  }
}
function filteredLibrary() {
  const filter = $("#library-filter").value;
  return state.catalog.videos.filter(video => (filter === "missing" ? video.missing : !video.missing &&
    (filter === "all" || filter === "review" && reviewReasons(video).length || filter === "unassigned" && unassigned(video) || video.type === filter)) &&
    searchMedia(video,$("#library-search").value) && (!$("#library-channel").value || ($("#library-channel").value === CUSTOMS_CHANNEL ? unassigned(video) : video.channels?.includes($("#library-channel").value))) &&
    (!$("#library-genre").value || video.genres?.includes($("#library-genre").value)));
}
function pageItems(items, prefix, view) {
  const size = Number($("#"+prefix+"-page-size").value), pages = Math.max(1,Math.ceil(items.length/size));
  view.page = Math.max(0,Math.min(view.page,pages-1));
  $("#"+prefix+"-prev").disabled = view.page === 0;
  $("#"+prefix+"-next").disabled = view.page >= pages-1;
  $("#"+prefix+"-page-info").textContent = `${items.length ? view.page*size+1 : 0}–${Math.min(items.length,(view.page+1)*size)} of ${items.length} · Page ${view.page+1}/${pages}`;
  return items.slice(view.page*size,(view.page+1)*size);
}
function renderLibrary() {
  labelFilters("library");
  const all = state.catalog.videos, matches = filteredLibrary();
  const videos = pageItems(matches,"library",libraryView);
  $("#library-count").textContent = `${activeMedia().length} MEDIA FILES`;
  $("#review-count").textContent = `${activeMedia().filter(unassigned).length} unassigned · ${activeMedia().filter(video => reviewReasons(video).length).length} need review`;
  $("#library-empty").classList.toggle("hidden", all.length > 0);
  $(".table-wrap").classList.toggle("hidden", videos.length === 0);
  $("#read-page-lengths").disabled = !videos.some(video=>!video.missing && !(video.duration>0));
  $("#library-body").innerHTML = videos.map(video => `<tr><td><span class="media-id">#${esc(video.id)}</span><div class="library-title">${esc(displayTitle(video))}</div><div class="bulk-file">${esc(video.file)}</div></td><td>${video.type === "advert" ? "Advert" : "Programme"}${video.enabled === false ? " · Disabled" : ""}</td><td class="duration-cell">${formatDuration(video.duration)}</td><td>${esc((video.genres || []).join(", ") || "—")}</td><td>${esc(video.channels?.join(", ") || (video.type === "advert" ? "All channels" : "No channels"))}<span class="review-label">${esc(reviewReasons(video).join(" · "))}</span></td><td><button class="media-edit" data-edit="${esc(video.id)}">EDIT</button></td></tr>`).join("");
  $("#library-body").querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => openEditor(button.dataset.edit)));
}
function renderChannels() {
  $("#channel-settings").innerHTML = channelNames().map(name => {
    const channel = state.catalog.channels.find(item => item.name === name);
    if (name === CUSTOMS_CHANNEL) return `<div class="channel-setting"><strong>${esc(name)}</strong><span class="channel-lineup-status">Automatic queue of unassigned programmes. Assigned videos leave after the current showing. No adverts.</span></div>`;
    const pending = Object.hasOwn(broadcastState.channels,name) ? broadcastState.channels[name]?.pending : null;
    const status = pending ? `Updated lineup starts ${new Date(pending.anchor).toLocaleString([], {weekday:'short',hour:'2-digit',minute:'2-digit'})}` : 'Current lineup repeats until you change it.';
    return `<div class="channel-setting"><strong>${esc(name)}</strong><label>Approx. interval (min)<input type="number" min="1" max="120" step="1" data-channel="${esc(name)}" data-setting="ad_interval" value="${Number(channel.ad_interval ?? state.catalog.settings.ad_interval ?? 900)/60}"></label><label>Break length (sec)<input type="number" min="0" max="600" step="1" data-channel="${esc(name)}" data-setting="ad_length" value="${Number(channel.ad_length ?? state.catalog.settings.ad_length ?? 90)}"></label><button type="button" class="media-edit" data-reshuffle="${esc(name)}">RESHUFFLE NOW</button><span class="channel-lineup-status">${esc(status)}</span></div>`;
  }).join("") || '<p>Add a channel, then assign programmes to it in the editor.</p>';
  $("#channel-settings").querySelectorAll("input").forEach(input => input.addEventListener("change", async () => {
    if (!input.checkValidity()) { input.reportValidity(); return; }
    const channel = state.catalog.channels.find(item => item.name === input.dataset.channel);
    channel[input.dataset.setting] = Number(input.value) * (input.dataset.setting === "ad_interval" ? 60 : 1);
    try { state.catalog = await saveCatalog(); renderAll(); } catch (_) {}
  }));
  $("#channel-settings").querySelectorAll('[data-reshuffle]').forEach(button => {
    button.disabled = !broadcastState.ready;
    button.addEventListener('click', async () => {
    if (state.scanning) { showToast('Wait for the scan to finish before reshuffling.'); return; }
    button.disabled = true;
    try {
      await saveQueue.catch(() => {}); await broadcastQueue.catch(() => {});
      const updated = USBTvPlans.reshuffle(state.catalog,broadcastState.channels,button.dataset.reshuffle);
      await persistBroadcasts(updated);
      broadcastState.channels = updated;
      renderAll(); syncChannel(true); syncGuidePreview();
      showToast('Channel reshuffled and restarted. New assignments are included.');
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; }
    });
  });
}
function renderAll() { reconcileBroadcasts(); invalidateSchedule(); renderGuide(); renderLibrary(); renderChannels(); }
let bulkRows = [];
function bulkRowsForScope() {
  const scope = $("#bulk-scope").value;
  if (scope === "filtered") return filteredLibrary().filter(video=>!video.missing);
  return activeMedia().filter(video => scope === "all" || scope === "unassigned" && unassigned(video) || scope === "review" && reviewReasons(video).length);
}
function filteredBulkRows() {
  const actual = new Map(state.catalog.videos.map(video=>[video.id,video]));
  return bulkRows.filter(row => searchMedia({...actual.get(row.id),...row},$("#bulk-search").value) &&
    (!$("#bulk-channel").value || ($("#bulk-channel").value === CUSTOMS_CHANNEL ? unassigned({...actual.get(row.id),...row}) : row.channels.includes($("#bulk-channel").value))) &&
    (!$("#bulk-genre").value || row.genres.includes($("#bulk-genre").value)));
}
function visibleBulkRows() {
  const size = Number($("#bulk-page-size").value);
  return filteredBulkRows().slice(bulkView.page*size,(bulkView.page+1)*size);
}
function updateBulkSummary(message = "") {
  const selected = bulkRows.filter(row => row.selected).length;
  $("#bulk-summary").textContent = `${bulkRows.length} files · ${selected} selected across all pages${message ? " · " + message : ""}`;
  const visible = visibleBulkRows(), checked = visible.filter(row=>row.selected).length;
  $("#bulk-select-all").checked = Boolean(visible.length && checked === visible.length);
  $("#bulk-select-all").indeterminate = checked > 0 && checked < visible.length;
  $("#bulk-apply").textContent = `SAVE ${selected} SELECTED ${selected === 1 ? "FILE" : "FILES"}`;
  $("#bulk-apply").disabled = selected === 0;
}
function renderBulkRows() {
  const actual = new Map(state.catalog.videos.map(video=>[video.id,video]));
  const visible = pageItems(filteredBulkRows(),"bulk",bulkView);
  $("#bulk-body").innerHTML = visible.map(row => {
    const video = actual.get(row.id);
    return `<tr data-id="${esc(row.id)}"><td><input type="checkbox" data-bulk-select aria-label="Approve media ${esc(row.id)}" ${row.selected ? "checked" : ""}></td><td><span class="media-id">#${esc(row.id)}</span><div class="bulk-file">${esc(video.file)}</div><span class="settings-note">${esc(row.reasons.join(" · "))}</span></td><td><input data-bulk-field="title" aria-label="Title for ${esc(row.id)}" value="${esc(row.title)}" placeholder="Needs title"><details><summary>Description, tags &amp; taglines</summary>${[["description","Description",1000],["tags","Tags",1000],["tagline","Retro tagline",300],["tagline_goblin","Goblin tagline",300]].map(([field,label,limit]) => `<label>${label}<textarea data-bulk-field="${field}" aria-label="${label} for ${esc(row.id)}" maxlength="${limit}" rows="2">${esc(field === "tags" ? (row.tags || []).join(", ") : row[field] || "")}</textarea></label>`).join("")}</details></td><td><input data-bulk-field="genres" aria-label="Genres for ${esc(row.id)}" value="${esc(row.genres.join(", "))}" list="known-genres" placeholder="Choose genres"></td><td><input data-bulk-field="channels" aria-label="Channels for ${esc(row.id)}" value="${esc(row.channels.join(", "))}" list="known-channels" placeholder="${video.type === "advert" ? "All channels" : "Choose channels"}"></td></tr>`;
  }).join("");
  $("#bulk-body").querySelectorAll("[data-bulk-select]").forEach(input => input.addEventListener("change", () => {
    bulkRows.find(row => row.id === input.closest("tr").dataset.id).selected = input.checked;
    updateBulkSummary();
  }));
  $("#bulk-body").querySelectorAll("[data-bulk-field]").forEach(input => input.addEventListener("input", () => {
    const row = bulkRows.find(row => row.id === input.closest("tr").dataset.id);
    row[input.dataset.bulkField] = ["genres", "channels", "tags"].includes(input.dataset.bulkField) ? USBTvSuggestions.list(input.value) : input.value;
    row.selected = true;
    input.closest("tr").querySelector("[data-bulk-select]").checked = true;
    updateBulkSummary();
  }));
  updateBulkSummary();
}
function generateBulk(preserve = false) {
  try {
    const rules = USBTvSuggestions.parseRules($("#bulk-rules").value);
    const previous = new Map(bulkRows.map(row => [row.id,row]));
    const catalog = {...state.catalog, label_rules:rules};
    bulkRows = bulkRowsForScope().map(video => preserve && previous.has(video.id) ? previous.get(video.id) : USBTvSuggestions.suggest(video,catalog));
    $("#bulk-error").textContent = "";
    renderBulkRows();
  } catch (error) { $("#bulk-error").textContent = error.message; }
}
function openBulkReview() {
  bulkRows = [];
  $("#bulk-rules").value = (state.catalog.label_rules || []).map(rule => `${rule.keyword} => ${(rule.genres || []).join(", ")} | ${(rule.channels || []).join(", ")}`).join("\n");
  $("#bulk-scope").value = "filtered";
  bulkView.page = 0;
  $("#bulk-search").value = "";
  labelFilters("bulk");
  $("#bulk-channel").value = ""; $("#bulk-genre").value = "";
  $("#bulk-genres").value = ""; $("#bulk-channels").value = "";
  $("#known-genres").innerHTML = (state.catalog.genres || []).map(genre => `<option value="${esc(genre)}"></option>`).join("");
  $("#known-channels").innerHTML = assignableChannelNames().map(channel => `<option value="${esc(channel)}"></option>`).join("");
  generateBulk(); $("#bulk-dialog").showModal();
}
async function importBulkFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 8_000_000) throw new Error("Choose a CSV/JSON file smaller than 8 MB.");
    const {found,skipped} = USBTvSuggestions.importText(await file.text(),state.catalog);
    const merged = new Map(bulkRows.map(row => [row.id,row]));
    found.forEach(row => merged.set(row.id,row));
    bulkRows = [...merged.values()];
    bulkView.page = 0;
    $("#bulk-search").value = ""; $("#bulk-channel").value = ""; $("#bulk-genre").value = "";
    renderBulkRows();
    updateBulkSummary(`Loaded ${found.length} suggestions; skipped ${skipped.length}`);
    $("#bulk-error").textContent = skipped.slice(0,5).join(". ");
  } catch (error) { $("#bulk-error").textContent = error.message; }
  finally { event.target.value = ""; }
}
function assignBulk() {
  const selected = bulkRows.filter(row => row.selected);
  if (!selected.length) { $("#bulk-error").textContent = "Select rows first."; return; }
  const replace = $("#bulk-mode").value === "replace";
  const genres = USBTvSuggestions.list($("#bulk-genres").value), channels = USBTvSuggestions.list($("#bulk-channels").value);
  selected.forEach(row => {
    if (genres.length) row.genres = replace ? [...genres] : USBTvSuggestions.list([...row.genres,...genres]);
    if (channels.length) row.channels = replace ? [...channels] : USBTvSuggestions.list([...row.channels,...channels]);
    row.reasons = ["Manual bulk assignment"];
  });
  $("#bulk-genres").value = ""; $("#bulk-channels").value = "";
  $("#bulk-error").textContent = ""; renderBulkRows();
}
async function applyBulk(rulesOnly = false) {
  let rules;
  try { rules = USBTvSuggestions.parseRules($("#bulk-rules").value); }
  catch (error) { $("#bulk-error").textContent = error.message; return; }
  const selected = rulesOnly ? [] : bulkRows.filter(row => row.selected);
  if (!rulesOnly && !selected.length) { $("#bulk-error").textContent = "Select at least one row to save assignments."; return; }
  if (!rulesOnly && ($("#bulk-genres").value.trim() || $("#bulk-channels").value.trim())) assignBulk();
  const before = structuredClone(state.catalog);
  const controls = [...$("#bulk-dialog").querySelectorAll("button,input,textarea,select")];
  const disabled = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  $("#bulk-dialog").dataset.saving = "true";
  try {
    state.catalog.label_rules = rules;
    selected.forEach(row => {
      const video = state.catalog.videos.find(video => video.id === row.id);
      video.title = row.title.trim(); video.genres = row.genres; video.channels = row.channels;
      for (const field of ["description", "tags", "tagline", "tagline_goblin"]) if (row[field] !== undefined) video[field] = row[field];
    });
    state.catalog = await saveCatalog();
    $("#bulk-dialog").close(); renderAll();
    showToast(rulesOnly ? "Labelling rules saved; file assignments unchanged" : `Saved labels for ${selected.length} files`);
  } catch (error) { state.catalog = before; $("#bulk-error").textContent = error.message; }
  finally { controls.forEach((control,index) => { control.disabled = disabled[index]; }); delete $("#bulk-dialog").dataset.saving; }
}
function stamp(seconds) {
  seconds = Math.floor(Number(seconds) || 0);
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
}
function parseBreaks(text, duration) {
  if (!text.trim()) return [];
  return [...new Set(text.split(",").map(value => {
    const parts = value.trim().split(":");
    if (!parts.length || parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part))) throw new Error("Use timestamps such as 15:00, 30:00 or seconds.");
    if (parts.length > 1 && Number(parts.at(-1)) >= 60 || parts.length === 3 && Number(parts[1]) >= 60) throw new Error("Minutes and seconds after a colon must be below 60.");
    const seconds = parts.reduce((total, part) => total*60 + Number(part), 0);
    if (!(seconds > 0 && seconds < duration)) throw new Error("Every break must be after the start and before the end of the video.");
    return seconds;
  }))].sort((a,b) => a-b);
}
function renderChoices() {
  const draft = state.editing;
  $("#genre-options").innerHTML = [...new Set([...state.catalog.genres,...draft.genres])].map(genre => `<label class="check-label"><input type="checkbox" value="${esc(genre)}" ${draft.genres.includes(genre) ? "checked" : ""}>${esc(genre)}</label>`).join("") || '<span class="settings-note">Add your first genre below.</span>';
  $("#channel-options").innerHTML = assignableChannelNames().map(channel => `<label class="check-label"><input type="checkbox" value="${esc(channel)}" ${draft.channels.includes(channel) ? "checked" : ""}>${esc(channel)}</label>`).join("") || '<span class="settings-note">Create channels in the library first.</span>';
}
function readChoices() {
  state.editing.genres = [...$("#genre-options").querySelectorAll("input:checked")].map(input => input.value);
  state.editing.channels = [...$("#channel-options").querySelectorAll("input:checked")].map(input => input.value);
}
function renderSuggestions() {
  const draft = state.editing;
  $("#break-suggestions").textContent = `${draft.break_suggestion_source || "interval"} suggestions: ${(draft.suggested_break_points || []).map(stamp).join(", ") || "None"}.`;
  $("#use-suggestions").disabled = !draft.suggested_break_points?.length;
}
function openEditor(id) {
  const video = state.catalog.videos.find(item => item.id === id);
  if (!video) return;
  state.editing = structuredClone(video);
  $("#editor-heading").textContent = `Edit media #${video.id}`;
  $("#editor-file").textContent = video.file;
  $("#edit-title").value = video.title || "";
  $("#new-genre").value = "";
  $("#edit-type").value = video.type;
  $("#edit-tags").value = (video.tags || []).join(", ");
  $("#edit-enabled").checked = video.enabled !== false;
  $("#edit-breaks").value = (video.break_points || []).map(stamp).join(", ");
  $("#edit-breaks-approved").checked = Boolean(video.breaks_approved);
  $("#edit-description").value = video.description || "";
  $("#edit-tagline").value = video.tagline || "";
  $("#edit-tagline-goblin").value = video.tagline_goblin || "";
  $("#editor-error").textContent = "";
  const technical = video.technical || {};
  $("#editor-technical").textContent = [formatDuration(video.duration), technical.width && `${technical.width}×${technical.height}`, technical.video_codec, technical.audio_codec, video.size && `${(video.size/1048576).toFixed(1)} MB`, video.added_at && `Added ${new Date(video.added_at).toLocaleDateString()}`].filter(Boolean).join(" · ");
  $("#preview-media").disabled = Boolean(video.missing);
  $("#break-editor").hidden = video.type === "advert";
  renderChoices(); renderSuggestions();
  $("#editor-dialog").showModal();
}
async function saveEditor(event) {
  event.preventDefault();
  const draft = state.editing;
  if (!draft) return;
  try {
    readChoices();
    const pendingGenre = $("#new-genre").value.trim();
    if (pendingGenre && !draft.genres.includes(pendingGenre)) draft.genres.push(pendingGenre);
    draft.title = $("#edit-title").value.trim();
    draft.type = $("#edit-type").value;
    draft.tags = [...new Set($("#edit-tags").value.split(",").map(value => value.trim()).filter(Boolean))];
    draft.enabled = $("#edit-enabled").checked;
    draft.description = $("#edit-description").value.trim();
    draft.tagline = $("#edit-tagline").value.trim();
    draft.tagline_goblin = $("#edit-tagline-goblin").value.trim();
    draft.break_points = parseBreaks($("#edit-breaks").value, Number(draft.duration));
    draft.breaks_approved = $("#edit-breaks-approved").checked;
    const index = state.catalog.videos.findIndex(video => video.id === draft.id);
    const before = state.catalog.videos[index];
    state.catalog.videos[index] = structuredClone(draft);
    $("#save-media").disabled = true;
    try { const saved = await saveCatalog(); state.catalog = saved; }
    catch (error) { state.catalog.videos[index] = before; throw error; }
    $("#editor-dialog").close();
    renderAll(); showToast("Labels saved to USB");
  } catch (error) { $("#editor-error").textContent = error.message; }
  finally { $("#save-media").disabled = false; }
}
async function analyseBreaks() {
  const id = state.editing?.id;
  if (!id) return;
  $("#analyse-breaks").disabled = true;
  $("#editor-error").textContent = "Analysing the file locally. This can take several minutes…";
  try {
    const response = await fetch("/api/analyse", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const item = state.catalog.videos.find(video => video.id === id);
    item.suggested_break_points = data.points; item.break_suggestion_source = data.source;
    if (state.editing?.id === id) { state.editing.suggested_break_points = data.points; state.editing.break_suggestion_source = data.source; renderSuggestions(); $("#editor-error").textContent = "Analysis complete. Review suggestions before approving."; }
  } catch (error) { if (state.editing?.id === id) $("#editor-error").textContent = error.message; }
  finally { $("#analyse-breaks").disabled = false; }
}
let quickLabelId = null;
function closeQuickLabels() {
  if ($("#quick-label-panel").dataset.saving === "true") return;
  $("#quick-label-panel").hidden = true;
  $("#quick-label-toggle").setAttribute("aria-expanded","false");
  quickLabelId = null;
}
function openQuickLabels() {
  const playback = state.playback;
  // During adverts, edit the programme containing the break rather than the ad.
  const id = playback?.mode === "channel" ? Schedule.locate(timeline(playback.channel))?.block.video.id : playback?.id;
  const video = state.catalog.videos.find(item=>item.id===id);
  if (!video) {showToast("No programme is currently playing");return;}
  quickLabelId = id;
  $("#quick-label-heading").textContent = `Edit #${video.id} · ${displayTitle(video)}`;
  $("#quick-label-file").textContent = video.file;
  $("#quick-label-title").value = video.title || "";
  $("#quick-label-genres").value = (video.genres || []).join(", ");
  $("#quick-label-tags").value = (video.tags || []).join(", ");
  $("#quick-label-channels").innerHTML = assignableChannelNames().map(name=>`<label class="check-label"><input type="checkbox" value="${esc(name)}" ${video.channels.includes(name) ? "checked" : ""}>${esc(name)}</label>`).join("");
  $("#quick-label-error").textContent = "";
  $("#quick-label-panel").hidden = false;
  $("#quick-label-toggle").setAttribute("aria-expanded","true");
  $("#quick-label-title").focus();
}
$("#quick-label-toggle").addEventListener("click",()=>$("#quick-label-panel").hidden ? openQuickLabels() : closeQuickLabels());
for (const id of ["quick-label-close","quick-label-cancel"]) $("#"+id).addEventListener("click",closeQuickLabels);
$("#quick-label-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const video = state.catalog.videos.find(item=>item.id===quickLabelId);
  if (!video || $("#quick-label-panel").dataset.saving === "true") return;
  const before = structuredClone(video);
  let metadataSaved = false;
  video.title = $("#quick-label-title").value.trim();
  video.genres = USBTvSuggestions.list($("#quick-label-genres").value);
  video.tags = USBTvSuggestions.list($("#quick-label-tags").value);
  video.channels = [...$("#quick-label-channels").querySelectorAll("input:checked")].map(input=>input.value);
  const panel = $("#quick-label-panel"), controls = [...panel.querySelectorAll("button,input")];
  panel.dataset.saving = "true"; controls.forEach(control=>{control.disabled=true;});
  try {
    state.catalog = await saveCatalog(); metadataSaved = true;
    renderAll(); await broadcastQueue;
    panel.dataset.saving = "false"; closeQuickLabels();
    showToast("Labels saved · current showing continues");
  } catch(error) {
    // A schedule write may fail after metadata was saved; retain those edits.
    if (!metadataSaved) Object.assign(video,before);
    $("#quick-label-error").textContent = error.message;
  } finally {panel.dataset.saving="false";controls.forEach(control=>{control.disabled=false;});}
});
function showPlayer() {
  $("#guide-preview-video").pause();
  if (!$("#player-dialog").open) $("#player-dialog").showModal();
  if (fullscreenElement() && state.catalog.settings?.fullscreen_mode !== "app") $("#player-dialog").classList.add("video-fills-screen");
  updatePlaybackControls(); revealPlayerControls(); updateFullscreenButtons();
}
// Share numbering with the guide: only channels with playable schedules count.
function playableChannels() { return channelNames().filter(channel => timeline(channel).duration > 0); }
const channelEntry = {digits:"", timer:null, hideTimer:null};
function clearChannelEntry() {
  clearTimeout(channelEntry.timer); clearTimeout(channelEntry.hideTimer);
  channelEntry.digits = "";
  $("#channel-osd").hidden = true;
}
function showChannelOsd(number, label = "", temporary = true) {
  const osd = $("#channel-osd");
  ($( "#player-dialog").open ? $("#player-dialog") : document.body).append(osd);
  osd.replaceChildren();
  const digits = document.createElement("strong"), name = document.createElement("span");
  digits.textContent = number; name.textContent = label;
  osd.append(digits,name); osd.hidden = false;
  clearTimeout(channelEntry.hideTimer);
  if (temporary) channelEntry.hideTimer = setTimeout(() => {osd.hidden=true;},2200);
}
function changeChannel(direction) {
  const names = playableChannels();
  if (!names.length) return;
  const index = names.indexOf(state.playback?.channel);
  tuneChannel(names[index < 0 ? (direction>0 ? 0 : names.length-1) : (index+direction+names.length)%names.length]);
}
function commitChannelNumber() {
  const digits = channelEntry.digits;
  clearChannelEntry();
  if (!digits) return;
  const channel = playableChannels()[Number(digits)-1];
  if (channel) tuneChannel(channel);
  else showChannelOsd(digits.padStart(3,"0"),"NO CHANNEL");
}
function enterChannelDigit(digit) {
  clearTimeout(channelEntry.timer);
  channelEntry.digits = (channelEntry.digits.length>=3 ? "" : channelEntry.digits) + digit;
  showChannelOsd(channelEntry.digits.padEnd(3,"_"),"TUNING…",false);
  channelEntry.timer = setTimeout(commitChannelNumber,1200);
}
// Channel controls also work in browser/window fullscreen, which may not set
// document.fullscreenElement. Capture at window before video control handlers.
window.addEventListener("keydown", event => {
  if (!$("#quick-label-panel").hidden) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
  if (document.activeElement?.closest('input,textarea,select,[contenteditable="true"]') ||
      ["#editor-dialog","#bulk-dialog","#settings-dialog"].some(selector=>$(selector).open)) return;
  const watching = $("#player-dialog").open && state.playback?.mode === "channel";
  if (!watching && !(document.fullscreenElement || document.webkitFullscreenElement)) return;
  if (/^[0-9]$/.test(event.key) && (!$("#player-dialog").open || watching)) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) enterChannelDigit(event.key);
  } else if (channelEntry.digits && ["Enter","Backspace","Escape"].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === "Enter") commitChannelNumber();
    else if (event.key === "Escape") clearChannelEntry();
    else {
      clearTimeout(channelEntry.timer); channelEntry.digits=channelEntry.digits.slice(0,-1);
      if (channelEntry.digits) {
        showChannelOsd(channelEntry.digits.padEnd(3,"_"),"TUNING…",false);
        channelEntry.timer=setTimeout(commitChannelNumber,1200);
      } else clearChannelEntry();
    }
  } else if (watching && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","PageUp","PageDown","MediaTrackNext","MediaTrackPrevious"].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) changeChannel(["ArrowUp","ArrowRight","PageUp","MediaTrackNext"].includes(event.key) ? 1 : -1);
  }
},true);
$("#channel-down").addEventListener("click",()=>changeChannel(-1));
$("#channel-up").addEventListener("click",()=>changeChannel(1));
document.addEventListener("fullscreenchange",()=>{if (!document.fullscreenElement) clearChannelEntry();});
function tuneChannel(channel) {
  if ($("#quick-label-panel").dataset.saving === "true") return;
  closeQuickLabels();
  if (!timeline(channel).duration) return;
  clearChannelEntry();
  selectGuideChannel(channel);
  state.playback = {mode:"channel", channel, key:null, loaded:false, paused:false};
  $("#return-live").hidden = false;
  $("#channel-down").hidden = false; $("#channel-up").hidden = false;
  showPlayer(); syncGuidePreview(); syncChannel(true);
  showChannelOsd(String(playableChannels().indexOf(channel)+1).padStart(3,"0"),channel);
}
function previewVideo(id) {
  if ($("#quick-label-panel").dataset.saving === "true") return;
  closeQuickLabels();
  clearChannelEntry();
  $("#channel-down").hidden = true; $("#channel-up").hidden = true;
  const video = state.catalog.videos.find(item => item.id === id);
  if (!video || video.missing) return;
  state.playback = {mode:"preview", id};
  $("#return-live").hidden = true;
  $("#player-status").textContent = "PREVIEW FROM START";
  $("#player-title").textContent = displayTitle(video);
  $("#player-meta").textContent = `${(video.genres || []).join(" · ")} · ${formatDuration(video.duration)}`;
  const player = $("#player");
  player.onloadedmetadata = null;
  player.src = videoUrl(video.file);
  showPlayer();
  player.play().catch(() => showToast("Press Play to start playback."));
}
function syncChannel(force = false) {
  const playback = state.playback;
  if (playback?.mode !== "channel" || playback.failed || playback.paused && !force) return;
  const current = Schedule.locate(timeline(playback.channel));
  if (!current) {
    if (playback.channel === CUSTOMS_CHANNEL) {
      if (playback.key !== "customs-empty") {
        playback.key = "customs-empty"; playback.loaded = false;
        const player = $("#player"); player.onloadedmetadata = null; player.pause(); player.removeAttribute("src"); player.load();
        $("#player-status").textContent = "CUSTOMS CLEARED";
        $("#player-title").textContent = "No unassigned programmes remain";
        $("#player-meta").textContent = "Choose another channel, or add more unassigned videos.";
        $("#quick-label-toggle").disabled = true;
      }
    } else $("#player-dialog").close();
    return;
  }
  $("#quick-label-toggle").disabled = false;
  const player = $("#player");
  $("#player-status").textContent = current.segment.advert ? "ADVERTISEMENT BREAK" : `LIVE · ${playback.channel}`;
  $("#player-title").textContent = current.segment.advert ? `${playback.channel} · Advert break` : displayTitle(current.block.video);
  const channelTimeline = current.timeline;
  const returnsToProgramme = current.block.segments.some(segment => !segment.advert && segment.start > current.segment.start);
  const following = channelTimeline.blocks[(current.block.index + 1) % channelTimeline.blocks.length].video;
  $("#player-meta").textContent = current.segment.advert ? `${displayTitle(current.segment.video)} · ${returnsToProgramme ? "Back to " + displayTitle(current.block.video) : "Up next: " + displayTitle(following)}` : `${formatDuration(current.block.video.duration)} · Channel time · Pause resumes live`;
  if (playback.key !== current.key) {
    playback.key = current.key; playback.loaded = false; playback.paused = false;
    const key = current.key;
    player.onloadedmetadata = () => {
      if (state.playback !== playback || playback.key !== key) return;
      const latest = Schedule.locate(timeline(playback.channel));
      if (latest?.key !== key) { syncChannel(); return; }
      playback.loaded = true;
      seekToLive(latest.position);
      player.play().catch(() => { playback.paused = true; showToast("Press Play to join the channel."); });
    };
    player.src = videoUrl(current.segment.video.file);
    player.load();
  } else if (playback.loaded && (force || Math.abs(player.currentTime - current.position) > 3)) {
    seekToLive(current.position);
    if (force) { playback.paused = false; player.play().catch(() => {}); }
  }
}
function seekToLive(position, player = $("#player")) {
  if (!Number.isFinite(player.duration)) return;
  const target = Math.max(0, Math.min(position, player.duration - 0.05));
  if (Math.abs(player.currentTime - target) > 0.15) player.currentTime = target;
}
function readDuration(file) {
  return new Promise(resolve => {
    const media = document.createElement("video");
    let finished = false;
    const timeout = setTimeout(() => done(0), 12000);
    function done(duration) {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      media.removeAttribute("src"); media.load();
      resolve(Number.isFinite(duration) ? duration : 0);
    }
    media.preload = "metadata";
    media.onloadedmetadata = () => done(media.duration);
    media.onerror = () => done(0);
    media.src = videoUrl(file);
  });
}
let scanTimer = null, scanPolling = false, handledScan = null, pendingScanRefresh = false, scanQuiet = true;
const editingLibrary = () => !$("#quick-label-panel").hidden || $("#editor-dialog").open || $("#bulk-dialog").open || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
function displayScan(job) {
  state.scanning = job.status === "running";
  const button = $("#rescan");
  button.disabled = state.scanning;
  button.innerHTML = state.scanning ? `↻ <span>SCANNING ${job.completed || 0}/${job.total || "…"}</span>` : '↻ <span>RESCAN VIDEOS</span>';
  $("#scan-progress").hidden = job.status === "idle";
  $("#scan-meter").max = Math.max(1,job.total || 0);
  $("#scan-meter").value = job.completed || 0;
  $("#scan-message").textContent = state.scanning ? `${job.stage === "discovering" ? "Finding videos…" : "Scanning"} · ${job.completed || 0}/${job.total || "…"} · ${job.current || ""}` : `${job.status === "complete" ? "Scan complete" : job.status === "interrupted" ? "Scan paused — rescan to continue" : "Scan failed"} · ${job.completed || 0}/${job.total || 0}${job.error ? " · " + job.error : ""}`;
  $("#scan-pause").hidden = !state.scanning;
  $("#scan-errors").hidden = !job.error_count;
  $("#scan-error-text").textContent = (job.errors || []).map(item => `${item.file}: ${item.error}`).join("\n");
}
async function pollScan() {
  if (scanPolling) return;
  scanPolling = true;
  try {
    const response = await apiFetch("/api/scan",{cache:"no-store"});
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "Could not read scan progress");
    displayScan(job);
    if (!state.scanning && job.id !== handledScan) {
      handledScan = job.id;
      pendingScanRefresh ||= Boolean(job.changed);
      if (!scanQuiet || job.status === "failed") showToast(job.status === "complete" ? "Library scan complete" : job.error || "Scan paused; completed work is saved");
    }
    if (pendingScanRefresh && !editingLibrary()) {
      const queued = saveQueue;
      await queued.catch(() => {});
      const response = await apiFetch("/api/catalog",{cache:"no-store"});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not refresh library");
      if (!editingLibrary() && queued === saveQueue) {
        pendingScanRefresh = false;
        if (JSON.stringify(data) !== JSON.stringify(state.catalog)) {
          state.catalog = data; applyThemeSetting(); applyCrtSetting(); renderAll();
        }
      }
    }
    if (!state.scanning && !pendingScanRefresh) { clearInterval(scanTimer); scanTimer = null; }
  } catch(error) { showToast(error.message); clearInterval(scanTimer); scanTimer = null; }
  finally { scanPolling = false; }
}
async function rescan(quiet = false) {
  if (state.scanning || quiet && editingLibrary()) return;
  scanQuiet = quiet;
  try {
    const response = await apiFetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "Scan failed");
    displayScan(job);
    if (!scanTimer) scanTimer = setInterval(pollScan,1000);
    await pollScan();
  } catch(error) { showToast(error.message); }
}
$("#scan-pause").addEventListener("click",async () => {
  try {
    const response = await apiFetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"pause"})});
    if (!response.ok) throw new Error("Could not pause scan");
    showToast("Pausing after the current metadata read…");
  } catch(error) {showToast(error.message);}
});
$("#read-page-lengths").addEventListener("click",async () => {
  const button = $("#read-page-lengths"); button.disabled = true;
  const size = Number($("#library-page-size").value);
  const videos = filteredLibrary().slice(libraryView.page*size,(libraryView.page+1)*size).filter(video=>!video.missing && !(video.duration>0));
  let cursor = 0, changed = false;
  try {
    await Promise.all(Array.from({length:Math.min(3,videos.length)},async () => {
      while(cursor < videos.length) {
        const video = videos[cursor++], duration = await readDuration(video.file);
        const current = state.catalog.videos.find(item=>item.id===video.id && item.fingerprint===video.fingerprint);
        if (duration>0 && current && !(current.duration>0)) {current.duration=duration;changed=true;}
      }
    }));
    if(changed) {await saveCatalog();renderAll();}
    showToast(changed ? "Available lengths saved" : "No additional lengths could be read; bundle ffprobe for these files");
  } catch(error) {showToast(error.message);}
  finally {renderLibrary();}
});
document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => setPage(tab.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(button => button.addEventListener("click", () => setPage(button.dataset.goto)));
for (const id of ["library-filter","library-channel","library-genre","library-page-size"]) $("#"+id).addEventListener("change", () => {libraryView.page=0;renderLibrary();});
$("#library-search").addEventListener("input", () => {libraryView.page=0;renderLibrary();});
for (const [prefix,view,render] of [["library",libraryView,renderLibrary],["bulk",bulkView,renderBulkRows]]) {
  $("#"+prefix+"-prev").addEventListener("click", () => {view.page--;render();});
  $("#"+prefix+"-next").addEventListener("click", () => {view.page++;render();});
}
for (const id of ["bulk-channel","bulk-genre","bulk-page-size"]) $("#"+id).addEventListener("change", () => {bulkView.page=0;renderBulkRows();});
$("#bulk-search").addEventListener("input", () => {bulkView.page=0;renderBulkRows();});
$("#bulk-select-matching").addEventListener("click", () => {filteredBulkRows().forEach(row=>{row.selected=true;});renderBulkRows();});
$("#bulk-clear-selection").addEventListener("click", () => {bulkRows.forEach(row=>{row.selected=false;});renderBulkRows();});
$("#bulk-review").addEventListener("click", openBulkReview);
[$("#close-bulk"), $("#bulk-cancel")].forEach(button => button.addEventListener("click", () => $("#bulk-dialog").close()));
$("#bulk-dialog").addEventListener("cancel", event => { if ($("#bulk-dialog").dataset.saving) event.preventDefault(); });
$("#bulk-scope").addEventListener("change", () => {bulkView.page=0;generateBulk(true);});
$("#bulk-generate").addEventListener("click", () => generateBulk());
$("#bulk-import").addEventListener("change", importBulkFile);
$("#bulk-select-all").addEventListener("change", event => { visibleBulkRows().forEach(row => { row.selected = event.target.checked; }); renderBulkRows(); });
$("#bulk-assign").addEventListener("click", assignBulk);
$("#bulk-apply").addEventListener("click", () => applyBulk());
$("#bulk-save-rules").addEventListener("click", () => applyBulk(true));
$("#bulk-export").addEventListener("click", () => {
  const blob = new Blob([USBTvSuggestions.exportCsv(bulkRows,state.catalog)],{type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = "usbtv-label-suggestions.csv"; link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});
$("#guide-earlier").addEventListener("click", () => browseGuide(-30));
$("#guide-later").addEventListener("click", () => browseGuide(30));
$("#guide-now").addEventListener("click", () => guideInput("live"));
$("#guide-rows").addEventListener("focusin", event => {
  const button = event.target.closest("[data-channel]");
  if (!button) return;
  guideNavigation.channel = button.dataset.channel;
  guideNavigation.kind = button.classList.contains("channel-card") ? "channel" : "programme";
  $("#guide-rows").querySelectorAll("[data-channel]").forEach(item => { item.tabIndex = item === button ? 0 : -1; });
  if (button.classList.contains("programme")) {
    const start = Number(button.dataset.start), end = Number(button.dataset.end);
    if (guideNavigation.time === null || guideNavigation.time < start || guideNavigation.time >= end) guideNavigation.time = Math.max(start,guideNavigation.start ?? Date.now());
  }
});
document.addEventListener("keydown", event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
  const target = document.activeElement;
  if (target?.closest('input,textarea,select,video,[contenteditable="true"]')) return;
  const withinGuide = $("#guide-rows").contains(target);
  if (!withinGuide && target !== document.body && target !== document.documentElement) return;
  const action = {ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right",Home:"live",Enter:"select"}[event.key];
  if (action && guideInput(action)) event.preventDefault();
});
$("#advanced-toggle").addEventListener("click", async () => {
  state.catalog.settings.advanced_mode = !state.catalog.settings.advanced_mode;
  applyAdvancedMode();
  try { await saveCatalog(); } catch (_) {}
});
$("#guide-span").addEventListener("input", event => {
  state.catalog.settings.guide_minutes = Number(event.target.value);
  renderGuide();
});
$("#guide-span").addEventListener("change", async () => {
  try { await saveCatalog(); } catch (_) {}
});
$("#rescan").addEventListener("click", () => rescan());
$("#settings-toggle").addEventListener("click", () => $("#settings-dialog").showModal());
$("#close-settings").addEventListener("click", () => $("#settings-dialog").close());
document.querySelectorAll('input[name="theme"]').forEach(input => input.addEventListener("change", async () => {
  state.catalog.settings.theme = input.value; applyThemeSetting();
  try { await saveCatalog(); } catch (_) {}
}));
$("#add-channel-form").addEventListener("submit", async event => {
  event.preventDefault();
  const name = $("#new-channel").value.trim();
  if (!name || channelNames().includes(name)) { showToast("Choose a new channel name."); return; }
  const channel = {name};
  state.catalog.channels.push(channel);
  try { await saveCatalog(); $("#new-channel").value = ""; renderAll(); }
  catch (_) { state.catalog.channels = state.catalog.channels.filter(item => item !== channel); }
});
$("#media-editor").addEventListener("submit", saveEditor);
$("#close-editor").addEventListener("click", () => $("#editor-dialog").close());
$("#editor-dialog").addEventListener("close", () => { state.editing = null; });
$("#edit-type").addEventListener("change", () => { $("#break-editor").hidden = $("#edit-type").value === "advert"; });
$("#add-genre").addEventListener("click", () => {
  const genre = $("#new-genre").value.trim();
  if (!genre) return;
  readChoices();
  if (!state.editing.genres.includes(genre)) state.editing.genres.push(genre);
  $("#new-genre").value = ""; renderChoices();
});
$("#use-suggestions").addEventListener("click", () => {
  $("#edit-breaks").value = state.editing.suggested_break_points.map(stamp).join(", ");
  $("#edit-breaks-approved").checked = false;
});
$("#edit-breaks").addEventListener("input", () => { $("#edit-breaks-approved").checked = false; });
$("#analyse-breaks").addEventListener("click", analyseBreaks);
$("#preview-media").addEventListener("click", () => previewVideo(state.editing.id));
$("#close-player").addEventListener("click", () => $("#player-dialog").close());
$("#preview-watch").addEventListener("click", () => { if (guidePreview.channel) tuneChannel(guidePreview.channel); });
$("#preview-play").addEventListener("click", () => {
  guidePreview.blocked = false; $("#preview-play").hidden = true; syncGuidePreview();
});
$("#guide-preview-video").addEventListener("error", () => {
  if (!$("#guide-preview-video").hasAttribute("src")) return;
  guidePreview.failed = true; $("#preview-play").hidden = true;
  $("#preview-message").textContent = "Preview unavailable. This browser may not support this video's codec.";
  $("#preview-message").hidden = false;
});
document.addEventListener("visibilitychange", syncGuidePreview);
$("#fullscreen-toggle").addEventListener("click", () => toggleFullscreen(document.documentElement));
$("#video-fullscreen").addEventListener("click", () => toggleFullscreen($("#player-dialog")));
$("#return-live").addEventListener("click", () => syncChannel(true));
document.querySelectorAll('input[name="fullscreen-mode"]').forEach(input=>input.addEventListener("change",async ()=>{
  state.catalog.settings.fullscreen_mode=input.value;
  updateFullscreenButtons();
  try {await saveCatalog();} catch (_) {}
}));
$("#crt-toggle").addEventListener("click", async () => {
  state.catalog.settings.crt = !state.catalog.settings.crt; applyCrtSetting();
  try { await saveCatalog(); } catch (_) {}
});
document.addEventListener("keydown", event => {
  if (!$("#quick-label-panel").hidden) return;
  if (event.key.toLowerCase() !== "f" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName) || $("#settings-dialog").open || $("#editor-dialog").open || $("#bulk-dialog").open) return;
  event.preventDefault(); toggleFullscreen($("#player-dialog").open ? $("#player-dialog") : document.documentElement);
});
$("#player-dialog").addEventListener("close", () => {
  if (videoFillsScreen()) exitAppFullscreen();
  closeQuickLabels();
  clearChannelEntry();
  state.playback = null;
  const player = $("#player"); player.onloadedmetadata = null; player.pause(); player.removeAttribute("src"); player.load();
});
$("#player").addEventListener("pause", () => {
  if (state.playback?.mode === "channel" && state.playback.loaded && !$("#player").ended) state.playback.paused = true;
});
$("#player").addEventListener("play", () => {
  if (state.playback?.mode === "channel" && state.playback.paused) { state.playback.paused = false; syncChannel(true); }
});
$("#player").addEventListener("ended", () => { if (state.playback?.mode === "channel") syncChannel(true); });
$("#player").addEventListener("error", () => {
  if (!state.playback) return;
  if (state.playback.mode === "channel") state.playback.failed = true;
  $("#player-meta").textContent = "This browser cannot play this file. Check its codec or choose another channel.";
  showToast("The browser could not play this media file.");
});
updateFullscreenButtons(); applyThemeSetting(); updateClock();
setInterval(updateClock,1000);
setInterval(renderGuide,30000);
setInterval(() => { syncChannel(); syncGuidePreview(); },500);
// Discover new files without requiring a restart. Leave open editors undisturbed.
setInterval(() => { if (!directFile && broadcastState.ready && !document.hidden) rescan(true); },120000);
if (directFile) {
  window.USBTvIntro?.start('satellite');
  $("#server-notice").hidden = false;
  $("#save-status").textContent = "LOCAL SERVER REQUIRED";
  document.querySelectorAll('#rescan, #advanced-toggle, #guide-span, #bulk-review, #add-channel-form input, #add-channel-form button, #crt-toggle, input[name="theme"]').forEach(control => { control.disabled = true; });
} else {
  loadCatalog().then(() => {
    window.USBTvIntro?.start(state.catalog.settings?.theme);
    applyCrtSetting(); return rescan();
  }).catch(error => {
    window.USBTvIntro?.start(state.catalog.settings?.theme);
    showToast(error.message);
  });
}

/* One selected programme title scrolls; other guide text stays still. */
(function () {
  "use strict";
  const guide = document.querySelector("#guide-rows");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let hovered = null, focused = null, selected = null, animation = null;

  function stop() {
    animation?.cancel();
    animation = null;
    selected?.classList.remove("title-scrolling");
  }
  function update(force = false) {
    const button = (hovered?.isConnected && hovered) || (focused?.isConnected && focused) || null;
    if (button === selected && !force) return;
    const previousKey = selected?.dataset.guideKey;
    const elapsed = animation?.currentTime;
    stop();
    selected = button;
    if (!button) {
      document.querySelector("#guide-programme-title").textContent = "Hover over or focus a programme to see its full title.";
      document.querySelector("#guide-programme-meta").textContent = "";
      return;
    }
    document.querySelector("#guide-programme-title").textContent = button.dataset.programmeTitle;
    document.querySelector("#guide-programme-meta").textContent = `${button.dataset.channel} · ${button.dataset.programmeTime} · Click to watch live`;
    const viewport = button.querySelector(".programme-title");
    const text = viewport.querySelector(".programme-title-text");
    const distance = Math.ceil(text.scrollWidth - viewport.clientWidth);
    if (distance <= 1 || reducedMotion.matches || !text.animate) return;
    button.classList.add("title-scrolling");
    const travel = Math.max(1500, distance / 28 * 1000);
    const duration = 1000 + travel + 1500;
    animation = text.animate([
      {transform:"translateX(0)", offset:0},
      {transform:"translateX(0)", offset:1000 / duration},
      {transform:`translateX(-${distance}px)`, offset:(1000 + travel) / duration},
      {transform:`translateX(-${distance}px)`, offset:1}
    ], {duration, iterations:Infinity, easing:"linear"});
    // A clock refresh should not keep restarting a very long title at its beginning.
    if (previousKey === button.dataset.guideKey && elapsed != null) animation.currentTime = elapsed;
  }
  guide.addEventListener("pointerover", event => {
    hovered = event.target.closest(".programme");
    update();
  });
  guide.addEventListener("pointerout", event => {
    hovered = event.relatedTarget instanceof Element ? event.relatedTarget.closest(".programme") : null;
    if (hovered && !guide.contains(hovered)) hovered = null;
    update();
  });
  guide.addEventListener("focusin", event => {
    hovered = null;
    focused = event.target.closest(".programme");
    update();
  });
  guide.addEventListener("focusout", event => {
    focused = event.relatedTarget instanceof Element ? event.relatedTarget.closest(".programme") : null;
    if (focused && !guide.contains(focused)) focused = null;
    update();
  });
  function refresh() {
    focused = guide.contains(document.activeElement) ? document.activeElement.closest(".programme") : null;
    hovered = focused?.matches(":focus-visible") ? null : guide.querySelector(".programme:hover");
    update(true);
  }
  window.addEventListener("resize", () => { renderGuide(); refresh(); });
  reducedMotion.addEventListener("change", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { stop(); selected = null; }
    else refresh();
  });
  // The guide is rebuilt on rescans and its clock tick. Release detached animations.
  new MutationObserver(refresh).observe(guide, {childList:true});
})();
