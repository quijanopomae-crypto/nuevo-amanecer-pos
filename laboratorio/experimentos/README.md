# Experimentos

Cada experimento vive en su propio subdirectorio y debe partir de una rama `lab/<nombre>`.

Convención sugerida:

```text
laboratorio/experimentos/EXP-YYYYMMDD-nombre/
├── experiment.json
├── README.md
└── src/
```

No uses datos, tokens ni endpoints de escritura de producción. Si el experimento resulta aprobado, promueve únicamente el cambio mínimo necesario hacia `POS/` mediante revisión de diff.
