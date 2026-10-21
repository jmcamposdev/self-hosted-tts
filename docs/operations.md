# Operación

## Estado y acceso

Ejecuta `docker compose ps`, consulta `GET /health/ready` y revisa `docker compose logs --tail=100 worker aligner api`. Las fases y el identificador de cada trabajo permiten diagnosticar errores sin registrar el guion ni la clave. Un error de alineación no convierte el trabajo en éxito parcial.

La API solo escucha en loopback. Desde el Mac puedes abrir un túnel `ssh -N -L 18080:127.0.0.1:8080 SERVIDOR` y utilizar el cliente con `--url http://127.0.0.1:18080`. Copia la clave privada a un archivo protegido del cliente mediante un canal seguro; no la añadas a Git. Para acceso permanente, coloca un proxy HTTPS delante de 127.0.0.1:8080. No publiques el alineador ni montes el socket Docker dentro de la aplicación.

## Datos y recursos

- `storage/state.sqlite` y sus ficheros WAL/SHM: voces, trabajos, reservas y checkpoints.
- `storage/voices/`: referencias y perfiles permanentes hasta borrado por API.
- `storage/jobs/`: resultados e intermedios por intento, retenidos siete días.
- `models/`: pesos descargados; se pueden volver a obtener con los scripts fijados.
- `.secrets/api_key` y `.env`: autenticación y configuración local, ignoradas por Git.

SQLite requiere disco local de un solo host. No uses NFS, varios VPS ni copias de la base en paralelo. Un bloqueo global limita a un único trabajador de cálculo aunque arranquen varios procesos accidentalmente. Se reservan 12 GiB para el trabajador, 4 GiB para el alineador y 512 MiB para la API. Las fases de cálculo son secuenciales, aunque ambos servicios puedan usar cuatro CPU. Comprueba recursos de otros contenedores antes de aumentar límites.

La API rechaza nuevas solicitudes con 507 si quedan menos de 2 GiB libres. El trabajador comprueba el espacio antes de cada fragmento. La cola admite hasta 100 trabajos pendientes/activos. Todo ello se configura en `.env`; la actualización requiere recrear los servicios.

El limpiador comprueba caducidades cada minuto. Las descargas caducadas se rechazan inmediatamente, aunque la limpieza física aún no se haya ejecutado. Los metadatos de trabajos caducados permanecen para consultar su estado; no contienen el audio y se eliminan el guion y la configuración capturada al completar la limpieza. Las voces y sus referencias no caducan. Borrar una voz requiere acabar o cancelar antes sus trabajos.

## Reinicios y recuperación

`docker compose restart worker` detiene el proceso de síntesis y devuelve el trabajo a la cola conservando sus checkpoints. Si el proceso muere abruptamente, el trabajo se puede recuperar al vencer su reserva de 120 segundos. No hay más de tres intentos automáticos. Un trabajador antiguo no puede publicar un resultado después de perder su reserva.

Cada fragmento confirmado tiene una huella de configuración y un checksum del PCM. Se reutilizan únicamente fragmentos completos y válidos. Un fallo transitorio del alineador admite dos reintentos; texto inválido, referencia incompatible, baja confianza o falta de espacio no se reintentan automáticamente. Para estos últimos, corrige la causa y crea otra solicitud con otra clave de idempotencia.

Cancelar es asíncrono y tarda como máximo el intervalo habitual de heartbeat (10 segundos) más la terminación del proceso. Borrar un trabajo activo solicita cancelación y posterior eliminación física. Los perfiles finales viven fuera del árbol del trabajo de clonación y sobreviven a su caducidad.

## Copia y restauración

Para una copia consistente, detén API y trabajador con `docker compose stop api worker`. Copia `storage`, `.secrets` y `.env` juntos, incluidos los archivos WAL que existan. Reinicia con `docker compose up -d`. El alineador solo lee datos y no necesita participar en la copia. Protege la copia: contiene voces, referencias, guiones y credenciales.

Para restaurar, conserva propietario/permisos, restaura esos tres elementos en el directorio del proyecto, vuelve a descargar modelos si faltan y levanta Compose. Si el host tiene otro UID/GID, actualiza TTS_UID/TTS_GID y la propiedad de los volúmenes antes de arrancar. No copies una base SQLite abierta de manera independiente de sus archivos WAL.

## Actualizar

No cambies de revisión de motor/modelos en un trabajo activo. Espera a que termine o cancélalo. Guarda la copia anterior, obtén la revisión nueva del repositorio y ejecuta `docker compose build && docker compose up -d`. Comprueba salud y un piloto corto antes de usar narraciones largas. Los esquemas de la primera versión se crean al arrancar; futuros cambios persistentes requerirán migraciones explícitas.

Las imágenes base siguen sus etiquetas de mantenimiento y los paquetes del sistema reciben actualizaciones al reconstruir; el código del motor, los pesos y las dependencias de aplicación están fijados por commit, revisiones y lockfiles. Registra la revisión del proyecto y los IDs de imagen utilizados en cada despliegue.

Para rotar la clave, reemplaza el contenido del archivo privado y recrea API y trabajador. Actualiza la copia de los clientes. No imprimas la clave en registros ni la incluyas en comandos compartidos.
