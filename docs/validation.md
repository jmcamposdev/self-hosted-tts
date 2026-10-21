# Validación

## Qué verifican las pruebas automáticas

`npm test` verifica ocho escenarios de API, persistencia y coordinación: autenticación, rechazo de ajustes no soportados, snapshots inmutables, cola e idempotencia, reservas entre trabajadores, intentos limitados, cancelación tras pérdida de proceso, expiración y descargas protegidas. Incluye una prueba de orquestación con dobles sintéticos explícitos: provoca un fallo del alineador y comprueba que el segundo intento reutiliza el fragmento terminado, escribe el audio en una ruta gestionada y suma pausas con muestras reales. Esa prueba no certifica calidad de voz ni del modelo acústico.

`npm run test:python` verifica normalización de cifras/fechas, conservación de índices Unicode, rechazo de fechas inválidas y separadores CTC. El modelo español emite `|` entre palabras; ese token debe mantenerse además del blank CTC. Eliminarlo causó un falso rechazo de una conjunción correcta y quedó cubierto por regresión.

La imagen del motor también ejecuta sus comprobaciones de kernels `--self-test` durante la construcción ARM64. Esto no sustituye la evaluación auditiva de un clon.

## Pilotos reales

En macOS se alineó la muestra neutra acelerada de 19,54 segundos con el modelo real español en CPU. En Linux ARM64 se han construido y arrancado los tres contenedores y se han creado dos perfiles distintos por API. Se completaron cuatro narraciones cortas por API: narrador (17,786 s, dos fragmentos), segunda voz (7,253 s), cambio de volumen y velocidad 1.0 (8,080 s) y la misma voz/texto/semilla a velocidad 1.08 (7,488 s). La relación medida fue 1,0791. Todas las descargas conservaron el texto exacto, los tres arrays, hashes, Opus y WAV mono 24 kHz.

Se reinició el trabajador real después del primer fragmento alineado del narrador. El trabajo terminó en el segundo intento, reutilizando el checkpoint del primero. Las ocho pruebas Node y las cuatro Python también pasaron en contenedores Linux ARM64, además de macOS.

Ejemplo para verificar una descarga y su texto original:

```sh
python3 scripts/validate-artifacts.py ./descarga --text-file narracion.txt
```

La salida de esta herramienta separa explícitamente la validación de formato de la precisión auditiva de los tiempos. El JSON debe reconstruir el texto completo, ser monotónico y quedar dentro de la duración del audio final. Los símbolos proyectados se indican en metadatos.

## Condiciones de promoción a producción

El MVP puede utilizarse para pilotos; la producción desatendida requiere completar y guardar evidencia de:

- Escucha humana de dos voces en varios fragmentos, comprobando identidad, pronunciación y uniones.
- Una narración real de aproximadamente 30 minutos, con revisión de inicio, centro y final, sin texto omitido/repetido ni deriva.
- Al menos 50 palabras anotadas independientemente (100 marcas de inicio/fin), con error p95 menor de 200 ms. No se usarán tiempos del propio alineador como referencia.
- La recuperación real y lógica tras reinicio ya están comprobadas en el piloto corto; repetirla en la carga larga si cambian la cola o los checkpoints.
- Seguimiento de memoria, disco y carga junto a los demás servicios del host durante el piloto largo.

Para comparar anotaciones manuales:

```sh
python3 scripts/evaluate-boundaries.py --words descarga/words.json --reference referencia-manual.json
```

La referencia es un array con objetos `{"word_index":0,"word":"Hola,","start":0.12,"end":0.45}`. Índices y texto deben coincidir con `words.json`; los tiempos los anota una persona escuchando el audio. La herramienta exige al menos 50 palabras y falla si no cumple el objetivo.

Mientras falte esta evidencia, no se afirma precisión equivalente a ElevenLabs ni una capacidad de producción de 30 minutos ya certificada. El límite de 30 minutos está implementado; su ensayo largo es una validación separada.
