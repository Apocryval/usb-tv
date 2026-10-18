/* Pure scheduling: guide and live player consume the same advert-aware timeline. */
(function (root) {
  "use strict";
  const ANCHOR = Date.UTC(2026, 0, 1);
  const validMedia = (item) => item.enabled !== false && !item.missing && Number.isFinite(Number(item.duration)) && Number(item.duration) > 0;
  function shuffled(items, text) {
    let seed = 2166136261;
    for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
    const result = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (let i = result.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function episodeProgrammes(video) {
    if (video.episode_review !== "multiple" || !video.episodes?.length) return [video];
    return video.episodes.map((episode, index) => ({...video, title:episode.title,
      episode_index:index, source_offset:episode.start, duration:episode.end - episode.start,
      break_points:(video.break_points || []).filter(point => point > episode.start && point < episode.end).map(point => point - episode.start)}));
  }
  function buildCycle(catalog, channelName, seed = channelName, anchor = ANCHOR, scheduleVersion = 2) {
    const channel = (catalog.channels || []).find((item) => item.name === channelName) || {};
    const interval = Number(channel.ad_interval ?? catalog.settings?.ad_interval ?? 900);
    const target = Number(channel.ad_length ?? catalog.settings?.ad_length ?? 90);
    const programmes = shuffled(catalog.videos.filter((item) => validMedia(item) && item.type !== "advert" && item.channels.includes(channelName)), seed).flatMap(episodeProgrammes);
    const adverts = shuffled(catalog.videos.filter((item) => validMedia(item) && item.type === "advert" && (!item.channels.length || item.channels.includes(channelName))), seed + ":adverts");
    let adIndex = 0, sinceBreak = 0, cursor = 0, previousAd = null, firstAd = null;
    const blocks = [];
    const programmeSeconds = programmes.reduce((sum, video) => sum + Number(video.duration), 0);
    // Span multiple rotations so a short collection still accumulates time toward breaks.
    const minimumCycle = adverts.length && target > 0 ? Math.max(programmeSeconds, interval * 4) : programmeSeconds;
    for (let index = 0; programmes.length && (index < programmes.length || cursor < minimumCycle ||
      (scheduleVersion < 2 ? sinceBreak > 0 && adverts.length && target > 0 : index % programmes.length !== 0) ||
      adverts.length > 1 && target > 0 && firstAd === previousAd) && index < 10000; index++) {
      const video = programmes[index % programmes.length];
      const block = { video, index, start: cursor, segments: [] };
      function append(media, offset, duration, advert = false) {
        if (duration <= 0) return;
        block.segments.push({ video: media, offset, duration, start: cursor, advert, key: `${index}:${block.segments.length}` });
        cursor += duration;
      }
      function breakNow() {
        if (!adverts.length || target <= 0) return;
        let length = 0;
        const used = new Set();
        while (length < target && used.size < adverts.length) {
          let candidate = null;
          for (let step = 0; step < adverts.length; step++) {
            const next = adverts[(adIndex + step) % adverts.length];
            if (used.has(next.id) || (adverts.length > 1 && next.id === previousAd)) continue;
            candidate = next;
            adIndex = (adIndex + step + 1) % adverts.length;
            break;
          }
          if (!candidate) break;
          append(candidate, 0, Number(candidate.duration), true);
          used.add(candidate.id);
          previousAd = candidate.id;
          if (firstAd === null) firstAd = candidate.id;
          length += Number(candidate.duration);
        }
        sinceBreak = 0;
      }
      const points = video.breaks_approved ? [...new Set((video.break_points || []).map(Number).filter((point) => point > 0 && point < Number(video.duration)))].sort((a, b) => a - b) : [];
      let offset = 0;
      for (const point of [...points, Number(video.duration)]) {
        const length = point - offset;
        append(video, (video.source_offset || 0) + offset, length);
        sinceBreak += length;
        offset = point;
        if (sinceBreak >= interval) breakNow();
      }
      block.duration = cursor - block.start;
      blocks.push(block);
    }
    return { channel: channelName, blocks, duration: cursor, anchor };
  }
  function build(catalog, channelName) {
    const plan = catalog.broadcasts && Object.hasOwn(catalog.broadcasts,channelName) ? catalog.broadcasts[channelName] : null;
    if (!plan) {
      if (channelName === "Interdimensional Customs") {
        const videos = catalog.videos.filter(video=>video.type !== "advert" && !video.channels.filter(name=>name!==channelName).length).map(video=>({...video,channels:[channelName]}));
        return buildCycle({...catalog,videos,channels:[{name:channelName,ad_length:0}]},channelName);
      }
      return buildCycle(catalog, channelName);
    }
    function cycle(version) {
      const actual = new Map(catalog.videos.map(video => [video.id,video]));
      const videos = version.snapshot.videos.map(frozen => ({...actual.get(frozen.id), ...frozen,
        file:actual.get(frozen.id)?.file, title:actual.get(frozen.id)?.title,
        episode_review:frozen.episode_review || "unchecked", episodes:frozen.episodes || [],
        genres:actual.get(frozen.id)?.genres || [], description:actual.get(frozen.id)?.description || ''}));
      return buildCycle({videos, channels:[version.snapshot.channel], settings:{}}, channelName, version.seed, version.anchor, version.schedule_version || 1);
    }
    const active = cycle(plan.active);
    return {...active, active, pending:plan.pending ? cycle(plan.pending) : null, transition:plan.pending?.anchor};
  }
  function locate(timeline, now = Date.now()) {
    if (timeline.active) return locate(timeline.pending && now >= timeline.transition ? timeline.pending : timeline.active, now);
    if (!timeline.duration) return null;
    const seconds = (now - timeline.anchor) / 1000;
    const cycle = Math.floor(seconds / timeline.duration);
    const elapsed = seconds - cycle * timeline.duration;
    const block = timeline.blocks.find((item) => elapsed < item.start + item.duration) || timeline.blocks.at(-1);
    const segment = block.segments.find((item) => elapsed < item.start + item.duration) || block.segments.at(-1);
    const cycleStart = timeline.anchor + cycle * timeline.duration * 1000;
    return { block, segment, position: segment.offset + elapsed - segment.start,
      segmentEnd: cycleStart + (segment.start + segment.duration) * 1000,
      start: cycleStart + block.start * 1000, end: cycleStart + (block.start + block.duration) * 1000,
      key: `${timeline.anchor}:${cycle}:${segment.key}:${segment.video.id}:${segment.video.fingerprint || ""}`, cycle, elapsed, timeline };
  }
  function guide(timeline, now = Date.now(), horizon = 7200) {
    const current = locate(timeline, now);
    if (!current) return [];
    const result = [];
    let start = current.start;
    for (let count = 0; start < now + horizon * 1000 && count < 500; count++) {
      const slot = locate(timeline, Math.max(start + (count ? .5 : 0), now));
      if (!slot) break;
      const block = slot.block;
      const end = slot.end;
      result.push({ video: block.video, start, end, current: count === 0,
        remaining: (end - Math.max(start, now)) / 1000,
        progress: count === 0 ? (now - start) / (end - start) : 0 });
      start = end;
    }
    return result;
  }
  // Live guides begin at the actual broadcast time, rather than retaining
  // already-finished programmes until the next clock-aligned page boundary.
  function guideWindow(now, minutes, browsingStart = null) {
    const live = browsingStart === null || browsingStart <= now;
    const start = live ? now : browsingStart;
    return {start, end:start + minutes * 60000, live};
  }
  function guideTicks(start, end, width, live) {
    const span = end - start;
    const step = Math.max(1, Math.ceil(span / 1800000 / Math.max(1, Math.floor(width / 75)))) * 1800000;
    const ticks = [{time:start, now:live}];
    for (let time = Math.ceil(start / step) * step; time < end; time += step) {
      // Leave room for the left-edge NOW/time label and the end label.
      if ((time - start) / span * width >= 65 && (end - time) / span * width >= 55) ticks.push({time});
    }
    ticks.push({time:end});
    return ticks;
  }
  function browseProgramme(timeline, at, direction, now = Date.now()) {
    const current = locate(timeline,at);
    if (!current) return null;
    if (direction === 'previous') {
      const previous = locate(timeline,current.start - .5);
      return previous ? previous.start + .5 : null;
    }
    if (direction === 'restart') return Math.min(now,current.start + .5);
    if (direction === 'next') return Math.min(now,current.end + .5);
    return null;
  }
  const api = { build, buildCycle, locate, guide, guideWindow, guideTicks, shuffled, validMedia, episodeProgrammes, browseProgramme, ANCHOR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.USBTvSchedule = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
