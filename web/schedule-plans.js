/* Persistent broadcast versions: additions switch at a loop boundary after an hour. */
(function(root) {
  'use strict';
  const S = root.USBTvSchedule;
  const CUSTOMS = 'Interdimensional Customs';
  function snapshot(catalog, name) {
    const channel = catalog.channels.find(item => item.name === name) || {name};
    return {channel:{name, ad_interval:channel.ad_interval ?? catalog.settings.ad_interval ?? 900,
      ad_length:name === CUSTOMS ? 0 : channel.ad_length ?? catalog.settings.ad_length ?? 90},
      videos:catalog.videos.filter(video => S.validMedia(video) && (['advert','bumper'].includes(video.type)
        ? name !== CUSTOMS && (!video.channels.length || video.channels.includes(name)) : name === CUSTOMS ? !video.channels.filter(value=>value !== CUSTOMS).length : video.channels.includes(name)))
        .map(video => ({id:video.id, fingerprint:video.fingerprint || '', duration:Number(video.duration),
          type:video.type, ...(video.type === "bumper" ? {bumper_role:video.bumper_role || "to_ads"} : {}), channels:[name], breaks_approved:Boolean(video.breaks_approved),
          break_points:video.break_points || [], ...(video.episode_review === "multiple" && !["advert","bumper"].includes(video.type) ?
            {episode_review:"multiple",episodes:video.episodes || []} : {})})).sort((a,b) => a.id.localeCompare(b.id))};
  }
  const versionFor = snapshot => snapshot.videos.some(video=>video.episode_review === "multiple" && video.episodes?.length) ? 4
    : snapshot.videos.some(video=>video.type === "bumper") ? 3 : 2;
  const signature = value => JSON.stringify(value);
  function cycle(version) { return S.buildCycle({videos:version.snapshot.videos, channels:[version.snapshot.channel],settings:{}}, version.snapshot.channel.name, version.seed, version.anchor, version.schedule_version || 1); }
  function reconcile(catalog, stored, now = Date.now()) {
    const plans = Object.assign(Object.create(null), structuredClone(stored || {}));
    for (const channel of catalog.channels) {
      const name = channel.name, desired = snapshot(catalog,name);
      let plan = Object.hasOwn(plans,name) ? plans[name] : null;
      if (!plan) {
        // New saved plans use complete programme rotations.
        plans[name] = {active:{snapshot:desired, seed:name, anchor:S.ANCHOR, schedule_version:versionFor(desired)}, pending:null};
        continue;
      }
      if (plan.pending && now >= plan.pending.anchor) { plan.active = plan.pending; plan.pending = null; }
      // Removed, disabled or replaced files cannot safely remain in a frozen loop.
      const available = new Map(catalog.videos.filter(S.validMedia).map(video => [video.id,video]));
      const safe = plan.active.snapshot.videos.filter(video => available.has(video.id) && (available.get(video.id).fingerprint || '') === video.fingerprint);
      if (safe.length !== plan.active.snapshot.videos.length) {
        plan.active = {snapshot:{...plan.active.snapshot,videos:safe}, seed:plan.active.seed, anchor:now, schedule_version:versionFor(desired)};
        plan.pending = null;
      }
      if (plan.active.schedule_version === versionFor(desired) && signature(desired) === signature(plan.active.snapshot)) { plan.pending = null; continue; }
      if (plan.pending?.schedule_version === versionFor(desired) && signature(desired) === signature(plan.pending.snapshot)) continue;
      const current = cycle(plan.active);
      if (!current.duration) { plan.active = {snapshot:desired,seed:plan.active.seed,anchor:now,schedule_version:versionFor(desired)}; plan.pending = null; continue; }
      if (name === CUSTOMS) {
        // Keep the on-air programme intact, then use only the remaining queue.
        const onAir = S.locate(current,now);
        plan.pending = {snapshot:desired,seed:plan.active.seed,anchor:onAir ? onAir.end : now,schedule_version:versionFor(desired)};
        continue;
      }
      const boundary = plan.active.anchor + Math.ceil((now + 3600000 - plan.active.anchor) / (current.duration * 1000)) * current.duration * 1000;
      plan.pending = {snapshot:desired, seed:plan.active.seed, anchor:boundary,schedule_version:versionFor(desired)};
    }
    for (const name of Object.keys(plans)) if (!catalog.channels.some(channel => channel.name === name)) delete plans[name];
    return plans;
  }
  function reshuffle(catalog, stored, name, now = Date.now()) {
    const plans = reconcile(catalog, stored, now);
    plans[name] = freshPlan(catalog,name,now);
    return plans;
  }
  function freshPlan(catalog,name,now) {
    const desired = snapshot(catalog,name);
    return {active:{snapshot:desired,seed:`${name}:${root.crypto.randomUUID()}`,anchor:now,schedule_version:versionFor(desired)},pending:null};
  }
  function reshuffleAll(catalog,stored,now = Date.now()) {
    const plans = reconcile(catalog,stored,now);
    for (const channel of catalog.channels) plans[channel.name] = freshPlan(catalog,channel.name,now);
    return plans;
  }
  function advance(catalog, stored, name, action, now = Date.now()) {
    const plans = reconcile(catalog, stored, now);
    const plan = plans[name];
    if (!plan || !['forward','skip'].includes(action)) throw new Error('No channel is available to advance.');
    const line = S.build({...catalog,broadcasts:plans},name);
    const current = S.locate(line,now);
    if (!current) throw new Error('This channel has no playable videos.');
    const target = action === 'forward' ? now + 30000
      : ((current.segment.advert || current.segment.bumper) ? current.segmentEnd : current.end) + .5;
    const elapsed = target - now;
    // Advancing across a queued lineup boundary adopts that lineup first.
    if (plan.pending && target >= plan.pending.anchor) {
      plan.active = plan.pending; plan.pending = null;
    }
    plan.active.anchor -= elapsed;
    if (plan.pending) plan.pending.anchor -= elapsed;
    if (plan.active.anchor < 0 || plan.pending && plan.pending.anchor < 0) throw new Error('Cannot advance this broadcast clock.');
    return plans;
  }
  root.USBTvPlans = {reconcile, reshuffle, reshuffleAll, advance};
})(globalThis);
