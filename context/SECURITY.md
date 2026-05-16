# Blindspot — Reglas de Seguridad para Ejecución Autónoma

> Este archivo debe leerse ANTES de ejecutar cualquier acción en modo autónomo o manual.
> Las reglas BLOQUEADAS son absolutas — no hay excepciones por conveniencia o eficiencia.

---

## Comandos BLOQUEADOS — nunca ejecutar

```
BLOQUEADO: pnpm run discover
BLOQUEADO: pnpm run discover-external -- --source google_places
BLOQUEADO: blindspot discover (cualquier variante)
BLOQUEADO: blindspot discover-external --source google_places
BLOQUEADO: git push (ninguna variante — ni --force, ni --tags)
BLOQUEADO: git push --force
BLOQUEADO: pnpm add <paquete> (sin aprobación explícita del usuario)
BLOQUEADO: npm install (fuera del entorno controlado)
BLOQUEADO: curl / wget a APIs externas de pago
BLOQUEADO: docker rm / docker rmi (contenedores de Supabase)
BLOQUEADO: docker compose down (apaga la DB local)
```

Si alguna fase de FUTURE.md requiere un comando bloqueado → **STOP CONDITION inmediata**.
Registrar `fase-bloqueada-google` o `fase-requiere-research` según corresponda.

---

## Operaciones de DB BLOQUEADAS

```sql
-- BLOQUEADO: elimina todos los datos
DROP TABLE leads;
DROP TABLE lead_buyer_scores;
TRUNCATE leads;
TRUNCATE lead_buyer_scores;

-- BLOQUEADO: DELETE sin WHERE filtrante específico
DELETE FROM leads;
DELETE FROM leads WHERE passed_filter = true;  -- afecta todos los leads calificados

-- BLOQUEADO: ALTER TABLE que elimine columnas
ALTER TABLE leads DROP COLUMN <cualquier_campo>;

-- BLOQUEADO: UPDATE masivo sin condición específica
UPDATE leads SET prospect_score = NULL;
UPDATE leads SET passed_filter = false;
```

---

## Operaciones de DB PERMITIDAS

```sql
-- PERMITIDO: lecturas de diagnóstico
SELECT COUNT(*), MIN(prospect_score), MAX(prospect_score) FROM leads WHERE passed_filter = true;

-- PERMITIDO: UPDATE de re-scoring (vía app layer, no SQL directo)
-- Usar: pnpm run score -- --all
-- No usar: UPDATE leads SET prospect_score = X directamente en bulk

-- PERMITIDO: migraciones aditivas (ADD COLUMN, CREATE INDEX, CREATE TABLE)
ALTER TABLE leads ADD COLUMN nueva_columna text;
CREATE INDEX IF NOT EXISTS idx_leads_niche ON leads(niche);
CREATE TABLE nueva_tabla (...);

-- PERMITIDO: INSERT en tablas de configuración o historial
INSERT INTO pipeline_config (...) VALUES (...);
INSERT INTO pipeline_runs (...) VALUES (...);
```

Toda migración debe seguir el protocolo de AUTONOMOUS.md § "Migraciones de DB".

---

## Presupuesto Google Places API

| Ítem | Valor |
|------|-------|
| Crédito total | $200.00 |
| Gastado | ~$5.16 |
| **Saldo restante** | **~$194.84** |
| Costo por request | ~$0.02 |
| Requests disponibles estimados | ~9,740 |

### Regla de gasto

- **Costo máximo por sesión autónoma:** $0.00 — las sesiones autónomas NO deben llamar a Google Places.
- Si una fase requiere Google Places → STOP CONDITION `fase-bloqueada-google`.
- El usuario decide manualmente cuándo y cuántos requests de Google Places ejecutar.

### Fuentes GRATUITAS (permitidas en modo autónomo)

| Fuente | Costo | Notas |
|--------|-------|-------|
| `mintur` | $0 | Scraping MINTUR, sin API key |
| `osm` (OpenStreetMap) | $0 | API pública, sin autenticación |
| `yelu` | $0 | Scraping Yelu.com.uy |
| `pedidosya` | $0 | Scraping PedidosYa (modo read-only) |
| `imm_habilitaciones` | $0 | Dataset público IMM |
| `infonegocios` | $0 | Scraping Infonegocios.uy |

Solo usar estas fuentes en tests controlados. Ver restricción de discovery más abajo.

---

## Discovery en modo autónomo — restricciones

El modo autónomo **NO ejecuta discovery real** salvo en tests controlados con fixtures.

```bash
# BLOQUEADO en modo autónomo — llama fuentes externas reales
pnpm run discover-external -- --source mintur
pnpm run discover-external -- --source osm

# PERMITIDO — tests con fixtures locales (sin red real)
pnpm test tests/discovery/providers/osm.test.ts
pnpm test tests/discovery/providers/pedidosya.test.ts
```

Los tests de discovery deben usar mocks de red (nock, msw, o fixtures JSON).
Si un test de discovery llama a la red real → es un bug en el test, no en el código.

