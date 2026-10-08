const PACCHETTI = { clienti: 'com.cbdvending.app', gestione: 'com.cbdvending.gestione' };
export function validaApk(info, app, precedente, installata) {
  if (!info || info.packageName !== PACCHETTI[app]) throw new Error('APK dell’app sbagliata: scegli il file ' + (app === 'gestione' ? 'Gestione.' : 'Clienti.'));
  if (!Number.isSafeInteger(info.versionCode) || info.versionCode < 1 || info.versionCode > 2100000000 || !info.versionName || info.versionName.length > 100) throw new Error('Versione APK non valida.');
  if (!/^[a-f0-9]{64}$/.test(info.sha256) || !/^[a-f0-9]{64}$/.test(info.signerSha256)) throw new Error('APK senza firma o impronte valide.');
  if (precedente && info.versionCode <= Number(precedente.codice)) throw new Error('Devi caricare una versione più recente di quella pubblicata.');
  if (precedente && info.signerSha256 !== precedente.firma_sha256) throw new Error('La firma è diversa da quella della versione pubblicata.');
  if (app === 'gestione' && installata && info.signerSha256 !== installata.signerSha256) throw new Error('La firma non corrisponde a Gestione installata su questo telefono.');
  if (app === 'gestione' && installata && info.versionCode < installata.versionCode) throw new Error('Questo APK Gestione è più vecchio di quello installato.');
}

export function statoAggiornamento(release, local) {
  if (!release) return { aggiorna: false, testo: 'Nessuna versione pubblicata.' };
  if (!local) return { aggiorna: false, testo: 'Versione installata non verificabile da questa app.' };
  if (local.notInstalled) return { aggiorna: false, testo: 'App Clienti non installata su questo telefono.' };
  if (release.firma_sha256 !== local.signerSha256) return { aggiorna: false, testo: 'Firma diversa: questo APK non può aggiornare l’app installata.' };
  if (Number(release.codice) > Number(local.versionCode)) return { aggiorna: true, testo: `Aggiornamento disponibile. Installata: ${local.versionName}.` };
  return { aggiorna: false, testo: `App aggiornata. Installata: ${local.versionName}.` };
}

