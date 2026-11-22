/* APC 2.32 – Notfall-Bildschirm.
   Bricht die App beim Start ab (z. B. wegen beschädigter Daten), erscheint statt einer leeren Seite ein
   Fenster mit «Neu laden», «Daten sichern» und «Sicherung wiederherstellen». Die Daten auf dem Gerät werden
   dabei nicht verändert, ausser beim bewussten Wiederherstellen einer Sicherung.
   Läuft unabhängig vom Hauptprogramm (eigene Datei, keine gemeinsamen Funktionen). */
(function(){
  'use strict';
  var errs = [];
  window.addEventListener('error', function(e){ errs.push((e && e.message) || 'Fehler'); });
  window.addEventListener('unhandledrejection', function(e){ errs.push(String(e && e.reason && e.reason.message || e && e.reason || 'Fehler')); });

  function keys(){ var o = []; try { for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf('apc.') === 0 && k.indexOf('apc.sync.') !== 0) o.push(k); } } catch(e){} return o; }
  function pad(n){ return (n < 10 ? '0' : '') + n; }

  function backup(msg){
    var data = {}; keys().forEach(function(k){ data[k] = localStorage.getItem(k); });
    var d = new Date(), name = 'APC-Notfall-Sicherung-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
    var b = { format:'apc-backup', version:1, appVersion:'Notfall', created:d.toISOString(), player:'', data:data, music:null };
    var file = new File([JSON.stringify(b)], name, { type:'application/json' });
    if (navigator.canShare && navigator.canShare({ files:[file] })){
      navigator.share({ files:[file], title:'APC-Sicherung' }).then(function(){ msg('Gesichert: ' + name); }, function(){ msg('Sicherung abgebrochen.'); });
      return;
    }
    var url = URL.createObjectURL(file), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    msg('Gesichert: ' + name + ' (im Download-Ordner).');
  }

  function restore(file, msg){
    var r = new FileReader();
    r.onload = function(){
      var b; try { b = JSON.parse(r.result); } catch(e){ msg('Das ist keine APC-Sicherung.'); return; }
      if (!b || b.format !== 'apc-backup' || !b.data || typeof b.data !== 'object'){ msg('Das ist keine APC-Sicherung.'); return; }
      if (!confirm('Alle APC-Daten auf diesem Gerät durch die Sicherung ersetzen?')) return;
      keys().forEach(function(k){ localStorage.removeItem(k); });
      Object.keys(b.data).forEach(function(k){ if (k.indexOf('apc.') === 0 && k.indexOf('apc.sync.') !== 0 && typeof b.data[k] === 'string') localStorage.setItem(k, b.data[k]); });
      msg('Sicherung wiederhergestellt. Die App wird neu geladen …');
      setTimeout(function(){ location.reload(); }, 1500);   // Zeit für den Cloud-Abgleich (sync.js lädt die Daten hoch)
    };
    r.readAsText(file);
  }

  function show(){
    if (document.getElementById('apc-rescue')) return;
    var st = document.createElement('style');
    st.textContent = '#apc-rescue{position:fixed;inset:0;z-index:2147483647;background:#0b1220;color:#e8eefc;font:16px/1.45 -apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}' +
      '#apc-rescue .b{max-width:520px;width:100%;background:#141d33;border:1px solid #2a3a60;border-radius:16px;padding:24px}' +
      '#apc-rescue h1{font-size:22px;margin:0 0 8px}#apc-rescue p{margin:0 0 12px;color:#b8c4e0}' +
      '#apc-rescue button{display:block;width:100%;margin:10px 0 0;padding:14px;border-radius:12px;border:0;font:600 16px -apple-system,system-ui,sans-serif;background:#2a3a60;color:#fff}' +
      '#apc-rescue button.p{background:#f97316}#apc-rescue .m{margin-top:14px;min-height:1.4em;color:#fde68a}#apc-rescue .e{margin-top:12px;font-size:12px;color:#7d8bb0;word-break:break-word}';
    document.head.appendChild(st);
    var o = document.createElement('div'); o.id = 'apc-rescue';
    o.innerHTML = '<div class="b" role="alertdialog" aria-labelledby="rs-h"><h1 id="rs-h">APC konnte nicht starten</h1>' +
      '<p>Die Daten auf diesem Gerät sind unverändert. Bitte zuerst neu laden. Hilft das nicht: Daten sichern und die Datei an Claude schicken, oder eine frühere Sicherung wiederherstellen.</p>' +
      '<button class="p" id="rs-reload">Neu laden</button><button id="rs-backup">Daten sichern</button><button id="rs-restore">Sicherung wiederherstellen</button>' +
      '<input type="file" id="rs-file" accept="application/json,.json" hidden><div class="m" id="rs-msg" aria-live="polite"></div>' +
      '<div class="e" id="rs-err"></div></div>';
    document.body.appendChild(o);
    var msg = function(t){ document.getElementById('rs-msg').textContent = t; };
    document.getElementById('rs-err').textContent = 'Fehler: ' + (errs.slice(0, 3).join(' · ') || 'unbekannt');
    document.getElementById('rs-reload').onclick = function(){ location.reload(); };
    document.getElementById('rs-backup').onclick = function(){ try { backup(msg); } catch(e){ msg('Sicherung fehlgeschlagen: ' + e.message); } };
    var inp = document.getElementById('rs-file');
    document.getElementById('rs-restore').onclick = function(){ inp.value = ''; inp.click(); };
    inp.onchange = function(){ if (inp.files && inp.files[0]) restore(inp.files[0], msg); };
  }

  // Das Hauptprogramm setzt am Ende seines Starts window.APC_ready = true.
  document.addEventListener('DOMContentLoaded', function(){ setTimeout(function(){ if (!window.APC_ready) show(); }, 0); });
  window.APCRescue = { show:show };
})();
