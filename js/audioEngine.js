/* ==========================================================
   audioEngine.js — Corazón del procesamiento de audio
   ----------------------------------------------------------
   - Decodifica archivos a AudioBuffer.
   - Crea la fuente de fondo (preset sintetizado o archivo).
   - Renderiza la mezcla final con OfflineAudioContext.

   ¿Por qué OfflineAudioContext? Procesa el audio "tan rápido
   como pueda la CPU" en lugar de en tiempo real: una mezcla
   de 10 minutos se genera en pocos segundos y el resultado
   es un AudioBuffer exacto que luego convertimos a WAV/MP3.

   Esquema del grafo de la mezcla:

     [voz] → [ganancia voz: normalización × atenuación dB] ─┐
                                                             ├→ [master + fundidos] → [limitador] → salida
     [fondo] → [ganancia fondo: volumen del slider] ────────┘
   ========================================================== */
window.SS = window.SS || {};

SS.engine = (function () {
  const RENDER_SAMPLE_RATE = 44100; // estándar de CD, compatible con MP3
  let liveContext = null;

  /**
   * AudioContext "en vivo" (para decodificar y para la vista previa del fondo).
   * Se crea bajo demanda porque los navegadores exigen un gesto del usuario.
   */
  function getContext() {
    if (!liveContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      liveContext = new Ctx();
    }
    if (liveContext.state === 'suspended') liveContext.resume();
    return liveContext;
  }

  /** Convierte un File/Blob (mp3, wav, webm…) en un AudioBuffer. */
  async function decodeBlob(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    return getContext().decodeAudioData(arrayBuffer);
  }

  /**
   * Crea la fuente de fondo dentro de cualquier contexto.
   * @param {BaseAudioContext} ctx
   * @param {string} type        'rain' | 'waves' | 'white' | 'brown' | 'custom'
   * @param {AudioBuffer} [customBuffer]  necesario si type === 'custom'
   * @returns {{output: AudioNode, start: Function, stop: Function}}
   */
  function createBackground(ctx, type, customBuffer) {
    if (type !== 'custom') return SS.noise.createPreset(ctx, type);

    if (!customBuffer) throw new Error('Falta el archivo de fondo personalizado.');
    const src = ctx.createBufferSource();
    src.buffer = customBuffer;
    src.loop = true; // si el fondo es más corto que la mezcla, se repite
    const output = ctx.createGain();
    output.gain.value = SS.utils.normalizeGain(customBuffer, 0.9);
    src.connect(output);
    return {
      output,
      start(when = 0) { src.start(when); },
      stop(when = 0) { try { src.stop(when); } catch (e) { /* ya detenido */ } }
    };
  }

  /**
   * Renderiza la mezcla completa.
   * @param {Object} o
   * @param {AudioBuffer} o.voiceBuffer      afirmaciones
   * @param {string}      o.bgType           tipo de fondo ('none' = sin fondo)
   * @param {AudioBuffer} [o.customBgBuffer] fondo subido por el usuario
   * @param {number}      o.voiceDb          atenuación de la voz en dB (negativo)
   * @param {number}      o.bgVolume         volumen del fondo 0..1
   * @param {number}      o.durationSec      duración total de la mezcla
   * @param {number}      o.voiceRate        velocidad de reproducción de la voz
   * @param {boolean}     o.loopVoice        repetir la voz hasta el final
   * @param {number}      o.gapSec           pausa entre repeticiones
   * @param {number}      o.fadeSec          fundido de entrada y de salida
   * @returns {Promise<AudioBuffer>}
   */
  async function renderMix(o) {
    const sr = RENDER_SAMPLE_RATE;
    const duration = o.durationSec;
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * sr), sr);

    // --- Bus master con fundidos y limitador ---
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    // Un compresor con ratio alto actúa como limitador: evita que la suma recorte (clipping)
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(ctx.destination);

    const fade = Math.min(o.fadeSec, duration / 2);
    if (fade > 0) {
      master.gain.setValueAtTime(0, 0);
      master.gain.linearRampToValueAtTime(1, fade);
      master.gain.setValueAtTime(1, duration - fade);
      master.gain.linearRampToValueAtTime(0, duration);
    }

    // --- Fondo ---
    if (o.bgType !== 'none') {
      const bg = createBackground(ctx, o.bgType, o.customBgBuffer);
      const bgGain = ctx.createGain();
      bgGain.gain.value = o.bgVolume;
      bg.output.connect(bgGain).connect(master);
      bg.start(0);
      bg.stop(duration);
    }

    // --- Voz (afirmaciones) ---
    // 1) Normalizamos para que 0 dB = pico máximo de la grabación.
    // 2) Aplicamos la atenuación del slider: aquí es donde se vuelve "subliminal".
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = SS.utils.normalizeGain(o.voiceBuffer) * SS.utils.dbToGain(o.voiceDb);
    voiceGain.connect(master);

    // Programamos una copia de la voz tras otra hasta llenar la duración.
    const period = Math.max(0.1, o.voiceBuffer.duration / o.voiceRate + o.gapSec);
    let t = 0;
    do {
      const src = ctx.createBufferSource();
      src.buffer = o.voiceBuffer;
      src.playbackRate.value = o.voiceRate; // >1 acelera (y sube el tono)
      src.connect(voiceGain);
      src.start(t);
      t += period;
    } while (o.loopVoice && t < duration);

    return ctx.startRendering();
  }

  /** Cuántas veces sonarán las afirmaciones con estos ajustes (para mostrarlo en la UI). */
  function countRepetitions(voiceBuffer, { durationSec, voiceRate, gapSec, loopVoice }) {
    if (!voiceBuffer) return 0;
    if (!loopVoice) return 1;
    const period = Math.max(0.1, voiceBuffer.duration / voiceRate + gapSec);
    return Math.ceil(durationSec / period);
  }

  return { getContext, decodeBlob, createBackground, renderMix, countRepetitions };
})();
