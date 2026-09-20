# Frontend — Secure Chat (LDAP + Secret Rotation)

Chat web con autenticación LDAP y rotación automática de secrets.

## Características

- **Login LDAP**: autenticación directa contra OpenLDAP (bind DN)
- **Chat en tiempo real**: polling cada 3s con auto-refresh de API key
- **Cifrado y firmas**: cada mensaje se cifra (Fernet) y firma (HMAC-SHA256) antes de enviarse
- **Sidebar de conversaciones**: lista de chats con búsqueda de usuarios en el directorio LDAP
- **Auto-refresh de secrets**: relee `config.json` cada 1s; si la API key rota, reintenta automáticamente en 401
- **UI minimalista**: scrollbar auto-hide, sidebar colapsable, diseño responsive

## Stack

- Nginx (servidor estático + reverse proxy)
- `config.js` / `config.json` inyectados por `render-config-js.sh` desde el volumen compartido
- `app.js` vanilla JS (sin framework)

## Variables de entorno

| Variable | Descripción |
|---|---|
| `BACKEND_URL` | URL del backend (default: `http://backend:3000`) |
| `API_SECRET` | Secret inicial para `config.js` (fallback si no hay rotación) |

## Ejecución

```bash
docker compose up -d --build frontend
El frontend se sirve en http://localhost:8080.