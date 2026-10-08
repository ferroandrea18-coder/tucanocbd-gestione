const PREFISSO = 'tucanocbd:prodotto:v1:';
export const codiceProdotto = (id) => PREFISSO + encodeURIComponent(id);
export function leggiCodice(testo) {
  const valore = testo.trim();
  if (!valore.startsWith(PREFISSO)) throw new Error('QR non valido: usa un’etichetta prodotto TucanoCBD.');
  try {
    const id = decodeURIComponent(valore.slice(PREFISSO.length));
    if (!id || id.length > 200) throw new Error();
    return id;
  } catch { throw new Error('Codice prodotto non valido.'); }
}

export function inizializzaQR({ db, catalogo, scarica, avviso, spiega, el, urlMedia }) {
  const $ = (id) => document.getElementById(id);
  let lettore, caricamento, avvio, chiusura, attivo = false, occupato = false, annulla = false;
  let selezionato = null;
  function stato(testo, male = false) {
    $('scanner-esito').textContent = testo;
    $('scanner-esito').className = male ? 'errore-campo' : 'nota';
  }
  function pulsanti() {
    const bloccato = occupato || !!avvio || attivo;
    for (const id of ['scanner-carica', 'scanner-scarica', 'scanner-quantita']) $(id).disabled = bloccato || !selezionato;
    for (const id of ['scanner-applica', 'scanner-prodotto', 'scanner-ricerca', 'scanner-codice']) $(id).disabled = bloccato;
    $('scanner-avvia').disabled = bloccato;
    $('scanner-ferma').disabled = occupato || (!avvio && !attivo);
  }
  function anteprima() {
    const p = catalogo().prodotti.find((p) => p.id === selezionato);
    if (!p) selezionato = null;
    $('scanner-selezionato').classList.toggle('nascosto', !p);
    if (p) {
      $('scanner-foto').src = urlMedia(p.immagine);
      $('scanner-nome').textContent = `${p.nome} ${p.formato}`;
      $('scanner-dettagli').textContent = `Casella ${p.slot || '—'} · Codice ${p.id}${p.nascosto ? ' · Nascosto ai clienti' : ''}`;
      $('scanner-scorte').textContent = `${catalogo().giacenze[p.id] ?? 0} pezzi disponibili`;
    }
    pulsanti();
  }
  function aggiornaCatalogo() {
    const testo = $('scanner-ricerca').value.trim().toLocaleLowerCase('it');
    const prodotti = catalogo().prodotti.filter((p) => `${p.nome} ${p.formato} ${p.slot} ${p.id}`.toLocaleLowerCase('it').includes(testo));
    $('scanner-prodotto').replaceChildren(
      el('option', { value: '' }, prodotti.length ? 'Scegli un prodotto…' : 'Nessun prodotto trovato'),
      ...prodotti.map((p) => el('option', { value: p.id }, `${p.nome} ${p.formato} · ${p.slot || '—'}`)));
    $('scanner-prodotto').value = prodotti.some((p) => p.id === selezionato) ? selezionato : '';
    anteprima();
  }
  async function libreriaScanner() {
    if (window.Html5Qrcode) return;
    caricamento ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
      script.onload = resolve;
      script.onerror = () => { script.remove(); caricamento = null; reject(new Error('Impossibile caricare lo scanner. Controlla la connessione.')); };
      document.head.append(script);
    });
    await caricamento;
  }
  async function ferma() {
    annulla = true;
    if (avvio) await avvio.catch(() => {});
    if (chiusura) return chiusura;
    if (attivo) {
      chiusura = lettore.stop();
      try { await chiusura; attivo = false; }
      finally { chiusura = null; pulsanti(); }
    }
    pulsanti();
  }
  async function seleziona(id) {
    if (occupato) return;
    occupato = true; pulsanti();
    try {
      await ferma();
      const p = catalogo().prodotti.find((p) => p.id === id);
      if (!p) throw new Error('Prodotto non presente nel catalogo. Aggiungilo da Nuovo prodotto, poi stampa il suo QR.');
      if (selezionato !== id) $('scanner-quantita').value = '1';
      selezionato = id;
      // Keep the manual selector in sync with the scanned product.
      $('scanner-ricerca').value = '';
      aggiornaCatalogo();
      stato('Prodotto selezionato. Scegli la quantità e premi + Carica o − Scarica.');
      $('scanner-codice').value = '';
    } catch (e) {
      selezionato = null; anteprima();
      stato(e.message, true); avviso(e.message, 'male');
    } finally { occupato = false; pulsanti(); }
  }
  async function selezionaQR(testo) {
    if (occupato) return;
    try { await seleziona(leggiCodice(testo)); }
    catch (e) { await ferma().catch(() => {}); selezionato = null; anteprima(); stato(e.message, true); }
  }
  async function movimento(verso) {
    if (occupato || attivo || avvio || !selezionato) return;
    const id = selezionato;
    const quantita = Number($('scanner-quantita').value);
    if (!Number.isSafeInteger(quantita) || quantita < 1 || quantita > 10000) { stato('Inserisci una quantità intera tra 1 e 10000.', true); return; }
    occupato = true; pulsanti(); stato('Aggiornamento scorte…');
    try {
      const { data, error } = await db.rpc('modifica_giacenza_gestore', { prodotto: id, variazione: verso * quantita });
      if (error) {
        if (/PGRST202|42883/.test(error.code)) throw new Error('Scanner da attivare: esegui supabase/qr-scorte.sql nel SQL Editor di Supabase.');
        if (/SCORTE_INSUFFICIENTI/.test(error.message)) throw new Error('Scorte insufficienti: nessun pezzo è stato tolto.');
        throw new Error(spiega(error));
      }
      catalogo().giacenze[id] = data;
      anteprima();
      stato(`${verso > 0 ? '+' : '−'}${quantita} pezzi registrati. Scorte attuali: ${data}. Puoi fare un altro movimento o selezionare un altro prodotto.`);
      avviso('Scorte aggiornate');
      try { await scarica(); } catch { avviso('Movimento registrato. Premi Aggiorna per ricaricare il catalogo.', 'male'); }
    } catch (e) {
      const messaggio = /fetch|network|connessione/i.test(e.message) ? e.message + ' Verifica le scorte con Aggiorna prima di ripetere.' : e.message;
      stato(messaggio, true); avviso(messaggio, 'male');
    } finally { occupato = false; anteprima(); }
  }
  $('scanner-carica').onclick = () => movimento(1);
  $('scanner-scarica').onclick = () => movimento(-1);
  $('scanner-ricerca').addEventListener('input', aggiornaCatalogo);
  $('scanner-prodotto').onchange = () => $('scanner-prodotto').value ? seleziona($('scanner-prodotto').value) : (selezionato = null, anteprima());
  $('scanner-form').onsubmit = (e) => { e.preventDefault(); return selezionaQR($('scanner-codice').value); };
  $('scanner-avvia').onclick = async () => {
    if (attivo || avvio || occupato) return;
    annulla = false;
    avvio = (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Per la fotocamera apri il pannello tramite HTTPS o localhost. Puoi selezionare il prodotto manualmente.');
      await libreriaScanner();
      if (annulla) return;
      lettore ??= new window.Html5Qrcode('scanner-camera', { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
      await lettore.start({ facingMode: 'environment' }, { fps: 8 }, (testo) => { if (attivo && !annulla) void selezionaQR(testo); }, () => {});
      attivo = true;
      stato('Inquadra un QR per selezionare il prodotto. La scansione non cambia le scorte.');
    })();
    pulsanti();
    try { await avvio; }
    catch (e) { stato(e.message || 'Fotocamera non disponibile: controlla il permesso.', true); }
    finally { avvio = null; pulsanti(); }
    if (annulla) await ferma().catch((e) => stato(e.message, true));
  };
  $('scanner-ferma').onclick = () => ferma().catch((e) => stato(e.message, true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) void ferma().catch(() => {}); });

  // Label generation and print integration are appended by the source update script.
  async function etichette(prodotti) {
    try {
      const { default: QRCode } = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
      const tessere = [];
      for (const p of prodotti) {
        const canvas = document.createElement('canvas');
        await QRCode.toCanvas(canvas, codiceProdotto(p.id), { width: 220, margin: 4, errorCorrectionLevel: 'M' });
        tessere.push(el('div', { class: 'etichetta-qr' }, canvas, el('b', {}, `${p.nome} ${p.formato}`), el('small', {}, p.slot), el('small', {}, p.id)));
      }
      $('qr-etichette').replaceChildren(...tessere);
      $('qr-dialog').showModal();
    } catch (e) { avviso('Impossibile generare i QR: ' + e.message, 'male'); }
  }
  $('qr-tutti').onclick = () => void etichette(catalogo().prodotti);
  $('qr-chiudi').onclick = () => $('qr-dialog').close();
  $('qr-stampa').onclick = () => window.print();
  return { etichette, ferma, aggiornaCatalogo };
}
