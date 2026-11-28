# Área de cobrança e o lado da Time (fork MIA, .96, segunda frente)

A empresa que já é cliente vê, em **Configurações › Plano e cobrança**, as cobranças com a nota
fiscal e o recibo de cada uma, paga a que está em aberto, troca o cartão das próximas mensalidades,
corrige os dados fiscais e pede a correção de uma nota que saiu errada. A Time vê, em **Admin ›
Empresas do cadastro**, o funil dos últimos 30 dias, a situação do pagamento de cada empresa e, só
depois de 30 dias sem nenhum pagamento, o botão "Apagar o cadastro".

O protótipo clicável foi aprovado pelo Gabriel em 27/10/2026
(`Projeto sistema MIA/Produto/Prototipo-pagamento-no-inicio-2026-10-27.html`, telas 3 e 4, decisões
5, 9, 10 e 11). Esta frente mora por cima da primeira ([`pagamento-no-inicio.md`](pagamento-no-inicio.md)):
usa os dados fiscais (`lib/dados-fiscais/`), a camada do Asaas (`lib/asaas-mia/`) e o retrato do
passo do pagamento (`mia_pagamento_inicial`) sem redefinir nada deles.

---

## 1. A área de cobrança (tela 3, decisão 9)

A tela que já existe (`app/app/settings/billing/page.tsx`, ponto `FORK MIA (.96)`) ganha, depois do
plano, do uso e da troca de plano, a área (`components/area-de-cobranca/AreaDeCobranca.tsx`). A
leitura é `lib/area-de-cobranca/leitura.ts`:

- **Cobranças**: as do cliente do Asaas DA EMPRESA (`provedor_cliente_id`), as 36 mais novas, com o
  mês, o valor, a forma e a situação: paga (com a data), em aberto (com o vencimento), vencida,
  cancelada (sem nota), estornada, em análise.
  - **Paga**: "Nota PDF" e "XML" (da nota emitida pelo Asaas; a emitida vale sobre a cancelada, que
    é a errada que a Time substituiu) e "Recibo" (o comprovante do Asaas). Nota que ainda não saiu,
    ou que está saindo, aparece assim.
  - **Em aberto ou vencida**: "Pagar agora" (a fatura do Asaas) e "Segunda via" (o PDF do boleto, ou
    a fatura quando não há boleto). No cartão, a tela diz em que dia ele é cobrado.
  - **Cancelada**: "Cobrança que não foi paga e foi cancelada. Não gera nota."
- **Forma de pagamento**: o cartão atual (final e bandeira) e o dia da próxima mensalidade. O cartão
  sai, nesta ordem, do que o Asaas diz da assinatura; do trocado aqui (9125) para ESTA assinatura,
  se a troca for mais nova que a última mensalidade paga no cartão; da última mensalidade paga no
  cartão; do cartão do passo do pagamento. Assinatura no Pix ou boleto mostra "Cadastrar um cartão".
- **Dados fiscais**: ver e editar (seção 3).
- Os links são do Asaas e só `https` (`linkSeguro`); a MIA lista, o cliente não vai ao painel do Asaas.
- O Asaas que não responde não derruba a tela: a lista diz que não leu e a forma e os dados fiscais
  aparecem pelo banco. Cobrança desligada, ou empresa cobrada por outro provedor: a área não aparece.

**Quem vê (decisão 11)**: só o ADMINISTRADOR. A página inteira já era só dele (`/403` para os
outros papéis, spec 13 §4), e a área ainda confere o papel de novo (`roleAtLeast`). As três rotas
exigem `requireRole("admin")`, a guarda do acompanhamento (`requireSupportWrite`) e a cobrança
ligada, e a empresa parada não entra (quem espera o primeiro pagamento usa o passo do início; quem
atrasou, o hub de suspensão).

## 2. Trocar o cartão, fora dos registros

`POST /api/v1/cobranca/area/cartao` → `trocarCartaoDaArea` (`lib/area-de-cobranca/servico.ts`). O
cartão novo vai para a ASSINATURA do Asaas pelo checkout transparente (`cartaoNaAssinatura`, da
primeira frente, com o token nulo): `updateCreditCard` e a assinatura passa a `CREDIT_CARD`. **Nada é
cobrado na hora**; as próximas mensalidades caem nele.

- A rota lê o corpo sem deixar a mensagem do parse escapar e confere o cartão dizendo só o campo
  (`conferirCartao`), como a do passo do pagamento.
