/* ==========================================================
   noiseGenerators.js — Fondos predeterminados sintetizados
   ----------------------------------------------------------
   En lugar de descargar archivos MP3 de lluvia u olas, los
   generamos matemáticamente con ruido + filtros. Ventajas:
   la app pesa unos pocos KB, no hay derechos de autor y
   funciona sin conexión.

   Cada preset devuelve un objeto { output, start(t), stop(t) }
   que funciona igual en un AudioContext (vista previa en vivo)
   que en un OfflineAudioContext (render final).
   ========================================================== */
window.SS = window.SS || {};

SS.noise = (function () {
  // Duración del bucle de ruido. Se repite sin cortes gracias al crossfade.
  const LOOP_SECONDS = 12;

  /* ---------- Generadores de muestras ---------- */

  // Ruido blanco: valores aleatorios uniformes. Mismo nivel en todas las frecuencias.
  function whiteSamples(n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
    return out;
  }

  // Ruido rosa: cae 3 dB por octava, suena más natural (algoritmo de Paul Kellet).
  function pinkSamples(n) {
    const out = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return out;
  }

  // Ruido marrón (browniano): cae 6 dB por octava, muy grave, tipo "rumor".
  function brownSamples(n) {
    const out = new Float32Array(n);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      out[i] = last * 3.5;
    }
    return out;
  }

  const GENERATORS = { white: whiteSamples, pink: pinkSamples, brown: brownSamples };

  /**
   * Crea un AudioBuffer estéreo de ruido que se puede repetir en bucle
   * sin "clic" en la unión. Truco: generamos un poco más de lo necesario
   * y mezclamos (crossfade de potencia constante) el final sobrante
   * con el principio, así la última muestra enlaza con la primera.
   */
  function makeNoiseBuffer(ctx, color, seconds = LOOP_SECONDS) {
    const sr = ctx.sampleRate;
    const n = Math.floor(seconds * sr);
    const fade = Math.floor(0.25 * sr);
    const buffer = ctx.createBuffer(2, n, sr);

    for (let c = 0; c < 2; c++) {
      // Cada canal se genera por separado: suena más amplio (estéreo real)
      const raw = GENERATORS[color](n + fade);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        const fadeIn = Math.sin(t * Math.PI / 2);
        const fadeOut = Math.cos(t * Math.PI / 2);
        raw[i] = raw[i] * fadeIn + raw[n + i] * fadeOut;
      }
      buffer.copyToChannel(raw.subarray(0, n), c);
    }
    return buffer;
  }

  /**
   * Añade "gotas" a un buffer: pequeñas ráfagas de ruido que decaen
   * muy rápido. Sobre ruido rosa filtrado dan la textura de lluvia.
   */
  function addRaindrops(buffer, dropsPerSecond = 45) {
    const sr = buffer.sampleRate;
    const n = buffer.length;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      const drops = Math.floor((n / sr) * dropsPerSecond);
      for (let d = 0; d < drops; d++) {
        const pos = Math.floor(Math.random() * n);
        const amp = 0.05 + Math.random() * 0.35;
        const decay = sr * (0.0015 + Math.random() * 0.004); // 1.5–5.5 ms
        const len = Math.floor(decay * 6);
        for (let k = 0; k < len; k++) {
          // "% n" hace que una gota cerca del final continúe al principio (bucle limpio)
          data[(pos + k) % n] += amp * Math.exp(-k / decay) * (Math.random() * 2 - 1);
        }
      }
    }
  }

  /** Pequeño atajo para crear un filtro BiquadFilter. */
  function filter(ctx, type, frequency, Q = 0.7) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  }

  /**
   * Construye el grafo de audio de un preset.
   * @param {BaseAudioContext} ctx  AudioContext u OfflineAudioContext
   * @param {'rain'|'waves'|'white'|'brown'} type
   */
  function createPreset(ctx, type) {
    const output = ctx.createGain();
    const sources = []; // todo lo que necesita start()/stop()

    function loopSource(buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      sources.push(src);
      return src;
    }

    switch (type) {
      case 'white': {
        // Ruido blanco con un leve recorte de agudos para que no resulte tan áspero
        loopSource(makeNoiseBuffer(ctx, 'white'))
          .connect(filter(ctx, 'lowpass', 14000))
          .connect(output);
        output.gain.value = 0.35;
        break;
      }

      case 'brown': {
        loopSource(makeNoiseBuffer(ctx, 'brown')).connect(output);
        output.gain.value = 0.8;
        break;
      }

      case 'rain': {
        // Capa 1: "siseo" de la lluvia = ruido rosa + gotas, filtrado en banda
        const hiss = makeNoiseBuffer(ctx, 'pink');
        addRaindrops(hiss);
        loopSource(hiss)
          .connect(filter(ctx, 'highpass', 400))
          .connect(filter(ctx, 'lowpass', 7000))
          .connect(output);

        // Capa 2: rumor grave de fondo (lluvia lejana sobre tejados)
        const rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 0.35;
        loopSource(makeNoiseBuffer(ctx, 'brown'))
          .connect(filter(ctx, 'lowpass', 300))
          .connect(rumbleGain)
          .connect(output);

        output.gain.value = 0.9;
        break;
      }

      case 'waves': {
        // Un oscilador muy lento (LFO) sube y baja el volumen: es el "vaivén" de las olas.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.085; // un ciclo cada ~12 s
        sources.push(lfo);

        // Capa 1: cuerpo de la ola (ruido marrón filtrado)
        const swell = ctx.createGain();
        swell.gain.value = 0.55;          // nivel base…
        const swellDepth = ctx.createGain();
        swellDepth.gain.value = 0.45;     // …± esta cantidad → oscila entre 0.1 y 1.0
        lfo.connect(swellDepth).connect(swell.gain);
        loopSource(makeNoiseBuffer(ctx, 'brown'))
          .connect(filter(ctx, 'lowpass', 700))
          .connect(swell)
          .connect(output);

        // Capa 2: espuma (agudos suaves) que crece en la cresta de la ola
        const foam = ctx.createGain();
        foam.gain.value = 0.08;
        const foamDepth = ctx.createGain();
        foamDepth.gain.value = 0.07;
        lfo.connect(foamDepth).connect(foam.gain);
        loopSource(makeNoiseBuffer(ctx, 'pink'))
          .connect(filter(ctx, 'highpass', 1500))
          .connect(foam)
          .connect(output);

        output.gain.value = 1;
        break;
      }

      default:
        throw new Error(`Fondo desconocido: ${type}`);
    }

    return {
      output,
      start(when = 0) { sources.forEach((s) => s.start(when)); },
      stop(when = 0) {
        sources.forEach((s) => { try { s.stop(when); } catch (e) { /* ya detenido */ } });
      }
    };
  }

  return { createPreset, makeNoiseBuffer };
})();
