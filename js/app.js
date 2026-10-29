/* ==========================================================
   app.js — Conecta la interfaz con el motor de audio
   ----------------------------------------------------------
   Este archivo NO procesa audio directamente: lee lo que el
   usuario elige en la página, llama a SS.engine / SS.encoders
   y muestra los resultados. Si queréis añadir funciones nuevas,
   la lógica de audio va en audioEngine.js y aquí solo el "cableado".
   ========================================================== */
(function () {
  const { utils, engine, recorder, encoders } = SS;
  const $ = (id) => document.getElementById(id);

  /* ---------- Estado de la aplicación ---------- */
  const state = {
    voiceBuffer: null,     // AudioBuffer de las afirmaciones
    voiceUrl: null,        // URL temporal para el reproductor de la voz original
    bgType: 'rain',        // fondo seleccionado
    customBgBuffer: null,  // AudioBuffer del fondo subido
    resultBuffer: null,    // AudioBuffer de la mezcla final
    resultWavBlob: null,   // la mezcla ya codificada en WAV
    resultUrl: null,
    bgPreview: null,       // { bg, gain } mientras suena la vista previa del fondo
    busy: false,
    recordTimer: null
  };

  /* ---------- Referencias a elementos ---------- */
  const el = {
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('[data-panel]'),
    voiceFile: $('voice-file'),
    dropzone: $('voice-dropzone'),
    recordBtn: $('record-btn'),
    recordLabel: $('record-label'),
    recordTimer: $('record-timer'),
    recordHint: $('record-hint'),
    voiceLoaded: $('voice-loaded'),
    voiceName: $('voice-name'),
    voiceDuration: $('voice-duration'),
    voiceWave: $('voice-wave'),
    voicePlayer: $('voice-player'),
    bgOptions: document.querySelectorAll('.bg-option'),
    bgFile: $('bg-file'),
    bgCustomName: $('bg-custom-name'),
    bgPreviewBtn: $('bg-preview-btn'),
    bgPreviewIcon: $('bg-preview-icon'),
    bgPreviewLabel: $('bg-preview-label'),
    voiceDb: $('voice-db'),
    voiceDbOut: $('voice-db-out'),
    voiceDbTag: $('voice-db-tag'),
    voiceDbHelp: $('voice-db-help'),
    bgVolume: $('bg-volume'),
    bgVolumeOut: $('bg-volume-out'),
    duration: $('duration'),
    durationOut: $('duration-out'),
    durationHelp: $('duration-help'),
    voiceRate: $('voice-rate'),
    voiceRateOut: $('voice-rate-out'),
    gap: $('gap'),
    gapOut: $('gap-out'),
    fade: $('fade'),
    fadeOut: $('fade-out'),
    loopVoice: $('loop-voice'),
    verifyMode: $('verify-mode'),
    processBtn: $('process-btn'),
    processLabel: $('process-label'),
    progress: $('progress'),
    progressBar: $('progress-bar'),
    status: $('status'),
    resultSection: $('result-section'),
    staleNote: $('stale-note'),
    resultWave: $('result-wave'),
    resultPlayer: $('result-player'),
    downloadWav: $('download-wav'),
    downloadMp3: $('download-mp3'),
    mp3Bitrate: $('mp3-bitrate'),
    toast: $('toast')
  };

  /* ==========================================================
     Utilidades de interfaz
     ========================================================== */
  let toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4500);
  }

  function setStatus(text) { el.status.textContent = text || ''; }

  /** Muestra la barra de progreso. fraction = null → animación indeterminada. */
  function setProgress(fraction) {
    if (fraction === undefined) { el.progress.hidden = true; return; }
    el.progress.hidden = false;
    el.progress.classList.toggle('is-indeterminate', fraction === null);
    el.progressBar.style.width = fraction === null ? '' : `${Math.round(fraction * 100)}%`;
  }

  function setBusy(busy) {
    state.busy = busy;
    el.processBtn.disabled = busy;
    el.downloadWav.disabled = busy;
    el.downloadMp3.disabled = busy;
    el.processLabel.textContent = busy ? 'Procesando…' : 'Procesar y Mezclar';
  }

  /** Pinta la parte "llena" del slider (variable CSS --fill). */
  function paintSlider(input) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  }

  /* ==========================================================
     Paso 1: cargar o grabar la voz
     ========================================================== */
  function switchTab(name) {
    el.tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });
    el.panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
  }

  async function loadVoice(blob, name) {
    setStatus('Leyendo audio…');
    try {
      const buffer = await engine.decodeBlob(blob);
      state.voiceBuffer = buffer;

      if (state.voiceUrl) URL.revokeObjectURL(state.voiceUrl);
      state.voiceUrl = URL.createObjectURL(blob);
      el.voicePlayer.src = state.voiceUrl;

      el.voiceName.textContent = name;
      el.voiceDuration.textContent = utils.formatTime(buffer.duration);
      el.voiceLoaded.hidden = false;
      utils.drawWaveform(el.voiceWave, buffer, '#a78bfa');

      setStatus('');
      updateReadouts();
      markStale();
    } catch (err) {
      console.error(err);
      setStatus('');
      toast('No se pudo leer ese audio. Prueba con MP3 o WAV.');
    }
  }

  async function toggleRecording() {
    if (!recorder.isSupported()) {
      toast('Tu navegador no permite grabar audio. Usa la opción "Subir archivo".');
      return;
    }

    if (!recorder.isRecording()) {
      try {
        await recorder.start();
      } catch (err) {
        console.error(err);
        toast('No se pudo acceder al micrófono. Revisa los permisos del navegador.');
        return;
      }
      el.recordBtn.classList.add('is-recording');
      el.recordLabel.textContent = 'Detener';
      const startedAt = Date.now();
      el.recordTimer.textContent = '00:00';
      state.recordTimer = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        el.recordTimer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      }, 250);
      return;
    }

    clearInterval(state.recordTimer);
    el.recordBtn.classList.remove('is-recording');
    el.recordLabel.textContent = 'Grabar de nuevo';
    const blob = await recorder.stop();
    await loadVoice(blob, 'Grabación de micrófono');
  }

  /* ==========================================================
     Paso 2: fondo
     ========================================================== */
  function selectBackground(type) {
    // "Subir el mío" sin archivo todavía → abrimos el selector y esperamos
    if (type === 'custom' && !state.customBgBuffer) {
      el.bgFile.click();
      return;
    }
    state.bgType = type;
    el.bgOptions.forEach((b) => {
      const selected = b.dataset.bg === type;
      b.classList.toggle('is-selected', selected);
      b.setAttribute('aria-checked', String(selected));
    });
    el.bgCustomName.hidden = type !== 'custom';
    // Si la vista previa estaba sonando, la reiniciamos con el nuevo fondo
    if (state.bgPreview) { stopBgPreview(); startBgPreview(); }
    markStale();
  }

  async function loadCustomBackground(file) {
    setStatus('Leyendo fondo…');
    try {
      state.customBgBuffer = await engine.decodeBlob(file);
      el.bgCustomName.textContent = `📁 ${file.name} · ${utils.formatTime(state.customBgBuffer.duration)} (se repite en bucle)`;
      setStatus('');
      selectBackground('custom');
    } catch (err) {
      console.error(err);
      setStatus('');
      toast('No se pudo leer ese archivo de fondo.');
    }
  }

  function startBgPreview() {
    if (state.bgType === 'none') { toast('Has elegido "Sin fondo".'); return; }
    const ctx = engine.getContext();
    const bg = engine.createBackground(ctx, state.bgType, state.customBgBuffer);
    const gain = ctx.createGain();
    gain.gain.value = el.bgVolume.value / 100;
    bg.output.connect(gain).connect(ctx.destination);
    bg.start(ctx.currentTime);
    state.bgPreview = { bg, gain };
    el.bgPreviewBtn.classList.add('is-playing');
    el.bgPreviewIcon.textContent = '■';
    el.bgPreviewLabel.textContent = 'Detener';
  }

  function stopBgPreview() {
    if (!state.bgPreview) return;
    state.bgPreview.bg.stop();
    state.bgPreview.gain.disconnect();
    state.bgPreview = null;
    el.bgPreviewBtn.classList.remove('is-playing');
    el.bgPreviewIcon.textContent = '▶';
    el.bgPreviewLabel.textContent = 'Escuchar fondo';
  }

  /* ==========================================================
     Paso 3: ajustes
     ========================================================== */
  function readSettings() {
    return {
      voiceDb: el.verifyMode.checked ? 0 : Number(el.voiceDb.value),
      bgVolume: Number(el.bgVolume.value) / 100,
      durationSec: Number(el.duration.value) * 60,
      voiceRate: Number(el.voiceRate.value),
      gapSec: Number(el.gap.value),
      fadeSec: Number(el.fade.value),
      loopVoice: el.loopVoice.checked
    };
  }

  /** Etiqueta orientativa para el nivel de la voz. */
  function describeLevel(db) {
    if (db > -15) return { key: 'audible', text: 'Audible' };
    if (db > -28) return { key: 'low', text: 'Bajo' };
    if (db > -45) return { key: 'subliminal', text: 'Subliminal' };
    return { key: 'inaudible', text: 'Casi inaudible' };
  }

  /** Actualiza todos los textos que acompañan a los sliders. */
  function updateReadouts() {
    const s = readSettings();
    const db = Number(el.voiceDb.value);

    const level = describeLevel(db);
    el.voiceDbOut.textContent = `${db} dB`;
    el.voiceDbTag.textContent = level.text;
    el.voiceDbTag.dataset.level = level.key;
    const pct = utils.dbToGain(db) * 100;
    el.voiceDbHelp.textContent = el.verifyMode.checked
      ? 'Modo verificación activo: la voz se mezclará a 0 dB (totalmente audible).'
      : `La voz sonará al ${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)} % de su volumen original, por debajo del fondo.`;

    el.bgVolumeOut.textContent = `${el.bgVolume.value} %`;
    el.durationOut.textContent = `${utils.formatTime(s.durationSec)} min`;
    el.voiceRateOut.textContent = `${s.voiceRate.toFixed(2)}×`;
    el.gapOut.textContent = `${s.gapSec.toFixed(1)} s`;
    el.fadeOut.textContent = `${s.fadeSec} s`;

    if (state.voiceBuffer) {
      const reps = engine.countRepetitions(state.voiceBuffer, s);
      el.durationHelp.textContent = `Tus afirmaciones (${utils.formatTime(state.voiceBuffer.duration / s.voiceRate)}) sonarán ${reps} ${reps === 1 ? 'vez' : 'veces'}.`;
    } else {
      el.durationHelp.textContent = 'Carga tus afirmaciones para ver cuántas veces se repetirán.';
    }

    document.querySelectorAll('input[type="range"]').forEach(paintSlider);

    // Volumen de la vista previa del fondo en tiempo real
    if (state.bgPreview) state.bgPreview.gain.gain.value = s.bgVolume;
  }

  /** Avisa de que el resultado ya no refleja los ajustes actuales. */
  function markStale() {
    if (state.resultBuffer) el.staleNote.hidden = false;
  }

  /* ==========================================================
     Procesar y mezclar
     ========================================================== */
  async function processMix() {
    if (state.busy) return;
    if (!state.voiceBuffer) {
      toast('Primero sube o graba tus afirmaciones (paso 1).');
      document.getElementById('voice-section').scrollIntoView({ behavior: 'smooth' });
      return;
    }

    stopBgPreview();
    setBusy(true);
    setProgress(null);
    setStatus('Renderizando la mezcla…');
    await utils.yieldToUI(); // deja que se pinte el estado "Procesando…"

    try {
      const started = performance.now();
      const buffer = await engine.renderMix({
        voiceBuffer: state.voiceBuffer,
        bgType: state.bgType,
        customBgBuffer: state.customBgBuffer,
        ...readSettings()
      });

      setStatus('Preparando la vista previa…');
      await utils.yieldToUI();
      const wav = encoders.encodeWAV(buffer);

      state.resultBuffer = buffer;
      state.resultWavBlob = wav;
      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
      state.resultUrl = URL.createObjectURL(wav);
      el.resultPlayer.src = state.resultUrl;

      el.resultSection.hidden = false;
      el.staleNote.hidden = true;
      utils.drawWaveform(el.resultWave, buffer, '#67e8f9');
      el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

      const secs = ((performance.now() - started) / 1000).toFixed(1);
      setStatus(`¡Listo! Mezcla de ${utils.formatTime(buffer.duration)} generada en ${secs} s.`);
    } catch (err) {
      console.error(err);
      setStatus('');
      toast(`Error al mezclar: ${err.message}`);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  /* ==========================================================
     Descargas
     ========================================================== */
  function downloadWav() {
    if (!state.resultWavBlob) return;
    utils.downloadBlob(state.resultWavBlob, 'subliminal-studio-mezcla.wav');
  }

  async function downloadMp3() {
    if (!state.resultBuffer || state.busy) return;
    setBusy(true);
    setProgress(0);
    setStatus('Codificando MP3…');
    try {
      const kbps = Number(el.mp3Bitrate.value);
      const mp3 = await encoders.encodeMP3(state.resultBuffer, kbps, (f) => {
        setProgress(f);
        setStatus(`Codificando MP3… ${Math.round(f * 100)} %`);
      });
      utils.downloadBlob(mp3, 'subliminal-studio-mezcla.mp3');
      setStatus('MP3 descargado.');
    } catch (err) {
      console.error(err);
      setStatus('');
      toast(err.message);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  /* ==========================================================
     Eventos
     ========================================================== */
  function bindEvents() {
    el.tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    el.voiceFile.addEventListener('change', () => {
      const file = el.voiceFile.files[0];
      if (file) loadVoice(file, file.name);
      el.voiceFile.value = ''; // permite volver a elegir el mismo archivo
    });

    // Arrastrar y soltar
    ['dragenter', 'dragover'].forEach((type) =>
      el.dropzone.addEventListener(type, (e) => { e.preventDefault(); el.dropzone.classList.add('is-dragover'); }));
    ['dragleave', 'drop'].forEach((type) =>
      el.dropzone.addEventListener(type, () => el.dropzone.classList.remove('is-dragover')));
    el.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('audio/')) loadVoice(file, file.name);
      else toast('Suelta un archivo de audio.');
    });

    el.recordBtn.addEventListener('click', toggleRecording);

    el.bgOptions.forEach((b) => b.addEventListener('click', () => {
      // Volver a pulsar "Subir el mío" permite cambiar de archivo
      if (b.dataset.bg === 'custom' && state.bgType === 'custom') el.bgFile.click();
      else selectBackground(b.dataset.bg);
    }));
    el.bgFile.addEventListener('change', () => {
      const file = el.bgFile.files[0];
      if (file) loadCustomBackground(file);
      el.bgFile.value = '';
    });
    el.bgPreviewBtn.addEventListener('click', () => (state.bgPreview ? stopBgPreview() : startBgPreview()));

    // Cualquier cambio en los ajustes actualiza los textos y marca el resultado como desactualizado
    [el.voiceDb, el.bgVolume, el.duration, el.voiceRate, el.gap, el.fade, el.loopVoice, el.verifyMode]
      .forEach((input) => input.addEventListener('input', () => { updateReadouts(); markStale(); }));

    el.processBtn.addEventListener('click', processMix);
    el.downloadWav.addEventListener('click', downloadWav);
    el.downloadMp3.addEventListener('click', downloadMp3);

    // Redibujar las formas de onda al cambiar el tamaño de la ventana
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.voiceBuffer) utils.drawWaveform(el.voiceWave, state.voiceBuffer, '#a78bfa');
        if (state.resultBuffer) utils.drawWaveform(el.resultWave, state.resultBuffer, '#67e8f9');
      }, 150);
    });
  }

  /* ---------- Arranque ---------- */
  if (!recorder.isSupported()) {
    el.recordHint.textContent = 'Tu navegador no permite grabar aquí (se necesita https o localhost). Usa "Subir archivo".';
  }
  bindEvents();
  updateReadouts();
})();