- A camada do Asaas nunca registra o corpo e devolve só o `code` do erro.
- Do cartão, o banco recebe o final de 4 números e a bandeira (pelos primeiros números,
  `bandeiraPeloNumero`, que devolve só a bandeira) em `mia_cartao_das_mensalidades` (9125, CHECK de
  4 dígitos), com a assinatura, quando e quem. A auditoria leva só o resultado
  (`area_de_cobranca.cartao_trocado`).
- O titular vem dos dados fiscais e o telefone é o WhatsApp deles (o Asaas exige); sem ele, a tela
  pede para preencher em Dados fiscais.
- A tela limpa o código de segurança depois de enviar e chama a rota por `fetch` direto (o cliente
  de API repete 503).

**A prova**: `tests/unit/area-de-cobranca-cartao-fora-dos-registros.test.ts` reprova a versão se o
número (com ou sem espaços) ou o código de segurança aparecerem em qualquer `console.*`, no Sentry,
na auditoria, numa cadeia do banco (escrita ou leitura) ou na resposta, nos caminhos: corpo que não
é JSON, cartão inválido, recusa com a descrição do Asaas ecoando o cartão, rede que cai com o corpo
na mensagem e troca aprovada (que prova também que nenhum pagamento é feito).

## 3. Os dados fiscais pela área (decisão 10)

`POST /api/v1/cobranca/area/dados-fiscais` → `salvarDadosFiscaisDaArea`. O administrador edita a
razão social, o endereço, as inscrições e o WhatsApp. **O CPF ou CNPJ e o tipo não mudam por ali**:
a tela mostra o documento travado (`CamposFiscais` com `documentoTravado`) e o servidor usa o que
está gravado, gravando com `permitirTrocarDocumento: false`. Trocar o titular é pedido à Time. A
empresa que ainda não tem dados fiscais (anterior à .96) preenche tudo uma vez.

Ao salvar, o cliente do Asaas recebe na hora (`garantirClienteFiscal`, avisos do Asaas desligados) e
a tela diz "Valem a partir da próxima nota". O Asaas fora não impede a gravação: a rodada da
primeira frente leva depois (`asaas_sincronizado_em` nulo), e a área avisa que a versão nova ainda
vai para o Asaas.

## 4. "A nota saiu errada" (decisão 10)

Em cada cobrança paga com nota, o botão abre o pedido: o que está errado (razão social ou nome,
CNPJ ou CPF, endereço, valor ou serviço, outra coisa) e o texto. `POST /api/v1/cobranca/area/nota-errada`
→ `pedirCorrecaoDaNota`:

- a cobrança é procurada entre as do cliente do Asaas DA EMPRESA e precisa estar paga (cobrança de
  outra empresa não é achada);
- vira um **chamado** do sistema de chamados do assistente (.88, `mia_chamados`), tipo pedido, aberto
  pela SESSÃO de quem pede (o gatilho `fn_mia_chamado_nasce` carimba a pessoa, o número e a
  demonstração), com o texto para a Time (a nota, o mês, o valor, o motivo e o que a pessoa
  escreveu) e a marca `contexto.cobranca` (`ref`, a nota, o motivo);
- a Time recebe o recado no grupo interno (nunca da demonstração), responde em Admin › Chamados ou
  pelo `plataforma_responder_chamado`, cancela a nota no Asaas e emite outra;
- a cobrança mostra "correção pedida · chamado nº X" enquanto o chamado está aberto e "correção
  respondida" depois; com o chamado aberto, um segundo pedido é recusado;
- auditoria `area_de_cobranca.nota_errada_pedida`: o número do chamado, o motivo e a cobrança, nunca
  o texto.

## 5. O lado da Time (tela 4, decisão 5)

Em `app/admin/(protected)/empresas-do-cadastro/page.tsx` (pontos `FORK MIA (.96)`):

- **Funil do cadastro, últimos 30 dias** (`fn_mia_funil_do_cadastro`, 9126): escolheram um plano no
  site (a conta criada com o plano escolhido, `auth.users` com `cobranca_plan_id`), criaram a conta
  (empresas nascidas pelo cadastro próprio, `mia_origem_da_empresa`), pagaram, esperando o pagamento
  e, fora da janela, sem pagamento há mais de 30 dias.
