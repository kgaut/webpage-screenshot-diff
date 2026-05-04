# screenshot-diff

Service HTTP qui capture des screenshots d'URL et les compare au batch
précédent pour détecter des régressions visuelles (CSS, layout). Conçu pour
être appelé depuis une pipeline CI/CD : un code HTTP `422` indique qu'au moins
une page a divergé au-delà du seuil autorisé.

## Fonctionnement

- Un `POST /diff` reçoit une liste d'URL et un seuil (% de pixels modifiés
  acceptés).
- Pour chaque URL, le service capture un screenshot pleine page avec
  Playwright (Chromium).
- Le screenshot est comparé à la baseline (le batch précédent) avec
  `pixelmatch`.
- Si l'écart dépasse le seuil, la requête échoue (HTTP 422) et l'image diff
  est persistée sur le volume.
- Au premier run d'une URL, le screenshot devient automatiquement la
  baseline.
- Les `HISTORY_SIZE` dernières captures par URL sont conservées (rotation
  automatique).

## API

### `POST /diff`

```json
{
  "threshold": 0.1,
  "updateBaselineOnFailure": false,
  "viewport": { "width": 1280, "height": 800 },
  "urls": [
    "https://example.com/",
    "https://example.com/checkout"
  ]
}
```

| Champ | Type | Défaut | Description |
|-------|------|--------|-------------|
| `urls` | `string[]` | — | URLs absolues à capturer (1–200). |
| `threshold` | `number` | `0` | Pourcentage de pixels modifiés autorisé (0–100). |
| `updateBaselineOnFailure` | `boolean` | `false` | Si `true`, la baseline est remplacée même quand le seuil est dépassé. |
| `viewport` | `{ width, height }` | env | Surcharge ponctuelle du viewport. |

Réponses :

- `200 OK` — toutes les URL passent le seuil.
- `422 Unprocessable Entity` — au moins une URL dépasse le seuil ou a échoué.
- `400 Bad Request` — JSON invalide.

Corps de réponse :

```json
{
  "ok": true,
  "threshold": 0.1,
  "results": [
    {
      "url": "https://example.com/",
      "hash": "ab12...",
      "created": false,
      "diffRatio": 0.0002,
      "thresholdExceeded": false,
      "screenshot": "/data/history/ab12.../2026-05-04T13-30-00-000Z.png",
      "diffImage": "/data/history/ab12.../2026-05-04T13-30-00-000Z.diff.png"
    }
  ]
}
```

### `GET /healthz`

Liveness probe (HTTP 200 si le serveur tourne).

## Layout du volume

```
/data/
  baselines/
    <sha256>.png             # référence ("batch précédent")
    <sha256>.json            # méta { url, capturedAt, viewport }
  history/
    <sha256>/
      <iso-timestamp>.png
      <iso-timestamp>.diff.png
      <iso-timestamp>.json
  index.json                 # mapping hash -> url (lisibilité humaine)
```

Le hash est `sha256(url)` : une URL renommée crée une nouvelle baseline.

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port d'écoute HTTP. |
| `DATA_DIR` | `/data` | Racine du volume persistant. |
| `HISTORY_SIZE` | `10` | Nombre de captures conservées par URL. |
| `MAX_CONCURRENCY` | `4` | URL capturées en parallèle dans une requête. |
| `DEFAULT_VIEWPORT_WIDTH` | `1280` | Largeur du viewport par défaut. |
| `DEFAULT_VIEWPORT_HEIGHT` | `800` | Hauteur du viewport par défaut. |
| `NAVIGATION_TIMEOUT_MS` | `30000` | Timeout `page.goto`. |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |

## Docker

### Build

```bash
docker build -t screenshot-diff:latest .
```

### Lancement (run direct)

```bash
docker run --rm -d \
  --name screenshot-diff \
  -p 3000:3000 \
  -v "$(pwd)/screenshots:/data" \
  -e HISTORY_SIZE=20 \
  -e DEFAULT_VIEWPORT_WIDTH=1440 \
  screenshot-diff:latest
```

Points de montage :

