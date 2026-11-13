/* APC – Cloud-Abgleich mit Supabase (Variante A: bestehende Speicherblöcke 1:1 abgleichen).
   - Die App speichert wie bisher sofort auf dem Gerät (offline zuerst). Dieses Modul merkt sich
     geänderte Blöcke und lädt sie im Hintergrund hoch; Änderungen vom anderen Gerät werden geholt.
   - Ein gemeinsames Familien-Login (E-Mail + Passwort). Jede Familie sieht dank Row Level Security
     nur ihre eigenen Zeilen in der Tabelle public.kv.
   - Nicht in die Cloud: eigene Bilder (Spielerkarte), Coach-Aufnahmen, Name, Darstellung, Musik.
   - Nur öffentliche Angaben im Code (Projekt-Adresse und publishable/anon key). Kein geheimer Schlüssel. */
(function(){
  'use strict';
  // ---- Einstellungen pro App (Beta und richtige App haben je ein eigenes Supabase-Projekt) ----
  var CFG = { url:'', key:'' };   // z. B. url:'https://xxxx.supabase.co', key:'sb_publishable_…'

  var LS; try { LS = window.localStorage; } catch(e){ return; }
  if (!LS) return;
  var SP = Storage.prototype, rawGet = SP.getItem, rawSet = SP.setItem, rawRem = SP.removeItem;
  var META = 'apc.sync.v1';
  var SKIP = ['apc.sync.', 'apc.cardimg.', 'apc.clips.', 'apc.name', 'apc.theme'];
  var MERGE = { 'apc.progress.v1':mergeProgress };
  var syncable = function(k){ k = String(k); return k.indexOf('apc.') === 0 && !SKIP.some(function(p){ return k.indexOf(p) === 0; }); };
  var enabled = !!(CFG.url && CFG.key);

  function loadMeta(){ try { return JSON.parse(rawGet.call(LS, META) || '{}') || {}; } catch(e){ return {}; } }
  var meta = loadMeta();
  meta.dirty = meta.dirty || {};
  if (!meta.device) meta.device = Math.random().toString(36).slice(2, 10);
  function saveMeta(){ try { rawSet.call(LS, META, JSON.stringify(meta)); } catch(e){} }
  saveMeta();

  // ---- Änderungen der App mitschreiben ----
  var pushTimer = null;
  function markDirty(k, del){ if (!syncable(k)) return; meta.dirty[k] = { t:Date.now(), del:!!del }; saveMeta(); schedulePush(); }
  SP.setItem = function(k, v){ var r = rawSet.call(this, k, v); if (this === LS) markDirty(k, false); return r; };
  SP.removeItem = function(k){ var r = rawRem.call(this, k); if (this === LS) markDirty(k, true); return r; };
  function schedulePush(){ if (!linked()) return; clearTimeout(pushTimer); pushTimer = setTimeout(function(){ push().catch(function(){}); }, 1500); }

  // ---- Supabase-Zugriff (REST, ohne Zusatzbibliothek) ----
  var logged = function(){ return !!(meta.session && meta.session.refresh_token); };
  var linked = function(){ return enabled && logged() && meta.linked === true; };
  function errText(j, status){
    var m = (j && (j.error_description || j.msg || j.message || j.error)) || ('Fehler ' + status);
    var T = { 'Invalid login credentials':'E-Mail oder Passwort falsch.', 'Email not confirmed':'E-Mail-Adresse noch nicht bestätigt. Bitte den Link in der Bestätigungs-Mail öffnen.',
              'User already registered':'Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.' };
    return T[m] || m;
  }
  function req(path, opt){
    opt = opt || {};
    var h = { 'apikey':CFG.key, 'Content-Type':'application/json' };
    if (opt.auth) h.Authorization = 'Bearer ' + meta.session.access_token;
    Object.keys(opt.headers || {}).forEach(function(k){ h[k] = opt.headers[k]; });
    return fetch(CFG.url.replace(/\/$/, '') + path, { method:opt.method || 'GET', headers:h, body:opt.body ? JSON.stringify(opt.body) : undefined, keepalive:!!opt.keepalive })
      .then(function(r){ return r.text().then(function(t){ var j = null; try { j = t ? JSON.parse(t) : null; } catch(e){}
        if (!r.ok) { var e = new Error(errText(j, r.status)); e.status = r.status; throw e; } return j; }); });
  }
  function setSession(j){
    meta.session = { access_token:j.access_token, refresh_token:j.refresh_token, expires_at:Date.now() + (j.expires_in || 3600) * 1000,
                     email:(j.user && j.user.email) || (meta.session && meta.session.email) || '' };
    saveMeta();
  }
  var refreshing = null;
  function token(){
    if (!logged()) return Promise.reject(new Error('Nicht angemeldet.'));
    if (meta.session.expires_at - Date.now() > 60000) return Promise.resolve();
    if (!refreshing) refreshing = req('/auth/v1/token?grant_type=refresh_token', { method:'POST', body:{ refresh_token:meta.session.refresh_token } })
      .then(setSession).catch(function(e){ if (e.status === 400 || e.status === 401){ meta.session = null; meta.linked = false; saveMeta(); } throw e; })
      .then(function(){ refreshing = null; }, function(e){ refreshing = null; throw e; });
    return refreshing;
  }
  function api(path, opt){ return token().then(function(){ opt = opt || {}; opt.auth = true; return req(path, opt); }); }

  // ---- Abgleich ----
  function localKeys(){ var out = []; for (var i = 0; i < LS.length; i++){ var k = LS.key(i); if (k && syncable(k)) out.push(k); } return out; }
  function push(opt){
    if (!linked()) return Promise.resolve(0);
    var D = meta.dirty, keys = Object.keys(D); if (!keys.length) return Promise.resolve(0);
    var snap = {}; keys.forEach(function(k){ snap[k] = D[k].t; });
    var ups = keys.filter(function(k){ return !D[k].del; }).map(function(k){ var v = rawGet.call(LS, k); return v === null ? null : { key:k, value:v, device:meta.device }; }).filter(Boolean);
    var dels = keys.filter(function(k){ return D[k].del || rawGet.call(LS, k) === null; });
    var ka = !!(opt && opt.keepalive), jobs = [];
    if (ups.length) jobs.push(api('/rest/v1/kv?on_conflict=user_id,key', { method:'POST', body:ups, keepalive:ka, headers:{ Prefer:'resolution=merge-duplicates,return=minimal' } }));
    dels.forEach(function(k){ jobs.push(api('/rest/v1/kv?key=eq.' + encodeURIComponent(k), { method:'DELETE', keepalive:ka, headers:{ Prefer:'return=minimal' } })); });
    return Promise.all(jobs).then(function(){
      keys.forEach(function(k){ if (meta.dirty[k] && meta.dirty[k].t === snap[k]) delete meta.dirty[k]; });
      meta.lastPush = new Date().toISOString(); meta.err = ''; saveMeta(); paint(); return keys.length;
    }, function(e){ meta.err = e.message; saveMeta(); paint(); throw e; });
  }
  function pull(){
    if (!linked()) return Promise.resolve(0);
    var q = '/rest/v1/kv?select=key,value,updated_at&order=updated_at.asc' + (meta.lastPull ? '&updated_at=gt.' + encodeURIComponent(meta.lastPull) : '');
    return api(q).then(function(rows){
      var changed = 0;
      (rows || []).forEach(function(r){
        if (r.updated_at > (meta.lastPull || '')) meta.lastPull = r.updated_at;
        if (!syncable(r.key)) return;
        var cur = rawGet.call(LS, r.key);
        if (cur === r.value) return;
        if (meta.dirty[r.key]){
          if (MERGE[r.key]){ try { var m = JSON.stringify(MERGE[r.key](JSON.parse(cur), JSON.parse(r.value))); if (m !== cur){ rawSet.call(LS, r.key, m); changed++; } } catch(e){} }
          return;   // lokale Änderung bleibt und wird hochgeladen
        }
        rawSet.call(LS, r.key, r.value); changed++;
      });
      meta.lastSync = new Date().toISOString(); meta.err = ''; saveMeta(); paint();
      if (changed) needReload = true;
      return changed;
    }, function(e){ meta.err = e.message; saveMeta(); paint(); throw e; });
  }
  var needReload = false, busy = false;
  function cycle(){
    if (!linked() || busy) return Promise.resolve();
    busy = true;
    // Auf Seiten mit laufender Mission oder offenen Formularen nur hochladen, nicht holen
    var safe = window.APC_screen === undefined || SAFE.indexOf(window.APC_screen) >= 0;
    return (safe ? pull() : Promise.resolve()).then(function(){ return push(); }).catch(function(){}).then(function(){ busy = false; maybeReload(); });
  }
  // Die App hält ihre Daten im Arbeitsspeicher. Neue Daten vom anderen Gerät werden darum mit einem
  // Neuladen übernommen – aber nur auf ruhigen Seiten, nie mitten in einer Mission oder einem Formular.
  var SAFE = ['center', 'progress', 'analytics', 'missions', 'records', 'trophies', 'season', 'log', 'card'];
  function maybeReload(){
    if (!needReload) return;
    var s = window.APC_screen;
    if (s === undefined || SAFE.indexOf(s) >= 0){ needReload = false; location.reload(); }
  }

  // Zusammenführen von Fortschritt (Trainings, Testtage, Rekorde), wenn beide Geräte gleichzeitig gespeichert haben
  function mergeProgress(a, b){
    a = a || {}; b = b || {};
    var uni = function(x, y, id){ var m = {}, o = []; (y || []).concat(x || []).forEach(function(e){ var k = id(e); if (!(k in m)) o.push(e); m[k] = e; });
      return o.map(function(e){ return m[id(e)]; }).sort(function(p, q){ return (Date.parse(p && p.at) || 0) - (Date.parse(q && q.at) || 0); }); };
    var out = Object.assign({}, b, a);
    out.log = uni(a.log, b.log, function(e){ return (e && e.at) + '|' + (e && e.mission); });
    out.tests = uni(a.tests, b.tests, function(e){ return e && e.at; });
    out.records = {}; Object.keys(Object.assign({}, b.records, a.records)).forEach(function(k){ out.records[k] = uni((a.records || {})[k], (b.records || {})[k], function(r){ return (r && r.at) + '|' + (r && r.v); }); });
    out.badges = Object.assign({}, b.badges, a.badges);
    out.cards = uni(a.cards, b.cards, function(c){ return JSON.stringify(c); });
    ['xp', 'completed', 'prCount', 'titles'].forEach(function(k){ out[k] = Math.max(a[k] || 0, b[k] || 0); });
    return out;
  }

  // ---- Anmelden, Konto erstellen, erste Verknüpfung ----
  function signIn(email, pw){
    return req('/auth/v1/token?grant_type=password', { method:'POST', body:{ email:email, password:pw } }).then(function(j){ setSession(j); meta.linked = false; meta.lastPull = ''; saveMeta(); return firstLink(); });
  }
  function signUp(email, pw){
    var back = location.origin + location.pathname;
    return req('/auth/v1/signup?redirect_to=' + encodeURIComponent(back), { method:'POST', body:{ email:email, password:pw } })
      .then(function(j){ if (j && j.access_token){ setSession(j); meta.linked = false; saveMeta(); return firstLink(); } return 'confirm'; });
  }
  function signOut(){
    var s = meta.session;
    if (s) req('/auth/v1/logout', { method:'POST', auth:true }).catch(function(){});
    meta.session = null; meta.linked = false; meta.lastPull = ''; meta.choice = null; saveMeta(); paint();
  }
  // Beim ersten Anmelden auf einem Gerät: Cloud leer → Gerätedaten hochladen. Gerät leer → Cloud übernehmen.
  // Beide haben Daten → Eltern entscheiden (meta.choice).
  function firstLink(){
    return api('/rest/v1/kv?select=key&limit=1').then(function(rows){
      var cloud = (rows || []).length > 0, local = localKeys().length > 0;
      if (!cloud){ return useDevice(); }
      if (!local){ return useCloud(); }
      meta.choice = true; saveMeta(); paint(); return 'choice';
    });
  }
  function useDevice(){
    return api('/rest/v1/kv?key=like.apc.*', { method:'DELETE', headers:{ Prefer:'return=minimal' } }).then(function(){
      meta.dirty = {}; localKeys().forEach(function(k){ meta.dirty[k] = { t:Date.now(), del:false }; });
      meta.linked = true; meta.choice = null; meta.lastPull = ''; saveMeta();
      return push().then(function(){ return pull(); }).then(function(){ needReload = false; paint(); return 'device'; });
    });
  }
  function useCloud(){
    return api('/rest/v1/kv?select=key,value,updated_at&order=updated_at.asc').then(function(rows){
      localKeys().forEach(function(k){ rawRem.call(LS, k); });
      (rows || []).forEach(function(r){ if (syncable(r.key)) rawSet.call(LS, r.key, r.value); if (r.updated_at > (meta.lastPull || '')) meta.lastPull = r.updated_at; });
      meta.dirty = {}; meta.linked = true; meta.choice = null; meta.lastSync = new Date().toISOString(); saveMeta();
      location.reload(); return 'cloud';
    });
  }

  // ---- Anzeige im Eltern-Bereich ----
  var box = null, note = '';
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); };
  var when = function(iso){ if (!iso) return '–'; try { return new Date(iso).toLocaleString('de-CH', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch(e){ return iso; } };
  function paint(){
    if (!box || !document.body.contains(box)) return;
    var h = '<p class="eyebrow">Cloud-Abgleich</p>';
    if (!enabled){
      h += '<p>Der Cloud-Abgleich ist für diese App noch nicht eingerichtet. Alle Daten bleiben auf diesem Gerät.</p>';
    } else if (!logged()){
      h += '<p>Mit dem Familien-Login sehen und bearbeiten mehrere Geräte dieselben Daten. Eigene Bilder, Coach-Aufnahmen und der Name bleiben nur auf diesem Gerät.</p>' +
        '<div class="sync-form"><label>E-Mail<input type="email" id="sy-mail" autocomplete="username" inputmode="email"></label>' +
        '<label>Passwort (mind. 10 Zeichen)<input type="password" id="sy-pw" autocomplete="current-password" minlength="10"></label></div>' +
        '<div class="bk-row"><button class="btn btn-primary btn-small" id="sy-in">Anmelden</button><button class="btn btn-ghost btn-small" id="sy-up">Konto erstellen</button></div>';
    } else if (meta.choice){
      h += '<p>Angemeldet als <b>' + esc(meta.session.email) + '</b>. In der Cloud und auf diesem Gerät gibt es schon Daten. Welche sollen gelten?</p>' +
        '<p class="muted">Tipp: Vorher unten eine Sicherung erstellen. Auf einem zweiten Gerät ist «Cloud übernehmen» richtig.</p>' +
        '<div class="bk-row"><button class="btn btn-primary btn-small" id="sy-cloud">Cloud übernehmen (ersetzt dieses Gerät)</button>' +
        '<button class="btn btn-ghost btn-small" id="sy-dev">Dieses Gerät hochladen (ersetzt die Cloud)</button>' +
        '<button class="btn btn-ghost btn-small" id="sy-out">Abmelden</button></div>';
    } else {
      var open = Object.keys(meta.dirty).length;
      h += '<p>Verbunden als <b>' + esc(meta.session.email) + '</b>. Letzter Abgleich: ' + when(meta.lastSync) + '.' +
        (open ? ' ' + open + ' Änderung' + (open > 1 ? 'en warten' : ' wartet') + ' auf das Hochladen.' : ' Alles abgeglichen.') + '</p>' +
        (meta.err ? '<p class="sync-err">Letzter Fehler: ' + esc(meta.err) + '</p>' : '') +
        '<div class="bk-row"><button class="btn btn-primary btn-small" id="sy-now">Jetzt abgleichen</button><button class="btn btn-ghost btn-small" id="sy-out">Abmelden</button></div>';
    }
    h += '<p id="sy-msg" aria-live="polite">' + esc(note) + '</p>';
    box.innerHTML = h;
    var $ = function(id){ return box.querySelector('#' + id); };
    var say = function(t){ note = t; var m = $('sy-msg'); if (m) m.textContent = t; };
    var run = function(btn, p, ok){ btn.disabled = true; say('Bitte warten …'); p.then(function(r){ note = ok ? ok(r) : ''; paint(); }, function(e){ btn.disabled = false; say(e.message || String(e)); }); };
    var creds = function(){ var e = $('sy-mail').value.trim(), p = $('sy-pw').value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)){ say('Bitte eine gültige E-Mail-Adresse eingeben.'); return null; }
      if (p.length < 10){ say('Das Passwort braucht mindestens 10 Zeichen.'); return null; } return [e, p]; };
    if ($('sy-in')) $('sy-in').onclick = function(){ var c = creds(); if (c) run(this, signIn(c[0], c[1]), function(r){ return r === 'choice' ? '' : 'Angemeldet und abgeglichen.'; }); };
    if ($('sy-up')) $('sy-up').onclick = function(){ var c = creds(); if (c) run(this, signUp(c[0], c[1]), function(r){ return r === 'confirm' ? 'Konto erstellt. Bitte den Link in der Bestätigungs-Mail öffnen und danach hier anmelden.' : 'Konto erstellt und verbunden.'; }); };
    if ($('sy-cloud')) $('sy-cloud').onclick = function(){ if (confirm('Die Daten auf diesem Gerät werden durch die Daten aus der Cloud ersetzt. Weiter?')) run(this, useCloud()); };
    if ($('sy-dev')) $('sy-dev').onclick = function(){ if (confirm('Die Daten in der Cloud werden durch die Daten dieses Geräts ersetzt. Das andere Gerät übernimmt sie beim nächsten Abgleich. Weiter?')) run(this, useDevice(), function(){ return 'Daten hochgeladen.'; }); };
    if ($('sy-now')) $('sy-now').onclick = function(){ var b = this; b.disabled = true; say('Gleiche ab …'); pull().then(function(){ return push(); }).then(function(){ note = 'Abgeglichen.'; paint(); if (needReload){ needReload = false; location.reload(); } }, function(e){ b.disabled = false; say(e.message); }); };
    if ($('sy-out')) $('sy-out').onclick = function(){ if (confirm('Abmelden? Die Daten bleiben auf diesem Gerät, werden aber nicht mehr abgeglichen.')){ note = 'Abgemeldet.'; signOut(); } };
  }
  function mount(el){ box = el; if (!box) return; box.classList.add('sync-box'); paint(); }
  var st = document.createElement('style');
  st.textContent = '.sync-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.sync-form label{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:.9rem}' +
    '.sync-form input{min-height:44px;border-radius:10px;border:1.5px solid var(--line);background:var(--panel-2);color:var(--text);font:inherit;padding:6px 12px}.sync-err{color:var(--red)}';
  (document.head || document.documentElement).appendChild(st);

  // ---- Zeitplan: beim Start, beim Zurückkehren in die App und jede Minute ----
  if (enabled){
    var start = function(){ cycle(); setInterval(function(){ if (document.visibilityState === 'visible') cycle(); }, 60000); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'visible') cycle(); else push({ keepalive:true }).catch(function(){});
    });
    window.addEventListener('online', function(){ cycle(); });
  }
  window.APCSync = { mount:mount, sync:cycle, status:function(){ return { enabled:enabled, logged:logged(), linked:linked(), dirty:Object.keys(meta.dirty).length, lastSync:meta.lastSync }; }, _cfg:CFG };
})();
