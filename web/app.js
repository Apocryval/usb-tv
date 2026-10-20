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
let writeToken = null, tokenRequest = null;
async function apiFetch(path, options) {
  if (directFile) throw new Error("Open USB.tv using its launcher to load and save your library.");
  try {
    if (options?.method && options.method.toUpperCase() !== 'GET') {
      if (!writeToken) {
        tokenRequest ||= fetch('/api/write-token', {cache:'no-store'}).then(async response => {
          if (!response.ok) throw new Error('Restart USB.tv with the updated app before saving.');
          writeToken = (await response.json()).token;
        }).finally(() => {tokenRequest=null;});
        await tokenRequest;
      }
      options = {...options, headers:{...options.headers, 'X-USBtv-Write':writeToken}};
    }
    return await fetch(path, options);
  }
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
  // Folder availability must not delay loading the saved theme and catalogue.
  void loadVideoFolder();
  const [response, broadcasts] = await Promise.all([
    apiFetch("/api/catalog", { cache: "no-store" }), apiFetch('/api/broadcasts', {cache:'no-store'})
  ]);
  if (!response.ok) throw new Error("USB.tv could not read catalog.json");
  state.catalog = await response.json();
  saveRevision = state.catalog.revision;
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

async function loadVideoFolder() {
  try {
    const response = await apiFetch('/api/video-folder', {cache:'no-store'});
    if (!response.ok) throw new Error('Restart USB.tv with the latest Windows build to choose a video folder.');
    showVideoFolder(await response.json());
  } catch (error) {
    $('#video-folder-status').textContent = error.message;
    $('#video-folder-save').disabled = true;
    $('#video-folder-reset').disabled = true;
  }
}

function showVideoFolder(folder) {
  $('#video-folder-path').value = folder.path;
  $('#video-folder-status').textContent = folder.available
    ? 'Includes subfolders. External files stay in place unless external preparation is enabled in Settings → Imports. Labels and schedules stay with USB.tv.'
    : 'Folder unavailable. Reconnect the drive or choose another folder. Your saved labels are retained.';
}

async function changeVideoFolder(path) {
  $('#video-folder-save').disabled = true;
  $('#video-folder-reset').disabled = true;
  try {
    const response = await apiFetch('/api/video-folder', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path})});
    const folder = await response.json();
    if (!response.ok) throw new Error(folder.error || 'Could not change video folder.');
    showVideoFolder(folder);
    $('#close-player').click();
    const preview = $('#guide-preview-video');
    preview.pause(); preview.removeAttribute('src'); preview.load();
    guidePreview.key = null;
    window.USBTvAudio?.setTrack(null,preview);
    state.scanning = false;
    await rescan();
  } catch (error) {
    $('#video-folder-status').textContent = error.message;
  } finally {
    $('#video-folder-save').disabled = false;
    $('#video-folder-reset').disabled = false;
  }
}

$('#video-folder-form').addEventListener('submit', event => {
  event.preventDefault();
  changeVideoFolder($('#video-folder-path').value);
});
$('#video-folder-reset').addEventListener('click', () => changeVideoFolder(''));

