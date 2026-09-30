# Backup diário do supabase-sistema-mia

O banco da plataforma MIA (crm.timecompany.com.br) e os arquivos do Storage são
copiados uma vez por dia, levados para fora da VPS criptografados e guardados
30 dias. Desde 29/09/2026.

Três peças, todas nesta pasta:

| Peça | Onde roda | O que faz |
|---|---|---|
| `backup/fazer-backup.sh` | serviço `backup` (imagem do mia-db) | grava a cópia do dia no volume `mia-backups` e marca `PRONTO` |
| `backup/enviar.sh` | serviço `backup-envio` (imagem do rclone) | leva cada cópia `PRONTO` para o drive, confere, marca `ENVIADO`, aplica a retenção |
| `backup/testar-restauracao.sh` | máquina da operação, com docker | baixa do drive, decifra e restaura num Postgres descartável: a prova |

Os dois serviços são separados de propósito: o que tem a senha do banco não tem
a credencial do Google, e o contrário. Nenhum dos dois entra na rede `easypanel`.

## O que é copiado

Uma pasta por dia, `AAAA-MM-DDTHHMMZ` (hora UTC), com o mesmo formato que o
`migrador/migrar.sh` já restaura (o caminho provado na virada):

| Arquivo | Conteúdo |
|---|---|
| `app.dir.tar` | `pg_dump -Fd -n public -n private`, com donos e GRANTs (o isolamento entre empresas mora nas políticas e GRANTs) |
| `auth_users.json`, `auth_identities.json` | o login, com o hash da senha: ninguém precisa trocar de senha |
| `storage_buckets.json`, `storage_objects.json` | os baldes e a lista de objetos (com tipo, cache e eTag de cada um) |
| `nuvem.txt` | contagem linha a linha de cada tabela do app, no instante do backup (o nome vem do migrador) |
| `storage.tar` | os arquivos do Storage, do volume `mia-storage` |
| `SHA256SUMS` | para conferir a cópia antes de restaurar |
| `relatorio.txt` | o resumo legível (tabelas, linhas, usuários, arquivos, tamanhos) |

Dump, JSON e contagem saem de UM snapshot (`pg_export_snapshot`): um usuário
criado no meio do backup não vira FK quebrada na restauração, e a contagem
sempre bate com o dump.

Não entra, porque o bootstrap do `deskcomm` recria a cada deploy: políticas do
Storage, gatilhos em `auth`, publicação do realtime. Sessões também não entram:
depois de uma restauração, todo mundo entra de novo uma vez.

## Quando

Todo dia às `BACKUP_HORA_UTC` (padrão `06` = 03:00 de Brasília). Serviço novo,
sem backup nenhum no volume, faz um na hora. Se falhar, tenta de novo a cada 30
min, até 3 vezes no dia. O envio olha o volume a cada 10 min.

Medido em 29/09/2026: 8 s e 23 MB para 147 tabelas e 337.493 linhas; o envio
leva cerca de 1 min.

## Onde fica

**Na VPS**, volume `mia-backups`: as `BACKUP_MANTER_LOCAL` (3) cópias mais
novas que já foram enviadas. Cópia que nunca foi enviada fica até 14 dias.

**No drive compartilhado do Google** `0AEPTfNuJL0Y-Uk9PVA`
(https://drive.google.com/drive/folders/0AEPTfNuJL0Y-Uk9PVA; único membro:
gabriel@timecompany.com.br):

```
LEIA-ME.txt                     o que é isto, para quem abrir o drive
backups/<AAAA-MM-DDTHHMMZ>/     a cópia do dia, criptografada (arquivos .bin)
relatorios/<AAAA-MM-DDTHHMMZ>.txt   o relatorio.txt ABERTO (sem dado pessoal)
```

**Retenção no drive**: `BACKUP_MANTER_DIAS` (30). Os 7 backups mais novos
nunca são apagados, mesmo velhos: se o backup parar, os últimos não vão embora
junto. O que sai vai para a lixeira do drive compartilhado (o rclone usa a
lixeira), onde o Google guarda mais 30 dias. Provado em 29/09/2026 com pastas
falsas: saiu só o que tinha mais de 30 dias E estava fora dos 7 mais novos, e o
relatório aberto saiu junto.

## Criptografia e senhas

`rclone crypt`: o CONTEÚDO de cada arquivo é cifrado (quem tem acesso ao drive
vê só `.bin` ilegível); os NOMES ficam abertos, para achar o dia. Depois de
subir, `rclone cryptcheck` compara o hash de cada arquivo do drive com o local
(sem baixar nada); só então a cópia é marcada `ENVIADO`.

