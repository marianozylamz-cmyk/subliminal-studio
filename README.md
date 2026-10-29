# Subliminal Studio

Aplicación web para crear audios subliminales: mezcla una grabación de afirmaciones con un sonido de fondo y baja la voz hasta un nivel casi inaudible. **Todo se procesa en el navegador** con la Web Audio API: no hace falta servidor y los audios nunca salen del dispositivo.

## Cómo ejecutarla

Puedes abrir `index.html` directamente, pero para que funcione la **grabación con micrófono** el navegador exige `https://` o `localhost`. Lo más fácil es levantar un servidor local desde la carpeta del proyecto:

```bash
python3 -m http.server 8000
```

y abrir <http://localhost:8000>.

## Estructura

```
subliminal-studio/
├── index.html            # Interfaz (Tailwind por CDN)
├── css/styles.css        # Componentes: tarjetas, sliders, dropzone, botones
└── js/
    ├── utils.js          # dB↔ganancia, formato de tiempo, forma de onda, descargas
    ├── noiseGenerators.js# Lluvia, olas, ruido blanco y marrón sintetizados
    ├── audioEngine.js    # Decodificar audio y renderizar la mezcla (OfflineAudioContext)
    ├── encoders.js       # Exportar a WAV (a mano) y MP3 (lamejs)
    ├── voiceRecorder.js  # Grabación con MediaRecorder
    └── app.js            # Conecta la interfaz con el motor
```

Los scripts son "clásicos" (no módulos ES) y se registran en un objeto global `SS`. Así funcionan sin empaquetador. El orden de los `<script>` en `index.html` importa.

## Cómo funciona la mezcla

```
[voz] → [ganancia: normalizar × atenuación dB] ─┐
                                                 ├→ [master + fundidos] → [limitador] → WAV/MP3
[fondo] → [ganancia: volumen del fondo] ────────┘
```

1. **Normalización:** la voz se lleva a su pico máximo, para que "-30 dB" signifique lo mismo con una grabación floja o fuerte.
2. **Atenuación:** `ganancia = 10^(dB/20)`. A -30 dB la voz suena al ~3 % y a -45 dB al ~0,6 %, enmascarada por el fondo.
3. **Bucle:** la voz se programa una y otra vez (con la velocidad y la pausa elegidas) hasta llenar la duración.
4. **Render offline:** `OfflineAudioContext` calcula toda la mezcla más rápido que en tiempo real y devuelve un `AudioBuffer`.
5. **Exportar:** el buffer se escribe como WAV PCM 16 bits o se codifica a MP3 con lamejs.

Los fondos predeterminados no son archivos: se generan con ruido (blanco, rosa, marrón) y filtros. Las olas usan un oscilador lento (LFO) que sube y baja el volumen.

## Ideas para ampliarla

- **Más fondos:** añadir un `case` en `createPreset()` de `noiseGenerators.js` y un botón en `index.html` con su `data-bg`.
- **Tonos binaurales:** dos `OscillatorNode` (p. ej. 200 Hz izquierda y 210 Hz derecha) con un `StereoPannerNode`, sumados al master en `renderMix()`.
- **Técnica "silent subliminal":** desplazar la voz a ultrasonidos (~17 kHz) por modulación de amplitud.
- **Texto a voz:** generar las afirmaciones con `speechSynthesis` (requiere capturar la salida, más complejo).
- **Web Worker:** mover la codificación MP3 a un worker para no bloquear la página en mezclas largas.

## Límites conocidos

- La duración máxima es de 15 minutos: el audio se guarda en memoria (~10 MB por minuto en WAV) y en móviles podría quedarse sin RAM.
- El MP3 depende de que cargue lamejs desde el CDN; el WAV funciona siempre.
- Grabar con el micrófono solo funciona en `https://` o `localhost`.
