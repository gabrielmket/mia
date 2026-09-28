# Virada: a plataforma sai do Supabase da nuvem para o supabase-sistema-mia

Roteiro da troca, na ordem. Cada passo diz o que confere antes de seguir.
Contexto e decisões: cabeçalho de `docker-compose.yml` e de `migrador/migrar.sh`.

## Pré-requisito que só o dono da conta libera

O Supabase novo precisa de endereço público com HTTPS (o navegador do usuário
fala com o login e o realtime). O domínio padrão do EasyPanel
(`*.ikox1m.easypanel.host`) resolve para 37.27.42.115, que NÃO aceita conexão de
fora; o IP público da VPS é 177.136.225.108. Uma das duas:

1. DNS: `sistema-db.timecompany.com.br` tipo A → 177.136.225.108, e o domínio
   cadastrado no serviço apontando para `mia-kong:8000`; ou
2. Rota no domínio do CRM: `crm.timecompany.com.br/supabase` → `mia-kong:8000`
   (o supabase-js aceita URL com caminho; o Studio não funciona sob caminho).

Depois de escolher: `SUPABASE_PUBLIC_URL` e `API_EXTERNAL_URL` do serviço viram
esse endereço, e deploy do serviço.

## Virada

1. **Parar o deskcomm** (`clientes/deskcomm`). Sem app e worker, ninguém escreve
   na nuvem — e o pooler dela libera conexões para o dump em paralelo.
2. **Volume limpo**: `MIA_VOLUME_SUFIXO=` (vazio) e `MIGRAR=off` no serviço;
   deploy. Conferir: `/auth/v1/health` 200 no endereço público.
3. **Preparar** (fora da VPS, onde há leitura da nuvem):
   `NUVEM_DB_URL=… DESTINO_URL=<endereço> DESTINO_SERVICE_KEY=<service key do novo> DUMP_JOBS=4 bash preparar-migracao.sh`.
   Conferir: os 5 arquivos com HTTP 200 no balde `migracao-da-nuvem`.
4. **Migrar**: `MIGRAR=virada`; deploy. O `migrador` roda uma vez e sai.
   Conferir: "CONTAGEM IGUAL", `auth.users` nuvem = aqui, e os erros do
   pg_restore (esperados só os de papel que só existe na nuvem).
5. **Arquivos do Storage**: `node copiar-storage.mjs objetos-do-storage.json`
   com `NUVEM_URL`, `NUVEM_SERVICE_KEY`, `NOVO_URL`, `NOVO_SERVICE_KEY`.
   Conferir: "copiados: 51 de 51".
6. **Apontar o deskcomm** para o novo: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e
   `SUPABASE_DB_URL=postgresql://postgres:<senha>@supabase-sistema-mia-db:5432/postgres`.
   A `main` precisa conter o `docker-compose.easypanel.yml` com bootstrap, app e
   worker na rede `easypanel` (sem isso eles não enxergam o banco). Deploy do
   deskcomm com as MESMAS imagens em produção.
7. **Conferir**: `/api/v1/health` com `supabase.status=ok` e `schema.em_dia=true`;
   login de um usuário real; uma mensagem entrando e saindo no WhatsApp.
8. **Fechar**: `MIGRAR=off`; apagar o balde `migracao-da-nuvem` (o dump tem
   todos os dados); anotar a data. A nuvem fica intacta 14 dias como plano B.

## Volta (se o passo 7 falhar)

Devolver as 4 variáveis do deskcomm para os valores da nuvem e deploy. O que
entrou depois da virada fica só no banco novo.
