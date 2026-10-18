/* Offline, explainable suggestions and spreadsheet imports. No labels are saved here. */
(function(root) {
  "use strict";
  const list = value => [...new Set((Array.isArray(value) ? value : String(value ?? "").split(/[;,]/)).map(item => String(item).trim()).filter(Boolean))];
  const normal = text => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  const matches = (text, keyword) => keyword && (` ${normal(text)} `).includes(` ${normal(keyword)} `);
  const defaults = [
    ["documentary", "Documentary"], ["documentaries", "Documentary"], ["comedy", "Comedy"], ["stand up", "Comedy"], ["music", "Music"],
    ["concert", "Music"], ["animation", "Animation"], ["gaming", "Gaming"], ["gameplay", "Gaming"],
    ["science", "Science"], ["nature", "Nature"], ["wildlife", "Nature"], ["history", "History"]];
  function suggest(video, catalog) {
    const genres = list(video.genres), channels = list(video.channels), reasons = [];
    const text = `${video.file} ${video.title || ""} ${(video.tags || []).join(" ")}`;
    const allowedChannels = (catalog.channels || []).map(channel => channel.name);
    const add = (values, target) => values.forEach(value => { if (!target.includes(value)) target.push(value); });
    let suggestedGenres = [], suggestedChannels = [];
    for (const [keyword, genre] of defaults) {
      if (matches(text,keyword)) { add([genre],suggestedGenres); reasons.push(`Keyword: ${keyword}`); }
    }
    for (const genre of catalog.genres || []) if (matches(text,genre)) { add([genre],suggestedGenres); reasons.push(`Genre name: ${genre}`); }
    for (const channel of allowedChannels) if (matches(text,channel)) { add([channel],suggestedChannels); reasons.push(`Channel name: ${channel}`); }
    for (const rule of catalog.label_rules || []) {
      if (matches(text,rule.keyword)) { add(list(rule.genres),suggestedGenres); add(list(rule.channels),suggestedChannels); reasons.push(`Your rule: ${rule.keyword}`); }
    }
    const folder = video.file.slice(0,video.file.lastIndexOf("/"));
    if (!["Videos","Adverts"].includes(folder)) {
      const peers = catalog.videos.filter(item => item.id !== video.id && !item.missing && item.type === video.type && item.file.slice(0,item.file.lastIndexOf("/")) === folder);
      for (const [field, target] of [["genres",suggestedGenres],["channels",suggestedChannels]]) {
        const labelled = peers.filter(item => item[field]?.length);
        if (labelled.length >= 2) {
          const first = [...labelled[0][field]].sort().join("\n");
          if (labelled.every(item => [...item[field]].sort().join("\n") === first)) {
            add(labelled[0][field],target); reasons.push(`${field === "genres" ? "Genres" : "Channels"} agree on ${labelled.length} files in this folder`);
          }
        }
      }
    }
    // An exact genre/channel name match is safe to offer; never invent channel routing.
    for (const genre of [...genres,...suggestedGenres]) {
      const channel = allowedChannels.find(channel => normal(channel) === normal(genre));
      if (channel) { add([channel],suggestedChannels); reasons.push(`Channel matches genre: ${genre}`); }
    }
    suggestedGenres = list(suggestedGenres.map(genre => (catalog.genres || []).find(existing => normal(existing) === normal(genre)) || genre));
    return {id:video.id, type:video.type || "programme", title:video.title || "", genres:genres.length ? genres : suggestedGenres,
      channels:channels.length ? channels : suggestedChannels,
      description:video.description || "", tags:list(video.tags), tagline:video.tagline || "", tagline_goblin:video.tagline_goblin || "",
      reasons:reasons.length ? list(reasons) : ["No confident match — choose labels manually"], selected:false};
  }
  function parseCsv(text) {
    const rows = [], row = [];
    let cell = "", quoted = false;
    for (let i=0;i<text.length;i++) {
      const char=text[i];
      if (char === '"') {
        if (quoted && text[i+1] === '"') { cell+='"'; i++; }
        else if (quoted || cell === "") quoted=!quoted;
        else throw new Error("Unexpected quote in CSV.");
      } else if (!quoted && char === ',') { row.push(cell); cell=""; }
      else if (!quoted && (char === '\n' || char === '\r')) {
        if (char === '\r' && text[i+1] === '\n') i++;
        row.push(cell); if (row.some(value=>value.trim())) rows.push([...row]); row.length=0; cell="";
      } else cell+=char;
    }
    if (quoted) throw new Error("CSV has an unclosed quote.");
    if (cell || row.length) { row.push(cell); if (row.some(value=>value.trim())) rows.push([...row]); }
    if (!rows.length) return [];
    const headers=rows.shift().map(value=>value.replace(/^\uFEFF/,"").trim().toLowerCase());
    if (!headers.includes("id") && !headers.includes("file")) throw new Error("CSV needs an id or file column.");
    if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate column names.");
    return rows.map((values,index)=> {
      if(values.length !== headers.length) throw new Error(`CSV row ${index+2} has the wrong number of columns. Quote values containing commas.`);
      return Object.fromEntries(headers.map((name,i)=>[name,values[i]]));
    });
  }
  function importText(text, catalog, options = {}) {
    const mode=options.mode || 'preserve';
    if(!['preserve','skip-labelled','replace'].includes(mode)) throw new Error('Choose a valid import conflict policy.');
    const trimmed=text.trim().replace(/^\uFEFF/,"");
    let records;
    if (/^[\[{]/.test(trimmed)) {
      let parsed;
      try { parsed=JSON.parse(trimmed); } catch (_) { throw new Error("Invalid JSON file."); }
      records=Array.isArray(parsed) ? parsed : parsed.suggestions;
      if(!Array.isArray(records)) throw new Error("JSON needs an array, or an object with a suggestions array.");
    } else records=parseCsv(trimmed);
    if(records.length>10000) throw new Error("Import up to 10,000 rows at once.");
    const found=[], skipped=[], seen=new Set(), protectedRows=[];
    records.forEach((record,index)=> {
      if(!record || typeof record !== "object" || Array.isArray(record)) { skipped.push(`Row ${index+1}: expected an object`); return; }
      let candidates=[];
      if(record.id !== undefined && String(record.id).trim()) {
        const id=String(record.id).trim().replace(/^#/,"").replace(/^0+/,"") || "0";
        candidates=catalog.videos.filter(video=>(String(video.id).replace(/^0+/,"") || "0") === id);
      } else if(record.file) {
        const path=String(record.file).replace(/\\/g,"/").replace(/^\.\//,"");
        candidates=catalog.videos.filter(video=>video.file===path);
        if(!candidates.length && !path.includes("/")) candidates=catalog.videos.filter(video=>video.file.split("/").at(-1)===path);
      }
      if(candidates.length!==1 || candidates[0].missing) { skipped.push(`Row ${index+1}: file/ID missing, unknown or ambiguous`); return; }
      const video=candidates[0];
      if(record.id !== undefined && record.file && String(record.file).replace(/\\/g,"/") !== video.file) { skipped.push(`Row ${index+1}: ID belongs to a different file`); return; }
      if(record.fingerprint && record.fingerprint !== video.fingerprint) { skipped.push(`Row ${index+1}: video content changed or belongs to another library`); return; }
      if(seen.has(video.id)) { skipped.push(`Row ${index+1}: repeated ID #${video.id}`); return; }
      seen.add(video.id);
      if (Object.hasOwn(record,"type") && record.type !== "" && !["programme","advert"].includes(record.type)) {
        skipped.push(`Row ${index+1}: type must be programme or advert`); return;
      }
      let confidence = null;
      if (record.confidence !== undefined && record.confidence !== null && record.confidence !== "") {
        confidence = Number(record.confidence);
        if (typeof record.confidence === "boolean" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
          skipped.push(`Row ${index+1}: confidence must be between 0 and 1`); return;
        }
      }
      let uncertainties = record.uncertainties || [];
      if (typeof uncertainties === "string") {
        try { uncertainties = JSON.parse(uncertainties); }
        catch (_) { uncertainties = uncertainties.split(/\r?\n/).filter(Boolean); }
      }
      if (!Array.isArray(uncertainties)) { skipped.push(`Row ${index+1}: uncertainties must be an array or text`); return; }
      uncertainties = uncertainties.map(value=>String(value).slice(0,300)).slice(0,20);
      if(mode==='skip-labelled' && (['genres','channels','tags'].some(field=>list(video[field]).length)
        || ['description','tagline','tagline_goblin'].some(field=>String(video[field]||'').trim()))) {
        protectedRows.push({id:video.id,fields:[],skipped:true});return;
      }
      const reasons=["Imported suggestion"];
      if (confidence !== null) reasons.push(`Model confidence: ${Math.round(confidence*100)}% (self-reported)`);
      if(record.evidence) reasons.push(String(record.evidence).slice(0,2000));
      reasons.push(...uncertainties);
      const suggestion={id:video.id, type:video.type || "programme", title:video.title || "", genres:list(video.genres),channels:list(video.channels),
        description:video.description || "", tags:list(video.tags), tagline:video.tagline || "", tagline_goblin:video.tagline_goblin || "",evidence:String(record.evidence || "").slice(0,2000),uncertainties,confidence,reasons,selected:false};
      if(record.type) suggestion.type=record.type;
      if(Object.hasOwn(record,"title")) suggestion.title=String(record.title || "").trim().slice(0,300);
      for(const [field,limit] of [["description",1000],["tagline",300],["tagline_goblin",300]]) if(Object.hasOwn(record,field)) suggestion[field]=String(record[field] || "").trim().slice(0,limit);
      for(const field of ["genres","channels","tags"]) if(Object.hasOwn(record,field)) suggestion[field]=list(record[field]);
      if(mode!=='replace') {
        const kept=[];
        for(const field of ['type','title','genres','channels','tags','description','tagline','tagline_goblin']) {
          const array=['genres','channels','tags'].includes(field);
          const current=array?list(video[field]):String(video[field]||'').trim();
          // Empty advert channels intentionally mean all channels, not missing data.
          const assigned=(array?current.length>0:current.length>0)||(field==='channels'&&video.type==='advert')
            || options.protectedFields?.[video.id]?.includes(field);
          if(assigned && Object.hasOwn(record,field)) {
            if(JSON.stringify(suggestion[field])!==JSON.stringify(current)) kept.push(field);
            suggestion[field]=current;
          }
        }
        if(kept.length) {
          suggestion.reasons.push(`Kept existing fields: ${kept.join(', ')}`);
          protectedRows.push({id:video.id,fields:kept,skipped:false});
        }
      }
      found.push(suggestion);
    });
    return {found,skipped,protectedRows};
  }
  const csvCell=value=>'"'+String(value ?? "").replace(/"/g,'""')+'"';
  function exportCsv(rows,catalog) {
    const headers = ["id","file","fingerprint","type","title","genres","channels","description","tags","tagline","tagline_goblin","evidence","uncertainties","confidence"];
    return [headers.join(","),...rows.map(row=> {
      const video = catalog.videos.find(video=>video.id===row.id);
      return [row.id,video?.file,video?.fingerprint,row.type || video?.type || "programme",row.title,
        row.genres.join("; "),row.channels.join("; "),row.description,(row.tags||[]).join("; "),row.tagline,row.tagline_goblin,
        row.evidence || "",JSON.stringify(row.uncertainties || []),row.confidence ?? ""].map(csvCell).join(",");
    })].join("\r\n");
  }
  function parseRules(text) {
    return text.split(/\r?\n/).map(line=>line.trim()).filter(line=>line && !line.startsWith("#")).map((line,index)=> {
      const halves=line.split("=>");
      if(halves.length!==2 || !halves[0].trim()) throw new Error(`Rule ${index+1}: use keyword => genres | channels`);
      const fields=halves[1].split("|");
      if(fields.length>2) throw new Error(`Rule ${index+1}: too many | separators`);
      const genres=list(fields[0]), channels=list(fields[1]);
      if(!genres.length && !channels.length) throw new Error(`Rule ${index+1}: add a genre or channel`);
      return {keyword:halves[0].trim(),genres,channels};
    });
  }
  const lower = value => String(value ?? '').trim().toLocaleLowerCase();
  function filterMedia(videos, filters = {}) {
    const bound = value => value === '' || value === undefined || value === null ? null : Number(value)*60;
    const min=bound(filters.minMinutes), max=bound(filters.maxMinutes);
    const tags=list(filters.tags).map(lower), words=lower(filters.search).split(/\s+/).filter(Boolean);
    const result=videos.filter(video=>{
      const duration=Number(video.duration), measured=Number.isFinite(duration)&&duration>0;
      if (min!==null && (!Number.isFinite(min)||min<0||!measured||duration<min)) return false;
      if (max!==null && (!Number.isFinite(max)||max<0||!measured||duration>max)) return false;
      if (min!==null && max!==null && min>max) return false;
      if (filters.type && video.type!==filters.type) return false;
      if (filters.enabled==='enabled' && video.enabled===false || filters.enabled==='disabled' && video.enabled!==false) return false;
      if (filters.channel && (filters.channel==='Interdimensional Customs'
        ? video.type==='advert'||(video.channels||[]).some(c=>c!=='Interdimensional Customs')
        : !(video.channels||[]).some(c=>lower(c)===lower(filters.channel)))) return false;
      if (filters.genre && !(video.genres||[]).some(g=>lower(g)===lower(filters.genre))) return false;
      const actualTags=(video.tags||[]).map(lower);
      if (tags.length && !(filters.tagMode==='any'?tags.some(t=>actualTags.includes(t)):tags.every(t=>actualTags.includes(t)))) return false;
      const status=filters.status;
      if (status==='no-title' && lower(video.title) || status==='no-description' && lower(video.description)
        || status==='no-tags' && video.tags?.length || status==='no-genres' && video.genres?.length
        || status==='no-channels' && (video.type==='advert'||video.channels?.length)
        || status==='unknown-length' && measured
        || status==='episode-review' && (!(duration>3000)||['single','multiple'].includes(video.episode_review))
        || status==='multiple-episodes' && video.episode_review!=='multiple') return false;
      const fields=['id','file','title','description','tags','genres','channels'];
      const chosen=fields.includes(filters.searchField)?[filters.searchField]:fields;
      const text=lower(chosen.flatMap(key=>video[key]||[]).join(' '));
      return words.every(word=>text.includes(word));
    });
    const compareText=(a,b)=>String(a||'').localeCompare(String(b||''),undefined,{numeric:true,sensitivity:'base'});
    const sort=filters.sort||'source';
    if (sort!=='source') result.sort((a,b)=>{
      let difference=0;
      if (sort.startsWith('duration-')) {
        const ad=Number(a.duration),bd=Number(b.duration),av=Number.isFinite(ad)&&ad>0,bv=Number.isFinite(bd)&&bd>0;
        if(av!==bv)return av?-1:1; // Unknown lengths always last.
        difference=av?(ad-bd)*(sort==='duration-desc'?-1:1):0;
      } else if (sort.startsWith('title-')) difference=compareText(a.title||a.file,b.title||b.file)*(sort==='title-desc'?-1:1);
      else if (sort.startsWith('id-')) difference=compareText(a.id,b.id)*(sort==='id-desc'?-1:1);
      else if (sort==='channel-count') difference=(b.channels?.length||0)-(a.channels?.length||0);
      return difference||compareText(a.id,b.id);
    });
    return result;
  }
  function assignLabels(row, assignments, mode='add') {
    const result={...row};
    for (const field of ['genres','channels','tags']) {
      const values=list(assignments[field]);
      if (!values.length) continue; // Blank controls preserve current values.
      const existing=list(row[field]);
      if (mode==='remove') result[field]=existing.filter(v=>!values.some(item=>lower(item)===lower(v)));
      else if(mode==='replace') result[field]=values;
      else result[field]=[...existing,...values.filter(v=>!existing.some(item=>lower(item)===lower(v)))];
    }
    if (['programme','advert'].includes(assignments.type)) result.type=assignments.type;
    if (['enabled','disabled'].includes(assignments.enabled)) result.enabled=assignments.enabled==='enabled';
    return result;
  }
  const api={suggest,parseCsv,importText,exportCsv,parseRules,list,filterMedia,assignLabels};
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  else root.USBTvSuggestions=api;
})(typeof globalThis!=="undefined" ? globalThis : this);