- **Coluna "Situação do pagamento"** (`lib/pagamento-inicial/situacao-na-lista.ts`, puro): Pix gerado
  (com quando), boleto em compensação (com o vencimento), cartão recusado (quantas vezes), cartão em
  análise, nunca gerou cobrança, pago (com a forma e a data), o modo teste e, depois de 30 dias sem
  pagamento, "sem pagamento há N dias". O teste que acabou sem pagamento diz isso embaixo.
- **"Apagar o cadastro"** (`lib/pagamento-inicial/cadastro-sem-pagamento.ts`, rota
  `POST /api/v1/admin/empresas-do-cadastro/[id]/apagar`). Só aparece, e só passa, na empresa que
  espera o primeiro pagamento há 30 dias ou mais sem NENHUM pagamento; nunca roda sozinho. A rota
  exige o admin da plataforma com escopo `full` e a verificação em duas etapas da sessão
  (`requirePlatformAdminEscrita`), como as outras escritas da tela, e quem apaga digita o nome curto
  da empresa. A ordem:
  1. confere de novo, no servidor, a situação e o nome curto;
  2. relê a cobrança no Asaas (paga agora? para tudo) e cancela a assinatura lá, para nada ficar
     cobrando; o Asaas fora recusa (nada é apagado);
  3. no banco, `fn_mia_cadastro_sem_pagamento_para_apagar` (9126) trava a empresa e a assinatura,
     confere tudo de novo e troca a suspensão de cobrança por uma ADMINISTRATIVA nova, pelas funções
     do upstream (`fn_reativar_organizacao` e `fn_suspender_organizacao`, na mesma transação);
  4. chama a exclusão do UPSTREAM (`excluirOrganizacao`, 0614): relê o provedor, apaga em cascata,
     desliga o que fala com o mundo, limpa os arquivos e remove o login de quem se cadastrou (que
     pode se cadastrar de novo).

  Por que o passo 3: a exclusão do upstream recusa empresa parada por cobrança (para não deixar
  assinatura cobrando no provedor). Aqui a cobrança já foi cancelada no passo 2, e a 9126 só troca a
  suspensão para a empresa que nunca pagou. Interrompida depois do passo 3, uma nova tentativa
  retoma (a 9126 devolve `ja_preparada`). Auditoria: a lápide e o fim da exclusão do upstream, e
  `pagamento_inicial.cadastro_apagado` (os dias, o plano, se havia cobrança).

## 6. Pelo MCP de plataforma

Nenhuma ferramenta nova (a lista segue com 99). `plataforma_ver_cliente` ganha `cobrancas`: as
cobranças da empresa no Asaas com a situação, o número da nota e o link do PDF, e o chamado da nota
errada de cada uma (`lib/area-de-cobranca/para-a-time.ts`). O filtro de quem espera o primeiro
pagamento e o passo do pagamento já vieram da primeira frente. Detalhe em
[`mcp-de-implantacao.md`](mcp-de-implantacao.md), "A área de cobrança (.96, segunda frente)".

## 7. Para quem mexe no código

### Onde o código do upstream (ou da primeira frente) foi tocado

- `app/app/settings/billing/page.tsx` (`FORK MIA (.96)`): a área, só do administrador.
- `app/admin/(protected)/empresas-do-cadastro/page.tsx` (`FORK MIA (.96)`): o funil, a coluna e o botão.
- `components/pagamento-inicial/CamposFiscais.tsx`: a prop opcional `documentoTravado` (o padrão não
  muda nada do cadastro nem do passo).
- `lib/mcp-plataforma/ferramentas/plataforma.ts`: `cobrancas` no `plataforma_ver_cliente`.
- `lib/audit/actions.ts`, `lib/i18n/dicionario.ts` (o dicionário `dicionario-mia-area-de-cobranca.ts`),
  `lib/assistente/manuais-das-telas.ts` (o manual `area-de-cobranca`).
- `easypanel/bootstrap.sh` (`FORK MIA (.96)`): seção 8.

### O schema (só objetos nossos)

- **9125** `mia_cartao_das_mensalidades`: o cartão trocado na área (final, bandeira, assinatura,
  quando e quem). Só o servidor lê e escreve. LGPD: cascata com a empresa e o gatilho da empresa
  redigida.
- **9126** `fn_mia_funil_do_cadastro` (só lê) e `fn_mia_cadastro_sem_pagamento_para_apagar`. Só o
  servidor executa.

### Provas