export function inizializzaDistribuzione({ db, server, el, spiega, avviso }) {
  const $ = (id) => document.getElementById(id);
  let releases = [], file = null, info = null, occupato = false;
  const avvisate = new Set();
  const installed = () => {
    try { return JSON.parse(window.TucanoAndroid?.getInstalledAppInfo?.() || 'null'); } catch { return null; }
  };
  const installedClient = () => {
    try { return JSON.parse(window.TucanoAndroid?.getInstalledClientAppInfo?.() || 'null'); } catch { return null; }
  };
  const download = (r) => db.storage.from('apk').getPublicUrl(r.percorso).data.publicUrl + '?download=' + encodeURIComponent(`TucanoCBD-${r.app}.apk`);
  const linkFisso = (app) => `${server}/functions/v1/ultimo-apk?app=${app}`;
  const errore = (e) => {
    if (/42P01|PGRST205|PGRST202|42883/.test(e?.code)) return 'Distribuzione da attivare: esegui supabase/distribuzione-apk.sql.';
    if (/VERSIONE_NON_PIU_RECENTE/.test(e?.message)) return 'È già stata pubblicata una versione uguale o più recente.';
    if (/FIRMA_APK_DIVERSA/.test(e?.message)) return 'La firma APK è diversa da quella della versione pubblicata.';
    return spiega(e);
  };
  function stato(testo, male = false) { $('apk-esito').textContent = testo; $('apk-esito').className = male ? 'errore-campo' : 'nota'; }
  function blocca(value) {
    occupato = value;
    for (const id of ['apk-app', 'apk-file', 'apk-novita', 'apk-controlla']) $(id).disabled = value;
    $('apk-pubblica').disabled = value || !file || !info;
    $('esci').disabled = value;
  }
  function scaricaApk(r, e) {
    if (window.TucanoAndroid?.downloadApk) {
      e?.preventDefault();
      window.TucanoAndroid.downloadApk(JSON.stringify(r));
    }
  }
  function proponiAggiornamento() {
    if (!window.TucanoAndroid?.downloadApk) return;
    const stati = ['clienti', 'gestione'].map((app) => {
      const release = releases.find((r) => r.app === app);
      const local = app === 'gestione' ? installed() : installedClient();
      return { app, release, stato: statoAggiornamento(release, local) };
    });
    const disponibili = stati.filter(({ release, stato }) => stato.aggiorna && !avvisate.has(`${release.app}:${release.codice}`));
    if (!disponibili.length) { if ($('update-dialog').open) $('update-dialog').close(); return; }
    if (document.querySelector('dialog[open]') && !$('update-dialog').open) return;
    $('update-testo').textContent = disponibili.length === 1 ? 'È disponibile un aggiornamento.' : 'Sono disponibili aggiornamenti per entrambe le app.';
    $('update-apps').replaceChildren(...stati.map(({ app, release, stato }) => {
      const nome = app === 'gestione' ? 'Gestione' : 'Clienti';
      const box = el('div', { class: 'riquadro colonna' }, el('h3', {}, `TucanoCBD ${nome}`), el('p', { class: 'nota', role: 'status' }, stato.testo));
      if (release) box.append(el('b', {}, `Ultima versione: ${release.versione}`));
      if (stato.aggiorna) {
        if (release.novita) box.append(el('p', { class: 'nota', style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, release.novita));
        box.append(el('button', { type: 'button', class: 'btn primario', onclick: () => { $('update-dialog').close(); scaricaApk(release); } }, `Aggiorna ${nome}`));
      } else box.append(el('button', { type: 'button', class: 'btn', disabled: true }, 'Nessun aggiornamento disponibile'));
      return box;
    }));
    $('update-dopo').onclick = () => {
      for (const { release } of disponibili) avvisate.add(`${release.app}:${release.codice}`);
      $('update-dialog').close();
    };
    if (!$('update-dialog').open) $('update-dialog').showModal();
  }
  $('update-dopo').onclick = () => $('update-dialog').close();
  function disegna() {
    $('apk-versioni').replaceChildren(...['clienti', 'gestione'].map((app) => {
      const r = releases.find((r) => r.app === app);
      const box = el('div', { class: 'riquadro colonna' }, el('h3', {}, app === 'clienti' ? 'TucanoCBD Clienti' : 'TucanoCBD Gestione'));
      if (!r) { box.append(el('p', { class: 'nota' }, 'Nessuna versione pubblicata.')); return box; }
      const aggiornamento = statoAggiornamento(r, app === 'gestione' ? installed() : installedClient());
      box.append(el('p', { class: 'nota', role: 'status' }, aggiornamento.testo));
      const link = el('input', { type: 'url', value: linkFisso(app), readonly: true, 'aria-label': `Link ultima versione ${app}` });
      box.append(el('b', {}, `Versione ${r.versione} · ${r.codice}`), el('p', { class: 'nota', style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, r.novita || 'Nessuna novità indicata.'),
        el('a', { href: download(r), class: aggiornamento.aggiorna ? 'btn primario' : 'btn', target: '_blank', rel: 'noopener', onclick: (e) => scaricaApk(r, e) }, aggiornamento.aggiorna ? 'Aggiorna app' : 'Scarica APK pubblicato'),
        el('label', {}, 'Link fisso all’ultima versione', link),
        el('button', { type: 'button', class: 'btn piccolo', onclick: async () => {
          try { if (navigator.share) await navigator.share({ title: `TucanoCBD ${app}`, url: linkFisso(app) }); else { await navigator.clipboard.writeText(linkFisso(app)); avviso('Link copiato'); } }
          catch { link.focus(); link.select(); avviso('Seleziona e copia il link.'); }
        } }, 'Condividi / copia link'),
        el('button', { type: 'button', class: 'btn piccolo', onclick: async () => {
          try {
            const { default: QRCode } = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
            $('apk-qr-titolo').textContent = `Ultima versione ${app}`;
            await QRCode.toCanvas($('apk-qr-canvas'), linkFisso(app), { width: 260, margin: 4 });
            $('apk-qr-dialog').showModal();
          } catch (e) { avviso('Impossibile generare il QR: ' + e.message, 'male'); }
        } }, 'QR download'));
      return box;
    }));
    const r = releases.find((r) => r.app === 'gestione');
    const local = installed();
    const aggiorna = r && local && Number(r.codice) > local.versionCode && r.firma_sha256 === local.signerSha256;
    $('aggiornamento-gestione').classList.toggle('nascosto', !aggiorna);
    if (aggiorna) {
      $('gestione-versione-nuova').textContent = `Gestione ${r.versione} è disponibile (installata: ${local.versionName}).`;
      $('gestione-scarica').href = download(r);
      $('gestione-scarica').onclick = (e) => scaricaApk(r, e);
    }
    $('apk-installata').textContent = local ? `Gestione installata: ${local.versionName} (${local.versionCode}).` : 'Per caricare APK usa l’app Android Gestione aggiornata. Dal browser puoi scaricare e condividere le versioni pubblicate.';
  }
  async function carica(silenzioso = false) {
    try {
      const { data, error } = await db.from('app_release').select('*');
      if (error) throw error;
      releases = data; disegna(); proponiAggiornamento();
      if (!silenzioso) stato('Versioni aggiornate.');
      return true;
    } catch (e) { if (!silenzioso) stato(errore(e), true); return false; }
  }
  $('apk-controlla').onclick = () => carica();
  $('apk-qr-chiudi').onclick = () => $('apk-qr-dialog').close();
  $('apk-app').onchange = () => {
    file = info = null; $('apk-file').value = ''; $('apk-file-info').textContent = 'Seleziona un APK della nuova versione.'; blocca(false);
  };
  $('apk-file').onchange = () => {
    file = info = null;
    try {
      const scelto = $('apk-file').files?.[0];
      if (!scelto) { blocca(false); return; }
      if (!/\.apk$/i.test(scelto.name) || scelto.size === 0 || scelto.size > 50 * 1024 * 1024) throw new Error('Scegli un file APK fino a 50 MB.');
      const metadata = JSON.parse(window.TucanoAndroid?.getSelectedApkInfo?.() || 'null');
      if (metadata?.error) throw new Error(metadata.error);
      if (!metadata || metadata.size !== scelto.size) throw new Error('Per verificare e pubblicare un APK, usa l’app Android Gestione aggiornata.');
      validaApk(metadata, $('apk-app').value, releases.find((r) => r.app === $('apk-app').value), installed());
      file = scelto; info = metadata;
      $('apk-file-info').textContent = `${scelto.name} · ${info.versionName} (${info.versionCode}) · ${(scelto.size / 1048576).toFixed(1)} MB`;
      stato('APK letto. Indica le novità e premi Pubblica come ultima versione.');
    } catch (e) { $('apk-file-info').textContent = ''; stato(e.message, true); }
    blocca(false);
  };
  $('form-apk').onsubmit = async (e) => {
    e.preventDefault();
    if (occupato || !file || !info) return;
    const app = $('apk-app').value, novita = $('apk-novita').value.trim();
    if (novita.length > 4000) { stato('Le novità possono contenere al massimo 4000 caratteri.', true); return; }
    blocca(true);
    try {
      if (!await carica(true)) throw new Error('Impossibile leggere le versioni. Attiva la distribuzione o controlla la connessione.');
      validaApk(info, app, releases.find((r) => r.app === app), installed());
      const percorso = `${app}/${info.versionCode}/${crypto.randomUUID()}.apk`;
      stato('Caricamento APK… Attendi senza chiudere l’app.');
      const upload = await db.storage.from('apk').upload(percorso, file, { contentType: 'application/vnd.android.package-archive', upsert: false, cacheControl: '31536000' });
      if (upload.error) throw new Error(errore(upload.error));
      stato('Pubblicazione dell’ultima versione…');
      const publish = await db.rpc('pubblica_apk', { p_app: app, p_versione: info.versionName, p_codice: info.versionCode, p_percorso: percorso, p_sha256: info.sha256, p_firma_sha256: info.signerSha256, p_novita: novita });
      if (publish.error) throw new Error(errore(publish.error));
      file = info = null; $('apk-file').value = ''; $('apk-file-info').textContent = ''; $('apk-novita').value = '';
      const ok = await carica(true);
      stato(ok ? 'Nuova versione pubblicata. Il link fisso ora offre questo APK.' : 'Versione pubblicata. Premi Controlla versioni per ricaricare.');
      avviso('APK pubblicato');
    } catch (err) { stato(err.message + ' Controlla le versioni prima di ripetere la pubblicazione.', true); }
    finally { blocca(false); }
  };
  document.addEventListener('tucano-riprendi', () => { if (!occupato) void carica(true); });
  disegna();
  void carica(true); // Check public releases at startup, including before login.
  return { carica };
}
