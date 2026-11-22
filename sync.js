/* APC – Cloud-Abgleich mit Supabase (Variante A: bestehende Speicherblöcke 1:1 abgleichen).
   - Die App speichert wie bisher sofort auf dem Gerät (offline zuerst). Dieses Modul merkt sich
     geänderte Blöcke und lädt sie im Hintergrund hoch; Änderungen vom anderen Gerät werden geholt.
   - Ein gemeinsames Familien-Login (E-Mail + Passwort). Jede Familie sieht dank Row Level Security
     nur ihre eigenen Zeilen in der Tabelle public.kv.
   - Ab APC 1.9: Login-Pflicht. Neue Familien registrieren sich mit Vorname, Name und E-Mail und haben
     zuerst den Status «wartend» (Tabelle public.familien). Erst nach der Freigabe durch den Betreiber
     («aktiv») öffnet sich die App; «deaktiviert» sperrt sie wieder. Die Daten bleiben erhalten.
   - Ab APC 2.4 (Variante A gegen Datenverlust): Vor jedem Hochladen wird der Cloud-Stand geholt und mit dem
     Gerät zusammengeführt (Drei-Wege-Vergleich mit dem letzten gemeinsamen Stand). Ergänzungen beider Geräte
     bleiben erhalten, Löschungen kommen auf dem anderen Gerät an, Unverändertes wird nicht hochgeladen.
   - Nicht in die Cloud: eigene Bilder (Spielerkarte), Coach-Aufnahmen, Name, Darstellung, Musik.
   - Nur öffentliche Angaben im Code (Projekt-Adresse und publishable/anon key). Kein geheimer Schlüssel. */
