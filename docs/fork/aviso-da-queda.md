# O aviso da queda e da volta do número no grupo do cliente (MIA-48)

## O que faz

Quando um número de WhatsApp de um cliente cai, o **número de avisos** da plataforma manda **uma** mensagem no
grupo de avisos daquele cliente (o mesmo grupo do aviso da passagem do bastão) dizendo qual número caiu (o nome
do canal e o final do telefone) e o passo a passo para reconectar pelo QR Code. Quando o número volta, manda
uma mensagem curta confirmando.

Antes, só o grupo **interno** sabia da queda, pelo report da plataforma. O cliente só descobria quando um
consumidor reclamava que ninguém respondia.

## Os textos (o que o cliente recebe)

Queda (o link é o `NEXT_PUBLIC_APP_URL` da instalação):

```
⚠️ *Um número de WhatsApp de vocês caiu*

*Número:* Recepção (final 0002)

Enquanto ele estiver desconectado, a IA não recebe nem responde as mensagens que chegam nele.

*Como reconectar pelo QR Code:*
1. Abra https://<endereço da instalação>/app/connections
2. No cartão desse número, clique em *Reconectar*. Vai aparecer um QR Code.
3. No celular desse número, abra o WhatsApp e toque em *Dispositivos conectados* › *Conectar dispositivo*.
4. Aponte a câmera para o QR Code da tela e espere aparecer *Conectado!*

Se o QR Code expirar antes, clique em *Gerar novo QR*. Quando o número voltar, avisamos aqui.
```

Volta:

```
✅ *O número de WhatsApp voltou*

*Número:* Recepção (final 0002)

Ele está conectado de novo e a IA voltou a receber e responder as mensagens que chegam nele. Não precisa fazer mais nada.
```

Número sem nome aparece como `final 0002`. O telefone inteiro não vai para o grupo.

## As regras

- **Detecção:** a mesma do report interno. Caído é a sessão não arquivada com `status` diferente de `WORKING`
  e de `STARTING`. Para o cliente há mais dois recortes:
  - só o número **por QR** que já teve telefone pareado (o passo a passo é o do QR; a linha morta sem
    telefone é QR que ninguém leu, não queda);
  - a queda precisa durar **10 minutos** (`ESPERA_ANTES_DE_AVISAR_MIN`). O reinício do contêiner deixa a sessão
    `STOPPED` por um minuto até o vigia do worker religá-la, e sem a espera cada deploy viraria um "caiu" e um
    "voltou" no grupo de todos os clientes. O relógio é nosso (`numero_do_cliente_fora:<sessão>`), porque a
    ingestão regrava `last_status_change_at` a cada evento.
- **Trava anti-ruído:** `jaAvisou` do report, chave por sessão (`numero_do_cliente_caiu:<sessão>`), janela de
  24 horas. Um aviso por queda por dia, por mais que o cron rode. A queda que dura mais de um dia é lembrada
  uma vez por dia, como no report interno.
- **Volta:** só quando houve queda avisada e a volta dela ainda não saiu (`numero_do_cliente_voltou:<sessão>`
  mais antiga que a queda, ou ausente). Sem queda avisada, sem volta avisada.
- **Destino:** `destinoDoAviso` com a organização da sessão que caiu. É o que impede o aviso de um cliente de
  ir ao grupo de outro.
- **O número de avisos caiu:** nada sai para cliente; quem trata é o report interno. E, enquanto ele estiver
  fora, os avisos que sairiam por ele esperam (nada é marcado) e saem quando ele voltar. O cliente que escolheu
  um número próprio para os avisos (`settings.numero_de_avisos`) segue avisado por ele.
- **A chave por cliente:** `organizations.settings.aviso_da_queda_do_numero`. Vem **ligada**: só o `false`
  gravado desliga. Sem grupo de avisos configurado, ligada não manda nada. Sem migration.
- **Empresa parada** (suspensa, redigida) não recebe recado (`ehOperante`). A empresa de demonstração não pode
  ter grupo de avisos (o banco recusa, 9010), então nunca recebe.
- Se a chave for desligada (ou o grupo tirado) durante a queda, a volta é dada por fechada, sem recado: ela não
  sai dias depois quando alguém religar.
