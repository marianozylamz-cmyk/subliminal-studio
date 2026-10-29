/* ==========================================================
   utils.js — Funciones de ayuda compartidas
   ----------------------------------------------------------
   Todos los módulos se registran dentro de un único objeto
   global "SS" (Subliminal Studio). Así evitamos ensuciar
   window y no necesitamos un empaquetador: basta con abrir
   index.html.
   ========================================================== */
window.SS = window.SS || {};

SS.utils = {
  /**
   * Convierte decibelios a ganancia lineal.
   *   0 dB  -> 1.0   (volumen original)
   *  -6 dB  -> ~0.5  (la mitad de amplitud)
   * -20 dB  -> 0.1
   * -40 dB  -> 0.01  (prácticamente enmascarado por el fondo)
   */
  dbToGain(db) {
    return Math.pow(10, db / 20);
  },

  /** Formatea segundos como m:ss (o h:mm:ss si hace falta). */
  formatTime(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  },

  /** Devuelve el pico absoluto (0..1+) de todos los canales de un AudioBuffer. */
  getPeak(buffer) {
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
    }
    return peak;
  },

  /**
   * Ganancia necesaria para "normalizar" un buffer a un pico objetivo.
   * Normalizar la voz antes de atenuarla hace que los dB del slider
   * signifiquen lo mismo sin importar lo fuerte o flojo que se grabó.
   * Limitamos a +26 dB para no amplificar un archivo casi en silencio.
   */
  normalizeGain(buffer, target = 0.98) {
    const peak = SS.utils.getPeak(buffer);
    if (peak === 0) return 1;
    return Math.min(target / peak, 20);
  },

  /** Cede el control al navegador para que pinte la UI (evita congelar la página). */
  yieldToUI() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  },

  /** Fuerza la descarga de un Blob con el nombre indicado. */
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Damos tiempo al navegador a iniciar la descarga antes de liberar memoria
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  /**
   * Dibuja la forma de onda (canal izquierdo) de un AudioBuffer en un <canvas>.
   * Para cada columna de píxeles buscamos el mínimo y el máximo del tramo
   * de muestras que le corresponde y dibujamos una barra vertical.
   */
  drawWaveform(canvas, buffer, color = '#a78bfa') {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, height);

    const data = buffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / width));
    // En audios largos no hace falta leer TODAS las muestras de cada columna
    const stride = Math.max(1, Math.floor(samplesPerPixel / 2000));
    const mid = height / 2;

    g.fillStyle = color;
    for (let x = 0; x < width; x++) {
      const start = x * samplesPerPixel;
      let min = 0, max = 0;
      for (let i = start; i < start + samplesPerPixel && i < data.length; i += stride) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y = mid - max * mid;
      const h = Math.max(1, (max - min) * mid);
      g.fillRect(x, y, 1, h);
    }
  }
};
