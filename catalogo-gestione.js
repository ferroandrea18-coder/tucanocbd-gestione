const normalizza = (testo) => String(testo ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function filtraProdotti(prodotti, giacenze, { ricerca = '', categoria = '', stato = '', scorte = '' } = {}) {
  const parole = normalizza(ricerca).split(/\s+/).filter(Boolean);
  return prodotti.filter((p) => {
    const testo = normalizza([p.nome, p.formato, p.categoria, p.slot, p.id].join(' '));
    const pezzi = giacenze[p.id] ?? 0;
    return parole.every((parola) => testo.includes(parola))
      && (!categoria || p.categoria === categoria)
      && (stato !== 'visibili' || !p.nascosto)
      && (stato !== 'nascosti' || !!p.nascosto)
      && (stato !== 'offerta' || !!p.offerta)
      && (scorte !== 'disponibili' || pezzi > 0)
      && (scorte !== 'esauriti' || pezzi === 0)
      && (scorte !== 'basse' || (pezzi > 0 && pezzi <= 3));
  });
}

export function inizializzaCatalogo({ db, catalogo, scarica, avviso, spiega, el, disegnaProdotti, leggiEuro, scriviEuro, euro }) {
  const $ = (id) => document.getElementById(id);
  let selezionato = null, occupato = false;
  const controlli = ['rapida-salva', 'rapida-prezzo', 'rapida-visibile', 'rapida-meno', 'rapida-piu', 'rapida-quantita', 'rapida-chiudi'];
  function blocca(valore) {
    occupato = valore;
    for (const id of controlli) $(id).disabled = valore;
    disegnaProdotti();
  }
  const esito = (testo, male = false) => {
    $('rapida-esito').textContent = testo;
    $('rapida-esito').className = male ? 'errore-campo' : 'nota';
  };
  async function ricaricaDopoSalvataggio() {
    try { await scarica(); }
    catch { avviso('Modifica salvata. Premi Aggiorna per ricaricare il catalogo.', 'male'); }
  }
  function erroreMovimento(error) {
    if (/PGRST202|42883/.test(error.code)) return 'Per i pulsanti scorte esegui supabase/qr-scorte.sql nel SQL Editor.';
    if (/SCORTE_INSUFFICIENTI/.test(error.message)) return 'Scorte insufficienti: nessun pezzo è stato tolto.';
    return spiega(error);
  }
  async function movimento(id, variazione) {
    if (occupato) return;
    const nelDialog = $('rapida').open && selezionato === id;
    if (!Number.isSafeInteger(variazione) || variazione === 0 || Math.abs(variazione) > 10000) {
      const testo = 'Inserisci una quantità intera tra 1 e 10000.';
      if (nelDialog) esito(testo, true);
      avviso(testo, 'male');
      return;
    }
    blocca(true);
    if (nelDialog) esito('Aggiornamento scorte…');
    try {
      const { data, error } = await db.rpc('modifica_giacenza_gestore', { prodotto: id, variazione });
      if (error) throw new Error(erroreMovimento(error));
      catalogo().giacenze[id] = data;
      if (nelDialog) { $('rapida-pezzi').textContent = `${data} pezzi`; esito('Movimento registrato.'); }
      avviso(`Scorte aggiornate: ${data} pezzi`);
      await ricaricaDopoSalvataggio();
    } catch (e) {
      const testo = e.message + ' Se la connessione si è interrotta, premi Aggiorna e verifica le scorte prima di ripetere.';
      if (nelDialog) esito(testo, true);
      avviso(testo, 'male');
    } finally { blocca(false); }
  }
  function apri(p) {
    if (occupato) return;
    selezionato = p.id;
    $('rapida-nome').textContent = `${p.nome} ${p.formato} · Casella ${p.slot || '—'}`;
    $('rapida-prezzo').value = scriviEuro(p.prezzo);
    $('rapida-visibile').checked = !p.nascosto;
    $('rapida-offerta').textContent = p.offerta ? `In offerta a ${euro(p.offerta.prezzo)}. Il prezzo normale deve essere maggiore.` : 'Per creare o cambiare un’offerta apri Scheda.';
    $('rapida-pezzi').textContent = `${catalogo().giacenze[p.id] ?? 0} pezzi`;
    $('rapida-quantita').value = '1';
    esito('');
    $('rapida').showModal();
  }
  $('rapida-chiudi').onclick = () => { if (!occupato) $('rapida').close(); };
  $('rapida').addEventListener('cancel', (e) => { if (occupato) e.preventDefault(); });
  $('rapida-meno').onclick = () => movimento(selezionato, -Number($('rapida-quantita').value));
  $('rapida-piu').onclick = () => movimento(selezionato, Number($('rapida-quantita').value));
  $('form-rapida').onsubmit = async (e) => {
    e.preventDefault();
    if (occupato || !selezionato) return;
    const id = selezionato;
    const prezzo = leggiEuro($('rapida-prezzo').value);
    const nascosto = !$('rapida-visibile').checked;
    if (!Number.isSafeInteger(prezzo) || prezzo <= 0 || prezzo > 2147483647) { esito('Inserisci un prezzo valido maggiore di zero, es. 14,80.', true); return; }
    blocca(true);
    esito('Salvataggio…');
    try {
      // Read the current offer, then update only the two quick-edit fields.
      const attuale = await db.from('prodotti').select('id,prezzo,offerta,nascosto').eq('id', id).single();
      if (attuale.error) throw new Error(spiega(attuale.error));
      if (attuale.data.offerta && prezzo <= attuale.data.offerta.prezzo) throw new Error('Il prezzo normale deve essere maggiore del prezzo in offerta. Cambia l’offerta dalla Scheda.');
      // Reject a concurrent price/offer change instead of validating an outdated offer.
      let richiesta = db.from('prodotti').update({ prezzo, nascosto }).eq('id', id).eq('prezzo', attuale.data.prezzo).eq('nascosto', attuale.data.nascosto);
      richiesta = attuale.data.offerta === null ? richiesta.is('offerta', null) : richiesta.eq('offerta', JSON.stringify(attuale.data.offerta));
      const risultato = await richiesta.select('id');
      if (risultato.error) throw new Error(spiega(risultato.error));
      if (!risultato.data?.length) throw new Error('Prodotto modificato da un altro gestore o permessi mancanti. Premi Aggiorna e riapri Rapida.');
      esito('Prezzo e visibilità salvati.');
      avviso('Prezzo e visibilità salvati');
      await ricaricaDopoSalvataggio();
    } catch (error) { esito(error.message, true); }
    finally { blocca(false); }
  };
  for (const id of ['ricerca-prodotti', 'filtro-categoria', 'filtro-stato', 'filtro-scorte']) $(id).addEventListener(id === 'ricerca-prodotti' ? 'input' : 'change', disegnaProdotti);
  $('azzera-filtri').onclick = () => {
    for (const id of ['ricerca-prodotti', 'filtro-categoria', 'filtro-stato', 'filtro-scorte']) $(id).value = '';
    disegnaProdotti();
    $('ricerca-prodotti').focus();
  };
  function categorie() {
    const scelta = $('filtro-categoria').value;
    const valori = [...new Set(catalogo().prodotti.map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    $('filtro-categoria').replaceChildren(el('option', { value: '' }, 'Tutte le categorie'), ...valori.map((c) => el('option', { value: c }, c)));
    $('filtro-categoria').value = valori.includes(scelta) ? scelta : '';
  }
  return { apri, movimento, categorie, occupato: () => occupato };
}
