---
name: add-contour
description: Añadir un nuevo algoritmo de contorno melódico orgánico al generador (objeto CONTOURS en js/generator.js). Usar cuando se pida una nueva forma de línea melódica, curva de alturas o perfil de célula.
---

# Añadir un algoritmo de contorno

Los contornos viven en el objeto `CONTOURS` de `js/generator.js`. Cada pieza
sortea uno para dibujar la curva de alturas de la célula madre, y cada variación
puede (prob. 0.4, `recontour`) redibujar las suyas con otro algoritmo distinto.
El nombre queda en `cell.contour` / `piece.contour` y se registra en consola al
generar (con los contornos extra de las variaciones entre paréntesis).

## Contrato de un contorno

```js
// dentro de CONTOURS:
nombre(n) {
  // n = largo de la célula (potencia de 2: 16..256)
  return arrayDeFloats; // largo exactamente n
}
```

- Devuelve **floats crudos, largo exactamente `n`**. No hace falta redondear ni
  acotar: `normalizeContour` lleva la curva al ámbito final (9–14 grados
  centrados cerca de la tónica, enteros recortados a [-7, 7]).
- Consecuencia de la normalización: importa la **forma relativa** de la curva,
  no su escala absoluta. Una curva de amplitud 0.1 y una de amplitud 100 suenan
  igual; lo que no se puede es devolver una constante (span 0 degenera a línea
  plana, aunque no rompe: hay guarda `|| 1`).
- Puede asumir `n` potencia de 2 (como hace `fractal`), pero si no lo necesita,
  mejor no depender de ello.
- Nombre en español y minúsculas, coherente con los existentes (`paseo`, `arco`,
  `onda`, `gesto`, `gravedad`, `fractal`, `terrazas`, `espiral`). Un comentario
  de una línea sobre la definición describiendo el carácter.

## Qué hace orgánico a un contorno

Los existentes siguen alguno de estos principios; uno nuevo debería también:
- **Continuidad**: pasos mayormente conjuntos, saltos como evento marcado.
- **Direccionalidad**: tendencias que se sostienen (arcos, derivas, mesetas),
  no ruido blanco — justamente lo que se eliminó al crear este sistema.
- **Tensión y reposo**: clímax desplazado, recuperación tras salto, atracción
  al centro tonal.

## Pasos

1. Añadir la función al objeto `CONTOURS` (queda registrada sola: la selección
   aleatoria y `CONTOUR_NAMES` derivan de `Object.keys`). No hay que tocar nada
   más — ni UI ni composer.
2. Verificar headless con la skill `test-generator`: recorrer todos los
   `CELL_LENGTHS` con `generateMotherCell(len, 'nombre')` y comprobar largo,
   grados enteros en [-7, 7] y que el ámbito resultante no sea plano.
3. Opcional: escucharlo con la skill `run-app` — generar varias veces hasta que
   la consola muestre `contorno: nombre`.