// Serialize writes so rapid theme/metadata edits cannot overwrite each other out of order.
let saveQueue = Promise.resolve();
let saveRevision = null;
function saveCatalog() {
  const snapshot = JSON.stringify(state.catalog);
  const task = saveQueue.catch(() => {}).then(async () => {
    $("#save-status").textContent = "SAVING…";
    const outgoing = JSON.parse(snapshot);
    outgoing.revision = saveRevision;
    const response = await apiFetch("/api/catalog", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(outgoing)});
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || "Save failed"); error.status = response.status; throw error; }
    saveRevision = data.revision;
    state.catalog.revision = data.revision;
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
  const active = Boolean(fullscreenElement());
  $("#fullscreen-toggle").setAttribute("aria-pressed",String(active));
  $("#fullscreen-toggle span").textContent = active ? "EXIT FULL" : "FULL SCREEN";
  const appMode = state.catalog.settings?.fullscreen_mode === 'app';
  const label = appMode ? active ? 'Exit app fullscreen' : 'Fullscreen app'
    : videoFillsScreen() ? 'Exit video fullscreen' : 'Fullscreen video';
  $("#video-fullscreen").title = label;
  $("#video-fullscreen").setAttribute("aria-label",label);
}
function revealPlayerControls() {
  const dialog = $("#player-dialog");
  dialog.classList.add("controls-visible");
  clearTimeout(cinemaHideTimer);
  cinemaHideTimer = setTimeout(()=>{
    if (!$("#quick-label-panel").hidden || state.playback?.loaded && $('#player').paused || dialog.querySelector('.player-top:hover,.playback-controls:hover') || dialog.querySelector('input:focus')) return;
    dialog.classList.remove("controls-visible");
  },2500);
}
function hidePlayerControls() {
  clearTimeout(cinemaHideTimer);
  $('#player-dialog').classList.remove('controls-visible');
}
function handlePlayerPointerDown() {
  // An ordinary viewer click reveals controls, not a stale tuning ident.
  // Keep unfinished numeric entry visible until committed or cancelled.
  if (!channelEntry.digits) {
    clearTimeout(channelEntry.hideTimer);
    $("#channel-osd").hidden = true;
  }
  revealPlayerControls();
}
function exitVideoView() {
  $("#player-dialog").classList.remove("video-fills-screen","controls-visible");
  clearTimeout(cinemaHideTimer);
  updateFullscreenButtons();
}
async function exitAppFullscreen() {
  exitVideoView();
  cinemaNative = false;
  if (fullscreenElement()) {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } catch (_) {}
  }
  updateFullscreenButtons();
}
async function toggleFullscreen(target = document.documentElement) {
  const immersive = target === $('#player-dialog') && $('#player-dialog').open && state.catalog.settings?.fullscreen_mode !== 'app';
  if (immersive && videoFillsScreen()) { exitVideoView(); return; }
  if (!immersive && fullscreenElement()) { await exitAppFullscreen(); return; }
  // Fill the viewport independently of browser fullscreen support. Always keep
  // the HTML player (and tuning overlays) rather than the native video surface.
  $("#player-dialog").classList.toggle("video-fills-screen",immersive);
  revealPlayerControls(); updateFullscreenButtons();
  if (fullscreenElement()) return;
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
$("#player-dialog").addEventListener("pointermove",revealPlayerControls);
$("#player-dialog").addEventListener("pointerdown",handlePlayerPointerDown);
window.addEventListener("keydown",event=>{
  if (event.key === "Escape" && videoFillsScreen() && $("#quick-label-panel").hidden) {
    event.preventDefault();event.stopImmediatePropagation();exitVideoView();
  } else if ($('#player-dialog').open && event.key==='Tab') revealPlayerControls();
},true);
window.addEventListener('keydown',event=>{
  if(!$('#player-dialog').open || event.repeat || event.altKey || event.ctrlKey || event.metaKey
    || !$('#quick-label-panel').hidden || document.activeElement?.closest('input,textarea,select,button,[contenteditable="true"]'))return;
  if(event.code==='Space'||event.key.toLowerCase()==='k') {
    event.preventDefault();revealPlayerControls();
    const player=$('#player');if(player.paused)player.play().catch(()=>{});else player.pause();
  }
},true);
function updatePlaybackControls() {
  const player = $("#player");
  $("#playback-toggle").textContent = player.paused ? "PLAY" : "PAUSE";
  const muteButton = $("#playback-mute");
  const muteState = String(player.muted);
  if (muteButton.dataset.muted !== muteState) {
    muteButton.dataset.muted = muteState;
    muteButton.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/>${player.muted ? '<path d="m16 9 6 6m0-6-6 6"/>' : '<path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>'}</svg>`;
  }
  muteButton.title = player.muted ? "Unmute audio" : "Mute audio";
  muteButton.setAttribute("aria-label",muteButton.title);
  muteButton.setAttribute("aria-pressed",muteState);
  $("#playback-volume").value = player.volume;
  const progress=playerProgress();
  $("#playback-time").textContent = `${stamp(progress.value-progress.min)} / ${progress.max>progress.min ? stamp(progress.max-progress.min) : "—"}`;
  const browsing = ['channel','replay','chaos'].includes(state.playback?.mode);
  $('#programme-previous').hidden = !browsing;
  $('#programme-restart').hidden = !browsing;
  $('#programme-previous').disabled = state.playback?.mode==='chaos' && !(state.playback.trailIndex>0);
  $('#programme-next').hidden = !['replay','chaos'].includes(state.playback?.mode);
  $('#programme-next').title = state.playback?.mode==='chaos'?'Skip to the next Chaos video':'Watch the next programme or catch up to live';
  $('#return-live').hidden = state.playback?.mode !== 'replay';
  $('#admin-playback-controls').hidden = !adminPlaybackEnabled() || state.playback?.mode !== 'channel';
  $('#call-network').hidden = !state.catalog.settings?.advanced_mode || state.playback?.mode !== 'channel';
  $('#call-network').disabled = adminAdvancing || !broadcastState.ready || !$('#quick-label-panel').hidden;
  $("#preview-seek-label").hidden = false;
  $("#preview-seek").min = progress.min;
  $("#preview-seek").max = Math.max(progress.min+.1,progress.max);
  $("#preview-seek").value = progress.value;
  $("#preview-seek").disabled = !(progress.max>progress.min);
  $("#preview-seek").title = ['channel','replay'].includes(state.playback?.mode)?'Drag to seek · forward seeking stops at live · Left/Right: 10 seconds':'Drag to seek · Left/Right: 10 seconds';
}
function playerProgress() {
  const player=$('#player'), playback=state.playback;
  const current=playback?.mode==='replay'?playback.current:playback?.mode==='channel'?playback.current || Schedule.locate(timeline(playback.channel)):null;
  let min=0,max=Number.isFinite(player.duration)?player.duration:0;
  if(current) {
    min=(current.segment.advert || current.segment.bumper)?current.segment.offset:current.block.video.source_offset||0;
    max=(current.segment.advert || current.segment.bumper)?min+current.segment.duration:min+Number(current.block.video.duration);
  }
  const position = current && playback.loaded === false ? current.position : player.currentTime || min;
  return {min,max,value:Math.max(min,Math.min(max,position))};
}
function seekPlayback(position) {
  const playback=state.playback,player=$('#player');
  if (!Number.isFinite(position) || $('#quick-label-panel').dataset.saving==='true') return;
  const progress=playerProgress();
  if(['preview','chaos'].includes(playback?.mode)) {
    if (progress.max>progress.min) { player.currentTime=Math.max(progress.min,Math.min(position,progress.max-.05)); }
    return;
  }
  if(!['channel','replay'].includes(playback?.mode))return;
  const line=playback.mode==='replay'?playback.line:timeline(playback.channel);
  const current=playback.current || Schedule.locate(line);
  if(!current)return;
  const target=Math.max(progress.min,Math.min(position,progress.max-.05));
  const segment=(current.segment.advert || current.segment.bumper)?current.segment:current.block.segments.find(s=>!s.advert && !s.bumper && target>=s.offset && target<s.offset+s.duration);
  if(!segment)return;
  const cycleStart=current.start-current.block.start*1000;
  // Fractional durations lose precision when added to epoch milliseconds.
  // Stay just inside this segment, as programme navigation does, so zero
  // cannot resolve to the previous video (or the preceding advert break).
  const offset=Math.max(Math.min(.0005,segment.duration/2),target-segment.offset);
  const cursor=cycleStart+(segment.start+offset)*1000;
  if(cursor>=Date.now()) {
    if (playback.mode==='replay') returnToLive(false);
    else {showToast('You are already watching live.');updatePlaybackControls();}
    return;
  }
  if (playback.mode==='channel') {
    const autoplay=!player.paused;
    clearChannelEntry();
    state.playback={mode:'replay',channel:playback.channel,line,cursor,current:null,loaded:false};
    loadChannelReplay(autoplay);revealPlayerControls();return;
  }
  playback.cursor=cursor;
  if(segment===current.segment && playback.loaded !== false) player.currentTime=target;
  else loadChannelReplay(playback.loaded === false ? playback.autoplay ?? !player.paused : !player.paused);
}
function seekRelative(seconds) {
  seekPlayback(playerProgress().value + seconds);
  revealPlayerControls();
}
$("#playback-toggle").addEventListener("click",()=>{
  const player = $("#player");
  if (player.paused) player.play().catch(()=>showToast("Unable to start this video"));else player.pause();
});
$("#playback-mute").addEventListener("click",()=>{$("#player").muted=!$("#player").muted;});
$("#playback-volume").addEventListener("input",event=>{const player=$("#player");player.volume=Number(event.target.value);player.muted=false;});
$("#preview-seek").addEventListener("input",event=>seekPlayback(Number(event.target.value)));
for (const name of ["play","pause","timeupdate","loadedmetadata","volumechange","emptied"]) $("#player").addEventListener(name,updatePlaybackControls);

function adminPlaybackEnabled() {
  return Boolean(state.catalog.settings?.advanced_mode && state.catalog.settings?.admin_playback);
}
let adminAdvancing = false;
async function advanceChannel(action) {
  const playback = state.playback;
  const network = action === 'network';
  const enabled = () => network ? Boolean(state.catalog.settings?.advanced_mode) : adminPlaybackEnabled();
  if (!enabled() || adminAdvancing || playback?.mode !== 'channel'
      || $('#quick-label-panel').dataset.saving === 'true') return;
  if (network && !$('#quick-label-panel').hidden) {
    showToast('Finish or cancel your labels before calling the network.'); return;
  }
  adminAdvancing = true;
  const buttons = [...$('#admin-playback-controls').querySelectorAll('button'), $('#call-network')];
  buttons.forEach(button=>{button.disabled=true;});
  try {
    await broadcastQueue;
    if (state.playback !== playback || !enabled()) return;
    const plans = USBTvPlans.advance(state.catalog,broadcastState.channels,playback.channel,network ? 'skip' : action);
    // Apply locally only after the saved revision is accepted by the server.
    await persistBroadcasts(plans);
    broadcastState.channels = plans;
    invalidateSchedule(); renderGuide(); renderChannels();
    if (state.playback === playback) {
      closeQuickLabels(); syncChannel(true); revealPlayerControls();
    }
    showToast(network ? 'Network called — next video is on air.' : action === 'skip' ? 'Channel advanced to the next video' : 'Channel advanced 30 seconds');
  } catch (error) { showToast(error.message); }
  finally {adminAdvancing=false;buttons.forEach(button=>{button.disabled=false;});updatePlaybackControls();}
}
$('#call-network').addEventListener('click',()=>advanceChannel('network'));
$('#admin-forward').addEventListener('click',()=>advanceChannel('forward'));
$('#admin-skip').addEventListener('click',()=>advanceChannel('skip'));
$('#admin-playback-toggle').addEventListener('change',async event=>{
  state.catalog.settings.admin_playback = event.target.checked;
  updatePlaybackControls();
  try { await saveCatalog(); } catch (error) { showToast(error.message); }
});

function applyCrtSetting() {
  const mode = state.catalog.settings?.crt_mode || (state.catalog.settings?.crt ? 'classic' : 'off');
  const enabled = mode !== 'off';
  document.body.classList.toggle("crt-on", enabled);
  document.body.classList.toggle("crt-realistic", mode === 'realistic');
  $("#crt-toggle").setAttribute("aria-pressed", String(enabled));
  const label = {off:'CRT OFF', classic:'CRT CLASSIC', realistic:'CRT REALISTIC'}[mode];
  $('#crt-toggle span').textContent = label;
  $('#crt-toggle').title = `${label}. Click for ${{off:'classic',classic:'realistic',realistic:'off'}[mode]}.`;
  $('#crt-toggle').setAttribute('aria-label', $('#crt-toggle').title);
  window.USBTvCRT?.setEnabled(mode === 'realistic');
}

function applyThemeSetting() {
  applyAudioSetting();
  $('#auto-imports').checked = state.catalog.settings?.auto_imports !== false;
  $('#prepare-external-imports').checked = state.catalog.settings?.prepare_external_imports === true;
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
  $("#page-guide .subheading").textContent = goblin ? "" : "A shuffled rotation, tuned to your collection.";
  document.querySelector('meta[name="theme-color"]').content = { satellite: "#09236c", teletext: "#080808", goblin: "#141a16" }[theme];
}

function applyAudioSetting() {
  const enabled = state.catalog.settings?.volume_levelling !== false;
  const profile = state.catalog.settings?.volume_profile === 'balanced' ? 'balanced' : 'standard';
  for (const id of ['volume-levelling','advanced-volume-levelling','player-volume-levelling']) $('#'+id).checked = enabled;
  for (const id of ['volume-profile','advanced-volume-profile','player-volume-profile']) $('#'+id).value = profile;
  window.USBTvAudio?.setProfile(profile);
  window.USBTvAudio?.setEnabled(enabled);
  refreshPlaybackAudio();
}
function refreshPlaybackAudio() {
  const playback = state.playback;
  const item = ['preview','chaos'].includes(playback?.mode) ? state.catalog.videos.find(video=>video.id === playback.id)
    : playback?.mode === 'channel' ? Schedule.locate(timeline(playback.channel))?.segment.video
    : playback?.mode === 'replay' ? playback.current?.segment.video : null;
  window.USBTvAudio?.setTrack(state.catalog.videos.find(video=>video.id === item?.id) || item || null);
}
function audioStatusMessage(audio, supported) {
  if (!supported) return 'This browser cannot apply volume levelling; original audio is used.';
  const progress = `${audio.checked} of ${audio.total} files checked. `;
  if (!audio.enabled) return progress + 'Levelling is off. Saved measurements are retained.';
  if (!audio.total) return 'No files to measure yet.';
  const playback = audio.checked ? 'Saved levels are applied during playback where available. ' : 'Unchecked files play at their original levels. ';
  return progress + playback + (!audio.available ? 'New measurements need FFmpeg.'
    : audio.checked < audio.total ? 'Remaining files are measured in the background after scanning.' : 'All files have been checked.');
}
async function refreshAudioStatus() {
  try {
    const response = await apiFetch('/api/audio',{cache:'no-store'});
    if (!response.ok) throw new Error('Restart USB.tv with the latest build to enable audio analysis.');
    const audio = await response.json();
    $('#audio-status').textContent = audioStatusMessage(audio, window.USBTvAudio?.supported());
  } catch (error) { $('#audio-status').textContent = error.message; }
}
async function changeVolumeLevelling(event) {
  const enabled = event.target.checked;
  state.catalog.settings.volume_levelling = enabled;
  applyAudioSetting();
  window.USBTvAudio?.unlock();
  try {
    await saveCatalog();
    await refreshAudioStatus();
  } catch (error) { showToast(error.message); }
}
for (const id of ['volume-levelling','advanced-volume-levelling','player-volume-levelling']) $('#'+id).addEventListener('change',changeVolumeLevelling);
async function changeVolumeProfile(event) {
  state.catalog.settings.volume_profile = event.target.value === 'balanced' ? 'balanced' : 'standard';
  applyAudioSetting(); window.USBTvAudio?.unlock();
  try { await saveCatalog(); } catch (error) { showToast(error.message); }
}
for (const id of ['volume-profile','advanced-volume-profile','player-volume-profile']) $('#'+id).addEventListener('change',changeVolumeProfile);
$('#auto-imports').addEventListener('change',async event=>{
  state.catalog.settings.auto_imports = event.target.checked;
  try { await saveCatalog(); } catch (error) { showToast(error.message); }
});
$('#prepare-external-imports').addEventListener('change',async event=>{
  state.catalog.settings.prepare_external_imports = event.target.checked;
  try { await saveCatalog(); } catch (error) { showToast(error.message); }
});

function displayTitle(video) { return video.title?.trim() || `Untitled ${video.type === "advert" ? "advert" : "programme"} #${video.id}`; }
function activeMedia() { return state.catalog.videos.filter(video => !video.missing); }
function channelNames() { return [...new Set((state.catalog.channels || []).map(channel => channel.name))].sort((a,b) => a.localeCompare(b)); }
function invalidateSchedule() { state.timelines.clear(); }
function timeline(channel) {
  if (!state.timelines.has(channel)) state.timelines.set(channel, Schedule.build({...state.catalog,broadcasts:broadcastState.channels}, channel));
  return state.timelines.get(channel);
}
function reviewReasons(video) {
  return [!video.title?.trim() && "Needs title", video.title_source === "filename" && "Auto title — review", !(video.duration > 0) && "Unreadable length / codec", !["advert","bumper"].includes(video.type) && !video.channels?.length && "Choose channels", !video.genres?.length && "Choose genres", (!["advert","bumper"].includes(video.type) && video.duration > 3000 && !["single", "multiple"].includes(video.episode_review)) && "Possibly multi-episode (over 50 min)", video.duplicate_of && `Duplicate of #${video.duplicate_of}`, video.missing && "Missing file"].filter(Boolean);
}
function guideMinutes() {
  const value = Number(state.catalog.settings?.guide_minutes ?? 120);
  return Number.isFinite(value) ? Math.max(30, Math.min(240, Math.round(value / 30) * 30)) : 120;
}
// Absolute browsing time stays put as the clock advances; null follows live TV.
const guideNavigation = {start:null, channel:null, time:null, kind:"programme"};
function liveGuideStart() { return Date.now(); }
function renderGuideRuler(start, end, live) {
  const ruler = $('#time-ruler');
  ruler.innerHTML = Schedule.guideTicks(start, end, ruler.clientWidth, live).map(tick =>
    `<span style="left:${(tick.time - start) / (end - start) * 100}%">${tick.now ? 'NOW' : formatTime(new Date(tick.time))}</span>`).join('');
}
function renderGuideWindowLabel(start, end, live) {
  $('#guide-window-label').textContent = `${new Date(start).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'})} · ${formatTime(new Date(start))}–${formatTime(new Date(end))}${live ? ' · LIVE' : ' · BROWSING'}`;
}
function applyAdvancedMode() {
  const enabled = Boolean(state.catalog.settings?.advanced_mode);
  $("#advanced-toggle").setAttribute("aria-pressed", String(enabled));
  $("#advanced-toggle").title = enabled ? "Hide advanced controls" : "Show advanced controls";
  document.querySelectorAll("[data-advanced]").forEach(panel => { panel.hidden = !enabled; });
  $('#admin-playback-toggle').checked = Boolean(state.catalog.settings?.admin_playback);
  updatePlaybackControls();
}
function renderGuide() {
  applyAdvancedMode();
  const now = Date.now();
  const minutes = guideMinutes(), horizon = minutes * 60;
  const window = Schedule.guideWindow(now, minutes, guideNavigation.start);
  if (window.live) guideNavigation.start = null;
  const guideStart = window.start, guideEnd = window.end;
  const gridHadFocus = $("#guide-rows").contains(document.activeElement);
  $("#guide-earlier").disabled = guideNavigation.start === null;
  $("#guide-now").setAttribute("aria-pressed", String(guideNavigation.start === null));
  renderGuideWindowLabel(guideStart, guideEnd, window.live);
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  const spanLabel = [hours && `${hours} ${hours === 1 ? "hour" : "hours"}`, remainder && `${remainder} minutes`].filter(Boolean).join(" ");
  $("#guide-span").value = minutes;
  $("#guide-span").setAttribute("aria-valuetext", spanLabel);
  $("#guide-span-value").textContent = spanLabel;
  const focusedKey = document.activeElement?.closest("#guide-rows [data-guide-key]")?.dataset.guideKey;
  const names = playableChannels();
  $("#guide-empty").classList.toggle("hidden", names.length > 0);
  $("#guide-rows").classList.toggle("hidden", names.length === 0);
  $('#guide-rows').dataset.live = String(window.live);
  renderGuideRuler(guideStart, guideEnd, window.live);
  $("#guide-rows").innerHTML = names.map((channel, index) => {
    const slots = Schedule.guide(timeline(channel), guideStart, horizon);
    const color = palette[index % palette.length];
    const moss = [...channel].reduce((hash,char)=>(Math.imul(hash,31)+char.charCodeAt(0))>>>0,0);
    const programmes = slots.map(slot => {
      slot.current = slot.start <= now && slot.end > now;
      slot.progress = slot.current ? (now - slot.start) / (slot.end - slot.start) : 0;
      const width = (Math.min(slot.end, guideEnd) - Math.max(slot.start, guideStart)) / (horizon * 1000) * 100;
      return `<button class="programme ${slot.current ? "current" : "next"} ${width < 12 ? "compact" : ""}" style="width:${width}%;--progress:${Math.round(slot.progress*100)}%" data-channel="${esc(channel)}" data-start="${slot.start}" data-end="${slot.end}" data-guide-key="${esc(JSON.stringify([channel,slot.video.id,slot.start]))}" data-programme-title="${esc(displayTitle(slot.video))}" data-programme-time="${formatTime(new Date(slot.start))}–${formatTime(new Date(slot.end))}" title="${esc(displayTitle(slot.video))} · ${formatTime(new Date(slot.start))}–${formatTime(new Date(slot.end))} · Tune into ${esc(channel)}"><span class="programme-tag">${slot.current ? "ON NOW" : esc((slot.video.genres || []).join(" / ").toUpperCase())}</span><span class="programme-title"><span class="programme-title-text">${esc(displayTitle(slot.video))}</span></span><span class="programme-time">${formatTime(new Date(slot.start))} — ${formatTime(new Date(slot.end))}</span></button>`;
    }).join("");
    const onNow = window.live && slots[0] ? `ON NOW · ${displayTitle(slots[0].video)}` : 'TUNE IN LIVE';
    return `<div class="guide-row"><button class="channel-card" data-moss="${moss%4}" data-moss-flip="${(moss>>>2)%2}" data-channel="${esc(channel)}" aria-label="Tune into ${esc(channel)}"><span class="channel-number">${String(index + 1).padStart(3,"0")}</span><span class="channel-logo" style="color:${color};background:${color}18">${esc(channel.slice(0,1).toUpperCase())}</span><span class="channel-info"><span class="channel-name">${esc(channel)}</span><span class="channel-meta" title="${esc(onNow)}">${esc(onNow)}</span></span></button><div class="schedule-track">${programmes}</div></div>`;
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
function refreshGuideWindow() {
  if (document.hidden || !$('#page-guide').classList.contains('active')) return;
  const now = Date.now();
  if (guideNavigation.start !== null) {
    if (guideNavigation.start <= now) renderGuide();
    return;
  }
  const end = now + guideMinutes() * 60000;
  const tracks = [...$('#guide-rows').querySelectorAll('.schedule-track')];
  // Rebuild only when a programme changes or another enters the far edge.
  // Normal clock ticks preserve DOM nodes, keyboard focus and hover state.
  if (tracks.some(track => !track.firstElementChild || Number(track.firstElementChild.dataset.end) <= now
      || Number(track.lastElementChild.dataset.end) < end)) {
    renderGuide();
    return;
  }
  for (const track of tracks) for (const button of track.children) {
    const start = Number(button.dataset.start), finish = Number(button.dataset.end);
    const width = Math.max(0, Math.min(finish,end) - Math.max(start,now)) / (end-now) * 100;
    button.style.width = `${width}%`;
    button.classList.toggle('compact',width < 12);
    if (button.classList.contains('current')) button.style.setProperty('--progress', `${Math.round((now-start)/(finish-start)*100)}%`);
  }
  renderGuideRuler(now,end,true);
  renderGuideWindowLabel(now,end,true);
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
  const live = liveGuideStart();
  const next = Math.max(live, (guideNavigation.start ?? live) + minutes * 60000);
  guideNavigation.start = next <= live ? null : next;
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
    const live = liveGuideStart();
    const next = Math.max(live,Math.floor(targetTime / 1800000) * 1800000);
    guideNavigation.start = next <= live ? null : next;
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
function updateGuideAudioControls() {
  const muted = $("#guide-preview-video").muted;
  const button = $("#preview-mute");
  const label = muted ? "Unmute preview audio" : "Mute preview audio";
  button.setAttribute("aria-label", label); button.title = label;
  button.setAttribute("aria-pressed", String(muted));
  button.querySelector(".preview-sound-waves").toggleAttribute("hidden", muted);
  button.querySelector(".preview-sound-off").toggleAttribute("hidden", !muted);
  $("#preview-badge").textContent = muted ? "LIVE · MUTED" : "LIVE";
  $("#preview-play").textContent = guidePreview.autoMuted ? "ENABLE SOUND" : muted ? "PLAY PREVIEW" : "PLAY WITH SOUND";
}
function syncGuidePreview() {
  const player = $("#guide-preview-video");
  const current = guidePreview.channel ? Schedule.locate(timeline(guidePreview.channel)) : null;
  $("#channel-preview").classList.toggle("hidden", !current);
  if (!current) {
    player.onloadedmetadata = null;
    if (player.hasAttribute("src")) { player.pause(); player.removeAttribute("src"); player.load(); }
    guidePreview.key = null;
    window.USBTvAudio?.setTrack(null,player);
    return;
  }
  const visible = $("#page-guide").classList.contains("active") && !document.hidden && !$("#player-dialog").open;
  if (!visible) { player.pause(); return; }
  const video = current.segment.video;
  window.USBTvAudio?.setTrack(state.catalog.videos.find(item=>item.id===video.id) || video,player);
  $("#preview-channel").textContent = `${guidePreview.channel} · ${(current.segment.advert || current.segment.bumper) ? (current.segment.bumper ? "STATION BUMPER" : "ADVERTISEMENT BREAK") : "ON AIR"}`;
  $("#preview-title").textContent = displayTitle(video);
  $("#preview-description").textContent = (current.segment.advert || current.segment.bumper) ? `Advert break during ${displayTitle(current.block.video)}.` : video.description || "Now showing on your personal broadcast.";
  $("#preview-meta").textContent = `${formatTime(new Date(current.start))}–${formatTime(new Date(current.end))} · ${(video.genres || []).join(" / ") || "Uncategorised"}`;
  const key = `${guidePreview.channel}:${current.key}`;
  if (guidePreview.key !== key) {
    Object.assign(guidePreview, {key, loaded:false, failed:false, blocked:false, starting:false});
    $("#preview-message").hidden = true; $("#preview-play").hidden = !guidePreview.autoMuted;
    player.onloadedmetadata = () => {
      if (guidePreview.key !== key) return;
      guidePreview.loaded = true;
      syncGuidePreview();
    };
    player.src = videoUrl(video.file); player.load();
  } else if (guidePreview.loaded && !guidePreview.failed) {
    // A blocked preview must not become a slideshow of periodic live seeks.
    if (guidePreview.blocked || guidePreview.starting) return;
    if (player.paused || Math.abs(player.currentTime - current.position) > 3) seekToLive(current.position, player);
    if (player.paused) {
      guidePreview.starting = true;
      player.play().then(() => {
        if (guidePreview.key === key && !player.muted && window.USBTvAudio?.suspended()) {
          guidePreview.blocked = true; $("#preview-play").hidden = false;
        }
      }).catch(async error => {
        if (guidePreview.key !== key || !$("#page-guide").classList.contains("active") || document.hidden || $("#player-dialog").open) return;
        if (error.name === 'NotAllowedError' && !player.muted) {
          player.muted = true; guidePreview.autoMuted = true;
          updateGuideAudioControls(); $("#preview-play").hidden = false;
          try { await player.play(); return; } catch (_) {}
        }
        guidePreview.blocked = true; $("#preview-play").hidden = false;
      }).finally(() => { if (guidePreview.key === key) guidePreview.starting = false; });
    }
  }
}
const libraryView = {page:0}, bulkView = {page:0};
const unassigned = video => !["advert","bumper"].includes(video.type) && !video.channels?.length;
function labelFilters(prefix) {
  const records=prefix==='bulk'?[...state.catalog.videos,...bulkRows]:state.catalog.videos;
  const genres=[...new Set([...(state.catalog.genres||[]),...records.flatMap(v=>v.genres||[])])].sort((a,b)=>a.localeCompare(b));
  for (const [field,values] of [["channel",channelNames()],["genre",genres]]) {
    const select = $("#"+prefix+"-"+field), previous = select.value;
    select.innerHTML = `<option value="">All ${field}s</option>` + values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("");
    if (values.includes(previous)) select.value = previous;
  }
  $('#known-tags').innerHTML=[...new Set(records.flatMap(v=>v.tags||[]))].sort((a,b)=>a.localeCompare(b)).map(tag=>`<option value="${esc(tag)}"></option>`).join('');
}
const mediaFilterFields=['search','channel','genre','tags-filter','tag-mode','min-minutes','max-minutes','sort','search-field','enabled-filter','type-filter','metadata-filter'];
function mediaFilters(prefix) {
  const value=key=>$('#'+prefix+'-'+key).value;
  const min=value('min-minutes'),max=value('max-minutes');
  $('#'+prefix+'-filter-note').textContent=min!==''&&max!==''&&Number(min)>Number(max)
    ? 'Minimum length exceeds maximum length. Adjust the range to show matches.'
    : (min!==''||max!==''?'Length limits include their endpoints; files with unknown lengths are excluded.':'');
  return {search:value('search'),channel:value('channel'),genre:value('genre'),tags:value('tags-filter'),tagMode:value('tag-mode'),
    minMinutes:min,maxMinutes:max,sort:value('sort'),searchField:value('search-field'),enabled:value('enabled-filter'),type:value('type-filter'),status:value('metadata-filter')};
}
function resetMediaFilters(prefix, render=true) {
  for(const field of mediaFilterFields) {
    const control=$('#'+prefix+'-'+field);
    control.value=field==='sort'?'source':field==='search-field'?'all':field==='tag-mode'?'all':'';
  }
  if(prefix==='library') {$('#library-filter').value='all';libraryView.page=0;if(render)renderLibrary();}
  else {bulkView.page=0;if(render)renderBulkRows();}
}
function filteredLibrary() {
  const filter = $("#library-filter").value;
  const scope=state.catalog.videos.filter(video => filter === "missing" ? video.missing : !video.missing &&
    (filter === "all" || filter === "review" && reviewReasons(video).length || filter === "unassigned" && unassigned(video) || video.type === filter));
  return USBTvSuggestions.filterMedia(scope,mediaFilters('library'));
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
  if (!$('#library-filter-note').textContent.startsWith('Minimum')) $('#library-filter-note').textContent=`${matches.length} matching files · ${formatDuration(matches.reduce((sum,v)=>sum+(Number(v.duration)>0?Number(v.duration):0),0))} total airtime${$('#library-filter-note').textContent?' · '+$('#library-filter-note').textContent:''}`;
  const videos = pageItems(matches,"library",libraryView);
  $("#library-count").textContent = `${activeMedia().length} MEDIA FILES`;
  $("#review-count").textContent = `${activeMedia().filter(unassigned).length} unassigned · ${activeMedia().filter(video => reviewReasons(video).length).length} need review`;
  $("#library-empty").classList.toggle("hidden", all.length > 0);
  $(".table-wrap").classList.toggle("hidden", videos.length === 0);
  $("#read-page-lengths").disabled = !videos.some(video=>!video.missing && !(video.duration>0));
  $("#library-body").innerHTML = videos.map(video => `<tr><td><span class="media-id">#${esc(video.id)}</span><div class="library-title">${esc(displayTitle(video))}</div><div class="bulk-file">${esc(video.file)}</div><div class="library-tags">${esc((video.tags||[]).join(' · '))}</div></td><td>${video.type === "bumper" ? "Bumper" : video.type === "advert" ? "Advert" : "Programme"}${video.enabled === false ? " · Disabled" : ""}</td><td class="duration-cell">${formatDuration(video.duration)}</td><td>${esc((video.genres || []).join(", ") || "—")}</td><td>${esc(video.channels?.join(", ") || (["advert","bumper"].includes(video.type) ? "All channels" : "No channels"))}<span class="review-label">${esc(reviewReasons(video).join(" · "))}</span></td><td><button class="media-edit" data-edit="${esc(video.id)}">EDIT</button></td></tr>`).join("");
  $("#library-body").querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => openEditor(button.dataset.edit)));
}
let reshuffling = false;
let deletingChannel = false;
async function deleteChannel(name) {
  if (deletingChannel || reshuffling || name === CUSTOMS_CHANNEL || !state.catalog.channels.some(channel=>channel.name===name)) return;
  if (state.scanning) { showToast('Wait for the scan to finish before deleting a channel.'); return; }
  const assigned = state.catalog.videos.filter(video=>video.channels?.includes(name));
  const exclusiveAds = assigned.filter(video=>['advert','bumper'].includes(video.type) && video.channels.length===1);
  const message = `Delete channel “${name}”?\n\nRemove this channel and its assignments from ${assigned.length} media item(s). Programmes with no remaining channel move to Interdimensional Customs.\n${exclusiveAds.length ? `${exclusiveAds.length} advert(s)/bumper(s) assigned only here will be disabled to prevent them playing on every channel.\n` : ''}\nYour video files and other channels will be kept. This cannot be undone.`;
  if (!window.confirm(message)) return;
  deletingChannel = true; renderChannels();
  let previous, candidate, saved = false;
  try {
    await saveQueue; await broadcastQueue;
    if (state.scanning) throw new Error('Wait for the scan to finish before deleting a channel.');
    previous = state.catalog;
    candidate = JSON.parse(JSON.stringify(previous));
    candidate.channels = candidate.channels.filter(channel=>channel.name!==name);
    for (const video of candidate.videos) {
      const hadChannel = video.channels?.includes(name);
      video.channels = (video.channels || []).filter(channel=>channel!==name);
      if (hadChannel && !video.channels.length && ['advert','bumper'].includes(video.type)) video.enabled=false;
    }
    for (const rule of candidate.label_rules || []) rule.channels=(rule.channels || []).filter(channel=>channel!==name);
    state.catalog = candidate;
    state.catalog = await saveCatalog(); saved = true;
    if (state.playback?.channel===name) $('#player-dialog').close();
    if (guideNavigation.channel===name) guideNavigation.channel=null;
    renderAll();
    await broadcastQueue;
    showToast(`Channel “${name}” deleted. Video files kept.`);
  } catch (error) {
    if (!saved && candidate && state.catalog===candidate) state.catalog=previous;
    renderAll();
    showToast(saved ? `Channel deleted. Schedule cleanup will retry: ${error.message}` : `Channel was not deleted: ${error.message}`);
  } finally { deletingChannel=false; renderChannels(); }
}
async function reshuffleChannels(name = null) {
  if (reshuffling || deletingChannel || !broadcastState.ready) return;
  if (state.scanning) { showToast('Wait for the scan to finish before reshuffling.'); return; }
  reshuffling = true; renderChannels();
  try {
    await saveQueue; await broadcastQueue;
    const updated = name === null ? USBTvPlans.reshuffleAll(state.catalog,broadcastState.channels)
      : USBTvPlans.reshuffle(state.catalog,broadcastState.channels,name);
    await persistBroadcasts(updated);
    broadcastState.channels = updated;
    renderAll(); syncChannel(true); syncGuidePreview();
    showToast(`${name === null ? 'All channels' : 'Channel'} reshuffled and restarted. New assignments are included.`);
  } catch (error) { showToast(error.message); }
  finally { reshuffling = false; renderChannels(); }
}
$('#shuffle-all-channels').addEventListener('click', () => reshuffleChannels());
function renderChannels() {
  $('#shuffle-all-channels').disabled = !broadcastState.ready || reshuffling || deletingChannel || !state.catalog.channels.length;
  $('#add-channel-form').querySelectorAll('input,button').forEach(control=>{control.disabled=deletingChannel;});
  $("#channel-settings").innerHTML = channelNames().map(name => {
    const channel = state.catalog.channels.find(item => item.name === name);
    if (name === CUSTOMS_CHANNEL) return `<div class="channel-setting"><strong>${esc(name)}</strong><span class="channel-lineup-status">Automatic queue of unassigned programmes. Assigned videos leave after the current showing. No adverts.</span></div>`;
    const pending = Object.hasOwn(broadcastState.channels,name) ? broadcastState.channels[name]?.pending : null;
    const status = pending ? `Updated lineup starts ${new Date(pending.anchor).toLocaleString([], {weekday:'short',hour:'2-digit',minute:'2-digit'})}` : 'Current lineup repeats until you change it.';
    return `<div class="channel-setting"><strong>${esc(name)}</strong><label>Approx. interval (min)<input type="number" min="1" max="120" step="1" data-channel="${esc(name)}" data-setting="ad_interval" value="${Number(channel.ad_interval ?? state.catalog.settings.ad_interval ?? 900)/60}"></label><label>Break length (sec)<input type="number" min="0" max="600" step="1" data-channel="${esc(name)}" data-setting="ad_length" value="${Number(channel.ad_length ?? state.catalog.settings.ad_length ?? 90)}"></label><button type="button" class="media-edit" data-reshuffle="${esc(name)}">RESHUFFLE NOW</button><button type="button" class="media-edit" data-delete-channel="${esc(name)}" aria-label="Delete channel ${esc(name)}">DELETE CHANNEL</button><span class="channel-lineup-status">${esc(status)}</span></div>`;
  }).join("") || '<p>Add a channel, then assign programmes to it in the editor.</p>';
  $("#channel-settings").querySelectorAll("input").forEach(input => input.addEventListener("change", async () => {
    if (deletingChannel) return;
    if (!input.checkValidity()) { input.reportValidity(); return; }
    const channel = state.catalog.channels.find(item => item.name === input.dataset.channel);
    channel[input.dataset.setting] = Number(input.value) * (input.dataset.setting === "ad_interval" ? 60 : 1);
    try { state.catalog = await saveCatalog(); renderAll(); } catch (_) {}
  }));
  $("#channel-settings").querySelectorAll('[data-reshuffle]').forEach(button => {
    button.disabled = !broadcastState.ready || reshuffling || deletingChannel;
    button.addEventListener('click', () => reshuffleChannels(button.dataset.reshuffle));
  });
  $('#channel-settings').querySelectorAll('input').forEach(input=>{input.disabled=deletingChannel;});
  $('#channel-settings').querySelectorAll('[data-delete-channel]').forEach(button=>{
    button.disabled=deletingChannel || reshuffling || state.scanning;
    button.addEventListener('click',()=>deleteChannel(button.dataset.deleteChannel));
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
  const rowsById=new Map(bulkRows.map(row=>[row.id,row]));
  return USBTvSuggestions.filterMedia(bulkRows.map(row=>({...actual.get(row.id),...row})),mediaFilters('bulk')).map(video=>rowsById.get(video.id));
}
function visibleBulkRows() {
  const size = Number($("#bulk-page-size").value);
  return filteredBulkRows().slice(bulkView.page*size,(bulkView.page+1)*size);
}
function updateBulkSummary(message = "") {
  const selected = bulkRows.filter(row => row.selected).length;
  const matches=filteredBulkRows(),hiddenSelected=selected-matches.filter(row=>row.selected).length;
  $("#bulk-summary").textContent = `${matches.length} matching / ${bulkRows.length} files · ${selected} selected across all pages${hiddenSelected?` · ${hiddenSelected} selected outside current filters`:''}${message ? " · " + message : ""}`;
  const visible = visibleBulkRows(), checked = visible.filter(row=>row.selected).length;
  $("#bulk-select-all").checked = Boolean(visible.length && checked === visible.length);
  $("#bulk-select-all").indeterminate = checked > 0 && checked < visible.length;
  $("#bulk-apply").textContent = `SAVE ${selected} SELECTED ${selected === 1 ? "FILE" : "FILES"}`;
  $("#bulk-apply").disabled = selected === 0;
}
function renderBulkRows() {
  labelFilters('bulk');
  const actual = new Map(state.catalog.videos.map(video=>[video.id,video]));
  const visible = pageItems(filteredBulkRows(),"bulk",bulkView);
  $("#bulk-body").innerHTML = visible.map(row => {
    const video = actual.get(row.id);
    return `<tr data-id="${esc(row.id)}"><td><input type="checkbox" data-bulk-select aria-label="Approve media ${esc(row.id)}" ${row.selected ? "checked" : ""}></td><td><span class="media-id">#${esc(row.id)}</span><div class="bulk-file">${esc(video.file)}</div><div class="settings-note">${formatDuration(video.duration)}${row.enabled===false||row.enabled===undefined&&video.enabled===false?" · Disabled":""}</div><div class="library-tags">${esc((row.tags||[]).join(" · "))}</div><span class="settings-note">${esc([...row.reasons,...reviewReasons(video).filter(reason=>reason.startsWith("Possibly multi-episode") || reason === "Auto title — review")].join(" · "))}</span>${!["advert","bumper"].includes(video.type) && (video.duration > 3000 || video.episode_review === "multiple") ? `<button type="button" class="media-edit" data-review-episodes="${esc(video.id)}">REVIEW EPISODES</button>` : ""}</td><td><input data-bulk-field="title" aria-label="Title for ${esc(row.id)}" value="${esc(row.title)}" placeholder="Needs title"><details><summary>Type, description, tags &amp; taglines</summary><label>Type<select data-bulk-field="type" aria-label="Type for ${esc(row.id)}"><option value="programme" ${(row.type || video.type) === "programme" ? "selected" : ""}>Programme</option><option value="advert" ${(row.type || video.type) === "advert" ? "selected" : ""}>Advert</option><option value="bumper" ${(row.type || video.type) === "bumper" ? "selected" : ""}>Bumper</option></select></label><label>Bumper position<select data-bulk-field="bumper_role"><option value="to_ads" ${!["from_ads","both"].includes(row.bumper_role || video.bumper_role) ? "selected" : ""}>Before advert break</option><option value="from_ads" ${(row.bumper_role || video.bumper_role) === "from_ads" ? "selected" : ""}>After advert break</option><option value="both" ${(row.bumper_role || video.bumper_role) === "both" ? "selected" : ""}>Before and after</option></select></label>${[["description","Description",1000],["tags","Tags",1000],["tagline","Retro tagline",300],["tagline_goblin","Goblin tagline",300]].map(([field,label,limit]) => `<label>${label}<textarea data-bulk-field="${field}" aria-label="${label} for ${esc(row.id)}" maxlength="${limit}" rows="2">${esc(field === "tags" ? (row.tags || []).join(", ") : row[field] || "")}</textarea></label>`).join("")}</details></td><td><input data-bulk-field="genres" aria-label="Genres for ${esc(row.id)}" value="${esc(row.genres.join(", "))}" list="known-genres" placeholder="Choose genres"></td><td><input data-bulk-field="channels" aria-label="Channels for ${esc(row.id)}" value="${esc(row.channels.join(", "))}" list="known-channels" placeholder="${["advert","bumper"].includes(video.type) ? "All channels" : "Choose channels"}"></td></tr>`;
  }).join("");
  $("#bulk-body").querySelectorAll("[data-review-episodes]").forEach(button=>button.addEventListener("click",()=>openEditor(button.dataset.reviewEpisodes)));
  $("#bulk-body").querySelectorAll("[data-bulk-select]").forEach(input => input.addEventListener("change", () => {
    bulkRows.find(row => row.id === input.closest("tr").dataset.id).selected = input.checked;
    updateBulkSummary();
  }));
  $("#bulk-body").querySelectorAll("[data-bulk-field]").forEach(input => input.addEventListener("input", () => {
    const row = bulkRows.find(row => row.id === input.closest("tr").dataset.id);
    row[input.dataset.bulkField] = ["genres", "channels", "tags"].includes(input.dataset.bulkField) ? USBTvSuggestions.list(input.value) : input.value;
    row.edited = true;
    row.editedFields=[...new Set([...(row.editedFields||[]),input.dataset.bulkField])];
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
  $('#bulk-import-policy').value='preserve';updateImportPolicyNote();
  $("#bulk-rules").value = (state.catalog.label_rules || []).map(rule => `${rule.keyword} => ${(rule.genres || []).join(", ")} | ${(rule.channels || []).join(", ")}`).join("\n");
  $("#bulk-scope").value = "filtered";
  bulkView.page = 0;
  resetMediaFilters('bulk',false);
  $('#bulk-sort').value=$('#library-sort').value;
  $("#bulk-search").value = "";
  labelFilters("bulk");
  $("#bulk-channel").value = ""; $("#bulk-genre").value = "";
  $("#bulk-genres").value = ""; $("#bulk-channels").value = "";
  for(const key of ['tags','type','enabled'])$('#bulk-'+key).value='';
  $("#known-genres").innerHTML = (state.catalog.genres || []).map(genre => `<option value="${esc(genre)}"></option>`).join("");
  $("#known-channels").innerHTML = assignableChannelNames().map(channel => `<option value="${esc(channel)}"></option>`).join("");
  generateBulk(); $("#bulk-dialog").showModal();
}
async function importBulkFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 8_000_000) throw new Error("Choose a CSV/JSON file smaller than 8 MB.");
    const drafts=new Map(bulkRows.filter(row=>row.selected||row.edited).map(row=>[row.id,row]));
    const importCatalog={...state.catalog,videos:state.catalog.videos.map(video=>({...video,...drafts.get(video.id)}))};
    const protectedFields=Object.fromEntries([...drafts].map(([id,row])=>[id,row.editedFields||[]]));
    const {found,skipped,protectedRows} = USBTvSuggestions.importText(await file.text(),importCatalog,{mode:$('#bulk-import-policy').value,protectedFields});
    if($('#bulk-import-policy').value!=='replace') for(const row of found) {
      const draft=drafts.get(row.id);
      if(draft?.edited) {row.edited=true;row.editedFields=[...(draft.editedFields||[])];}
    }
    const merged = new Map(bulkRows.map(row => [row.id,row]));
    found.forEach(row => merged.set(row.id,row));
    bulkRows = [...merged.values()];
    bulkView.page = 0;
    resetMediaFilters('bulk',false);
    $("#bulk-search").value = ""; $("#bulk-channel").value = ""; $("#bulk-genre").value = "";
    renderBulkRows();
    const kept=protectedRows.filter(row=>!row.skipped).length, ignored=protectedRows.filter(row=>row.skipped).length;
    updateBulkSummary(`Loaded ${found.length} suggestions${kept?` · kept existing fields on ${kept} videos`:''}${ignored?` · skipped ${ignored} labelled videos`:''} · rejected ${skipped.length} invalid rows`);
    $("#bulk-error").textContent = skipped.slice(0,5).join(". ");
  } catch (error) { $("#bulk-error").textContent = error.message; }
  finally { event.target.value = ""; }
}
function updateImportPolicyNote() {
  const mode=$('#bulk-import-policy').value;
  $('#bulk-import-policy-note').textContent=mode==='replace'
    ? 'Replace mode: supplied fields can overwrite or clear existing values. Imported rows start unselected; review them before Save selected files.'
    : mode==='skip-labelled'
    ? 'Skip mode: ignore imported rows for videos with existing genres, channels, tags, descriptions or taglines. Other videos only fill empty fields; existing titles and types are kept.'
    : 'Keep existing is the default: only fill empty fields. Existing titles, programme/advert types and label lists are kept, including any draft edits. Unrestricted adverts keep All channels. Scanned and manually entered values are both protected.';
}
$('#bulk-import-policy').addEventListener('change',updateImportPolicyNote);
function assignBulk() {
  const selected = bulkRows.filter(row => row.selected);
  if (!selected.length) { $("#bulk-error").textContent = "Select rows first."; return; }
  const assignments={genres:$('#bulk-genres').value,channels:$('#bulk-channels').value,tags:$('#bulk-tags').value,type:$('#bulk-type').value,enabled:$('#bulk-enabled').value};
  selected.forEach(row => {
    Object.assign(row,USBTvSuggestions.assignLabels(row,assignments,$('#bulk-mode').value));
    row.editedFields=[...new Set([...(row.editedFields||[]),...Object.keys(assignments).filter(key=>assignments[key].trim())])];
    row.reasons = ["Manual bulk assignment"];
    row.edited = true;
  });
  for(const key of ['genres','channels','tags','type','enabled'])$('#bulk-'+key).value='';
  $("#bulk-error").textContent = ""; renderBulkRows();
}
async function applyBulk(rulesOnly = false) {
  let rules;
  try { rules = USBTvSuggestions.parseRules($("#bulk-rules").value); }
  catch (error) { $("#bulk-error").textContent = error.message; return; }
  const selected = rulesOnly ? [] : bulkRows.filter(row => row.selected);
  if (!rulesOnly && !selected.length) { $("#bulk-error").textContent = "Select at least one row to save assignments."; return; }
  if (!rulesOnly && ['genres','channels','tags','type','enabled'].some(key=>$('#bulk-'+key).value.trim())) assignBulk();
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
      if (video.title_source === 'filename') video.title_source = 'manual';
      for (const field of ["type", "bumper_role", "enabled", "description", "tags", "tagline", "tagline_goblin"]) if (row[field] !== undefined) video[field] = row[field];
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
function episodeTimestamp(value) {
  const parts = String(value).trim().split(":");
  if (!parts.length || parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part)) ||
      parts.length > 1 && Number(parts.at(-1)) >= 60 || parts.length === 3 && Number(parts[1]) >= 60)
    throw new Error("Use episode timestamps such as 0:00, 22:30 or 1:05:00.");
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}
function markerStamp(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(milliseconds / 60000), remainder = (milliseconds % 60000) / 1000;
  return `${minutes}:${remainder < 10 ? "0" : ""}${remainder}`;
}
function readEpisodeRows() {
  let previous = 0;
  const episodes = [...$("#episode-rows").children].map(row => {
    const title = row.querySelector('[data-episode="title"]').value.trim();
    const start = episodeTimestamp(row.querySelector('[data-episode="start"]').value);
    let end = episodeTimestamp(row.querySelector('[data-episode="end"]').value);
    if (Math.abs(end - state.editing.duration) <= .001) end = state.editing.duration;
    if (!title || !(start >= previous && start < end && end <= state.editing.duration))
      throw new Error("Give every episode a title and ordered, non-overlapping boundaries within the video.");
    previous = end;
    return {title,start,end};
  });
  if (episodes.length > 200) throw new Error("Use up to 200 episodes.");
  return episodes;
}
function renderEpisodeRows(episodes) {
  $("#episode-rows").innerHTML = episodes.map((episode,index) => `<div class="episode-row"><label>Episode ${index+1}<input data-episode="title" maxlength="300" value="${esc(episode.title)}"></label><label>Start<input data-episode="start" value="${markerStamp(episode.start)}"></label><label>End<input data-episode="end" value="${markerStamp(episode.end)}"></label><div class="editor-actions"><button type="button" data-episode-preview="start">PREVIEW START</button><button type="button" data-episode-preview="end">PREVIEW END</button><button type="button" data-episode-remove>REMOVE</button></div></div>`).join("");
}
function updateEpisodeEditor() {
  const programme = $("#edit-type").value === "programme";
  $("#edit-bumper-options").hidden = $("#edit-type").value !== "bumper";
  $("#episode-review-panel").hidden = !programme;
  $("#episode-markers").hidden = $("#edit-episode-review").value !== "multiple";
}
$("#edit-episode-review").addEventListener("change", updateEpisodeEditor);
$("#edit-type").addEventListener("change", updateEpisodeEditor);
$("#divide-episodes").addEventListener("click", () => {
  const count = Number($("#episode-count").value), duration = Number(state.editing.duration);
  if (!Number.isInteger(count) || count < 2 || count > 200 || !(duration > 0)) {
    $("#editor-error").textContent = "Choose 2–200 episodes and a video with a known length."; return;
  }
  renderEpisodeRows(Array.from({length:count},(_,index) => ({title:`${$("#edit-title").value || displayTitle(state.editing)} — Episode ${index+1}`,
    start:Math.floor(index * duration / count),end:index === count-1 ? duration : Math.floor((index+1) * duration / count)})));
  $("#editor-error").textContent = "Suggested equal divisions — review the boundaries before saving.";
});
$("#add-episode").addEventListener("click", () => {
  try {
    const episodes = readEpisodeRows(), start = episodes.at(-1)?.end || 0;
    if (episodes.length >= 200 || start >= state.editing.duration) throw new Error("Make room before the end of the video to add an episode.");
    episodes.push({title:`Episode ${episodes.length+1}`,start,end:state.editing.duration}); renderEpisodeRows(episodes);
  } catch (error) { $("#editor-error").textContent = error.message; }
});
$("#episode-rows").addEventListener("click", event => {
  const row = event.target.closest(".episode-row");
  if (!row) return;
  if (event.target.closest("[data-episode-remove]")) { row.remove(); return; }
  const button = event.target.closest("[data-episode-preview]");
  if (!button) return;
  try {
    let position = episodeTimestamp(row.querySelector(`[data-episode="${button.dataset.episodePreview}"]`).value);
    if (button.dataset.episodePreview === "end") position = Math.max(0,position-5);
    if (!(position >= 0 && position < state.editing.duration)) throw new Error("Preview time must be within the video.");
    previewVideo(state.editing.id,position);
  } catch (error) { $("#editor-error").textContent = error.message; }
});
function rememberEditDraft(video) {
  try { sessionStorage.setItem('usbtv-edit-draft',JSON.stringify(video)); $('#recover-edit-draft').hidden = false; return true; }
  catch (_) { return false; }
}
function clearEditDraft(id) {
  try {
    if (JSON.parse(sessionStorage.getItem('usbtv-edit-draft'))?.id === id) sessionStorage.removeItem('usbtv-edit-draft');
    $('#recover-edit-draft').hidden = !sessionStorage.getItem('usbtv-edit-draft');
  } catch (_) {}
}
$('#recover-edit-draft').addEventListener('click', () => {
  try {
    const draft = JSON.parse(sessionStorage.getItem('usbtv-edit-draft'));
    const current = state.catalog.videos.find(video => video.id === draft?.id);
    if (!current || current.missing || current.fingerprint !== draft.fingerprint || current.duration !== draft.duration) {
      showToast('The draft’s file has changed or is unavailable. The draft cannot safely be restored.'); return;
    }
    openEditor(current.id,draft);
    $('#editor-error').textContent = 'Recovered unsaved draft. Review it against the refreshed library before saving.';
  } catch (_) { showToast('No saved edit draft is available in this tab.'); }
});
try { $('#recover-edit-draft').hidden = !sessionStorage.getItem('usbtv-edit-draft'); } catch (_) {}
function openEditor(id, draft = null) {
  let video = state.catalog.videos.find(item => item.id === id);
  if (!video) return;
  if (draft) {
    video = {...video};
    for (const key of ['title','type','bumper_role','genres','channels','tags','enabled','description','tagline','tagline_goblin','break_points','breaks_approved','episode_review','episodes']) video[key] = structuredClone(draft[key]);
  }
  state.editing = structuredClone(video);
  $("#editor-heading").textContent = `Edit media #${video.id}`;
  $("#editor-file").textContent = video.file;
  $("#edit-title").value = video.title || "";
  $("#new-genre").value = "";
  $("#edit-type").value = video.type;
  $("#edit-bumper-role").value = video.bumper_role || "to_ads";
  $("#edit-episode-review").value = video.episode_review || "unchecked";
  $("#episode-review-panel").open = !["advert","bumper"].includes(video.type) && (video.duration > 3000 || video.episode_review === "multiple");
  $("#episode-review-hint").textContent = video.duration > 3000 && !["single","multiple"].includes(video.episode_review) ? "· Possibly multi-episode" : "";
  $("#episode-count").value = Math.max(2,video.episodes?.length || 2);
  renderEpisodeRows(video.episodes || []); updateEpisodeEditor();
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
  $("#break-editor").hidden = video.type !== "programme";
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
    if (draft.title_source === 'filename') draft.title_source = 'manual';
    draft.type = $("#edit-type").value;
    draft.bumper_role = $("#edit-bumper-role").value;
    draft.episode_review = $("#edit-episode-review").value;
    draft.episodes = draft.episode_review === "multiple" ? readEpisodeRows() : draft.episodes || [];
    if (draft.episode_review === "multiple" && draft.episodes.length < 2) throw new Error("Add at least two episodes, or choose Single programme.");
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
    catch (error) {
      if (error.status === 409 && rememberEditDraft(draft)) error.message += ' Your draft is kept in this tab. Refresh, then choose Recover edit draft in Library & labels.';
      state.catalog.videos[index] = before; throw error;
    }
    clearEditDraft(draft.id);
    $("#editor-dialog").close();
    renderAll(); if ($("#bulk-dialog").open) renderBulkRows(); showToast("Labels saved to USB");
  } catch (error) { $("#editor-error").textContent = error.message; }
  finally { $("#save-media").disabled = false; }
}
async function analyseBreaks() {
  const id = state.editing?.id;
  if (!id) return;
  $("#analyse-breaks").disabled = true;
  $("#editor-error").textContent = "Analysing the file locally. This can take several minutes…";
  try {
    const response = await apiFetch("/api/analyse", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (saveRevision === data.base_revision) {
      saveRevision = data.revision; state.catalog.revision = data.revision;
    }
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
  // Use the loaded segment, even when paused across a live schedule boundary.
  const id = ['channel','replay'].includes(playback?.mode) ? playback.mediaId
    || (playback.mode === 'channel' ? Schedule.locate(timeline(playback.channel))?.segment.video.id : playback.current?.segment.video.id)
    : playback?.id;
  const video = state.catalog.videos.find(item=>item.id===id);
  if (!video) {showToast("No media is currently playing");return;}
  quickLabelId = id;
  $("#quick-label-heading").textContent = `Edit #${video.id} · ${displayTitle(video)}`;
  $("#quick-label-file").textContent = video.file;
  $("#quick-label-title").value = video.title || "";
  $('#quick-label-type').value = video.type;
  $('#quick-label-bumper-role').value = video.bumper_role || 'to_ads';
  $('#quick-label-enabled').checked = video.enabled !== false;
  $('#quick-label-all-channels').checked = ['advert','bumper'].includes(video.type) && !video.channels.length;
  updateQuickLabelType();
  $("#quick-label-genres").value = (video.genres || []).join(", ");
  $("#quick-label-tags").value = (video.tags || []).join(", ");
  $("#quick-label-channels").innerHTML = assignableChannelNames().map(name=>`<label class="check-label"><input type="checkbox" value="${esc(name)}" ${video.channels.includes(name) || $('#quick-label-all-channels').checked ? "checked" : ""}>${esc(name)}</label>`).join("");
  $('#quick-label-channels').querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
    $('#quick-label-all-channels').checked = false;
  }));
  $("#quick-label-error").textContent = "";
  $("#quick-label-panel").hidden = false;
  $("#quick-label-toggle").setAttribute("aria-expanded","true");
  $("#quick-label-title").focus();
}
$("#quick-label-toggle").addEventListener("click",()=>$("#quick-label-panel").hidden ? openQuickLabels() : closeQuickLabels());
function updateQuickLabelType() {
  const advert = ['advert','bumper'].includes($('#quick-label-type').value);
  $('#quick-label-bumper-options').hidden = $('#quick-label-type').value !== 'bumper';
  $('#quick-label-global-option').hidden = !advert;
  $('#quick-label-channel-legend').textContent = advert ? 'Allowed channels' : 'Show on channels';
  $('#quick-label-channel-note').textContent = advert
    ? 'Untick a channel to exclude this advert or bumper. All channels also includes future channels. To stop it everywhere, turn off Enabled for broadcast. Lineup changes normally wait for the next scheduled update; reshuffle a channel to apply them now.'
    : 'Interdimensional Customs automatically shows unassigned programmes. Assigning a channel or changing to Advert removes this programme from Customs after the current showing finishes.';
}
$('#quick-label-type').addEventListener('change', () => {
  // Converting an unrestricted advert must not assign a programme everywhere.
  if ($('#quick-label-type').value === 'programme' && $('#quick-label-all-channels').checked) {
    $('#quick-label-all-channels').checked = false;
    $('#quick-label-channels').querySelectorAll('input').forEach(input => {input.checked = false;});
  }
  updateQuickLabelType();
});
$('#quick-label-all-channels').addEventListener('change', event => {
  if (event.target.checked) $('#quick-label-channels').querySelectorAll('input').forEach(input => {input.checked = true;});
});
for (const id of ["quick-label-close","quick-label-cancel"]) $("#"+id).addEventListener("click",closeQuickLabels);
$("#quick-label-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const video = state.catalog.videos.find(item=>item.id===quickLabelId);
  if (!video || $("#quick-label-panel").dataset.saving === "true") return;
  const type = $('#quick-label-type').value;
  const enabled = $('#quick-label-enabled').checked;
  const allChannels = ['advert','bumper'].includes(type) && $('#quick-label-all-channels').checked;
  const channels = [...$("#quick-label-channels").querySelectorAll("input:checked")].map(input=>input.value);
  if (['advert','bumper'].includes(type) && enabled && !allChannels && !channels.length) {
    $('#quick-label-error').textContent = 'Choose at least one allowed channel, choose All channels, or turn off Enabled for broadcast.';
    return;
  }
  const before = structuredClone(video);
  let metadataSaved = false;
  video.title = $("#quick-label-title").value.trim();
  video.type = type; video.bumper_role = $('#quick-label-bumper-role').value; video.enabled = enabled;
  video.genres = USBTvSuggestions.list($("#quick-label-genres").value);
  video.tags = USBTvSuggestions.list($("#quick-label-tags").value);
  video.channels = allChannels ? [] : channels;
  const panel = $("#quick-label-panel"), controls = [...panel.querySelectorAll("button,input,select")];
  panel.dataset.saving = "true"; controls.forEach(control=>{control.disabled=true;});
  try {
    state.catalog = await saveCatalog(); metadataSaved = true; clearEditDraft(video.id);
    renderAll(); await broadcastQueue;
    panel.dataset.saving = "false"; closeQuickLabels();
    showToast(video.enabled === false ? 'Labels saved · disabled for broadcast' : 'Labels saved · lineup changes follow the channel schedule');
  } catch(error) {
    // A schedule write may fail after metadata was saved; retain those edits.
    if (!metadataSaved) {
      if (error.status === 409 && rememberEditDraft(video)) error.message += ' Your draft is kept in this tab. Refresh, then choose Recover edit draft in Library & labels.';
      Object.assign(video,before);
    }
    $("#quick-label-error").textContent = error.message;
  } finally {panel.dataset.saving="false";controls.forEach(control=>{control.disabled=false;});}
});
$('#retry-media').addEventListener('click', () => {
  const playback = state.playback;
  if (playback?.mode !== 'channel' || !playback.failed) return;
  playback.key = null; playback.failed = false;
  syncChannel(true);
});
function showPlayer(reveal = true) {
  $('#retry-media').hidden = true;
  window.USBTvAudio?.unlock();
  $("#guide-preview-video").pause();
  if (!$("#player-dialog").open) $("#player-dialog").showModal();
  $('#player').focus({preventScroll:true});
  if (fullscreenElement() && state.catalog.settings?.fullscreen_mode !== "app") $("#player-dialog").classList.add("video-fills-screen");
  updatePlaybackControls();
  if(reveal)revealPlayerControls();else hidePlayerControls();
  updateFullscreenButtons();
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
  positionChannelOsd();
  clearTimeout(channelEntry.hideTimer);
  if (temporary) channelEntry.hideTimer = setTimeout(() => {osd.hidden=true;},2200);
}
function positionChannelOsd() {
  const dialog = $('#player-dialog'), osd = $('#channel-osd');
  if (!dialog.open) {osd.style.removeProperty('bottom');return;}
  if (osd.hidden) return;
  const box = dialog.getBoundingClientRect(), video = $('#player').getBoundingClientRect();
  // Stay above the video's lower edge, even when mobile controls sit below it.
  osd.style.bottom = `${Math.max(16,box.bottom - video.bottom - dialog.clientTop + 54)}px`;
}
window.addEventListener('resize',positionChannelOsd);
document.addEventListener('fullscreenchange',()=>requestAnimationFrame(positionChannelOsd));
document.addEventListener('webkitfullscreenchange',()=>requestAnimationFrame(positionChannelOsd));
if (typeof ResizeObserver !== 'undefined') {
  const osdResizeObserver = new ResizeObserver(positionChannelOsd);
  osdResizeObserver.observe($('#player-dialog'));
  osdResizeObserver.observe($('#player'));
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
  hidePlayerControls();
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
  const seeking = document.activeElement === $('#preview-seek') && ['ArrowLeft','ArrowRight'].includes(event.key);
  if (!seeking && document.activeElement?.closest('input,textarea,select,[contenteditable="true"]') ||
      ["#editor-dialog","#bulk-dialog","#settings-dialog"].some(selector=>$(selector).open)) return;
  const watching = $("#player-dialog").open && ['channel','replay'].includes(state.playback?.mode);
  const playing = $('#player-dialog').open && ['channel','replay','preview','chaos'].includes(state.playback?.mode);
  if (!playing && !(document.fullscreenElement || document.webkitFullscreenElement)) return;
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
  } else if (playing && ['ArrowLeft','ArrowRight'].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation();
    seekRelative(event.key==='ArrowRight'?10:-10);
  } else if (watching && ["ArrowUp","ArrowDown","PageUp","PageDown","MediaTrackNext","MediaTrackPrevious"].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) changeChannel(["ArrowUp","PageUp","MediaTrackNext"].includes(event.key) ? 1 : -1);
  }
},true);
$("#channel-down").addEventListener("click",()=>changeChannel(-1));
$("#channel-up").addEventListener("click",()=>changeChannel(1));
document.addEventListener("fullscreenchange",()=>{if (!document.fullscreenElement) clearChannelEntry();});
function tuneChannel(channel, withStatic = true) {
  if ($("#quick-label-panel").dataset.saving === "true") return;
  closeQuickLabels();
  stopChaosTransition();
  if (!timeline(channel).duration) return;
  clearChannelEntry();
  selectGuideChannel(channel);
  state.playback = {mode:"channel", channel, key:null, loaded:false, paused:false};
  $("#return-live").hidden = false;
  $("#channel-down").hidden = false; $("#channel-up").hidden = false;
  showPlayer(false); syncGuidePreview(); syncChannel(true);
  if (withStatic) globalThis.USBTvTransition?.play();
  showChannelOsd(String(playableChannels().indexOf(channel)+1).padStart(3,"0"),channel);
}
function previewVideo(id, position = 0) {
  if ($("#quick-label-panel").dataset.saving === "true") return;
  closeQuickLabels();
  stopChaosTransition();
  clearChannelEntry();
  $("#channel-down").hidden = true; $("#channel-up").hidden = true;
  const video = state.catalog.videos.find(item => item.id === id);
  if (!video || video.missing) return;
  state.playback = {mode:"preview", id, loaded:false};
  $("#return-live").hidden = true;
  $("#player-status").textContent = position ? `PREVIEW AT ${stamp(position)}` : "PREVIEW FROM START";
  $("#player-title").textContent = displayTitle(video);
  $("#player-meta").textContent = `${(video.genres || []).join(" · ")} · ${formatDuration(video.duration)}`;
  const player = $("#player");
  player.autoplay=true;
  const playback=state.playback;
  player.onloadedmetadata = () => {if(state.playback!==playback)return;seekToLive(position,player);playback.loaded=true;};
  window.USBTvAudio?.setTrack(video);
  player.src = videoUrl(video.file);
  showPlayer();
  player.play().catch(() => {revealPlayerControls();showToast("Press Play to start playback.");});
}
// Independent from the live schedule: whole files, one showing per shuffled cycle.
function chaosRandomInt(limit) {
  const range = 0x100000000, ceiling = range - range % limit;
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= ceiling);
  return sample[0] % limit;
}
function shuffleChaos(videos, previousId = null, randomInt = chaosRandomInt) {
  const queue = videos.filter(video=>!video.missing && video.file).slice();
  for (let i=queue.length-1;i>0;i--) {
    const j=randomInt(i+1); [queue[i],queue[j]]=[queue[j],queue[i]];
  }
  if (queue.length>1 && queue[0].id===previousId) {
    const j=1+randomInt(queue.length-1); [queue[0],queue[j]]=[queue[j],queue[0]];
  }
  return queue;
}
let chaosTransitionTimer = null, chaosSound = null;
function stopChaosTransition() {
  clearTimeout(chaosTransitionTimer);
  $('#chaos-transition').hidden=true;
  if (chaosSound) { chaosSound.close().catch(()=>{}); chaosSound=null; }
}
function chaosTransition() {
  stopChaosTransition();
  const overlay=$('#chaos-transition');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  overlay.classList.toggle('chaos-reduced',reduced);
  overlay.replaceChildren();
  if (!reduced) for(let i=0;i<28;i++) {
    const particle=document.createElement('i');
    const angle=i*Math.PI*2/28;
    particle.style.setProperty('--dx',`${Math.cos(angle)*(30+Math.random()*30)}vmax`);
    particle.style.setProperty('--dy',`${Math.sin(angle)*(30+Math.random()*30)}vmax`);
    particle.style.setProperty('--hue',String(i*360/28));
    overlay.append(particle);
  }
  const title=document.createElement('strong');title.textContent='CHAOS';overlay.append(title);
  overlay.hidden=false;
  // Locally synthesised pitch dive and noise burst; no audio file or network needed.
  const player=$('#player'), AudioContext=window.AudioContext||window.webkitAudioContext;
  if (AudioContext && !player.muted && player.volume>0) try {
    const context=chaosSound=new AudioContext(), now=context.currentTime;
    const gain=context.createGain();gain.connect(context.destination);
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.12*player.volume,now+.04);
    gain.gain.exponentialRampToValueAtTime(.0001,now+1.05);
    const oscillator=context.createOscillator();oscillator.type='sawtooth';
    oscillator.frequency.setValueAtTime(1100,now);oscillator.frequency.exponentialRampToValueAtTime(45,now+.95);
    const filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=2200;
    oscillator.connect(filter);filter.connect(gain);oscillator.start(now);oscillator.stop(now+1.05);
    const noise=context.createBuffer(1,Math.ceil(context.sampleRate*.8),context.sampleRate);
    const samples=noise.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*.25;
    const burst=context.createBufferSource();burst.buffer=noise;burst.connect(filter);burst.start(now);
    context.resume().catch(()=>{});
  } catch (_) { /* Animation and playback still work without Web Audio. */ }
  chaosTransitionTimer=setTimeout(stopChaosTransition,1300);
}
function startChaos() {
  if (!state.catalog.settings?.advanced_mode || $('#quick-label-panel').dataset.saving==='true') return;
  const queue=shuffleChaos(state.catalog.videos);
  if (!queue.length) {showToast('Add some videos before unleashing chaos.');return;}
  closeQuickLabels();clearChannelEntry();
  state.playback={mode:'chaos',queue,index:-1,id:null,failures:0,trail:[],trailIndex:-1};
  $('#channel-down').hidden=true;$('#channel-up').hidden=true;$('#return-live').hidden=true;
  $('#quick-label-toggle').disabled=false;
  showPlayer();
  $('#player-dialog').classList.add('video-fills-screen');
  revealPlayerControls();updateFullscreenButtons();
  // Request during the click gesture, before waiting for video metadata.
  if (!fullscreenElement()) {
    const root=document.documentElement;
    try {
      const request=root.requestFullscreen?root.requestFullscreen({navigationUI:'hide'}):root.webkitRequestFullscreen?.();
      request?.catch(()=>{});
    } catch (_) {}
  }
  chaosTransition();advanceChaos();
}
function advanceChaos(failed = false) {
  const playback=state.playback;
  if (playback?.mode!=='chaos' || $('#quick-label-panel').dataset.saving==='true') return;
  if (failed && ++playback.failures>=playback.queue.length) {
    $('#player-meta').textContent='None of these files could be played. Close Chaos and check the files.';
    showToast('Chaos stopped: no playable files.');return;
  }
  if (!failed) playback.failures=0;
  closeQuickLabels();
  let video;
  playback.trail ||= [];playback.trailIndex ??= -1;
  if (playback.trailIndex<playback.trail.length-1) video=playback.trail[++playback.trailIndex];
  else {
    if (++playback.index>=playback.queue.length) {
      playback.queue=shuffleChaos(playback.queue,playback.id);playback.index=0;
    }
    video=playback.queue[playback.index];
    playback.trail.push(video);playback.trailIndex=playback.trail.length-1;
  }
  showChaosVideo(playback,video);
}
function previousChaos() {
  const playback=state.playback;
  if (playback?.mode!=='chaos' || !(playback.trailIndex>0) || $('#quick-label-panel').dataset.saving==='true') return;
  closeQuickLabels();playback.failures=0;
  showChaosVideo(playback,playback.trail[--playback.trailIndex]);
}
function showChaosVideo(playback,video) {
  playback.id=video.id;playback.loaded=false;
  $('#player-status').textContent=`CHAOS · ${playback.queue.length} VIDEOS`;
  $('#player-title').textContent=displayTitle(video);
  $('#player-meta').textContent=`${formatDuration(video.duration)} · Everything shuffled · No scheduled breaks`;
  const player=$('#player');
  player.onloadedmetadata=()=>{
    if(state.playback!==playback || playback.id!==video.id)return;
    player.currentTime=0;playback.loaded=true;
    player.play().catch(()=>{revealPlayerControls();showToast('Press Play to start Chaos.');});
  };
  window.USBTvAudio?.setTrack(video);
  player.src=videoUrl(video.file);player.load();updatePlaybackControls();
}
$('#chaos-button').addEventListener('click',startChaos);
function browseChannel(direction) {
  const playback=state.playback;
  if (!['channel','replay'].includes(playback?.mode) || $('#quick-label-panel').dataset.saving==='true') return;
  const now=Date.now(), line=playback.mode==='replay'?playback.line:timeline(playback.channel);
  const at=playback.mode==='replay'?playback.current?.start ?? playback.cursor:now;
  const target=Schedule.browseProgramme(line,at,direction,now);
  if (target===null) return;
  globalThis.USBTvTransition?.play();
  if (target>=now) {returnToLive();return;}
  closeQuickLabels();clearChannelEntry();stopChaosTransition();
  state.playback={mode:'replay',channel:playback.channel,line,cursor:target,current:null,loaded:false};
  loadChannelReplay();revealPlayerControls();
}
function returnToLive(withStatic = true) {
  const playback=state.playback;
  if (['channel','replay'].includes(playback?.mode)) tuneChannel(playback.channel, withStatic);
}
function loadChannelReplay(autoplay = true) {
  const playback=state.playback;
  if (playback?.mode!=='replay') return;
  if (playback.cursor>=Date.now()) {returnToLive();return;}
  const current=Schedule.locate(playback.line,playback.cursor);
  if (!current) {returnToLive();return;}
  playback.current=current;playback.mediaId=current.segment.video.id;playback.loaded=false;playback.autoplay=autoplay;
  const player=$('#player'), behind=Math.max(1,Math.round((Date.now()-playback.cursor)/60000));
  player.autoplay=autoplay;
  $('#player-status').textContent=`REPLAY · ${playback.channel}`;
  $('#player-title').textContent=(current.segment.advert || current.segment.bumper)?`${playback.channel} · ${current.segment.bumper ? "Station bumper" : "Advert break"}`:displayTitle(current.block.video);
  $('#player-meta').textContent=`${behind} min behind live · ${(current.segment.advert || current.segment.bumper)?displayTitle(current.segment.video):'Watching from the lineup'} · Return to live at any time`;
  $('#quick-label-toggle').disabled=false;
  window.USBTvAudio?.setTrack(state.catalog.videos.find(v=>v.id===current.segment.video.id)||current.segment.video);
  player.onloadedmetadata=()=>{
    if (state.playback!==playback || playback.current!==current) return;
    seekToLive(current.position,player);playback.loaded=true;
    if(autoplay)player.play().catch(()=>{revealPlayerControls();showToast('Press Play to watch the replay.');});
    else {player.pause();revealPlayerControls();}
  };
  player.src=videoUrl(current.segment.video.file);player.load();updatePlaybackControls();
}
function advanceChannelReplay() {
  const playback=state.playback;
  if (playback?.mode!=='replay' || !playback.loaded) return;
  playback.cursor=playback.current.segmentEnd+.5;
  loadChannelReplay();
}
$('#programme-previous').addEventListener('click',()=>{if(state.playback?.mode==='chaos'){globalThis.USBTvTransition?.play();previousChaos();}else browseChannel('previous');});
$('#programme-restart').addEventListener('click',()=>{
  if(state.playback?.mode==='chaos') {globalThis.USBTvTransition?.play();$('#player').currentTime=0;$('#player').play().catch(()=>{});}
  else browseChannel('restart');
});
$('#programme-next').addEventListener('click',()=>{if(state.playback?.mode==='chaos'){globalThis.USBTvTransition?.play();advanceChaos();}else browseChannel('next');});
// Episode boundaries and internal breaks can occur before the source file ends.
$('#player').addEventListener('timeupdate',()=>{
  const playback=state.playback;
  if (playback?.mode!=='replay' || !playback.loaded) return;
  const segment=playback.current.segment;
  if ($('#player').currentTime>=segment.offset+segment.duration-.03) advanceChannelReplay();
});
function syncChannel(force = false) {
  const playback = state.playback;
  if (playback?.mode !== "channel" || playback.paused && !force && !playback.failed) return;
  const current = Schedule.locate(timeline(playback.channel));
  $('#retry-media').hidden = !playback.failed;
  if (playback.failed && current?.key === playback.key) {
    const next = Schedule.locate(timeline(playback.channel),current.segmentEnd + 1);
    $('#player-meta').textContent = `This file could not be played. Retry or change channel.${next ? ' Next scheduled segment: ' + displayTitle(next.segment.video) + ' at ' + new Date(current.segmentEnd).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '.' : ''}`;
    return;
  }
  if (!current) {
    if (playback.channel === CUSTOMS_CHANNEL) {
      if (playback.key !== "customs-empty") {
        playback.key = "customs-empty"; playback.mediaId = null; playback.loaded = false;
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
  $("#player-status").textContent = (current.segment.advert || current.segment.bumper) ? (current.segment.bumper ? "STATION BUMPER" : "ADVERTISEMENT BREAK") : `LIVE · ${playback.channel}`;
  $("#player-title").textContent = (current.segment.advert || current.segment.bumper) ? `${playback.channel} · ${current.segment.bumper ? "Station bumper" : "Advert break"}` : displayTitle(current.block.video);
  const channelTimeline = current.timeline;
  const returnsToProgramme = current.block.segments.some(segment => !segment.advert && !segment.bumper && segment.start > current.segment.start);
  const following = channelTimeline.blocks[(current.block.index + 1) % channelTimeline.blocks.length].video;
  $("#player-meta").textContent = (current.segment.advert || current.segment.bumper) ? `${displayTitle(current.segment.video)} · ${returnsToProgramme ? "Back to " + displayTitle(current.block.video) : "Up next: " + displayTitle(following)}` : `${formatDuration(current.block.video.duration)} · Channel time · Pause resumes live`;
  window.USBTvAudio?.setTrack(state.catalog.videos.find(video=>video.id === current.segment.video.id) || current.segment.video);
  if (playback.key !== current.key) {
    player.autoplay=true;
    playback.failed = false;
    $('#retry-media').hidden = true;
    playback.key = current.key; playback.current = current; playback.mediaId = current.segment.video.id; playback.loaded = false; playback.paused = false;
    const key = current.key;
    player.onloadedmetadata = () => {
      if (state.playback !== playback || playback.key !== key) return;
      const latest = Schedule.locate(timeline(playback.channel));
      if (latest?.key !== key) { syncChannel(); return; }
      playback.current = latest; playback.loaded = true;
      seekToLive(latest.position);
      player.play().catch(() => { playback.paused = true; revealPlayerControls();showToast("Press Play to join the channel."); });
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
let scanTimer = null, scanPolling = false, handledScan = null, pendingScanRefresh = false, scanQuiet = true, audioRefreshKey = '';
const editingLibrary = () => !$("#quick-label-panel").hidden || $("#editor-dialog").open || $("#bulk-dialog").open || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
function displayScan(job) {
  state.scanning = job.status === "running";
  const button = $("#rescan");
  button.disabled = state.scanning;
  button.innerHTML = state.scanning ? `↻ <span>${job.stage === 'audio' ? 'AUDIO LEVELS' : job.stage === 'importing' ? 'PREPARING VIDEOS' : 'SCANNING'} ${job.completed || 0}/${job.total || "…"}</span>` : '↻ <span>RESCAN VIDEOS</span>';
  $("#scan-progress").hidden = job.status === "idle";
  $("#scan-meter").max = Math.max(1,job.total || 0);
  $("#scan-meter").value = job.completed || 0;
  $("#scan-message").textContent = state.scanning ? `${job.stage === "discovering" ? "Finding videos…" : job.stage === "audio" ? "Measuring audio levels" : job.stage === "importing" ? "Preparing new video" : "Scanning"} · ${job.completed || 0}/${job.total || "…"} · ${job.current || ""}` : `${job.status === "complete" ? "Scan complete" : job.status === "interrupted" ? "Scan paused — rescan to continue" : "Scan failed"} · ${job.completed || 0}/${job.total || 0}${job.error ? " · " + job.error : ""}${job.audio_note ? " · " + job.audio_note : ""}`;
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
    const checkpoint = `${job.id}:${job.stage}:${Math.floor((job.completed || 0) / 10)}`;
    if (job.changed && state.scanning && checkpoint !== audioRefreshKey) {
      audioRefreshKey = checkpoint; pendingScanRefresh = true;
    }
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
          saveRevision = data.revision;
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
for (const [prefix,view,render] of [['library',libraryView,renderLibrary],['bulk',bulkView,renderBulkRows]]) {
  for(const key of mediaFilterFields.filter(key=>!['search','channel','genre'].includes(key))) {
    const control=$('#'+prefix+'-'+key);
    control.addEventListener(control.tagName==='INPUT'?'input':'change',()=>{view.page=0;render();});
  }
  $('#'+prefix+'-reset-filters').addEventListener('click',()=>resetMediaFilters(prefix));
}
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
$("#settings-toggle").addEventListener("click", () => { $('#settings-dialog').showModal(); refreshAudioStatus(); });
$("#close-settings").addEventListener("click", () => $("#settings-dialog").close());
document.querySelectorAll('input[name="theme"]').forEach(input => input.addEventListener("change", async () => {
  state.catalog.settings.theme = input.value; applyThemeSetting();
  try { await saveCatalog(); } catch (_) {}
}));
$("#add-channel-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (deletingChannel) return;
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
$("#edit-type").addEventListener("change", () => { $("#break-editor").hidden = $("#edit-type").value !== "programme"; });
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
$("#preview-mute").addEventListener("click", () => {
  window.USBTvAudio?.unlock();
  const player = $("#guide-preview-video");
  player.muted = !player.muted;
  guidePreview.autoMuted = false;
  guidePreview.blocked = false; $("#preview-play").hidden = true;
  updateGuideAudioControls(); syncGuidePreview();
});
$("#guide-preview-video").addEventListener("volumechange", updateGuideAudioControls);
$("#preview-play").addEventListener("click", () => {
  window.USBTvAudio?.unlock();
  if (guidePreview.autoMuted) { $("#guide-preview-video").muted = false; guidePreview.autoMuted = false; updateGuideAudioControls(); }
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
$("#return-live").addEventListener("click", returnToLive);
document.querySelectorAll('input[name="fullscreen-mode"]').forEach(input=>input.addEventListener("change",async ()=>{
  state.catalog.settings.fullscreen_mode=input.value;
  updateFullscreenButtons();
  try {await saveCatalog();} catch (_) {}
}));
$("#crt-toggle").addEventListener("click", async () => {
  const current = state.catalog.settings.crt_mode || (state.catalog.settings.crt ? 'classic' : 'off');
  state.catalog.settings.crt_mode = {off:'classic', classic:'realistic', realistic:'off'}[current];
  state.catalog.settings.crt = state.catalog.settings.crt_mode !== 'off';
  applyCrtSetting();
  try { await saveCatalog(); } catch (_) {}
});
document.addEventListener("keydown", event => {
  if (!$("#quick-label-panel").hidden) return;
  if (event.key.toLowerCase() !== "f" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName) || $("#settings-dialog").open || $("#editor-dialog").open || $("#bulk-dialog").open) return;
  event.preventDefault(); toggleFullscreen($("#player-dialog").open ? $("#player-dialog") : document.documentElement);
});
$("#player-dialog").addEventListener("close", () => {
  stopChaosTransition();
  exitVideoView();
  closeQuickLabels();
  clearChannelEntry();
  state.playback = null;
  const player = $("#player"); player.onloadedmetadata = null; player.pause(); player.removeAttribute("src"); player.load();
});
$("#player").addEventListener("pause", () => {
  if (state.playback?.mode === "channel" && state.playback.loaded && !$("#player").ended) state.playback.paused = true;
  if(state.playback?.loaded && !$('#player').ended)revealPlayerControls();
});
$("#player").addEventListener("play", () => {
  if (state.playback?.mode === "channel" && state.playback.paused) { state.playback.paused = false; syncChannel(true); }
  if($('#player-dialog').classList.contains('controls-visible'))revealPlayerControls();
});
$("#player").addEventListener("ended", () => { if (state.playback?.mode === "channel") syncChannel(true); else if(state.playback?.mode==='chaos') advanceChaos(); else if(state.playback?.mode==='replay') advanceChannelReplay(); });
$("#player").addEventListener("error", () => {
  if (!state.playback) return;
  if (state.playback.mode === 'replay') {
    state.playback.loaded=false;
    $('#player-meta').textContent='This replay file cannot be played. Choose Next programme or Return to live.';
    showToast('Unable to play this replay.');return;
  }
  if (state.playback.mode === 'chaos') {
    const playback=state.playback, id=playback.id;
    showToast('Chaos skipped a file this browser cannot play.');
    setTimeout(()=>{if(state.playback===playback && playback.id===id)advanceChaos(true);},300);
    return;
  }
  if (state.playback.mode === "channel") {
    state.playback.failed = true;
    $('#retry-media').hidden = false;
    revealPlayerControls();
  }
  $("#player-meta").textContent = "This browser cannot play this file. Check its codec or choose another channel.";
  showToast("The browser could not play this media file.");
});
updateFullscreenButtons(); applyThemeSetting(); updateClock();
setInterval(updateClock,1000);
setInterval(refreshGuideWindow,1000);
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
