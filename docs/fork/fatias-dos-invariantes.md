# As fatias dos invariantes de banco na CI

Desde a MIA-346 (28/11/2026). Peça só do fork: o upstream roda `test:db` numa perna só por major.

## 1. O que é

O job `invariants-majors` do `ci.yml` roda a suíte de banco (`pnpm test:db`, ~780 arquivos de
`tests/invariants`, em série, um banco novo por arquivo) numa matriz **major do Postgres × fatia**.
São **4 fatias** por major (`--shard=N/4`). O agregado `invariants`, que é o check obrigatório, só
fica verde se todas as fatias de todas as majors passarem.

## 2. Por que por peso, e não pelo hash do vitest

Medido em 28/11/2026 em 33 jobs de 7 rodadas verdes do `ci.yml` (tabela completa na MIA-346):

| parte da fatia | tempo |
|---|---|
| preparar o runner (checkout, Node, pnpm) | 0,4 a 0,8 min |
| subir o Postgres | ~0,2 min |
| aplicar o schema (os dois baselines, install + update) | 0,1 a 0,4 min |
| vitest | 12 a 27 min |

O peso é teste, não schema: guardar o banco com o baseline aplicado economizaria menos de meio
minuto por fatia. O problema era a divisão. O `--shard` do vitest ordena os arquivos pelo hash do
caminho e corta em pedaços com o mesmo número de arquivos, e 6 arquivos somam 24% do tempo (o mais
pesado leva ~165 s; a mediana é ~1 s). A fatia que recebia os pesados era sempre o caminho crítico:
com 3 fatias, a 1 levava 18 a 27 min e a mais leve 12 a 17.

Agora quem corta é o sequenciador da suíte (`vitest.fatias.ts`, ligado em `vitest.db.config.ts`): maior peso primeiro, cada arquivo vai para a fatia mais leve até ali. A
divisão é determinística, então cada fatia a calcula sozinha e as quatro somam a suíte inteira. A
ordem dentro da fatia continua sorteada (issue #207), com a semente no log como antes.

O sequenciador e a tabela moram na raiz, e não em `tests/`: `vitest.db.config.ts` os importa e entra
na imagem, onde `tests/` não entra (`.dockerignore`). Em `tests/` o `next build` quebraria (TS2307);
quem guarda é `tests/unit/pr-mexe-na-imagem.test.ts`.

## 3. A tabela de pesos

`vitest.fatias.pesos.json`: segundos medidos por arquivo (mediana), só os de 5 s ou mais.
Arquivo fora da tabela (novo, ou leve) pesa 1,2 s. Mais 0,6 s fixos por arquivo (o banco copiado do
molde e o import).

Tabela velha **não deixa teste de fora**, só desequilibra. Refaça quando uma fatia passar a levar
bem mais que as outras ou quando entrar um invariante pesado:

```bash
for r in <id1> <id2> <id3>; do gh run view "$r" -R gabrielmket/mia --log > "/tmp/ci-$r.log"; done
node scripts/peso-dos-invariantes.mjs /tmp/ci-*.log
```

Use rodadas verdes. O script lê as linhas `✓ tests/invariants/... (N tests) 1234ms` do vitest.

## 4. O que protege

- `tests/unit/fatia-por-peso.test.ts`: com 1 a 6 fatias, todo arquivo roda exatamente uma vez;
  arquivo novo cai numa fatia só; a divisão não depende da ordem de entrada; as 4 fatias ficam
  equilibradas; a config usa o sequenciador; a ordem é sorteada pela semente.
- `tests/unit/invariants-majors-em-fatias.test.ts`: a lista `fatia:` da matriz e o N do `--shard`
  são o mesmo número, a fatia está no `concurrency:`, o `update.sh` roda na fatia 1.

## 5. Conferir depois de uma fusão

1. `git grep -n "sequencer: SequenciadorDosInvariantes" vitest.db.config.ts` (se a fusão reescrever
   a config, o corte volta ao hash sem nenhum teste de banco reprovar).
2. `git grep -n "fatia: \[1, 2, 3, 4\]\|--shard=\${{ matrix.fatia }}/4" .github/workflows/ci.yml`.
3. `npx vitest run tests/unit/fatia-por-peso.test.ts tests/unit/invariants-majors-em-fatias.test.ts`.

## 6. Riscos

- A suíte depende de `BaseSequencer` de `vitest/node`. Numa major nova do vitest, conferir se o
  sequenciador próprio ainda é respeitado com `--sequence.shuffle.files=true` (no 4.1, a config só
  troca para o sorteador dele quando não há sequenciador declarado).
- Uma fatia a mais é um job a mais por major. Com o executor hospedado, a fila do Actions conta:
  numa rodada com muita coisa ao mesmo tempo, a espera por runner pode comer parte do ganho.
