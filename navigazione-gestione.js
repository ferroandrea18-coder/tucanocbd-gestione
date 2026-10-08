export function direzioneSwipe(inizio, fine, durata) {
  const dx = fine.x - inizio.x, dy = fine.y - inizio.y;
  if (durata > 1400 || Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

export function inizializzaNavigazione({ cambia }) {
  const pulsanti = [...document.querySelectorAll('[data-scheda]')];
  const pagine = [...document.querySelectorAll('[data-pagina]')];
  const pannello = document.getElementById('pannello');
  let indice = 0, gesto = null, ignoraClickFino = 0;
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
    if (e.touches.length !== 1) { gesto = null; return; }
    if (!gesto) return;
    const p = e.touches[0], dx = p.clientX - gesto.x, dy = p.clientY - gesto.y;
    if (!gesto.orizzontale && Math.abs(dy) > 24 && Math.abs(dy) >= Math.abs(dx)) { gesto = null; return; }
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.5) gesto.orizzontale = true;
    if (gesto.orizzontale && e.cancelable) e.preventDefault();
  }, { passive: false });
  pannello.addEventListener('click', (e) => {
    if (Date.now() < ignoraClickFino) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  pannello.addEventListener('touchcancel', () => { gesto = null; }, { passive: true });
  pannello.addEventListener('touchend', (e) => {
    const partenza = gesto; gesto = null;
    if (!partenza || e.changedTouches.length !== 1) return;
    const p = e.changedTouches[0];
    const verso = direzioneSwipe(partenza, { x: p.clientX, y: p.clientY }, Date.now() - partenza.tempo);
    if (verso) { ignoraClickFino = Date.now() + 350; vai(indice + verso); }
  }, { passive: true });
  vai(0);
}
