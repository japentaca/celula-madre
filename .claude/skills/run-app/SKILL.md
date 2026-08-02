---
name: run-app
description: Levantar la app de música generativa en un servidor HTTP local y verla en el navegador. Usar cuando haya que ejecutar, probar visualmente o depurar la app (no funciona desde file://).
---

# Ejecutar la app

La app es estática (HTML + JS vanilla + Tone.js por CDN) pero **no funciona
abriendo `index.html` directamente**: Tone.js necesita un contexto seguro
(localhost o HTTPS). Siempre servir por HTTP.

## Levantar el servidor

Desde la raíz del repo, en segundo plano:

```
python -m http.server 8000
```

(Alternativa si no hay Python: `npx serve -l 8000 .`)

La app queda en `http://localhost:8000`. Si el puerto 8000 está ocupado, usar
8001, 8002…

## Verla y probarla

1. Cargar las herramientas de Chrome (ToolSearch con
   `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp`
   y añadir `read_console_messages` si se va a depurar).
2. `tabs_context_mcp`, crear pestaña nueva y navegar a `http://localhost:8000`.
3. La app genera una pieza automáticamente al cargar; con "Generar" se crea otra.
   Al generar, la consola registra `Pieza generada — contorno: ..., forma: ...`
   (útil para verificar qué algoritmo de contorno salió sorteado).
4. **El audio requiere clic en Play** (gesto de usuario para `Tone.start()`); la
   generación y el piano roll funcionan sin audio, así que para verificar lógica
   visual no hace falta reproducir.
5. Errores de JS: revisar con `read_console_messages`.

## Al terminar

Matar el servidor lanzado en segundo plano (o avisar al usuario de que quedó
corriendo y en qué puerto).
