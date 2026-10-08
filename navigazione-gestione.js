// Cambia sezione con un trascinamento lungo (un quarto di schermo) o con una passata veloce.
export function direzioneSwipe(inizio, fine, durata, larghezza = 360) {
  const dx = fine.x - inizio.x, dy = fine.y - inizio.y;
  if (Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
  const lungo = Math.abs(dx) >= Math.min(90, larghezza * 0.25);
  const veloce = Math.abs(dx) >= 30 && Math.abs(dx) / Math.max(durata, 1) > 0.45;
  return lungo || veloce ? (dx < 0 ? 1 : -1) : 0;
}

export function inizializzaNavigazione({ cambia }) {
  const pulsanti = [...document.querySelectorAll('[data-scheda]')];
  const pagine = [...document.querySelectorAll('[data-pagina]')];
  const pannello = document.getElementById('pannello');
  let indice = 0, gesto = null, ignoraClickFino = 0;
  const paginaAttiva = () => pagine.find((p) => p.dataset.pagina === pulsanti[indice].dataset.scheda);
  // La pagina segue il dito; con animata=true scorre fino alla posizione indicata.
  function sposta(pagina, dx, animata = false) {
    if (!pagina?.style) return;
    pagina.style.transition = animata ? 'transform .2s ease-out, opacity .2s ease-out' : 'none';
    pagina.style.transform = dx ? `translateX(${dx}px)` : '';
    pagina.style.opacity = dx ? String(Math.max(0.5, 1 - Math.abs(dx) / (window.innerWidth * 1.5))) : '';
  }
  function vai(prossimo, tastiera = false) {
    if (prossimo < 0 || prossimo >= pulsanti.length || document.querySelector('dialog[open]')) return;
    const precedente = indice;
    indice = prossimo;
    pulsanti.forEach((b, i) => {
      b.classList.toggle('attiva', i === indice);
      b.setAttribute('aria-selected', String(i === indice));
      b.tabIndex = i === indice ? 0 : -1;
    });
    const nome = pulsanti[indice].dataset.scheda;
    pagine.forEach((p) => p.classList.toggle('nascosto', p.dataset.pagina !== nome));
    document.getElementById('sezione-attiva').textContent = pulsanti[indice].getAttribute('aria-label');
    if (tastiera) pulsanti[indice].focus();
    if (precedente !== indice) cambia(nome);
  }
  pulsanti.forEach((b, i) => {
    b.onclick = () => vai(i);
    b.addEventListener('keydown', (e) => {
      let nuovo;
      if (e.key === 'ArrowRight') nuovo = Math.min(indice + 1, pulsanti.length - 1);
      if (e.key === 'ArrowLeft') nuovo = Math.max(indice - 1, 0);
      if (e.key === 'Home') nuovo = 0;
      if (e.key === 'End') nuovo = pulsanti.length - 1;
      if (nuovo != null) { e.preventDefault(); vai(nuovo, true); }
    });
  });
  const esclusi = 'input,textarea,select,video,canvas,[contenteditable],.galleria,#scanner-camera,[data-no-swipe]';
  pannello.addEventListener('touchstart', (e) => {
    gesto = null;
    if (e.touches.length !== 1 || pannello.classList.contains('nascosto') || document.querySelector('dialog[open]') || e.target.closest(esclusi)) return;
    const p = e.touches[0];
    // Keep Android's edge-back gesture available.
    if (p.clientX < 24 || p.clientX > window.innerWidth - 24) return;
    gesto = { x: p.clientX, y: p.clientY, tempo: Date.now() };
  }, { passive: true });
  pannello.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) { if (gesto) sposta(paginaAttiva(), 0, true); gesto = null; return; }
    if (!gesto) return;
    const p = e.touches[0], dx = p.clientX - gesto.x, dy = p.clientY - gesto.y;
    if (!gesto.orizzontale && Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { gesto = null; return; }
    if (!gesto.orizzontale && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) gesto.orizzontale = true;
    if (!gesto.orizzontale) return;
    if (e.cancelable) e.preventDefault();
    // Oltre la prima e l'ultima sezione la pagina resiste, così si capisce che non c'è altro.
    const vicina = indice + (dx < 0 ? 1 : -1);
    sposta(paginaAttiva(), vicina < 0 || vicina >= pulsanti.length ? dx * 0.3 : dx);
  }, { passive: false });
  pannello.addEventListener('click', (e) => {
    if (Date.now() < ignoraClickFino) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  pannello.addEventListener('touchcancel', () => { gesto = null; sposta(paginaAttiva(), 0, true); }, { passive: true });
  pannello.addEventListener('touchend', (e) => {
    const partenza = gesto; gesto = null;
    if (!partenza || e.changedTouches.length !== 1) return;
    const p = e.changedTouches[0], dx = p.clientX - partenza.x, larghezza = window.innerWidth;
    const verso = direzioneSwipe(partenza, { x: p.clientX, y: p.clientY }, Date.now() - partenza.tempo, larghezza);
    const uscente = paginaAttiva();
    if (!verso || indice + verso < 0 || indice + verso >= pulsanti.length) { sposta(uscente, 0, true); return; }
    ignoraClickFino = Date.now() + 350;
    sposta(uscente, 0);
    vai(indice + verso);
    // La nuova sezione entra dal lato da cui arriva, proseguendo il movimento del dito.
    const entrante = paginaAttiva();
    if (entrante !== uscente && typeof requestAnimationFrame === 'function') {
      sposta(entrante, verso * larghezza + dx);
      requestAnimationFrame(() => requestAnimationFrame(() => sposta(entrante, 0, true)));
    }
  }, { passive: true });
  vai(0);
}
