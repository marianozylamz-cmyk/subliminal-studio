/* ==========================================================
   encoders.js — Convierte un AudioBuffer en archivo descargable
   ----------------------------------------------------------
   - WAV: lo escribimos "a mano" (cabecera de 44 bytes + PCM 16 bits).
   - MP3: usamos la librería lamejs (cargada por CDN en index.html).
   ========================================================== */
window.SS = window.SS || {};

SS.encoders = (function () {
  /** Pasa muestras float (-1..1) a enteros de 16 bits (-32768..32767). */
  function floatTo16(input) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  /**
   * Codifica a WAV PCM 16 bits.
   * Formato: [cabecera RIFF/fmt/data de 44 bytes][muestras intercaladas L,R,L,R…]
   */
  function encodeWAV(buffer) {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const len = buffer.length;
    const blockAlign = numCh * 2;
    const dataSize = len * blockAlign;

    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);          // tamaño del bloque fmt
    view.setUint16(20, 1, true);           // 1 = PCM sin compresión
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * blockAlign, true); // bytes por segundo
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);          // bits por muestra
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Escribimos las muestras intercaladas. Int16Array usa el orden de bytes
    // del sistema, que en la práctica siempre es little-endian (lo que pide WAV).
    const pcm = new Int16Array(arrayBuffer, 44);
    const channels = [];
    for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));

    let k = 0;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        pcm[k++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  /**
   * Codifica a MP3 con lamejs, por bloques de 1152 muestras (tamaño de frame MP3).
   * Cada cierto número de bloques cedemos el control al navegador para
   * actualizar la barra de progreso y no congelar la página.
   * @param {AudioBuffer} buffer
   * @param {number} kbps   128, 192 o 320
   * @param {(fraction:number)=>void} [onProgress]
   */
  async function encodeMP3(buffer, kbps = 192, onProgress) {
    if (typeof window.lamejs === 'undefined') {
      throw new Error('No se pudo cargar el codificador MP3. Revisa tu conexión o descarga en WAV.');
    }
    const channels = Math.min(2, buffer.numberOfChannels);
    const encoder = new lamejs.Mp3Encoder(channels, buffer.sampleRate, kbps);

    const left = floatTo16(buffer.getChannelData(0));
    const right = channels > 1 ? floatTo16(buffer.getChannelData(1)) : null;

    const BLOCK = 1152;
    const parts = [];
    for (let i = 0, n = 0; i < left.length; i += BLOCK, n++) {
      const l = left.subarray(i, i + BLOCK);
      const chunk = right
        ? encoder.encodeBuffer(l, right.subarray(i, i + BLOCK))
        : encoder.encodeBuffer(l);
      if (chunk.length) parts.push(new Int8Array(chunk)); // copia: lamejs reutiliza memoria

      if (n % 200 === 0) {
        if (onProgress) onProgress(i / left.length);
        await SS.utils.yieldToUI();
      }
    }
    const tail = encoder.flush();
    if (tail.length) parts.push(new Int8Array(tail));
    if (onProgress) onProgress(1);

    return new Blob(parts, { type: 'audio/mpeg' });
  }

  return { encodeWAV, encodeMP3 };
})();
