# DeskcommCRM no EasyPanel

Instalação sem terminal na VPS: o EasyPanel puxa este repositório e sobe
`docker-compose.easypanel.yml`. O banco é preparado pelo serviço `bootstrap`
(extensões, schema, chave de cifra e o usuário dono), que roda a cada deploy.

## Arquivos

| arquivo | papel |
|---|---|
| `docker-compose.easypanel.yml` (raiz) | a stack: bootstrap, app, worker, waha, redis, srh, scheduler, caddy. Só `image:`, nada é compilado na VPS |
| `easypanel/bootstrap.sh` | prepara o banco, o mesmo que o `install.sh` faz nas etapas 7, 8 e 11 |
| `easypanel/Caddyfile` | proxy interno atrás do Traefik do EasyPanel: bloqueia o webhook global do WAHA e dá timeout longo ao agente |

## Passo a passo

### 1. Endereço (Cloudflare)

DNS de `timecompany.com.br` → **Add record**: tipo `A`, nome `crm`, IPv4 `177.136.225.108`,
**Proxy status: DNS only** (nuvem cinza). Existe um coringa `*` apontando para outro servidor;
o registro específico vale só para `crm` e não mexe no resto.

### 2. Banco (supabase.com)

1. **New project**, região **South America (São Paulo)**. Guarde a senha do banco.
2. Copie 4 valores para o bloco do Environment:
   - `NEXT_PUBLIC_SUPABASE_URL`: Project Settings › Data API › Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Project Settings › API Keys › aba **Legacy** › `anon`
   - `SUPABASE_SERVICE_ROLE_KEY`: mesma aba › `service_role` (secreta)
   - `SUPABASE_DB_URL`: botão **Connect** › **Session pooler** › URI, trocando `[YOUR-PASSWORD]`
     pela senha do banco. Nunca a "Direct connection" (só IPv6, não conecta da VPS).
     Senha com `@ : / # ?` precisa ser codificada (`@` = `%40`, `:` = `%3A`, `/` = `%2F`, `#` = `%23`, `?` = `%3F`).
3. **Authentication › URL Configuration**:
   - Site URL: `https://crm.timecompany.com.br`
   - Redirect URLs: `https://crm.timecompany.com.br/auth/confirm`

   Sem isso, "esqueci minha senha" e convites chegam com link para `localhost`.

### 3. EasyPanel

1. **+ Novo projeto** `deskcomm` › **+ Serviço** › **Compose**.
2. **Fonte: Git**
   - Repository URL: `https://github.com/gabrielmket/DeskcommCRM`
   - Branch: `main`
   - Build Path: `/`
   - Docker Compose File: `docker-compose.easypanel.yml`
3. **Environment**: o EasyPanel pré-preenche com o `.env.example` de desenvolvimento.
   **Apague tudo**, cole o bloco gerado para esta instalação, preencha as 4 linhas do
   Supabase e as 2 do dono, e ligue **Create .env file**.
4. **Domínios**: host `crm.timecompany.com.br`, HTTPS ligado, serviço **`caddy`**, porta **80**,
   protocolo interno HTTP.
5. **Deploy**. No primeiro deploy o `bootstrap` aplica o schema inteiro (alguns minutos);
   o app só sobe depois que ele termina. No painel ele aparece **parado**: é o esperado.

### 4. Primeiro acesso

`https://crm.timecompany.com.br` › entrar com `OWNER_EMAIL` e `OWNER_PASSWORD`.
No onboarding, deixe o WhatsApp do celular **já aberto em Aparelhos conectados** antes de
gerar o QR (ele expira em poucos minutos).

A chave de IA fica para depois: **IA › Credenciais** (cifrada no banco) e o provedor em
**Agente de IA › Provedores**.

Depois de entrar, apague a linha `OWNER_PASSWORD` do Environment e faça redeploy: o
bootstrap pula o dono quando ela está vazia.

### 5. Chamada de voz do WhatsApp (serviço `wacalls`)

⚠️ Liga um segundo aparelho ao número por caminho não oficial: o risco é o bloqueio da
CONTA do número. Cada organização aceita isso na tela antes de ler o QR.

1. **Antes** do deploy, acrescente ao Environment (sem apagar o resto):
   `WACALLS_ADMIN_USER`, `WACALLS_ADMIN_PASSWORD`, `WACALLS_API_TOKEN` (segredos gerados
   fora do repo), `WACALLS_PUBLIC_IP` (IP público da VPS), `WACALLS_WEBRTC_UDP_PORT=7881`
   e `WACALLS_API_BASE_URL=http://wacalls:8080`. Sem usuário e senha de administrador o
   contêiner não sobe (fica reiniciando).
2. Libere **UDP 7881 de entrada** no firewall do provedor da VPS.
3. Deploy. Na tela: **Configurações › Segurança** (aceitar o risco) e depois
   **Conexões › Chamada de voz** (ler o QR).

Desligar: esvazie `WACALLS_API_BASE_URL` e faça redeploy (a tela volta ao aviso).

## Quando algo não funciona

| sintoma | onde olhar |
|---|---|
| deploy falha e o app não sobe | logs do serviço `bootstrap`: ele diz qual variável falta ou por que não conectou |
| `network easypanel declared as external, but could not be found` | a rede do EasyPanel tem outro nome nesta VPS; troque `easypanel` no fim do compose |
| domínio mostra 404 ou 502 do painel | o domínio precisa apontar para o serviço `caddy`, porta 80, HTTP interno |
| cadeado não aparece | registro A ainda não propagou, ou está com a nuvem laranja da Cloudflare |
| app reiniciando | logs do `app`, procure `[env]` |
| `wacalls` reiniciando | log diz `no admin configured`: faltam `WACALLS_ADMIN_USER`/`WACALLS_ADMIN_PASSWORD` |
| ligação conecta e fica muda | `WACALLS_PUBLIC_IP` vazio/errado, ou UDP 7881 bloqueada no firewall do provedor |

## Atualizar

Não use o botão "Atualizar agora" da tela: ele depende de um agente instalado pelo
`install.sh`, que não existe aqui, e puxaria a versão do autor por cima deste fork.

Para trazer uma versão nova do autor: `git fetch upstream --tags`, junte na `main` do fork,
troque as tags `1.21.0` do compose (ou declare `APP_IMAGE`, `WORKER_IMAGE` e
`SCHEDULER_IMAGE` no Environment) e faça redeploy. O bootstrap re-aplica o schema em modo
update. Para rodar código próprio do fork, publique as imagens em
`ghcr.io/gabrielmket/...` (workflow `publish-image.yml`) e aponte as três variáveis para elas.
