# Decisiones y dependencias

## Motor y cambio de voz

Se utiliza el motor C de [gabriele-mastrapasqua/qwen3-tts](https://github.com/gabriele-mastrapasqua/qwen3-tts/tree/ef339be58a778b062e1c14382347964552eae007), sin modificar su código. Su servidor nativo no expone una carga arbitraria de `.qvoice` por petición. El trabajador invoca la CLI con un perfil elegido por ID interno. No se aceptan rutas de modelos, archivos de voz, argumentos arbitrarios o comandos en la API.

Qwen distingue Base (extracción del hablante) de CustomVoice (síntesis). Los perfiles de 0.6B no se mezclan con 1.7B. Se crea un graft `.qvoice` de 1.7B, sin transcripción ICL y sin intercambiar todos los pesos. Este camino coincide con el piloto de voz neutra, con velocidad aplicada mediante WSOLA. La API no da de alta archivos `.qvoice` externos en v1.

## Alineación

El motor no proporciona la alineación requerida. Se combina Wav2Vec2 español, PyTorch CPU y CTC segmentation, usando el texto conocido. La normalización de cifras y fechas se hace antes de sintetizar para que el texto pronunciado y el alineado coincidan. Se proyecta después al texto original. Los símbolos y las cifras originales tienen tiempos derivados que se identifican por separado.

Se evita el conjunto completo WhisperX, que incorpora ASR, diarización y dependencias innecesarias. No se depende de `torchaudio.functional.forced_align`, deprecada en 2.8 y eliminada en 2.9. Se fija NumPy 1.26.4 porque el módulo de CTC 1.7.4 instalado se compiló contra la ABI NumPy 1 y falló con NumPy 2 en la comprobación local.

La confianza media mínima de un fragmento es 0.1 y cada palabra debe superar 0.005, además de tener un intervalo positivo. Son controles de fallo, no una certificación de precisión. Las pruebas de referencias manuales deben determinar si estos umbrales son suficientes; no se relajan automáticamente para hacer pasar un audio que no encaja.

## Compatibilidad

Se conserva el JSON de tres arrays por carácter usado por ElevenLabs, incluyendo texto, orden y segundos. Las rutas públicas y el flujo asíncrono son propios. No se promete compatibilidad total con ElevenLabs, ni con su SDK o sus opciones propietarias. Un adaptador para youtube-ai quedará en otro cambio; este proyecto no depende de ese repositorio.

## Licencias y procedencia

| Componente | Licencia / fuente |
|---|---|
| Código propio | MIT, archivo LICENSE de este repositorio. |
| Motor C | [MIT](https://github.com/gabriele-mastrapasqua/qwen3-tts/blob/ef339be58a778b062e1c14382347964552eae007/LICENSE); incluida en la imagen del trabajador. |
| Pesos Qwen3-TTS 1.7B | [Apache-2.0, Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) y [CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice). |
| Wav2Vec2 español | [Apache-2.0](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-spanish). |
| CTC segmentation 1.7.4 | [Apache-2.0](https://github.com/lumaku/ctc-segmentation/blob/master/LICENSE). |
| Transformers | Apache-2.0. |
| PyTorch | BSD-3-Clause; se conserva el paquete y sus avisos. |
| num2words | LGPL-2.1; paquete sin modificaciones, con su COPYING incluido. |
| FFmpeg del sistema | La compilación Debian y sus bibliotecas tienen sus propias condiciones LGPL/GPL; se instala el paquete de la distribución sin modificarlo. |

Las licencias anteriores no conceden derechos sobre una voz o una grabación. El servicio guarda referencias proporcionadas por su propietario y no descarga voces de terceros. Las imágenes Docker son para uso propio; cualquier distribución de imágenes, pesos o dependencias debe conservar sus licencias y avisos correspondientes.

Revisiones fijadas:

- Motor: `ef339be58a778b062e1c14382347964552eae007`.
- Base: `fd4b254389122332181a7c3db7f27e918eec64e3`.
- CustomVoice: `0c0e3051f131929182e2c023b9537f8b1c68adfe`.
- Alineador español: `96d7e9b4e4a78af515a3c6d3cee7c0826045d276`.

El primer esquema de datos es v1. Hay una única instancia de base SQLite en un disco local y un propietario de API; no se incluyen cuentas, cuotas comerciales, facturación ni almacenamiento distribuido.
