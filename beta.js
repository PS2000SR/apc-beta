/* APC Beta – wird nur in der Beta-App (Repository apc-beta) geladen, als erstes Skript.
   Die Beta läuft unter derselben Adresse (ps2000sr.github.io) wie die richtige App und teilt sich darum
   den Browser-Speicher. Damit die Beta die echten Daten nie verändert, werden alle Speichernamen
   umgeleitet: «apc.xyz» wird zu «apcbeta.xyz», die Musik-Datenbank «apc-music» zu «apcbeta-music».
   Die Daten der richtigen App werden nur gelesen (einmalige Kopie), nie geschrieben oder gelöscht. */
(function(){
  'use strict';
  var LS; try { LS = window.localStorage; } catch(e){ return; }
  if (!LS) return;
  var SP = Storage.prototype, getI = SP.getItem, setI = SP.setItem, remI = SP.removeItem, keyI = SP.key;
  var lenD = Object.getOwnPropertyDescriptor(SP, 'length');
  var PROD = 'apc.', BETA = 'apcbeta.', STAMP = 'apcbeta.__copied';

  function realKeys(st){ var n = lenD.get.call(st), out = []; for (var i = 0; i < n; i++) out.push(keyI.call(st, i)); return out; }
  function toBeta(k){ k = String(k); return k.indexOf(PROD) === 0 ? BETA + k.slice(PROD.length) : k; }
  function visible(){ // Sicht der App: Beta-Schlüssel als «apc.…», echte «apc.…»-Schlüssel ausgeblendet
    return realKeys(LS).filter(function(k){ return k.indexOf(PROD) !== 0 && k !== STAMP; })
      .map(function(k){ return k.indexOf(BETA) === 0 ? PROD + k.slice(BETA.length) : k; });
  }

  // Einmalige Kopie der echten Daten beim allerersten Start der Beta
  function copyFromProd(){
    realKeys(LS).forEach(function(k){ if (k.indexOf(BETA) === 0) remI.call(LS, k); });
    realKeys(LS).forEach(function(k){ if (k.indexOf(PROD) === 0) setI.call(LS, BETA + k.slice(PROD.length), getI.call(LS, k)); });
    setI.call(LS, STAMP, new Date().toISOString());
  }
  var hasBeta = realKeys(LS).some(function(k){ return k.indexOf(BETA) === 0; });
  if (!hasBeta && realKeys(LS).some(function(k){ return k.indexOf(PROD) === 0; })) copyFromProd();

  SP.getItem = function(k){ return getI.call(this, this === LS ? toBeta(k) : k); };
  SP.setItem = function(k, v){ return setI.call(this, this === LS ? toBeta(k) : k, v); };
  SP.removeItem = function(k){ return remI.call(this, this === LS ? toBeta(k) : k); };
  SP.key = function(i){ if (this !== LS) return keyI.call(this, i); var v = visible(); return i >= 0 && i < v.length ? v[i] : null; };
  Object.defineProperty(SP, 'length', { configurable:true, enumerable:true, get:function(){ return this === LS ? visible().length : lenD.get.call(this); } });

  // Musik-Datenbank umleiten
  try {
    var IDBP = IDBFactory.prototype, openI = IDBP.open, delI = IDBP.deleteDatabase;
    var dbName = function(n){ n = String(n); return n.indexOf('apc-') === 0 ? 'apcbeta-' + n.slice(4) : n; };
    IDBP.open = function(n, v){ return v === undefined ? openI.call(this, dbName(n)) : openI.call(this, dbName(n), v); };
    IDBP.deleteDatabase = function(n){ return delI.call(this, dbName(n)); };
  } catch(e){}

  // Name auf dem Home-Bildschirm
  var t = document.querySelector('meta[name="apple-mobile-web-app-title"]'); if (t) t.setAttribute('content', 'APC Beta');

  // Sichtbarer BETA-Vermerk mit Menü (Daten neu kopieren / Beta-Daten löschen)
  function fmt(iso){ try { return new Date(iso).toLocaleString('de-CH', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); } catch(e){ return iso; } }
  function ui(){
    document.documentElement.classList.add('is-beta');
    var st = document.createElement('style');
    st.textContent =
      '.beta-tag{position:fixed;z-index:60;top:calc(env(safe-area-inset-top,0px) + 6px);left:50%;transform:translateX(-50%);background:#FF8A3D;color:#1A0E00;border:0;border-radius:999px;font:800 13px/1 system-ui,sans-serif;letter-spacing:.14em;padding:8px 14px;min-height:32px;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer}' +
      '.beta-ov{position:fixed;inset:0;z-index:61;background:rgba(5,10,18,.72);display:grid;place-items:center;padding:20px}' +
      '.beta-pn{background:#101A2C;color:#ECF1F8;border:2px solid #FF8A3D;border-radius:18px;padding:22px;width:min(420px,100%);display:flex;flex-direction:column;gap:12px;font:15px/1.4 system-ui,sans-serif}' +
      '.beta-pn h2{margin:0;font-size:20px}.beta-pn p{margin:0;color:#B5C2D6}.beta-pn p b{color:#ECF1F8}#beta-msg{color:#FF8A3D}#beta-msg:empty{display:none}' +
      '.beta-pn button{min-height:48px;border-radius:12px;border:0;font:700 15px system-ui,sans-serif;cursor:pointer}' +
      '.beta-pn .b1{background:#FF8A3D;color:#1A0E00}.beta-pn .b2{background:transparent;color:#ECF1F8;box-shadow:inset 0 0 0 1.5px #25334E}' +
      '.brand b .beta-v{color:#FF8A3D;margin-left:.35em}';
    document.head.appendChild(st);
    var b = document.createElement('button'); b.className = 'beta-tag'; b.type = 'button'; b.textContent = 'BETA'; b.setAttribute('aria-label', 'Beta-Version: Menü öffnen');
    document.body.appendChild(b);
    var brand = document.querySelector('.brand b'); if (brand){ var s = document.createElement('span'); s.className = 'beta-v'; s.textContent = 'BETA'; brand.appendChild(s); }
    document.title = 'APC Beta';
    b.onclick = function(){
      var ov = document.createElement('div'); ov.className = 'beta-ov';
      var when = getI.call(LS, STAMP);
      ov.innerHTML = '<div class="beta-pn" role="dialog" aria-modal="true" aria-labelledby="beta-h"><h2 id="beta-h">APC Beta</h2>' +
        '<p>Testversion. Sie arbeitet mit einer eigenen Kopie der Daten. Die richtige APC-App bleibt unverändert.</p>' +
        '<p>' + (when ? 'Daten zuletzt aus der richtigen App kopiert: ' + fmt(when) + '.' : 'Noch keine Daten aus der richtigen App kopiert.') + '</p>' +
        '<p><b>Auf iPad und iPhone</b> hat jede App auf dem Home-Bildschirm ihren eigenen Speicher. Dann so übernehmen: in der richtigen App unter Eltern → «Sicherung erstellen», hier in der Beta unter Eltern → «Sicherung wiederherstellen».</p>' +
        '<p id="beta-msg" role="status"></p>' +
        '<button class="b1" id="beta-copy">Daten aus der Hauptversion kopieren</button>' +
        '<button class="b2" id="beta-close">Schliessen</button></div>';
      document.body.appendChild(ov);
      var close = function(){ ov.remove(); b.focus(); };
      ov.onclick = function(e){ if (e.target === ov) close(); };
      ov.querySelector('#beta-close').onclick = close;
      ov.querySelector('#beta-copy').onclick = function(){
        if (!realKeys(LS).some(function(k){ return k.indexOf(PROD) === 0; })){
          ov.querySelector('#beta-msg').textContent = 'Hier sind keine Daten der richtigen App sichtbar. Bitte den Weg über die Sicherung nehmen (siehe oben).';
          return;
        }
        if (!confirm('Die Beta-Daten werden durch eine frische Kopie aus der richtigen App ersetzt. Weiter?')) return;
        copyFromProd(); location.reload();
      };
      ov.querySelector('#beta-copy').focus();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui); else ui();
})();