A chave sai de duas variáveis, `BACKUP_CRIPTO_SENHA` e `BACKUP_CRIPTO_SAL`, no
formato `rclone obscure` (que é só embaralhamento, não proteção: trate como a
senha em si). Estão em:

- `Consultoria/DeskcommCRM-implantacao/ENV-SUPABASE-SISTEMA-MIA.txt` (também em texto aberto);
- `Consultoria/DeskcommCRM-implantacao/ENV-SUPABASE-SISTEMA-MIA.easypanel.txt` (o ambiente inteiro do serviço);
- o ambiente do serviço no EasyPanel.

**Sem as duas, nenhum backup se abre.** Guarde uma cópia num cofre de senhas.

## Credencial do Google

Em uso: `GOOGLE_DRIVE_TOKEN_B64`, o token OAuth da conta gabriel@ gerado por
`rclone authorize "drive"` (um clique do dono da conta, sem Google Cloud), em
base64 numa linha. O JSON original está em
`Consultoria/DeskcommCRM-implantacao/google-drive-backup-token.json`. O rclone
renova o acesso sozinho; o token só para se for revogado, se a conta sair do
drive, ou se passar 6 meses sem uso.

Alternativa já suportada: `GOOGLE_SA_JSON_B64`, o JSON de uma conta de serviço
membro "Gerente de conteúdo" SÓ deste drive (menos acesso; exige um projeto no
Google Cloud). Se as duas estiverem preenchidas, vale o token.

**Aviso do rclone (29/09/2026)**: o token usa o client_id compartilhado do
rclone para o Google Drive, que o rclone anuncia que vai parar de funcionar em
2026. Se o envio passar a falhar com erro de autorização mesmo com token novo, a
saída é a conta de serviço (acima), ou um client_id próprio criado no Google
Cloud (`rclone authorize "drive" <client_id> <client_secret>`, e o `enviar.sh`
passa a precisar de `RCLONE_CONFIG_GDRIVE_CLIENT_ID/SECRET`).

### Renovar o token

1. Na máquina da operação: `rclone authorize "drive"`. Abre o navegador: entrar
   como gabriel@timecompany.com.br e autorizar.
2. O rclone imprime um JSON: salvar em `google-drive-backup-token.json` (no
   lugar do antigo), sem colar em conversa nenhuma.
3. `base64 -w0 google-drive-backup-token.json` vira o novo
   `GOOGLE_DRIVE_TOKEN_B64`, nos dois arquivos `ENV-SUPABASE-SISTEMA-MIA*` e no
   ambiente do serviço no EasyPanel.
4. Deploy do `supabase-sistema-mia` (só o `backup-envio` muda). Conferir
   `operacao.backup_envio` (abaixo) em até 10 min.

Sem credencial ou sem senha, o `backup-envio` não derruba nada: fica parado
avisando, e o relato vai para `operacao.backup_envio`.

## Como conferir

Não há log central na VPS, então o log é uma tabela do próprio banco, no schema
`operacao` (fora do dump do app, da API e das migrations). No SQL do Studio
(sistema-db.timecompany.com.br) ou por psql:

```sql
select pasta, ok, etapa, detalhe, pg_size_pretty(bytes) as tamanho, tabelas, linhas,
       usuarios, objetos_storage, terminado_em, enviado_em, envio_detalhe
  from operacao.backup
 order by iniciado_em desc
 limit 10;

select visto_em, relato from operacao.backup_envio;
```

Tudo certo: o backup de hoje com `ok = true` e `enviado_em` preenchido; o
relato do envio começando com `ok:` e `visto_em` de menos de 20 min atrás.
Problema: `ok = false` (a `etapa` diz onde parou), `enviado_em` vazio há mais de
um dia, relato com `ERRO` ou `parado`.

No painel do EasyPanel, os dois contêineres têm healthcheck com sentido:
`backup` fica "unhealthy" se não houver cópia PRONTO de menos de 26 h;
`backup-envio`, se o último relato não for `ok` ou tiver mais de 30 min. Os logs
dos dois também estão lá.

No drive, `relatorios/<pasta>.txt` mostra o resumo de cada dia sem precisar
decifrar nada.

## Como restaurar

### 1. Baixar e decifrar

Numa máquina com docker. O arquivo de ambiente leva os segredos: criar com
`umask 077`, nunca colar em conversa, apagar no fim.

