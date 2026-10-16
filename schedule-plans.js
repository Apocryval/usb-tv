/* Persistent broadcast versions: additions switch at a loop boundary after an hour. */
(function(root) {
  'use strict';
  const S = root.USBTvSchedule;
  const CUSTOMS = 'Interdimensional Customs';
  function snapshot(catalog, name) {
    const channel = catalog.channels.find(item => item.name === name) || {name};
    return {channel:{name, ad_interval:channel.ad_interval ?? catalog.settings.ad_interval ?? 900,
      ad_length:name === CUSTOMS ? 0 : channel.ad_length ?? catalog.settings.ad_length ?? 90},
      videos:catalog.videos.filter(video => S.validMedia(video) && (video.type === 'advert'
        ? name !== CUSTOMS && (!video.channels.length || video.channels.includes(name)) : name === CUSTOMS ? !video.channels.filter(value=>value !== CUSTOMS).length : video.channels.includes(name)))
        .map(video => ({id:video.id, fingerprint:video.fingerprint || '', duration:Number(video.duration),
          type:video.type, channels:[name], breaks_approved:Boolean(video.breaks_approved),
          break_points:video.break_points || []})).sort((a,b) => a.id.localeCompare(b.id))};
  }
  const signature = value => JSON.stringify(value);
  function cycle(version) { return S.buildCycle({videos:version.snapshot.videos, channels:[version.snapshot.channel],settings:{}}, version.snapshot.channel.name, version.seed, version.anchor); }
  function reconcile(catalog, stored, now = Date.now()) {
    const plans = Object.assign(Object.create(null), structuredClone(stored || {}));
    for (const channel of catalog.channels) {
      const name = channel.name, desired = snapshot(catalog,name);
      let plan = Object.hasOwn(plans,name) ? plans[name] : null;
      if (!plan) {
        // Preserve the pre-existing station's order and clock on first migration.
        plans[name] = {active:{snapshot:desired, seed:name, anchor:S.ANCHOR}, pending:null};
        continue;
      }
      if (plan.pending && now >= plan.pending.anchor) { plan.active = plan.pending; plan.pending = null; }
      // Removed, disabled or replaced files cannot safely remain in a frozen loop.
      const available = new Map(catalog.videos.filter(S.validMedia).map(video => [video.id,video]));
      const safe = plan.active.snapshot.videos.filter(video => available.has(video.id) && (available.get(video.id).fingerprint || '') === video.fingerprint);
      if (safe.length !== plan.active.snapshot.videos.length) {
        plan.active = {snapshot:{...plan.active.snapshot,videos:safe}, seed:plan.active.seed, anchor:now};
        plan.pending = null;
      }
      if (signature(desired) === signature(plan.active.snapshot)) { plan.pending = null; continue; }
      if (plan.pending && signature(desired) === signature(plan.pending.snapshot)) continue;
      const current = cycle(plan.active);
      if (!current.duration) { plan.active = {snapshot:desired,seed:plan.active.seed,anchor:now}; plan.pending = null; continue; }
      if (name === CUSTOMS) {
        // Keep the on-air programme intact, then use only the remaining queue.
        const onAir = S.locate(current,now);
        plan.pending = {snapshot:desired,seed:plan.active.seed,anchor:onAir ? onAir.end : now};
        continue;
      }
      const boundary = plan.active.anchor + Math.ceil((now + 3600000 - plan.active.anchor) / (current.duration * 1000)) * current.duration * 1000;
      plan.pending = {snapshot:desired, seed:plan.active.seed, anchor:boundary};
    }
    for (const name of Object.keys(plans)) if (!catalog.channels.some(channel => channel.name === name)) delete plans[name];
    return plans;
  }
  function reshuffle(catalog, stored, name, now = Date.now()) {
    const plans = reconcile(catalog, stored, now);
    plans[name] = {active:{snapshot:snapshot(catalog,name),seed:`${name}:${root.crypto.randomUUID()}`,anchor:now},pending:null};
    return plans;
  }
  root.USBTvPlans = {reconcile, reshuffle};
})(globalThis);
