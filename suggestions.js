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
    return {id:video.id, title:video.title || "", genres:genres.length ? genres : suggestedGenres,
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
  function importText(text, catalog) {
    const trimmed=text.trim().replace(/^\uFEFF/,"");
    let records;
    if (/^[\[{]/.test(trimmed)) {
      let parsed;
      try { parsed=JSON.parse(trimmed); } catch (_) { throw new Error("Invalid JSON file."); }
      records=Array.isArray(parsed) ? parsed : parsed.suggestions;
      if(!Array.isArray(records)) throw new Error("JSON needs an array, or an object with a suggestions array.");
    } else records=parseCsv(trimmed);
    if(records.length>10000) throw new Error("Import up to 10,000 rows at once.");
    const found=[], skipped=[], seen=new Set();
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
      const reasons=["Imported suggestion"];
      if(record.evidence) reasons.push(String(record.evidence).slice(0,2000));
      if(Array.isArray(record.uncertainties)) reasons.push(...record.uncertainties.map(value=>String(value).slice(0,300)));
      const suggestion={id:video.id, title:video.title || "", genres:list(video.genres),channels:list(video.channels),
        description:video.description || "", tags:list(video.tags), tagline:video.tagline || "", tagline_goblin:video.tagline_goblin || "",reasons,selected:false};
      if(Object.hasOwn(record,"title")) suggestion.title=String(record.title || "").trim().slice(0,300);
      for(const [field,limit] of [["description",1000],["tagline",300],["tagline_goblin",300]]) if(Object.hasOwn(record,field)) suggestion[field]=String(record[field] || "").trim().slice(0,limit);
      for(const field of ["genres","channels","tags"]) if(Object.hasOwn(record,field)) suggestion[field]=list(record[field]);
      found.push(suggestion);
    });
    return {found,skipped};
  }
  const csvCell=value=>'"'+String(value ?? "").replace(/"/g,'""')+'"';
  function exportCsv(rows,catalog) {
    return ["id,file,title,genres,channels,description,tags,tagline,tagline_goblin",...rows.map(row=>[row.id,catalog.videos.find(video=>video.id===row.id)?.file,row.title,row.genres.join("; "),row.channels.join("; "),row.description,(row.tags||[]).join("; "),row.tagline,row.tagline_goblin].map(csvCell).join(","))].join("\r\n");
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
  const api={suggest,parseCsv,importText,exportCsv,parseRules,list};
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  else root.USBTvSuggestions=api;
})(typeof globalThis!=="undefined" ? globalThis : this);