---

## Git — restricciones

```bash
# PERMITIDO
git add <archivos-específicos>
git commit -m "tipo: descripción"
git status
git diff
git log --oneline -10
git stash
git stash pop

# BLOQUEADO
git push (cualquier variante)
git push --force
git push --tags
git reset --hard HEAD~N  # destruye commits
git clean -fd            # elimina archivos sin trackear
git checkout -- .        # descarta cambios sin staging
```

El usuario hace `git push` manualmente cuando decide que el trabajo está listo para compartir.

---

## Paquetes y dependencias

```bash
# BLOQUEADO sin aprobación explícita
pnpm add <paquete>
pnpm add -D <paquete>
npm install <paquete>
pnpm remove <paquete>

# PERMITIDO siempre
pnpm install          # instala lo que ya está en package.json
pnpm test
pnpm typecheck
pnpm run score
pnpm run enrich
pnpm run maintain
```

Si una fase requiere una nueva dependencia → presentar la propuesta al usuario y esperar aprobación.
No instalar paquetes especulativamente "por si acaso".

---

## Red y acceso externo

En modo autónomo, el único acceso de red permitido es a `localhost` (DB local y Supabase local).

```
PERMITIDO:  localhost:5432 (PostgreSQL)
PERMITIDO:  localhost:54321 (Supabase Studio)
BLOQUEADO:  cualquier dominio externo durante ejecución autónoma
BLOQUEADO:  fetch/axios/got a URLs externas en código de producción (solo en tests con mocks)
```

---

## Entorno de DB

Solo existe una DB: **local** (Docker, `supabase_db_gap-radar`).

```bash
# Único comando permitido para consultas directas
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "<query>"

# BLOQUEADO — conectar a cualquier instancia remota
psql postgresql://... (URLs remotas)
supabase db push        # sincroniza con Supabase cloud
supabase link           # vincula a proyecto cloud
```

No existe entorno de staging ni producción activo. Todo es local.

---

## Variables de entorno y secretos

```bash
# BLOQUEADO — exponer en output, logs, o código
echo $GOOGLE_PLACES_API_KEY
console.log(process.env.SUPABASE_SERVICE_KEY)

# BLOQUEADO — hardcodear en código
const API_KEY = "AIzaSy..."

# PERMITIDO — acceder en runtime via process.env
const key = process.env.GOOGLE_PLACES_API_KEY
```

Si un archivo de código nuevo requiere una API key → usar `process.env.X` y documentar en `.env.example`.
Nunca commitear `.env` ni `.env.local`.

---

## Verificación de seguridad antes de commitear

Antes de cada `git commit` en modo autónomo, verificar mentalmente:

- [ ] No hay `console.log` con datos sensibles
- [ ] No hay API keys hardcodeadas
- [ ] No hay código que llame a Google Places
- [ ] No hay código que borre datos sin WHERE específico
- [ ] El diff no incluye archivos `.env`
- [ ] Los tests no llaman a la red real (usan mocks)
- [ ] Los tipos de TypeScript son correctos (typecheck pasa)

---

## Tabla de referencia rápida

| Acción | Estado | Motivo |
|--------|--------|--------|
| `pnpm test` | ✅ SIEMPRE | Verificación estándar |
| `pnpm typecheck` | ✅ SIEMPRE | Verificación estándar |
| `pnpm run score -- --all` | ✅ PERMITIDO | Solo DB local |
| `pnpm run enrich -- --limit 10` | ✅ PERMITIDO | Solo DB local |
| `git commit` | ✅ PERMITIDO | Local, reversible |
| `git push` | ❌ BLOQUEADO | Acción externa irreversible |
| `pnpm add X` | ⚠️ APROBACIÓN | Modifica dependencias |
| `pnpm run discover-external` | ❌ BLOQUEADO | Puede gastar API budget |
| `pnpm run discover` | ❌ BLOQUEADO | Llama Google Places API |
| `DROP TABLE / TRUNCATE` | ❌ BLOQUEADO | Destruye datos irreversiblemente |
| `DELETE FROM leads` (sin WHERE) | ❌ BLOQUEADO | Destruye datos |
| `ALTER TABLE ... DROP COLUMN` | ❌ BLOQUEADO | Migración destructiva |
| `docker compose down` | ❌ BLOQUEADO | Apaga DB local |

---

## Protocolo de stop por violación de seguridad

Si durante la ejecución autónoma se detecta que un paso requiere una acción bloqueada:

1. **No ejecutar** la acción bloqueada.
2. Registrar en `AUTONOMOUS.md § ESTADO`: razón del stop, acción bloqueada, fase afectada.
3. Commitear solo los archivos `context/` modificados hasta ese punto.
4. Mostrar al usuario:
   - Qué fases se completaron correctamente
   - Qué acción bloqueada se detectó
   - Qué decisión necesita tomar el usuario para continuar

El usuario puede entonces ejecutar la acción manualmente (ej: `git push`, `pnpm run discover`) con plena consciencia del costo o riesgo.