```bash
umask 077
cat > rclone.env <<'EOF'
RCLONE_CONFIG_GDRIVE_TYPE=drive
RCLONE_CONFIG_GDRIVE_SCOPE=drive
RCLONE_CONFIG_GDRIVE_TEAM_DRIVE=<BACKUP_DRIVE_ID>
RCLONE_CONFIG_GDRIVE_TOKEN=<o JSON de google-drive-backup-token.json, numa linha>
RCLONE_CONFIG_COFRE_TYPE=crypt
RCLONE_CONFIG_COFRE_REMOTE=gdrive:backups
RCLONE_CONFIG_COFRE_PASSWORD=<BACKUP_CRIPTO_SENHA>
RCLONE_CONFIG_COFRE_PASSWORD2=<BACKUP_CRIPTO_SAL>
RCLONE_CONFIG_COFRE_FILENAME_ENCRYPTION=off
RCLONE_CONFIG_COFRE_DIRECTORY_NAME_ENCRYPTION=false
EOF
docker run --rm --env-file rclone.env -v "$PWD:/out" rclone/rclone:1.75.1 lsf cofre: --dirs-only   # os dias
docker run --rm --env-file rclone.env -v "$PWD:/out" rclone/rclone:1.75.1 copy cofre:<pasta> /out/<pasta>
(cd <pasta> && sha256sum -c SHA256SUMS)
rm rclone.env
```

No Git Bash do Windows: `MSYS_NO_PATHCONV=1` antes do `docker run` e
`-v "$(cygpath -m "$PWD"):/out"`.

### 2. O banco, pelo caminho do migrador

O mesmo roteiro da virada (`VIRADA.md`, passos 2 a 4), com os arquivos do backup
no lugar dos da nuvem:

1. **Pilha limpa**: um `MIA_VOLUME_SUFIXO` novo (ex.: `-restauro`; declarar
   os volumes `mia-db-data-restauro`, `mia-db-config-restauro`,
   `mia-storage-restauro` e `mia-backups-restauro` na lista `volumes:` do
   compose) e `MIGRAR=off`; deploy. O volume antigo fica intacto. Conferir
   `/auth/v1/health` 200 no endereço público. (VPS nova: serviço novo a partir
   do git, sufixo vazio.)
2. **Os 5 arquivos no balde privado `migracao-da-nuvem`** do Supabase novo,
   pela API, com a service key dele:

   ```bash
   U=https://sistema-db.timecompany.com.br; K=<SERVICE_ROLE_KEY>; B=migracao-da-nuvem
   curl -s -X POST "$U/storage/v1/bucket" -H "apikey: $K" -H "Authorization: Bearer $K" \
     -H "Content-Type: application/json" -d "{\"id\":\"$B\",\"name\":\"$B\",\"public\":false}"
   for a in app.dir.tar auth_users.json auth_identities.json storage_buckets.json nuvem.txt; do
     curl -sf -o /dev/null -w "$a: HTTP %{http_code}\n" -X POST "$U/storage/v1/object/$B/$a" \
       -H "apikey: $K" -H "Authorization: Bearer $K" -H "Content-Type: application/octet-stream" \
       -H "x-upsert: true" --data-binary @"<pasta>/$a"
   done
   ```

   Limite: 50 MB por arquivo (`FILE_SIZE_LIMIT` do `storage` no compose). Se o
   `app.dir.tar` passar disso, subir o limite antes.
3. **`MIGRAR=virada`**; deploy. O `migrador` roda uma vez e sai. Conferir no log
   dele: `CONTAGEM IGUAL` (aqui o `nuvem.txt` é a contagem do instante do
   backup) e `auth.users` igual dos dois lados. Erros do pg_restore só de papel
   que não existe aqui são esperados.
4. **Os arquivos do Storage** (abaixo).
5. **Fechar**: `MIGRAR=off`; apagar o balde `migracao-da-nuvem`; deploy do
   `deskcomm` (o bootstrap recria políticas, gatilhos e realtime). Se o
   endereço público mudou: `NUVEM_URL_PUBLICO` = o endereço ANTIGO antes do
   passo 3 (o migrador reescreve os links) e o `deskcomm` apontado para o novo
   (`VIRADA.md`, passo 6).

### 3. Os arquivos do Storage

Pela API, nunca desempacotando no volume: o storage-api guarda tipo e cache em
atributos que o tar não leva. Cada objeto está no `storage.tar` em
`stub/stub/<balde>/<nome>/<versão>` (`stub` = `GLOBAL_S3_BUCKET` e
`STORAGE_TENANT_ID`), e o tipo e o cache estão no `storage_objects.json`. Depois
do passo 3 do banco (os baldes já existem):