- **Não reconecta** o número (a regra do topo do `channel-health`) e não mexe no `session-reconciler`.
- O texto é só em português, como o aviso da passagem.

## Onde mora

- `lib/avisos/aviso-da-queda.ts`: a rodada (`avisarQuedasEVoltas`), os textos e o estado para o MCP
  (`estadoDoAvisoDaQueda`).
- `lib/avisos/chave-do-aviso-da-queda.ts`: a chave (`CHAVE_DO_AVISO_DA_QUEDA`, `avisoDaQuedaLigado`), pura.
- Chamado pelo cron `app/api/v1/cron/report-da-plataforma/route.ts` (de minuto em minuto), no passo **0b**,
  antes da saída "sem grupo de report": o aviso ao cliente não depende do grupo interno. O report interno
  (texto, chave `canal_caiu:<sessão>`, frequência) não mudou.
- As marcas ficam em `platform_avisos_enviados` (a tabela do report, 0258), com `organization_id` no `detalhe`.

## O volume das marcas

A marca da queda (`caiu`) e a da volta (`voltou`) nunca são apagadas, porque são a trava de 24 horas: ficam
duas linhas por número que já caiu um dia. Por isso a rodada nunca as lê todas. O PostgREST corta toda
resposta em 1000 linhas sem erro, e uma leitura cortada deixava o relógio de uma queda nova de fora: o cliente
nunca era avisado.

- O relógio (`fora:<sessão>`) é o que diz quais sessões importam. Ele começa antes de qualquer aviso de queda
  e só sai quando a volta é resolvida, quando a sessão é arquivada ou apagada, ou quando ela volta dentro da
  espera. Então só existe para quem está caído agora ou tem volta a dar. A leitura dele pagina
  (`range`, 1000 por página) com teto de 5000 e log quando bate o teto.
- O relógio é gravado só se não existir (`upsert` com `ignoreDuplicates`): regravar o começo a cada minuto
  faria a espera de 10 minutos nunca vencer.
- As marcas `caiu` e `voltou` são lidas pela chave, só das sessões que voltaram, em lotes de 100.
- O teto de **200 sessões caídas** vale por rodada. A consulta já só traz número por QR com telefone. Com mais
  de 200 caídas ao mesmo tempo, as que ficaram de fora entram nas rodadas seguintes.

## MCP de plataforma

- Escrita: `plataforma_configurar_atendimento`, campo `aviso_da_queda_do_numero` (operação
  `implantar_configuracao`), com auditoria `platform.aviso_da_queda_alterado`. Pedido igual ao gravado responde
  `ja_estava`.
- Leitura: `plataforma_ver_cliente`, `aviso_da_queda` (`ligada`, `grupo_configurado`, `vai_avisar`,
  `ultimo_aviso_de_queda`, `ultimo_aviso_de_volta`, com a data e o número); `plataforma_ver_configuracao`
  (seção `atendimento`) e o checklist (área `atendimento`) mostram a chave.
- O grupo de avisos continua sendo escolhido só pela tela (Admin › Número de avisos).

## Testes

- `lib/avisos/aviso-da-queda.test.ts`: uma queda, um aviso (o cron rodando de minuto em minuto por um dia); a
  espera; a volta; sem queda avisada, sem volta; cliente sem grupo; chave desligada; empresa suspensa; a Academia
  Alfa nunca no grupo da Academia Beta; o número de avisos caído; o estado para o MCP.
  E o volume: com 1200 marcas antigas e o corte de 1000 linhas do dublê (`maxRows`), a queda nova ainda é
  avisada e a volta ainda sai; a sessão arquivada durante a queda não deixa o relógio para sempre.
- `app/api/v1/cron/report-da-plataforma/route.test.ts`: a costura no cron, o report interno igual, o caso sem
  grupo interno e o do número de avisos caído.
- `tests/unit/mcp-de-implantacao-aviso-da-queda.test.ts`: a chave e o estado no MCP.
- `tests/unit/cron-respeita-org-operante.test.ts`: o cron saiu da lista dos isentos (agora fala com cliente, e
  filtra a empresa parada).