| arquivo | o que prova |
|---|---|
| `tests/unit/area-de-cobranca-regras.test.ts` | cada situação de cobrança, a nota que vale, o texto do chamado, a bandeira, o cartão das próximas, a situação na lista da Time e os 30 dias |
| `tests/unit/area-de-cobranca-leitura.test.ts` | a área lê o Asaas da empresa, o Asaas fora não derruba, sem Asaas, desligada; as cobranças para a Time |
| `tests/unit/area-de-cobranca-servico.test.ts` | o documento não muda, o Asaas recebe; a nota errada vira chamado da sessão, só da cobrança paga da empresa, uma vez |
| `tests/unit/area-de-cobranca-cartao-fora-dos-registros.test.ts` | o cartão fora de todo registro, e nada cobrado na troca |
| `tests/unit/cadastro-sem-pagamento-apagar.test.ts` | a ordem do apagar, as recusas e a verificação em duas etapas na rota |
| `tests/unit/mcp-de-implantacao-area-de-cobranca.test.ts` | as cobranças com a nota no `plataforma_ver_cliente`, 99 ferramentas |
| `tests/unit/bootstrap-reaplica-no-deadlock.test.ts` | o conserto do bootstrap (seção 8) |
| `tests/unit/baseline-do-upstream-zera-o-lock-timeout.test.ts` | a cerca do cabeçalho do `baseline.sql` que o bootstrap troca na cópia (seção 8) |
| `tests/invariants/area-de-cobranca.test.ts` | o banco: a 9125 só do servidor, o CHECK do final, a LGPD; o funil; o preparo do apagar e as recusas dele |

## 8. O bootstrap reaplica o schema quando perde a disputa

A implantação reaplica o schema (`easypanel/bootstrap.sh`, modo update) com o app ANTIGO ainda
atendendo. Um `drop trigger if exists` ou um `create policy` pede lock exclusivo, entra na fila atrás
de uma transação do app, forma ciclo e perde por `deadlock detected`. Aconteceu em três implantações
e deixou a saúde com `erros: 1` à toa (o comando que perdeu ficava de fora até o deploy seguinte).
Na .96 entrou uma segunda passada quando TODOS os erros eram deadlock; uma disputa que se repetisse
nela ainda parava o trem. Desde a MIA-350 (desenho na MIA-348, dívida 5), no modo update:

1. **Espera curta por lock.** Cada comando do schema desiste do lock em
   `least(500ms, deadlock_timeout / 2)`, lido do próprio banco na hora (`AVISO` e 500 ms se a
   leitura falhar). Desiste antes do `deadlock_timeout` do app, então quem perde é o schema (que
   repete), e não a tela de alguém; e nenhuma consulta do app fica na fila atrás do lock exclusivo
   por mais que isso. O `baseline-mia.sql` e o trecho "antes do upstream" recebem
   `-c "set lock_timeout = ..."`.
2. **O `baseline.sql` vai por uma cópia.** Ele abre com `SET lock_timeout = 0;` (linha 5), que
   apagaria o `-c`. O bootstrap aplica `/tmp/deskcomm/baseline.sql`, com só essa linha trocada (o
   resto byte a byte, a mesma contagem de linhas, o mesmo número de linha no erro). O
   `supabase/baseline.sql` do repositório não muda. Se a linha não estiver nas 20 primeiras, o
   bootstrap avisa e aplica o original; a cerca `baseline-do-upstream-zera-o-lock-timeout` reprova
   a fusão antes disso acontecer calado.
3. **Até 3 passadas inteiras**, esperando 10 s e depois 20 s, quando há ALGUM erro de disputa ou de
   conexão (`deadlock detected`, `lock timeout`, conexão que caiu: o padrão do `reaplicar_baseline`
   do kit do upstream, em `hostgator-setup-kit/_common.sh`). Com erro de verdade junto, repetir
   limpa a disputa e sobra só o que precisa de conserto. Erro sem disputa nenhuma não repete.
4. **O `psql` que não chega ao fim do arquivo conta.** Código de saída diferente de 0 vira a linha
   "a aplicação não chegou ao fim do arquivo (o psql saiu com código N): <causa>". Antes, o
   `|| true` engolia e o carimbo podia dizer 0 com metade do arquivo aplicada.
5. **O carimbo é o da última passada**, que é o que ficou no banco: disputa curada na passada 2 ou
   3 não conta; a que dura as 3 conta (`erros > 0`, `em_dia: false`, trem parado no passo 11), e
   é o certo, porque o comando está fora do banco. A amostra começa pelo que NÃO é disputa. A escrita
   do carimbo fica fora da espera curta.