(function(){
  'use strict';
  // ---- Einstellungen pro App (Beta und richtige App haben je ein eigenes Supabase-Projekt) ----
  var CFG = { url:'https://dnnomxgmyjyekjzynsce.supabase.co', key:'sb_publishable_4xyzFcj6S4yK5uthJ8wDWw_38FVKdN1' };   // Beta-Projekt apc-beta (öffentliche Angaben)

  var LS; try { LS = window.localStorage; } catch(e){ return; }
  if (!LS) return;
  var SP = Storage.prototype, rawGet = SP.getItem, rawSet = SP.setItem, rawRem = SP.removeItem;
  var META = 'apc.sync.v1';
  // apc.cardimg deckt die Auswahl (apc.cardimg.v1) UND die eigenen Bilder (apc.cardimgs.v1) ab – bis APC 2.3 fehlten die Bilder (Tippfehler)
  var SKIP = ['apc.sync.', 'apc.seenVersion', 'apc.cardimg', 'apc.clips.', 'apc.name', 'apc.theme', 'apc.xseen.', 'apc.defekt.'];   // apc.defekt: Kopien beschädigter Blöcke (APC 2.32), nur auf dem Gerät   // apc.xseen: gesehene Bonus-Meldungen pro Gerät
  var syncable = function(k){ k = String(k); return k.indexOf('apc.') === 0 && !SKIP.some(function(p){ return k.indexOf(p) === 0; }); };
  var enabled = !!(CFG.url && CFG.key);

  function loadMeta(){ try { return JSON.parse(rawGet.call(LS, META) || '{}') || {}; } catch(e){ return {}; } }
  var meta = loadMeta();
  meta.dirty = meta.dirty || {};
  Object.keys(meta.dirty).forEach(function(k){ if (!syncable(k)) delete meta.dirty[k]; });   // APC 2.31: z. B. eigene Bilder nie mehr hochladen
  if (meta.linked === true && !meta.status) meta.status = 'aktiv';   // Geräte, die schon vor 1.9 verbunden waren (auch offline sofort nutzbar)
  if (!meta.device) meta.device = Math.random().toString(36).slice(2, 10);
  function saveMeta(){ try { rawSet.call(LS, META, JSON.stringify(meta)); } catch(e){} }

  // ---- APC 2.4: zwei Vergleichsstände pro Block für das Zusammenführen ----
  // 1) Abgleich-Basis («apc.sync.b.<Block>», auf dem Gerät gespeichert): letzter Stand, den Gerät und Cloud
  //    nachweislich gemeinsam hatten. Damit erkennt das Zusammenführen, was jede Seite seither ergänzt,
  //    geändert oder gelöscht hat.
  // 2) App-Sicht (nur im Arbeitsspeicher): der Stand, den die laufende App kennt (beim Start geladen oder
  //    zuletzt selbst gespeichert). Hat der Abgleich inzwischen Neues vom anderen Gerät eingetragen, wird beim
  //    nächsten Speichern der App zusammengeführt statt überschrieben.
  // apc.sync.* geht nie in die Cloud und nie in eine Sicherung.
  var BASE = 'apc.sync.b.';
  var getBase = function(k){ try { return rawGet.call(LS, BASE + k); } catch(e){ return null; } };
  var setBase = function(k, v){ try { if (v === null || v === undefined) rawRem.call(LS, BASE + k); else rawSet.call(LS, BASE + k, v); } catch(e){ try { rawRem.call(LS, BASE + k); } catch(x){} } };
  var appView = {};
  try { for (var i0 = 0; i0 < LS.length; i0++){ var k0 = LS.key(i0); if (k0 && syncable(k0)) appView[k0] = rawGet.call(LS, k0); } } catch(e){}
  saveMeta();

  // ---- Änderungen der App mitschreiben ----
  var pushTimer = null;
  function markDirty(k, del){ if (!syncable(k)) return; meta.dirty[k] = { t:Date.now(), del:!!del }; saveMeta(); schedulePush(); }
  SP.setItem = function(k, v){
    if (this !== LS) return rawSet.call(this, k, v);
    v = String(v);
    if (syncable(k)){
      var cur = rawGet.call(LS, k), seen = appView.hasOwnProperty(k) ? appView[k] : cur;
      appView[k] = v;
      // Der Abgleich hat seit dem letzten Lesen der App Neues eingetragen: zusammenführen statt überschreiben
      if (cur !== null && seen !== null && cur !== seen){ var m = mergeText(k, v, cur, seen); if (m !== null) v = m; }
    }
    var r = rawSet.call(LS, k, v); markDirty(k, false); return r;
  };
  SP.removeItem = function(k){ var r = rawRem.call(this, k); if (this === LS){ if (syncable(k)) appView[k] = null; markDirty(k, true); } return r; };
  function schedulePush(){ if (!linked()) return; clearTimeout(pushTimer); pushTimer = setTimeout(function(){ push().catch(function(){}); }, 1500); }

  // ---- Supabase-Zugriff (REST, ohne Zusatzbibliothek) ----
  var logged = function(){ return !!(meta.session && meta.session.refresh_token); };
  var active = function(){ return logged() && meta.status === 'aktiv'; };
  var linked = function(){ return enabled && active() && meta.linked === true; };
  function errText(j, status){
    var m = (j && (j.error_description || j.msg || j.message || j.error)) || ('Fehler ' + status);
    var T = { 'Invalid login credentials':'E-Mail oder Passwort falsch.', 'Email not confirmed':'E-Mail-Adresse noch nicht bestätigt. Bitte den Link in der Bestätigungs-Mail öffnen.',
              'User already registered':'Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.',
              'Failed to fetch':'Keine Verbindung zum Internet.', 'Load failed':'Keine Verbindung zum Internet.' };
    return T[m] || m;
  }
  function req(path, opt){
    opt = opt || {};
    var h = { 'apikey':CFG.key, 'Content-Type':'application/json' };
    if (opt.auth) h.Authorization = 'Bearer ' + meta.session.access_token;
    Object.keys(opt.headers || {}).forEach(function(k){ h[k] = opt.headers[k]; });
    return fetch(CFG.url.replace(/\/$/, '') + path, { method:opt.method || 'GET', headers:h, body:opt.body ? JSON.stringify(opt.body) : undefined, keepalive:!!opt.keepalive })
      .catch(function(){ throw new Error('Keine Verbindung zum Internet.'); })
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
      .then(setSession).catch(function(e){ if (e.status === 400 || e.status === 401){ meta.session = null; meta.linked = false; meta.status = ''; saveMeta(); gate(); } throw e; })
      .then(function(){ refreshing = null; }, function(e){ refreshing = null; throw e; });
    return refreshing;
  }
  function api(path, opt){ return token().then(function(){ opt = opt || {}; opt.auth = true; return req(path, opt); }); }

  // ---- Freigabe-Status (public.familien) ----
  function checkStatus(){
    if (!logged()) return Promise.resolve('');
    return api('/rest/v1/familien?select=status').then(function(rows){
      var s = (rows && rows[0] && rows[0].status) || 'wartend';
      if (s !== meta.status){ meta.status = s; saveMeta(); }
      return s;
    });
  }

  // ---- Abgleich ----
  function localKeys(){ var out = []; for (var i = 0; i < LS.length; i++){ var k = LS.key(i); if (k && syncable(k)) out.push(k); } return out; }
  // Hochladen (APC 2.4): zuerst den aktuellen Cloud-Stand der geänderten Blöcke holen und mit dem Gerät
  // zusammenführen – so überschreibt ein Gerät nie mehr unbemerkt, was das andere inzwischen gespeichert hat.
  // Hochladen läuft immer nacheinander (nie zwei gleichzeitig).
  // APC 2.42: Holen und Hochladen laufen strikt nacheinander in einer gemeinsamen Warteschlange. Liefen sie
  // gleichzeitig, konnte ein Gerät seinen eigenen, gerade hochgeladenen Stand als Änderung des anderen Geräts
  // ansehen und Zähler wie XP doppelt zählen.
  var queue = Promise.resolve();
  function serial(fn){ var p = queue.then(fn); queue = p.catch(function(){}); return p; }
  function push(opt){ return serial(function(){ return pushNow(opt); }); }
  function pull(){ return serial(pullNow); }
  // Zuletzt von diesem Gerät hochgeladener Stand pro Block («apc.sync.s.<Block>»). Findet das Gerät genau diesen
  // Stand in der Cloud, stammt er von ihm selbst (z. B. Antwort unterwegs verloren) und gilt als gemeinsamer Stand.
  var SENT = 'apc.sync.s.';
  var getSent = function(k){ try { return rawGet.call(LS, SENT + k); } catch(e){ return null; } };
  var setSent = function(k, v){ try { if (v === null) rawRem.call(LS, SENT + k); else rawSet.call(LS, SENT + k, v); } catch(e){} };
  function baseFor(k, cloudVal){ var bt = getBase(k); if (cloudVal !== undefined && cloudVal !== null && cloudVal === getSent(k)) bt = cloudVal; return bt; }
  function pushNow(opt){
    if (!linked()) return Promise.resolve(0);
    var D = meta.dirty, keys = Object.keys(D).filter(syncable); if (!keys.length) return Promise.resolve(0);
    var snap = {}; keys.forEach(function(k){ snap[k] = D[k].t; });
    var upKeys = keys.filter(function(k){ return !D[k].del && rawGet.call(LS, k) !== null; });
    var dels = keys.filter(function(k){ return upKeys.indexOf(k) < 0; });
    var ka = !!(opt && opt.keepalive), local = {};
    upKeys.forEach(function(k){ local[k] = rawGet.call(LS, k); });
    var inList = upKeys.map(function(k){ return '"' + k.replace(/"/g, '') + '"'; }).join(',');
    var fetchCloud = upKeys.length ? api('/rest/v1/kv?select=key,value,updated_at&key=in.(' + encodeURIComponent(inList) + ')', { keepalive:ka }) : Promise.resolve([]);
    return fetchCloud.then(function(rows){
      var cloud = {}, stamp = {}; (rows || []).forEach(function(r){ cloud[r.key] = r.value; stamp[r.key] = r.updated_at; });
      var send = {};
      upKeys.forEach(function(k){
        var c = cloud[k], l = local[k], bt = baseFor(k, c);
        send[k] = (c === undefined || c === l || c === bt) ? l : (mergeText(k, l, c, bt) || l);
      });
      // Nur hochladen, was sich von der Cloud unterscheidet. Ein Gerät, das einen Block unverändert neu speichert,
      // kann so nie gleichzeitig Neues vom anderen Gerät überschreiben.
      var post = upKeys.filter(function(k){ return send[k] !== cloud[k]; }), jobs = [];
      post.forEach(function(k){ setSent(k, send[k]); });
      // APC 2.42: bedingtes Speichern. Ein Block wird nur geschrieben, wenn er in der Cloud seit dem Lesen
      // unverändert ist (gleicher Zeitstempel updated_at); ein neuer Block nur, wenn ihn nicht gerade das andere
      // Gerät angelegt hat. Sonst wurde nichts geschrieben: Der Block bleibt markiert, und der nächste Durchgang
      // führt mit dem neuen Cloud-Stand zusammen. So kann kein Gerät das andere überschreiben – auch nicht im
      // selben Moment. Braucht kein zusätzliches SQL (Tabelle kv mit Zeitstempel und Änderungs-Regel genügen).
      var lost = {}, CF = meta.conflict || (meta.conflict = {});
      post.forEach(function(k){
        var body = { value:send[k], device:meta.device }, req;
        // Rückfall: Scheitert das bedingte Speichern mit genau demselben Zeitstempel erneut, obwohl sich die Cloud
        // nicht verändert hat, greift die Bedingung nicht (z. B. Zeitformat) – dann normal speichern wie in 2.4.
        if (stamp[k] && CF[k] === stamp[k]){ body.key = k; meta.condFallback = (meta.condFallback || 0) + 1;
          req = api('/rest/v1/kv?on_conflict=user_id,key', { method:'POST', keepalive:ka, headers:{ Prefer:'resolution=merge-duplicates,return=minimal' }, body:[body] }).then(function(){ return [1]; }); }
        else if (stamp[k]) req = api('/rest/v1/kv?key=eq.' + encodeURIComponent(k) + '&updated_at=eq.' + encodeURIComponent(stamp[k]),
          { method:'PATCH', keepalive:ka, headers:{ Prefer:'return=representation' }, body:body });
        else { body.key = k; req = api('/rest/v1/kv?on_conflict=user_id,key', { method:'POST', keepalive:ka, headers:{ Prefer:'resolution=ignore-duplicates,return=representation' }, body:[body] }); }
        jobs.push(req.then(function(r){ if (!r || !r.length){ lost[k] = 1; CF[k] = stamp[k] || ''; } else delete CF[k]; }));
      });
      dels.forEach(function(k){ jobs.push(api('/rest/v1/kv?key=eq.' + encodeURIComponent(k), { method:'DELETE', keepalive:ka, headers:{ Prefer:'return=minimal' } })); });
      return Promise.all(jobs).then(function(){
        upKeys.forEach(function(k){
          var now = rawGet.call(LS, k), v = send[k];
          if (v !== local[k]){   // der hochgeladene Stand enthält Neues vom anderen Gerät: auch aufs Gerät
            if (now === local[k]) rawSet.call(LS, k, v);
            else if (now !== null){ var m = mergeText(k, now, v, local[k]); if (m !== null) rawSet.call(LS, k, m); }   // App hat inzwischen gespeichert
            needReload = true;
          }
          if (lost[k]){ setBase(k, cloud[k] === undefined ? null : cloud[k]); return; }
          setBase(k, v);   // die Cloud hat jetzt genau v
        });
        dels.forEach(function(k){ if (rawGet.call(LS, k) === null) setBase(k, null); });
        keys.forEach(function(k){ if (meta.dirty[k] && meta.dirty[k].t === snap[k]) delete meta.dirty[k]; });
        Object.keys(lost).forEach(function(k){ meta.dirty[k] = { t:Date.now(), del:false }; });
        if (Object.keys(lost).length){ clearTimeout(pushTimer); pushTimer = setTimeout(function(){ push().catch(function(){}); }, 400 + Math.random() * 1200); }
        meta.lastPush = new Date().toISOString(); meta.err = ''; saveMeta(); paint();
        if (needReload && !busy) setTimeout(maybeReload, 0);   // Neues vom anderen Gerät gleich anzeigen (nur auf ruhigen Seiten)
        return keys.length;
      });
    }).catch(function(e){ meta.err = e.message; saveMeta(); paint(); throw e; });
  }
  function pullNow(){
    if (!linked()) return Promise.resolve(0);
    // Erster Abgleich nach dem Update auf 2.4: einmal alle Blöcke holen, um die Basis anzulegen. Dabei wird nichts
    // vom Gerät überschrieben – weicht ein Block ab, wird zusammengeführt und hochgeladen.
    var init = meta.baseInit !== 1;
    var q = '/rest/v1/kv?select=key,value,updated_at&order=updated_at.asc' + (meta.lastPull && !init ? '&updated_at=gt.' + encodeURIComponent(meta.lastPull) : '');
    return api(q).then(function(rows){
      var changed = 0;
      (rows || []).forEach(function(r){
        if (r.updated_at > (meta.lastPull || '')) meta.lastPull = r.updated_at;
        if (!syncable(r.key)) return;
        var cur = rawGet.call(LS, r.key);
        if (cur === r.value){ if (!meta.dirty[r.key]) setBase(r.key, r.value); return; }
        if (init && cur !== null && !meta.dirty[r.key]) meta.dirty[r.key] = { t:Date.now(), del:false };   // abweichend: wie eine lokale Änderung behandeln
        if (meta.dirty[r.key]){
          // Gerät hat ungespeicherte Änderungen: zusammenführen, die Basis bleibt bis zum Neuladen
          var m = cur === null ? null : mergeText(r.key, cur, r.value, baseFor(r.key, r.value));
          if (m !== null && m !== cur){ rawSet.call(LS, r.key, m); changed++; }
          setBase(r.key, r.value);   // die Cloud-Fassung ist jetzt gemeinsamer Stand; das Gerät hat zusätzlich seine Änderungen
          return;
        }
        rawSet.call(LS, r.key, r.value); setBase(r.key, r.value); changed++;
      });
      // Löschungen vom anderen Gerät: Blöcke, die schon einmal abgeglichen waren (Basis vorhanden), hier nicht
      // geändert wurden und in der Cloud fehlen, werden auch hier entfernt.
      return api('/rest/v1/kv?select=key').then(function(all){
        var inCloud = {}; (all || []).forEach(function(r){ inCloud[r.key] = 1; });
        localKeys().forEach(function(k){
          if (inCloud[k] || meta.dirty[k]) return;
          if (getBase(k) !== null){ rawRem.call(LS, k); setBase(k, null); changed++; }
          else if (init) meta.dirty[k] = { t:Date.now(), del:false };   // nie hochgeladener Block (z. B. Kopie aus der Hauptversion): jetzt hochladen
        });
        if (init) meta.baseInit = 1;
        return changed;
      });
    }).then(function(changed){
      meta.lastSync = new Date().toISOString(); meta.err = ''; saveMeta(); paint();
      if (changed) needReload = true;
      return changed;
    }, function(e){ meta.err = e.message; saveMeta(); paint(); throw e; });
  }
  // APC 2.31: eigene Bilder, die bis APC 2.3 versehentlich hochgeladen wurden, einmalig aus der Cloud löschen.
  // Nur die Cloud-Kopie; die Bilder auf dem Gerät bleiben.
  function cleanCloud(){
    if (meta.imgClean === 1) return Promise.resolve();
    return api('/rest/v1/kv?key=eq.' + encodeURIComponent('apc.cardimgs.v1'), { method:'DELETE', headers:{ Prefer:'return=minimal' } })
      .then(function(){ meta.imgClean = 1; saveMeta(); }, function(){});   // offline: beim nächsten Abgleich wieder versuchen
  }
  var needReload = false, busy = false;
  var running = null;
  function cycle(opt){
    if (!enabled || !logged()) return Promise.resolve();
    if (busy) return running || Promise.resolve();
    busy = true;
    var force = !!(opt && opt.pull);
    // Zuerst den Freigabe-Status prüfen (offline gilt der zuletzt bekannte Status)
    running = checkStatus().then(function(){ if (meta.err === NETERR){ meta.err = ''; saveMeta(); } }, function(){}).then(function(){   // Status erreichbar = wieder online
      if (!active()) return;
      if (meta.linked !== true) return meta.choice ? null : firstLink();
      // Auf Seiten mit laufender Mission oder offenen Formularen nur hochladen, nicht holen
      // Eltern-Bereich (ab 2.42): holen ja, aber nie automatisch neu laden – dort erscheint der Hinweis «Aktualisieren»
      var safe = force || window.APC_screen === undefined || window.APC_screen === 'parents' || SAFE.indexOf(window.APC_screen) >= 0;
      return cleanCloud().then(function(){ return safe ? pull() : null; }).then(function(){ return push(); });
    }).catch(function(e){ meta.err = e.message; saveMeta(); }).then(function(){ busy = false; running = null; paint(); gate(); if (!(opt && opt.noReload)) maybeReload(); });
    return running;
  }
  // Die App hält ihre Daten im Arbeitsspeicher. Neue Daten vom anderen Gerät werden darum mit einem
  // Neuladen übernommen – aber nur auf ruhigen Seiten, nie mitten in einer Mission oder einem Formular.
  var SAFE = ['center', 'progress', 'analytics', 'missions', 'records', 'trophies', 'season', 'log', 'card', 'games'];
  function maybeReload(){
    if (!needReload) return;
    var s = window.APC_screen;
    if (s === undefined || SAFE.indexOf(s) >= 0){ if (reloadTo(s)) needReload = false; }
    else if (s === 'parents'){ fresh = true; banner(); }
  }
  // APC 2.42: Nach dem Neuladen (neue Daten vom anderen Gerät) öffnet die App wieder dieselbe Seite, ohne Intro
  function reloadTo(s, manual){
    // Schutz vor einer Neulade-Schleife: automatisch höchstens 2× innerhalb von 30 s
    try { var L = JSON.parse(sessionStorage.getItem('apcReloads') || '[]').filter(function(t){ return Date.now() - t < 30000; });
      if (!manual && L.length >= 2){   // später nochmals versuchen (needReload bleibt gesetzt)
        fresh = true; banner(); clearTimeout(retryT); retryT = setTimeout(maybeReload, 30000 - (Date.now() - L[0]) + 200); return false; }
      L.push(Date.now()); sessionStorage.setItem('apcReloads', JSON.stringify(L)); if (s) sessionStorage.setItem('apcReopen', s); } catch(e){}
    location.reload(); return true;
  }
  var retryT = null;

  // ---- APC 2.42: Abgleich beim Seitenwechsel ----
  // Eltern-Bereich: beim Öffnen sofort abgleichen, damit Daten vom anderen iPad da sind, bevor man etwas
  // bearbeitet. Kommen neue Daten an und wurde noch nichts angetippt, lädt die App gleich wieder den
  // Eltern-Bereich; sonst erscheint oben ein Hinweis mit «Aktualisieren».
  // Ruhige Seiten: sofort abgleichen statt erst beim nächsten Minutentakt (höchstens alle 10 s).
  var lastScreenSync = 0, fresh = false;
  function screen(name){
    if (!enabled || !logged() || !linked() || !active()) { badge(); return; }
    if (name === 'parents'){
      var t0 = Date.now(), touched = false;
      var mark = function(){ touched = true; };
      document.addEventListener('pointerdown', mark, true); document.addEventListener('keydown', mark, true);
      var p = busy ? (running || Promise.resolve()).then(function(){ return cycle({ pull:true, noReload:true }); }) : cycle({ pull:true, noReload:true });
      p.then(function(){
        document.removeEventListener('pointerdown', mark, true); document.removeEventListener('keydown', mark, true);
        if (!needReload) return;
        if (window.APC_screen !== 'parents'){ maybeReload(); return; }
        if (!touched && Date.now() - t0 < 8000 && reloadTo('parents')){ needReload = false; return; }
        fresh = true; banner();
      });
      lastScreenSync = Date.now();
    } else if (SAFE.indexOf(name) >= 0){
      if (needReload) { maybeReload(); return; }
      if (Date.now() - lastScreenSync > 10000){ lastScreenSync = Date.now(); cycle(); }
    }
    banner();
  }

  // ---- APC 2.42: Offline-Hinweis ----
  // Unten über der Navigation: «Offline» (mit Anzahl wartender Änderungen). Im Eltern-Bereich oben ein Hinweis,
  // dass Daten vom anderen iPad möglicherweise nicht aktuell sind.
  var NETERR = 'Keine Verbindung zum Internet.';
  function offline(){ return linked() && (navigator.onLine === false || meta.err === NETERR); }
  function badge(){
    if (!document.body) return;
    var el = document.getElementById('sy-off');
    if (!el){ el = document.createElement('span'); el.id = 'sy-off'; el.className = 'sy-off'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    var n = Object.keys(meta.dirty).length, on = enabled && logged() && offline();
    el.hidden = !on;
    el.textContent = on ? 'Offline' + (n ? ' · ' + n + (n > 1 ? ' Änderungen warten' : ' Änderung wartet') : '') : '';
    banner();
  }
  function banner(){
    var sc = document.getElementById('screen-parents'); if (!sc) return;
    var el = document.getElementById('sy-banner');
    var off = enabled && logged() && offline(), show = window.APC_screen === 'parents' && (off || fresh);
    if (!show){ if (el) el.remove(); if (window.APC_screen !== 'parents') fresh = false; return; }
    var host = sc.querySelector('.inner') || sc;
    if (!el || el.parentNode !== host){ if (el) el.remove(); el = document.createElement('div'); el.id = 'sy-banner'; el.className = 'sy-banner'; el.setAttribute('role', 'status');
      var head = host.querySelector('.tr-head'); if (head && head.nextSibling) host.insertBefore(el, head.nextSibling); else host.insertBefore(el, host.firstChild); }
    if (off){ el.className = 'sy-banner off';
      el.innerHTML = '<span><b>Offline</b> – Daten vom anderen iPad sind möglicherweise nicht aktuell. Deine Änderungen werden hochgeladen, sobald wieder Internet da ist.</span>'; }
    else { el.className = 'sy-banner new';
      el.innerHTML = '<span><b>Neue Daten vom anderen iPad</b> sind da.</span> <button class="btn btn-primary btn-small" id="sy-fresh">Aktualisieren</button>';
      el.querySelector('#sy-fresh').onclick = function(){ reloadTo('parents', true); }; }
  }

  // ---- APC 2.4: Zusammenführen (Drei-Wege-Vergleich mit der Basis) ----
  // l = dieses Gerät, c = Cloud, b = gemeinsame Basis (oder undefined, wenn unbekannt).
  // Was nur eine Seite geändert hat, wird übernommen; Ergänzungen beider Seiten bleiben erhalten; Löschungen gelten.
  // Ändern beide Seiten denselben einzelnen Wert, gilt dieses Gerät – ausser bei Einträgen mit Zeitstempel «at»
  // (z. B. Kommentare, Matchstatistik): dort gilt der neuere Eintrag. Zähler im Fortschritt (XP usw.) werden addiert.
  var COUNTERS = { xp:1, completed:1, prCount:1, titles:1 };
  var J = function(x){ return JSON.stringify(x); };
  var isObj = function(x){ return !!x && typeof x === 'object' && !Array.isArray(x); };
  var withId = function(a){ return Array.isArray(a) && a.length > 0 && a.every(function(e){ return isObj(e) && e.id !== undefined && e.id !== null; }); };
  function merge3(l, c, b, top){
    if (J(l) === J(c)) return l;
    if (b !== undefined){ if (J(l) === J(b)) return c; if (J(c) === J(b)) return l; }
    if (l === undefined) return c;           // nur auf einer Seite vorhanden (ohne Basis: ergänzen)
    if (c === undefined) return l;
    if (isObj(l) && isObj(c)){
      if (typeof l.at === 'string' && typeof c.at === 'string' && !top) return c.at > l.at ? c : l;
      var bo = isObj(b) ? b : (b === undefined ? undefined : {}), out = {};
      Object.keys(Object.assign({}, bo || {}, c, l)).forEach(function(k){
        var r = merge3(l[k], c[k], bo === undefined ? undefined : bo[k], false);
        if (top === 'progress' && COUNTERS[k] && typeof l[k] === 'number' && typeof c[k] === 'number')
          r = (bo && typeof bo[k] === 'number') ? l[k] + c[k] - bo[k] : Math.max(l[k], c[k]);
        if (r !== undefined) out[k] = r;
      });
      return out;
    }
    if (Array.isArray(l) && Array.isArray(c)){
      var ba = Array.isArray(b) ? b : (b === undefined ? undefined : []);
      if ((withId(l) || !l.length) && (withId(c) || !c.length) && (l.length || c.length) && (!ba || !ba.length || withId(ba))){
        var mp = function(a){ var m = {}; (a || []).forEach(function(e){ m[J(e.id)] = e; }); return m; };
        var L = mp(l), C = mp(c), B = ba ? mp(ba) : null, order = [], seen = {};
        c.concat(l).forEach(function(e){ var k = J(e.id); if (!seen[k]){ seen[k] = 1; order.push(k); } });
        return order.map(function(k){ return merge3(L[k], C[k], B ? B[k] : undefined, false); }).filter(function(e){ return e !== undefined; });
      }
      // Listen ohne Kennung (z. B. Trainingsprotokoll): Ergänzungen beider Seiten, Löschungen relativ zur Basis
      // Listen ohne Kennung (z. B. Trainingsprotokoll, Tests): als Menge. Ein Eintrag bleibt, wenn ihn beide Seiten
      // haben oder eine Seite ihn neu hinzugefügt hat; gelöscht ist er, wenn eine Seite ihn aus der Basis entfernt hat.
      var set = function(a){ var m = {}; (a || []).forEach(function(e){ m[J(e)] = 1; }); return m; };
      var Ls = set(l), Cs = set(c), Bs = set(ba), res = [], got = {};
      c.concat(l).forEach(function(e){ var k = J(e); if (got[k]) return; got[k] = 1;
        var inL = !!Ls[k], inC = !!Cs[k], inB = !!Bs[k];
        if ((inL && inC) || (!inB && (inL || inC))) res.push(e); });
      if (res.length && res.every(function(e){ return isObj(e) && typeof e.at === 'string'; }))
        res = res.map(function(e, i){ return [e, i]; }).sort(function(p, q){ return p[0].at < q[0].at ? -1 : p[0].at > q[0].at ? 1 : p[1] - q[1]; }).map(function(x){ return x[0]; });
      return res;
    }
    return l;   // einzelner Wert, beide geändert: dieses Gerät gilt
  }
  // Zusammenführen zweier gespeicherter Blöcke (Text). Gibt null zurück, wenn nicht möglich (dann gilt dieses Gerät).
  function mergeText(k, lt, ct, bt){
    try { var b = bt === null || bt === undefined ? undefined : JSON.parse(bt);
      var m = merge3(JSON.parse(lt), JSON.parse(ct), b, k === 'apc.progress.v1' ? 'progress' : true);
      return J(m); } catch(e){ return null; }
  }

  // ---- Anmelden, Konto erstellen, erste Verknüpfung ----
  // Nach dem Anmelden: erst bei Status «aktiv» mit der Cloud verbinden
  function afterLogin(){
    return checkStatus().then(function(s){ return s === 'aktiv' ? firstLink() : s; });
  }
  function signIn(email, pw){
    return req('/auth/v1/token?grant_type=password', { method:'POST', body:{ email:email, password:pw } }).then(function(j){
      setSession(j); meta.linked = false; meta.lastPull = ''; meta.status = ''; meta.choice = null; saveMeta(); return afterLogin(); });
  }
  function signUp(email, pw, vorname, nachname){
    var back = location.origin + location.pathname;
    return req('/auth/v1/signup?redirect_to=' + encodeURIComponent(back), { method:'POST', body:{ email:email, password:pw, data:{ vorname:vorname, nachname:nachname } } })
      .then(function(j){ if (j && j.access_token){ setSession(j); meta.linked = false; meta.status = ''; saveMeta(); return afterLogin(); } return 'confirm'; });
  }
  function signOut(){
    var s = meta.session;
    if (s) req('/auth/v1/logout', { method:'POST', auth:true }).catch(function(){});
    meta.session = null; meta.linked = false; meta.lastPull = ''; meta.choice = null; meta.status = ''; saveMeta(); paint(); gate();
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
      meta.dirty = {}; localKeys().forEach(function(k){ meta.dirty[k] = { t:Date.now(), del:false }; setBase(k, null); });   // Cloud ist leer: es gibt keinen gemeinsamen Stand
      meta.linked = true; meta.choice = null; meta.lastPull = ''; saveMeta();
      return push().then(function(){ return pull(); }).then(function(){ needReload = false; paint(); return 'device'; });
    });
  }
  function useCloud(){
    return api('/rest/v1/kv?select=key,value,updated_at&order=updated_at.asc').then(function(rows){
      localKeys().forEach(function(k){ setBase(k, null); rawRem.call(LS, k); });
      (rows || []).forEach(function(r){ if (syncable(r.key)){ rawSet.call(LS, r.key, r.value); setBase(r.key, r.value); } if (r.updated_at > (meta.lastPull || '')) meta.lastPull = r.updated_at; });
      meta.dirty = {}; meta.linked = true; meta.choice = null; meta.lastSync = new Date().toISOString(); saveMeta();
      location.reload(); return 'cloud';
    });
  }

  // ---- Anzeige im Eltern-Bereich ----
  var box = null, note = '';
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); };
  var when = function(iso){ if (!iso) return '–'; try { return new Date(iso).toLocaleString('de-CH', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch(e){ return iso; } };
  function paint(){
    badge();
    if (!box || !document.body.contains(box)) return;
    var h = '<p class="eyebrow">Cloud-Abgleich</p>';
    if (!enabled){
      h += '<p>Der Cloud-Abgleich ist für diese App noch nicht eingerichtet. Alle Daten bleiben auf diesem Gerät.</p>';
    } else if (!logged()){
      h += '<p>Nicht angemeldet.</p>';
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
    if ($('sy-cloud')) $('sy-cloud').onclick = function(){ if (confirm(TXT_CLOUD)) run(this, useCloud()); };
    if ($('sy-dev')) $('sy-dev').onclick = function(){ if (confirm(TXT_DEV)) run(this, useDevice(), function(){ return 'Daten hochgeladen.'; }); };
    if ($('sy-now')) $('sy-now').onclick = function(){ var b = this; b.disabled = true; say('Gleiche ab …'); pull().then(function(){ return push(); }).then(function(){ note = 'Abgeglichen.'; paint(); if (needReload){ needReload = false; location.reload(); } }, function(e){ b.disabled = false; say(e.message); }); };
    if ($('sy-out')) $('sy-out').onclick = function(){ if (confirm(TXT_OUT)){ note = ''; signOut(); } };
  }
  var TXT_CLOUD = 'Die Daten auf diesem Gerät werden durch die Daten aus der Cloud ersetzt. Weiter?';
  var TXT_DEV = 'Die Daten in der Cloud werden durch die Daten dieses Geräts ersetzt. Das andere Gerät übernimmt sie beim nächsten Abgleich. Weiter?';
  var TXT_OUT = 'Abmelden? Die Daten bleiben auf diesem Gerät. Die APC lässt sich erst nach einer neuen Anmeldung wieder öffnen.';

  // ---- Login-Pflicht: Anmeldefenster über der ganzen App ----
  // Die App öffnet sich erst mit einem freigeschalteten Login (Status «aktiv»). Hinweis: Das Fenster läuft
  // im Browser; geschützt sind vor allem die Daten in der Cloud (Row Level Security in der Datenbank).
  var gEl = null, gMode = 'login', gNote = '', gBusy = false;
  function gateState(){
    if (!enabled) return '';
    if (!logged()) return gMode;                       // 'login' oder 'register'
    if (meta.status === 'wartend') return 'wartend';
    if (meta.status === 'deaktiviert') return 'deaktiviert';
    if (meta.status !== 'aktiv') return 'pruefen';
    if (meta.choice) return 'choice';
    if (meta.linked !== true) return 'verbinden';
    return '';
  }
  function gate(){
    if (!document.body) return;
    var st = gateState();
    if (!st){ if (gEl){ gEl.remove(); gEl = null; gNote = ''; } return; }
    if (!gEl){ gEl = document.createElement('div'); gEl.className = 'apc-gate'; gEl.setAttribute('role', 'dialog'); gEl.setAttribute('aria-modal', 'true'); gEl.setAttribute('aria-labelledby', 'gt-h'); document.body.appendChild(gEl); }
    var mail = logged() ? esc(meta.session.email) : '';
    var field = function(id, label, type, ac, extra){ return '<label>' + label + '<input type="' + type + '" id="' + id + '" autocomplete="' + ac + '"' + (extra || '') + '></label>'; };
    var h = '<div class="gt-pn"><p class="gt-brand">APC · Athlete Performance Centre</p>';
    if (st === 'login'){
      h += '<h2 id="gt-h">Anmelden</h2><p>Melde dich mit dem Login deiner Familie an. Neue Familien registrieren sich einmal und werden danach freigeschaltet.</p>' +
        '<div class="gt-form">' + field('gt-mail', 'E-Mail', 'email', 'username', ' inputmode="email"') + field('gt-pw', 'Passwort', 'password', 'current-password') + '</div>' +
        '<button class="gt-b1" id="gt-in">Anmelden</button><button class="gt-b2" id="gt-toreg">Neu hier? Registrieren</button>';
    } else if (st === 'register'){
      h += '<h2 id="gt-h">Registrieren</h2><p>Nach der Registrierung wird dein Zugang geprüft und freigeschaltet. Vorname und Name dienen nur der Freigabe und sind für andere Familien nicht sichtbar.</p>' +
        '<div class="gt-form">' + field('gt-vn', 'Vorname', 'text', 'given-name', ' maxlength="60"') + field('gt-nn', 'Name', 'text', 'family-name', ' maxlength="60"') +
        field('gt-mail', 'E-Mail', 'email', 'username', ' inputmode="email"') + field('gt-pw', 'Passwort (mind. 10 Zeichen)', 'password', 'new-password', ' minlength="10"') + '</div>' +
        '<button class="gt-b1" id="gt-up">Registrieren</button><button class="gt-b2" id="gt-tolog">Zurück zur Anmeldung</button>';
    } else if (st === 'wartend'){
      h += '<h2 id="gt-h">Registrierung eingegangen</h2><p>Angemeldet als <b>' + mail + '</b>. Deine Registrierung wird geprüft. Sobald dein Zugang freigeschaltet ist, öffnet sich die APC.</p>' +
        '<button class="gt-b1" id="gt-check">Erneut prüfen</button><button class="gt-b2" id="gt-out">Abmelden</button>';
    } else if (st === 'deaktiviert'){
      h += '<h2 id="gt-h">Zugang deaktiviert</h2><p>Der Zugang für <b>' + mail + '</b> ist im Moment deaktiviert. Die Daten auf diesem Gerät bleiben erhalten.</p>' +
        '<button class="gt-b1" id="gt-check">Erneut prüfen</button><button class="gt-b2" id="gt-out">Abmelden</button>';
    } else if (st === 'choice'){
      h += '<h2 id="gt-h">Welche Daten sollen gelten?</h2><p>Angemeldet als <b>' + mail + '</b>. In der Cloud und auf diesem Gerät gibt es schon Daten.</p>' +
        '<p class="gt-muted">Auf einem zweiten Gerät ist «Cloud übernehmen» richtig.</p>' +
        '<button class="gt-b1" id="gt-cloud">Cloud übernehmen (ersetzt dieses Gerät)</button><button class="gt-b2" id="gt-dev">Dieses Gerät hochladen (ersetzt die Cloud)</button><button class="gt-b2" id="gt-out">Abmelden</button>';
    } else {   // 'pruefen' oder 'verbinden'
      h += '<h2 id="gt-h">Verbinde …</h2><p>Angemeldet als <b>' + mail + '</b>. Der Zugang wird geprüft und die Daten werden abgeglichen. Dafür braucht es eine Internetverbindung.</p>' +
        (meta.err ? '<p class="gt-err">' + esc(meta.err) + '</p>' : '') +
        '<button class="gt-b1" id="gt-check">Erneut versuchen</button><button class="gt-b2" id="gt-out">Abmelden</button>';
    }
    h += '<p id="gt-msg" aria-live="polite">' + esc(gNote) + '</p></div>';
    var keep = {}; ['gt-vn', 'gt-nn', 'gt-mail'].forEach(function(id){ var i = gEl.querySelector('#' + id); if (i) keep[id] = i.value; });
    gEl.innerHTML = h;
    Object.keys(keep).forEach(function(id){ var i = gEl.querySelector('#' + id); if (i) i.value = keep[id]; });
    var $ = function(id){ return gEl.querySelector('#' + id); };
    var say = function(t){ gNote = t; var m = $('gt-msg'); if (m) m.textContent = t; };
    var run = function(btn, fn, ok){
      if (gBusy) return; gBusy = true; btn.disabled = true; say('Bitte warten …');
      Promise.resolve().then(fn).then(function(r){ gBusy = false; gNote = ok ? (ok(r) || '') : ''; paint(); gate(); },
        function(e){ gBusy = false; btn.disabled = false; say(e.message || String(e)); });
    };
    var mailPw = function(){ var e = $('gt-mail').value.trim(), p = $('gt-pw').value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)){ say('Bitte eine gültige E-Mail-Adresse eingeben.'); return null; }
      if (p.length < 10){ say('Das Passwort braucht mindestens 10 Zeichen.'); return null; } return [e, p]; };
    if ($('gt-in')) $('gt-in').onclick = function(){ var c = mailPw(); if (c) run(this, function(){ return signIn(c[0], c[1]); }); };
    if ($('gt-up')) $('gt-up').onclick = function(){
      var vn = $('gt-vn').value.trim(), nn = $('gt-nn').value.trim();
      if (!vn || !nn){ say('Bitte Vorname und Name eingeben.'); return; }
      var c = mailPw(); if (!c) return;
      run(this, function(){ return signUp(c[0], c[1], vn, nn); }, function(r){
        if (r === 'confirm'){ gMode = 'login'; return 'Registrierung gespeichert. Bitte den Link in der Bestätigungs-Mail öffnen und dich danach hier anmelden.'; } });
    };
    if ($('gt-toreg')) $('gt-toreg').onclick = function(){ gMode = 'register'; gNote = ''; gate(); };
    if ($('gt-tolog')) $('gt-tolog').onclick = function(){ gMode = 'login'; gNote = ''; gate(); };
    if ($('gt-check')) $('gt-check').onclick = function(){ meta.err = ''; run(this, function(){ return cycle(); }, function(){
      return meta.status === 'wartend' ? 'Noch nicht freigeschaltet.' : meta.status === 'deaktiviert' ? 'Der Zugang ist weiterhin deaktiviert.' : ''; }); };
    if ($('gt-cloud')) $('gt-cloud').onclick = function(){ if (confirm(TXT_CLOUD)) run(this, useCloud); };
    if ($('gt-dev')) $('gt-dev').onclick = function(){ if (confirm(TXT_DEV)) run(this, useDevice); };
    if ($('gt-out')) $('gt-out').onclick = function(){ if (confirm(TXT_OUT)){ gMode = 'login'; gNote = ''; signOut(); } };
  }
  function mount(el){ box = el; if (!box) return; box.classList.add('sync-box'); paint(); }
  var st = document.createElement('style');
  // Hohe Spezifität, weil die App alle Eingabefelder in den Eltern-Boxen als kleine Häkchen gestaltet (.pbox input)
  st.textContent = '.pbox .sync-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}' +
    '.pbox .sync-form label{display:flex;flex-direction:column;align-items:stretch;gap:4px;color:var(--muted);font-size:.9rem;cursor:default}' +
    '.pbox .sync-form input{width:100%;height:auto;min-height:46px;box-sizing:border-box;border-radius:10px;border:1.5px solid var(--line);background:var(--panel-2);color:var(--text);font:inherit;font-size:16px;padding:8px 12px;accent-color:auto}' +
    '.pbox .sync-err{color:var(--red)}' +
    '.sy-off{position:fixed;z-index:55;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 72px);pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.35);background:rgba(40,28,6,.92)!important;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid rgba(245,158,11,.55);background:rgba(245,158,11,.14);color:#FBBF24;font:700 .72rem/1.2 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}' +
    '.sy-off[hidden]{display:none}.sy-off::before{content:"";width:7px;height:7px;border-radius:50%;background:#F59E0B}' +
    '.sy-banner{margin:0 0 14px;padding:12px 14px;border-radius:14px;font-size:.95rem;line-height:1.4;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}' +
    '.sy-banner.off{border:1px solid rgba(245,158,11,.5);background:rgba(245,158,11,.12);color:var(--text)}' +
    '.sy-banner.new{border:1px solid rgba(127,212,255,.5);background:rgba(127,212,255,.12);color:var(--text)}' +
    '.apc-gate{position:fixed;inset:0;z-index:10000;background:var(--ink,#09111F);display:grid;place-items:center;padding:calc(env(safe-area-inset-top,0px) + 20px) 20px calc(env(safe-area-inset-bottom,0px) + 20px);overflow:auto}' +
    '.gt-pn{background:var(--panel,#101A2C);color:var(--text,#ECF1F8);border:1.5px solid var(--line,#25334E);border-radius:18px;padding:24px;width:min(440px,100%);display:flex;flex-direction:column;gap:12px;font:16px/1.45 Barlow,system-ui,sans-serif}' +
    '.gt-pn h2{margin:0;font:800 28px/1.1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.02em}' +
    '.gt-pn p{margin:0;color:var(--muted,#8697B3)}.gt-pn p b{color:var(--text,#ECF1F8)}' +
    '.gt-brand{font-weight:700;font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ice,#7FD4FF)!important}' +
    '.gt-form{display:flex;flex-direction:column;gap:10px}' +
    '.gt-form label{display:flex;flex-direction:column;gap:4px;color:var(--muted,#8697B3);font-size:.9rem}' +
    '.gt-form input{width:100%;min-height:48px;box-sizing:border-box;border-radius:10px;border:1.5px solid var(--line,#25334E);background:var(--panel-2,#16223A);color:var(--text,#ECF1F8);font:inherit;font-size:16px;padding:8px 12px}' +
    '.gt-form input:focus{outline:2px solid var(--ice,#7FD4FF);outline-offset:1px}' +
    '.gt-pn button{min-height:50px;border-radius:12px;border:0;font:700 16px Barlow,system-ui,sans-serif;cursor:pointer}' +
    '.gt-pn button:disabled{opacity:.6}' +
    '.gt-b1{background:var(--ice,#7FD4FF);color:var(--on-ice,#061220)}' +
    '.gt-b2{background:transparent;color:var(--text,#ECF1F8);box-shadow:inset 0 0 0 1.5px var(--line,#25334E)}' +
    '.gt-err{color:var(--red,#FF4458)!important}#gt-msg{color:var(--ice,#7FD4FF)}#gt-msg:empty{display:none}';
  (document.head || document.documentElement).appendChild(st);

  // ---- Zeitplan: beim Start, beim Zurückkehren in die App und jede Minute ----
  if (enabled){
    var start = function(){ gate(); cycle(); setInterval(function(){ if (document.visibilityState === 'visible') cycle(); }, 60000); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'visible') cycle(); else push({ keepalive:true }).catch(function(){});
    });
    // Kommen beide Geräte gleichzeitig wieder ins Netz, nicht im selben Moment abgleichen (kleiner Zufallsversatz)
    window.addEventListener('online', function(){ setTimeout(cycle, 300 + Math.random() * 2500); });
  }
  window.addEventListener('offline', badge);
  window.addEventListener('online', badge);
  try { new MutationObserver(function(){ if (window.APC_screen === 'parents' && !document.getElementById('sy-banner')) banner(); })
    .observe(document.documentElement, { childList:true, subtree:true }); } catch(e){}
  window.APCSync = { mount:mount, sync:cycle, screen:screen, status:function(){ return { enabled:enabled, logged:logged(), status:meta.status || '', linked:linked(), dirty:Object.keys(meta.dirty).length, lastSync:meta.lastSync }; }, _cfg:CFG, _merge:mergeText };
})();
