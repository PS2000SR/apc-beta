# APC Beta

Testversion der APC. Änderungen werden hier zuerst getestet und erst danach in die richtige App (Repository apc) übernommen.

- Adresse: https://ps2000sr.github.io/apc-beta/
- Eigene Datenkopie: `beta.js` leitet alle Speichernamen von `apc.` auf `apcbeta.` um. Die Daten der richtigen App werden nur gelesen, nie verändert.
- Unterschiede zur richtigen App: `beta.js`, die mit NUR-BETA markierte Zeile in `index.html`, `manifest.webmanifest`, `sw.js` (Cache-Name) und die Symbole mit BETA-Band.

## Cloud-Abgleich (Supabase, Variante A)

- `sync.js`: gleicht die Speicherblöcke `apc.*` über das Familien-Login mit der Tabelle `public.kv` ab. Nicht in die Cloud: eigene Bilder, Coach-Aufnahmen, Name, Darstellung, Musik.
- Oben in `sync.js` stehen nur die öffentlichen Angaben (Projekt-Adresse und publishable/anon key). Der geheime Schlüssel gehört nie ins Repository.
- `supabase/01_kv.sql`: Tabelle, Row Level Security und Freigaben. Einmal im SQL Editor des Supabase-Projekts ausführen.

## Login pro Familie und Freigabe (ab APC 1.9)

- `supabase/02_familien.sql`: Tabelle `public.familien` (Vorname, Name, E-Mail, Status `wartend` / `aktiv` / `deaktiviert`). Einmal im SQL Editor ausführen, nach `01_kv.sql`. Bestehende Logins werden dabei als `aktiv` übernommen.
- Neue Registrierungen landen automatisch mit Status `wartend`. Freischalten: im Supabase-Dashboard → Table Editor → `familien` den Status auf `aktiv` setzen. Sperren: `deaktiviert`.
- Trainingsdaten (`public.kv`) sind nur für Logins mit Status `aktiv` lesbar und schreibbar. Familien können ihren Status nicht selbst ändern.
- `sync.js` zeigt beim Start ein Anmeldefenster über der ganzen App, bis das Login freigeschaltet ist. Ein freigeschaltetes Gerät bleibt angemeldet und funktioniert auch offline.