| Chemin conteneur | Rôle | Recommandation hôte |
|------------------|------|---------------------|
| `/data` | baselines + historique + diffs | volume nommé ou répertoire mis en cache par la CI |

### docker-compose

```bash
docker compose up -d
docker compose logs -f screenshot-diff
docker compose down
```

Voir `docker-compose.yml` pour les valeurs de variables et le montage du
volume `./screenshots:/data`.

### Persistance entre runs CI

Trois stratégies possibles :

1. **Cache CI** (`actions/cache`, GitLab `cache:`) — rapide, éphémère, propre
   à la branche.
2. **Repo dédié de baselines** — les PNG sont commités dans un repo séparé.
   Les changements visuels passent par une review.
3. **Volume distant** (NFS, S3 monté via FUSE) — utile en mono-runner
   long-vivant.

## Exemples d'appels

### Premier run (création des baselines)

```bash
curl -X POST http://localhost:3000/diff \
  -H 'content-type: application/json' \
  -d '{
    "threshold": 0.1,
    "urls": [
      "https://example.com/",
      "https://example.com/pricing"
    ]
  }'
```

→ HTTP 200, chaque résultat avec `"created": true`.

### Run de comparaison

```bash
curl -X POST http://localhost:3000/diff \
  -H 'content-type: application/json' \
  -d '{
    "threshold": 0.1,
    "viewport": { "width": 1440, "height": 900 },
    "urls": ["https://example.com/"]
  }'
```

→ HTTP 200 si `diffRatio * 100 <= threshold`, HTTP 422 sinon.

### Forcer la mise à jour des baselines (refonte CSS volontaire)

```bash
curl -X POST http://localhost:3000/diff \
  -H 'content-type: application/json' \
  -d '{
    "threshold": 100,
    "updateBaselineOnFailure": true,
    "urls": ["https://example.com/"]
  }'
```

### Faire échouer le job CI sur 422

```bash
curl -fsS -X POST http://localhost:3000/diff \
  -H 'content-type: application/json' \
  -d @visual-urls.json
# `-f` (--fail) renvoie un code de sortie ≠ 0 sur HTTP >= 400
```

### Pipeline GitHub Actions

```yaml
jobs:
  visual-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Restore screenshots cache
        uses: actions/cache@v4
        with:
          path: screenshots
          key: visual-regression-${{ github.ref_name }}
          restore-keys: visual-regression-main

      - name: Start screenshot-diff
        run: |
          docker run -d --name diff -p 3000:3000 \
            -v "$PWD/screenshots:/data" \
            -e HISTORY_SIZE=15 \
            ghcr.io/<org>/screenshot-diff:latest
          for i in {1..30}; do
            curl -fsS http://localhost:3000/healthz && break
            sleep 1
          done

      - name: Run visual diff
        run: |
          curl -fsS -X POST http://localhost:3000/diff \
            -H 'content-type: application/json' \
            -d @.github/visual-urls.json \
            -o diff-result.json

      - name: Upload artefacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: visual-diff
          path: |
            screenshots/history
            diff-result.json
```

### Pipeline GitLab CI

```yaml
visual-regression:
  image: docker:24
  services:
    - docker:24-dind
  cache:
    key: visual-regression-$CI_COMMIT_REF_SLUG
    paths: [screenshots/]
  script:
    - docker run -d --name diff -p 3000:3000
        -v "$PWD/screenshots:/data"
        -e HISTORY_SIZE=15
        $CI_REGISTRY_IMAGE/screenshot-diff:latest
    - until curl -fsS http://docker:3000/healthz; do sleep 1; done
    - |
      curl -fsS -X POST http://docker:3000/diff \
        -H 'content-type: application/json' \
        -d @ci/visual-urls.json
  artifacts:
    when: on_failure
    paths: [screenshots/history]
```

## Développement local

```bash
npm install
npx playwright install chromium
DATA_DIR=./screenshots npm run dev   # hot reload via tsx
npm test                              # tests unitaires (vitest)
npm run build                         # compile TS -> dist/
```

## Stack

- Node.js 20+ / TypeScript / ESM
- Playwright (Chromium)
- Express
- pixelmatch + pngjs
- zod (validation)
- vitest (tests)
