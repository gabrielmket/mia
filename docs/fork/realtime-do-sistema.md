# Realtime do supabase-sistema-mia: semente desligada

O serviço `realtime` de `infra/supabase-sistema-mia/docker-compose.yml` sobe com
`SEED_SELF_HOST: "false"` (MIA-140, MIA-141, MIA-145). O banco de produção está com
`poll_interval_ms` = 500 desde 23/11/2026; a variável é trocada no painel do EasyPanel pelo Gabriel,
e este compose descreve o realtime depois dessa troca.

## Por quê

O realtime consulta o banco ("mudou alguma coisa?") no ritmo do `poll_interval_ms` do tenant
`realtime-dev` (`_realtime.extensions`, linha do tipo `postgres_cdc_rls`, campo
`settings.poll_interval_ms`). O padrão de fábrica é 100 ms. Medido em 23/11 (MIA-133), o
`realtime.list_changes` respondia por 79% de todo o tempo de execução do banco. O Gabriel aprovou
500 ms (MIA-141), e o valor foi trocado no banco de produção.

Com a semente ligada, o `run.sh` do realtime (v2.76.5) apaga o tenant `realtime-dev` e o cria de
novo a cada subida, com `poll_interval_ms` = 100. O intervalo aprovado voltaria a 100 no primeiro
reinício. Desligada, o tenant que está no banco fica como está, e os 500 ms continuam entre
reinícios.

## O que muda para quem opera

Qualquer mudança no tenant do realtime é escrita à mão no banco de produção, portanto só com
aprovação do Gabriel, e é ele ou a sessão dev quem faz.

1. **Trocar o `JWT_SECRET` do Supabase.** O tenant guarda a sua cópia do segredo e não pega o novo
   sozinho. Sem atualizar, o realtime recusa o token dos usuários e as telas deixam de atualizar
   ao vivo (mensagem nova, quadro, alertas), sem derrubar o resto. Depois de trocar o segredo,
   atualize o tenant `realtime-dev`. O realtime guarda o segredo do tenant cifrado com o
   `DB_ENC_KEY`, então não escreva na coluna direto: use a API de tenants do próprio realtime, ou
   ligue a semente por uma única subida e siga o item 3.
2. **Instalação nova ou banco recriado.** O esquema `_realtime` não entra no backup
   (`infra/supabase-sistema-mia/BACKUP.md`). Num banco novo não há tenant, e com a semente
   desligada o realtime sobe sem ele (o healthcheck consulta a saúde do tenant e falha). Ligue a
   semente na primeira subida e siga o item 3.
3. **Depois de qualquer subida com a semente ligada:** volte `SEED_SELF_HOST` para `"false"`, ponha
   de novo `settings.poll_interval_ms` = 500 no tenant e reinicie só o `realtime`. Leia o valor no
   banco depois do reinício para confirmar.

## Onde mexer

- A fonte é `infra/supabase-sistema-mia/docker-compose.yml`. O `docker-compose.inline.yml` sai dele
  pelo `node gerar-inline.mjs` (não edite o inline à mão).
- O `docker-compose.easypanel.yml` é o das imagens do app e não tem o realtime.