```bash
mkdir -p <pasta>/storage && tar -C <pasta>/storage -xf <pasta>/storage.tar
cd <pasta> && NOVO_URL=https://sistema-db.timecompany.com.br NOVO_SERVICE_KEY=<SERVICE_ROLE_KEY> \
node --input-type=module -e '
import { readFileSync } from "node:fs";
const { NOVO_URL: U, NOVO_SERVICE_KEY: K } = process.env;
const objetos = JSON.parse(readFileSync("storage_objects.json", "utf8"));
const caminho = (s) => s.split("/").map(encodeURIComponent).join("/");
let ok = 0;
for (const o of objetos) {
  const arq = ["storage/stub/stub", o.bucket_id, o.name, o.version].filter(Boolean).join("/");
  const r = await fetch(`${U}/storage/v1/object/${encodeURIComponent(o.bucket_id)}/${caminho(o.name)}`, {
    method: "POST",
    headers: { apikey: K, Authorization: `Bearer ${K}`, "x-upsert": "true",
               "Content-Type": o.metadata?.mimetype || "application/octet-stream",
               "cache-control": o.metadata?.cacheControl || "max-age=3600" },
    body: readFileSync(arq),
  });
  if (r.ok) ok++; else console.log("FALHA", o.bucket_id, o.name, r.status);
}
console.log(`subidos: ${ok} de ${objetos.length}`);'
```

Conferir: `subidos: N de N`, com N = `objetos_storage` do backup.

## A prova de restauração

Backup que nunca foi restaurado não é backup. `testar-restauracao.sh` baixa um
backup do drive, decifra e restaura num Postgres descartável com a MESMA imagem
da produção, e prova: (1) cada arquivo bate com o `SHA256SUMS`; (2) o login
entra; (3) o app restaura com a contagem linha a linha IGUAL à do backup; (4)
cada objeto do Storage tem o seu arquivo no `storage.tar`, com md5 igual ao
eTag. Apaga tudo no fim.

```bash
# segredos lidos do ENV-SUPABASE-SISTEMA-MIA.easypanel.txt para variáveis, sem imprimir
export BACKUP_DRIVE_ID=... BACKUP_CRIPTO_SENHA=... BACKUP_CRIPTO_SAL=...
export GOOGLE_DRIVE_TOKEN=<caminho de google-drive-backup-token.json>
bash backup/testar-restauracao.sh --drive            # o mais novo
bash backup/testar-restauracao.sh --drive <pasta>    # um dia específico
bash backup/testar-restauracao.sh <pasta-local>      # uma cópia já decifrada
```

Rodada em 29/09/2026, do drive real: `RESTAURAÇÃO OK`, 7 arquivos intactos,
147 tabelas e 337.493 linhas iguais, Storage 50 de 50, em 1m41s (cópia de
teste). E no primeiro backup de produção, `2026-09-29T0434Z`, com as chaves do
arquivo local (prova de que o servidor cifra com a mesma senha): 148 tabelas e
348.771 linhas iguais, Storage 51 de 51, em 1m10s. Vale repetir uma vez por mês
e depois de qualquer mudança nos scripts.

## Variáveis

| Variável | Serviço | Padrão | Para quê |
|---|---|---|---|
| `BACKUP_HORA_UTC` | backup | `06` | hora do backup diário (UTC) |
| `BACKUP_MANTER_LOCAL` | backup | `3` | cópias já enviadas que ficam na VPS |
| `BACKUP_MANTER_DIAS` | backup-envio | `30` | dias no drive (os 7 mais novos ficam sempre) |
| `BACKUP_DRIVE_ID` | backup-envio | vazio | o drive compartilhado |
| `BACKUP_CRIPTO_SENHA`, `BACKUP_CRIPTO_SAL` | backup-envio | vazio | a chave da criptografia (formato `rclone obscure`) |
| `GOOGLE_DRIVE_TOKEN_B64` | backup-envio | vazio | token OAuth do gabriel@, em base64 |
| `GOOGLE_SA_JSON_B64` | backup-envio | vazio | alternativa: conta de serviço, em base64 |

Os dois scripts aceitam `BACKUP_UMA_VEZ=sim` (uma volta e sai) para teste, e o
`enviar.sh` aceita `BACKUP_RAIZ_DRIVE` para mandar a outra pasta (o teste usou
`gdrive:teste-backup/`).
