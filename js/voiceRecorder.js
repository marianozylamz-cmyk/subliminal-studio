/* ==========================================================
   voiceRecorder.js — Grabación desde el micrófono
   ----------------------------------------------------------
   Usa getUserMedia (pide permiso al usuario) + MediaRecorder.
   Devuelve un Blob que luego se decodifica igual que un
   archivo subido.

   Nota: el micrófono solo funciona en "contexto seguro":
   https:// o http://localhost.
   ========================================================== */
window.SS = window.SS || {};

SS.recorder = (function () {
  let stream = null;
  let mediaRecorder = null;
  let chunks = [];

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  /** Elige el primer formato que el navegador sepa grabar (Chrome/Firefox: webm, Safari: mp4). */
  function pickMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (!MediaRecorder.isTypeSupported) return '';
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.start(250); // guardamos un trozo cada 250 ms
  }

  /** Detiene la grabación, libera el micrófono y resuelve con el audio grabado. */
  function stop() {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder) return reject(new Error('No hay ninguna grabación activa.'));
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop()); // apaga el indicador del micrófono
        mediaRecorder = null;
        stream = null;
        chunks = [];
        resolve(blob);
      };
      mediaRecorder.stop();
    });
  }

  function isRecording() {
    return !!mediaRecorder && mediaRecorder.state === 'recording';
  }

  return { isSupported, start, stop, isRecording };
})();