6. **Log:** uma linha por passada (`passada 2 de 3: 4 comando(s) perderam a disputa ...`) e
   `/tmp/baseline-passada-N.log`; o da última também fica em `/tmp/baseline.log`.

Banco novo não muda: sem app, sem espera curta e com `ON_ERROR_STOP`.

**O que isto não resolve.** O kit do upstream para o que fala com o banco antes do DDL; daqui não
dá (o bootstrap é um contêiner sem acesso ao Docker). Um comando numa tabela segurada por um cron
longo (até 240 s no `prospecting`) ainda pode perder nas 3 passadas: conta como erro e o trem para,
como antes, só que mais raro. Ficam na dívida: a coluna `passadas` no carimbo (para ver o deploy que
precisou de 2 ou 3) e a conferência das regras de isolamento do kit (`update.sh`), se um deploy ainda
cair por disputa.

O schema tem `drop ... if exists` e `create ...` em comandos soltos (regras e gatilhos), e alguns
são de regra **restritiva** (as de `update`/`delete` em `conversations` e `messages`, as de
`calendar_appointments`). Se o `drop` ganha o lock e o `create` logo depois perde por `lock timeout`,
a regra ou o gatilho fica fora até a passada seguinte (10 a 30 s). Regra restritiva faltando amplia
acesso; regra permissiva faltando nega; gatilho faltando pula a regra dele. Antes desta mudança o
buraco era o mesmo, só que só no deadlock (raro); com a espera curta, perder vira o caso comum. Não
dá para corrigir no arquivo: os pares estão no `baseline.sql`, que é do upstream byte a byte. Se a
disputa durar as 3 passadas, **`erros > 0` quer dizer que há objeto do schema faltando no ar**: a
ação é reimplantar assim que a disputa passar, e não esperar o próximo trem.

**Para o Revisor.** Migration que COPIA dado e depois APAGA a origem em dois comandos soltos pode
perder a cópia (disputa) e ganhar o apagar; a passada seguinte sai limpa e o dado não veio. Copiar e
apagar vão no mesmo bloco `do $$ ... $$` (uma transação só). Vale também sem esta mudança. A mesma
regra vale para o nosso `baseline-mia.sql`: um `drop` + `create` de regra restritiva vai dentro de um
`do $$ ... $$`, como já faz o par de `supabase/baseline-mia.sql:24052-24055`.

**Provas.** `tests/unit/bootstrap-reaplica-no-deadlock.test.ts` (o bootstrap de verdade com um `psql`
de mentira: lock timeout que cura na 2ª, disputa nas 3, disputa com permissão, benignos, `psql` que
sai com código 2, a espera curta nas chamadas e a cópia com só a linha 5 trocada);
`tests/unit/baseline-do-upstream-zera-o-lock-timeout.test.ts` (a cerca do cabeçalho); e a etapa 3b
do `scripts/ensaio-de-banco.sh`, que roda o bootstrap de verdade num Postgres descartável com uma
sessão segurando lock em `public.conversations`: disputa de 8 s cura na passada 2 (carimbo novo,
`erros = 0`, as mesmas políticas da etapa 3) sem prender uma leitura do app com `statement_timeout`
de 2 s; disputa que não acaba sai 0 com `erros > 0` e `lock timeout` na amostra, e solto o lock a
rodada seguinte volta a 0.

## 9. Desvios do protótipo e lacunas

- **Cobrança cancelada**: aparece quando o Asaas a devolve na lista do cliente com `deleted`. A
  documentação do Asaas não diz se a busca por cliente traz a cobrança removida; se não trouxer, o
  Pix vencido e apagado não aparece na lista (e continua sem nota).
- **"Pagar por Pix ou boleto"** (o botão ao lado de "Trocar o cartão" no protótipo) não entrou: a
  cobrança em aberto já tem "Pagar agora", que abre a fatura do Asaas com Pix, boleto e cartão.
  Mudar a forma das próximas mensalidades de cartão para fatura fica para quando for pedido.
- **A bandeira logo depois da troca** sai dos primeiros números do cartão (o Asaas não a devolve na
  troca); a próxima mensalidade paga no cartão traz a do Asaas.
- **O formulário de dados fiscais** da área é o mesmo do passo (CEP com busca, inscrições, WhatsApp),
  com o documento travado; o protótipo mostrava menos campos.
- **Testado com o Asaas dublado**: a troca de cartão e a lista de notas contra o sandbox de verdade
  não foram feitas aqui (como na primeira frente).
