# Pagamento no início (fork MIA, .96)

Quem chega pelo site num plano de **entrada paga** escolhe o plano, se cadastra, **paga na
própria tela** e só então monta a MIA. Quem chega num plano **com teste grátis** entra sem
pagar nada, mas passa pelo mesmo passo para **escolher como paga depois do teste**. A nota
fiscal sai pelo Asaas só quando o dinheiro entra, e todos os avisos de cobrança são da MIA.

O protótipo clicável foi aprovado pelo Gabriel em 27/10/2026
(`Projeto sistema MIA/Produto/Prototipo-pagamento-no-inicio-2026-10-27.html`, versão 8, com
os ajustes dos comentários), e a decisão 12 foi revista por ele no mesmo dia, em dois
ajustes (seção 6). Esta versão é a do **caminho do pagamento**: o cadastro, os dados fiscais,
o passo "Pagamento", o cartão, os avisos, a nota e o MCP. A área de cobrança da empresa
(`/app/settings/billing`) e o lado da Time em Empresas do cadastro vêm numa frente irmã, por
cima destas peças.

A base é a cobrança do upstream (Rafael, [`../saas/cobranca.md`](../saas/cobranca.md)): a
assinatura no Asaas, a releitura, a régua e a **entrada paga** dele (0679: a empresa num plano
de 0 dia de teste nasce suspensa, com `cobranca_assinaturas.pagamento_inicial_pendente`, até o
primeiro pagamento). O que é nosso fica ao lado: schema nas migrations **9120 a 9122**, código
em `lib/dados-fiscais/`, `lib/asaas-mia/` e `lib/pagamento-inicial/`.

---

## 1. O caminho, ponta a ponta

**Entrada paga** (plano com 0 dia de teste):

1. **Cadastro** (`/signup`, a tela do upstream estendida): além do de hoje, "Seu nome", o
   **WhatsApp** e o bloco "Dados da empresa para a cobrança e a nota fiscal" (seção 2). O
   nome da empresa vira "Nome fantasia" (ou "Nome do negócio", na pessoa física). O botão vira
   "Criar conta e ir para o pagamento". A action confere tudo de novo
   (`lib/pagamento-inicial/cadastro.ts`) e guarda os dados fiscais na passagem do cadastro.
2. **A empresa nasce** (confirmação do e-mail, aprovação da Time ou `/get-started`): o gatilho
   do upstream a suspende até pagar, e o nosso (9120) leva os dados fiscais para ela.
3. **Passo "Pagamento"** (`/onboarding/pagamento`), antes do "Seu negócio". A empresa parada
   é levada para cá e **nunca** para `/account-suspended` (seção 4). Pix com QR e copia e
   cola, cartão digitado na tela (checkout transparente do Asaas) ou boleto com linha
   digitável e PDF. A tela confere sozinha, ao abrir e a cada 5 segundos.
4. **"Pagamento confirmado"**, com o recibo na tela (plano, valor, forma, quando, próxima
   cobrança). Depois, "Continuar" leva ao "Seu negócio".

**Plano com teste grátis** (decisão 12 revista):

1. Cadastro de hoje (sem os dados fiscais: seção 2).
2. Passo "Pagamento" no modo teste: **"Nada é cobrado hoje"**. A pessoa preenche os dados
   fiscais (se ainda não tem) e escolhe **cartão** (cadastrado agora, debitado sozinho no fim
   do teste; a tela diz a data) ou **Pix** (gerado 3 dias antes do fim do teste, com o aviso).
   Sem boleto nesta primeira mensalidade. Depois, "Continuar: Seu negócio".
3. Fim do teste (seção 6).

## 2. Os dados fiscais (9120)

`mia_dados_fiscais`, uma linha por empresa: empresa (CNPJ, inclusive o **alfanumérico** da
Receita) ou pessoa física (CPF), razão social ou nome completo, CEP, rua, número, complemento,
bairro, cidade, UF, as inscrições municipal e estadual (opcionais, só na empresa) e o WhatsApp
de quem assina. A régua é uma só (`lib/dados-fiscais/regras.ts`): a tela confere enquanto a
pessoa digita, a action e as rotas conferem de novo, e o banco tem os mesmos limites em CHECK.

- **Preencher pelo CNPJ** usa a consulta da Receita que o sistema já tem: o cliente da
  BrasilAPI do upstream (`lib/brasil-api/client.ts`) e o mesmo mapeamento dos campos
  (`lib/dados-fiscais/consultas.ts`). Só volta o que a nota precisa, nunca o quadro de sócios.
- **Buscar o CEP**: não havia busca no sistema; vem da mesma BrasilAPI (`/cep/v2`).
- As duas consultas do cadastro são rotas **públicas e só de leitura**
  (`/api/v1/publico/cnpj` e `/cep`), com teto por IP.
- **Quem lê**: o administrador da empresa e a plataforma (RLS). **Quem escreve**: só o
  servidor, depois de conferir papel e documento.
- **O CPF ou CNPJ não muda depois do primeiro pagamento** (decisão 10: trocar de titular é
  pedido à Time). Antes de pagar, muda pelo "Corrigir" do passo.
- Toda gravação zera `asaas_sincronizado_em`: o cliente do Asaas recebe a versão nova na
  hora (no passo) ou na rodada horária, e a mudança vale para as próximas notas.
- **A passagem do cadastro** (`mia_dados_fiscais_do_cadastro`): a conta existe antes da
  empresa, então os dados esperam pelo usuário. O gatilho `trg_mia_dados_fiscais_nascem_com_a_empresa`
  os leva na criação dela (pelo `created_by`, o mesmo do gatilho da entrada paga) e põe a
  razão social no `legal_name`. Passagem com mais de 30 dias sai sozinha.

**Decisão (pedida na especificação): plano com teste grátis não mostra os dados fiscais no
cadastro.** O cadastro dele segue o de hoje, curto. Os dados são pedidos no passo
"Pagamento" do modo teste, porque é ali que o cartão vai ao Asaas (que exige o CPF ou CNPJ) e
porque a nota do fim do teste sai com eles.

**LGPD.** Os dados fiscais são da empresa cliente (na pessoa física, de quem assina), não de
um contato: as catracas de LGPD do fork (`lgpd-*`, catálogo de FKs para `contacts`) não os
alcançam, e o acesso do titular é a própria tela (o administrador vê e corrige). O que se
garante: apagar a empresa ou o usuário leva junto (cascade), e a empresa **redigida**
(`organizations.status = 'redacted'`, a anonimização da empresa inteira) perde os dados
fiscais e o retrato do pagamento pelos gatilhos `trg_mia_dados_fiscais_saem_com_a_empresa_redigida`
e `trg_mia_pagamento_inicial_sai_com_a_empresa_redigida`. Prova em
`tests/invariants/pagamento-no-inicio.test.ts`.

## 3. O passo "Pagamento" (9121)

`mia_pagamento_inicial` é o retrato do passo, nos dois modos (`entrada_paga` e `teste`): a
forma, a cobrança no Asaas, o Pix copia e cola, a linha e o PDF do boleto, do cartão só o
final e a bandeira, as recusas, a última conferência e o lembrete. O serviço é
`lib/pagamento-inicial/servico.ts`; as rotas, `app/api/v1/pagamento-inicial/**`.

- **Por baixo é a cobrança do upstream.** Gerar = garantir o cliente do Asaas com os dados
  fiscais (`notificationDisabled: true`), depois `gerarLinkDePagamento` (a assinatura
  `UNDEFINED` com a primeira cobrança). A MESMA primeira cobrança aceita as três formas:
  `pixQrCode`, `identificationField` e `payWithCreditCard`.
- **Quem decide que pagou** é a releitura do upstream (`sincronizar`), nunca o corpo do aviso.
  Ela desliga `pagamento_inicial_pendente` e reativa a empresa; a linha do passo é marcada
  depois (`marcarPagoSeLiberou`), pelo aviso do Asaas (`lib/cobranca/sinal.handler.ts`), pela
  conferência da tela e pela rodada.
- **A conferência da tela**: `POST /api/v1/pagamento-inicial/conferir`, ao abrir e a cada 5
  s. Lê a cobrança direto no Asaas no máximo uma vez a cada 8 s por empresa (`conferido_em`).
- **O boleto** que venceria hoje ganha 3 dias (o prazo da compensação). **Sair do boleto já
  gerado** para o Pix ou o cartão cancela a assinatura no Asaas (o boleto deixa de valer) e
  refaz a cobrança: nunca se cobra duas vezes.
- **Trocar de plano antes de pagar** (decisão 7): botão no próprio passo, entre os planos
  visíveis. A cobrança gerada é cancelada no Asaas e a próxima sai no plano novo. Indo para
  um plano com teste, a empresa entra no teste na hora; vindo de um plano com teste para um
  de entrada paga, a empresa passa a esperar o pagamento.
- **Quem fecha e volta** (tela 2): a empresa parada cai sempre no passo, que mostra o Pix que
  ainda vale, o boleto com o prazo, o cartão recusado com os dois caminhos, ou "Pagamento
  confirmado" se pagou com a tela fechada (a conferência ao abrir).
- **Só quem administra paga.** Os outros papéis veem "a empresa espera o primeiro pagamento".
- O passo não gasta IA e não abre nenhuma outra tela antes de pagar (o layout do início
  mostra só ele, sem o assistente).
- **Auditoria**: cobrança gerada (forma), refeita (o motivo), tentativa no cartão (só o
  resultado), confirmação, troca de plano, forma escolhida no teste, bloqueio do fim do teste,
  lembrete e dados fiscais gravados (só o tipo e se o documento mudou).

## 4. Para onde vai a empresa parada

`lib/pagamento-inicial/destino.ts`: suspensão do tipo `cobranca` com
`pagamento_inicial_pendente` vai a `/onboarding/pagamento`; todo o resto (atraso de quem já
pagou, suspensão administrativa, redigida) continua em `/account-suspended`. Pontos de
ligação, cada um com `FORK MIA (.96)`: `resolveActiveOrg` (`lib/auth/server.ts`), o layout de
`/app`, o layout do início (a empresa parada vê só o passo), o roteador do início
(`app/onboarding/page.tsx`, o passo vem antes do "Seu negócio") e o hub `/account-suspended`
(com o link de um pedido de LGPD, o hub continua).

## 5. O cartão fica fora dos registros (decisão 2a)

O número e o código de segurança chegam ao servidor só para seguir ao Asaas, na mesma
requisição:

- a rota lê o corpo sem deixar a mensagem do parse escapar (ela citaria o texto) e confere o
  cartão dizendo só o campo (`lib/asaas-mia/cartao-regras.ts`);
- a chamada ao Asaas nunca registra o corpo, e todo erro vira o `code` do Asaas, nunca a
  descrição (que pode ecoar o cartão); um `code` com cara de número vira "recusado"
  (`lib/asaas-mia/api.ts` e `cartao.ts`);
- o pagamento com cartão **nunca se repete sozinho** (um POST que caiu pode ter cobrado), e a
  tela chama a rota por `fetch` direto, porque o cliente de API repete 503;
- do cartão, o banco recebe só o final de 4 números e a bandeira (o CHECK da 9121 recusa
  mais que 4 dígitos); a auditoria leva só o resultado;
- o token que o Asaas devolve é usado na hora para as próximas mensalidades e descartado; a
  tela limpa o código de segurança depois de enviar.

**A prova**: `tests/unit/cartao-fora-dos-registros.test.ts` (a camada do Asaas) e
`tests/unit/pagamento-inicial-cartao-rota.test.ts` (a rota de ponta a ponta) reprovam a versão
se o número, o número com espaços ou o código de segurança aparecerem em qualquer `console.*`
(por onde o `logger` sai), no Sentry, na auditoria, numa escrita no banco, no estado gravado
ou na resposta, nos caminhos que costumam vazar: corpo que não é JSON, cartão inválido,
recusa com a descrição ecoando o cartão, rede que cai com o corpo na mensagem do erro,
resposta que não é JSON, aprovado e cadastro do teste.

## 6. O plano com teste e o fim do teste (decisão 12 revista)

Dois ajustes do Gabriel em 27/10/2026:

- A primeira mensalidade depois do teste é por **cartão** (cadastrado no passo: a assinatura
  do upstream, que no teste já nasce com o primeiro vencimento no fim dele, recebe o cartão
  sem cobrança, `updateCreditCard`, e o Asaas debita naquele dia) ou por **Pix**. Sem boleto:
  a compensação demora e a pessoa ficaria bloqueada tendo pago.
- **3 dias antes do fim do teste**, para quem não cadastrou cartão: a assinatura, a primeira
  cobrança só no Pix (`billingType: PIX`), o QR e o aviso. O aviso é registrado como o
  `trial_acabando` do upstream (pela função dele que registra avisos), e a régua dele não
  manda o dela em dobro. Sem os dados fiscais (empresa anterior à .96), não gera: a régua do
  upstream avisa como hoje.
- **O teste acaba sem a primeira mensalidade paga, ou com o cartão recusado: bloqueia NA
  HORA**, sem a tolerância da régua. É uma função NOVA do fork, `fn_mia_bloquear_fim_do_teste`
  (9122), ao lado de `fn_cobranca_suspender_se_devendo` (nunca a redefine): trava a linha da
  assinatura e põe a empresa no estado da entrada paga do upstream (pendência ligada e
  suspensão `cobranca` com o motivo "Aguardando o primeiro pagamento"). Daí em diante vale o
  caminho da entrada paga: o passo "Pagamento" com o Pix e a troca de cartão (sem boleto), e
  a releitura do upstream libera quando pagar. Com o cartão cadastrado, o bloqueio espera o
  fim do DIA do débito (o Asaas cobra ao longo dele).
- O aviso do bloqueio é o do **"falta só o pagamento"**, nunca o de "conta suspensa por falta
  de pagamento".
- **Quem já pagou alguma mensalidade** (`proximo_vencimento` ou `periodo_pago_desde`
  gravados), quem tem **prazo extra** dado pela Time e a empresa já parada seguem a régua de
  hoje.
- O gancho roda **no começo de `aplicarRegua`** (`lib/cobranca/sincronizar.ts`, ponto
  `FORK MIA (.96)`), antes de a régua do upstream decidir. Com a cobrança desligada, não lê nada.

## 7. Os avisos e a nota fiscal

- **Os avisos de cobrança são todos da MIA** (decisão 8). O sistema já pedia ao Asaas, cliente
  por cliente, que não mandasse os dele (`notificationDisabled: true`, no `garantirCliente` do
  upstream); o cliente criado ou atualizado pelo fork mantém. A tela de Conexão lembra de
  conferir também a configuração geral da conta no painel do Asaas.
- **Lembrete do dia seguinte** (decisão 6): UM e-mail, 1 dia depois de gerada a cobrança (até
  7 dias), para quem gerou e não pagou, com o botão "Voltar ao pagamento"
  (`lib/pagamento-inicial/rodada.ts`). Cobrança refeita zera a marca.
- **"Pagamento confirmado: a sua conta está liberada"** e **nenhum "conta suspensa"** para
  quem acabou de assinar são da **.95** (`lib/planos-mia/entrada-paga.ts`, no `aplicarRegua`):
  o motivo "Aguardando o primeiro pagamento" do bloqueio do fim do teste é o mesmo, então a
  liberação dele também ganha o texto da .95.
- **A nota fiscal sai pelo Asaas SÓ DEPOIS do pagamento confirmado** (decisão 8): toda
  assinatura do Asaas da instalação recebe `invoiceSettings` com `ON_PAYMENT_CONFIRMATION`
  (`lib/asaas-mia/nota.ts`; `mia_nota_da_assinatura` diz para qual assinatura já foi feito).
  Pix vencido, boleto cancelado e cobrança refeita nunca geram nota. O serviço municipal e os
  impostos (que o Asaas exige) são da instalação: Admin › Cobrança › **Conexão**, no quadro
  "Nota fiscal pelo Asaas, na confirmação do pagamento" (`platform_config`,
  `MIA_NOTA_FISCAL_DO_ASAAS`). Sem ele, nenhuma nota automática.

## 8. Pelo MCP de plataforma

Nenhuma ferramenta nova (a lista segue com 99): pagar é sempre do cliente.

- `plataforma_listar_clientes` ganha `situacao_do_pagamento: "aguardando_primeiro_pagamento"`:
  só quem espera o primeiro pagamento (entrada paga, ou o teste que acabou sem pagamento),
  cada um com `pagamento_inicial` (forma escolhida, situação, modo, desde quando).
- `plataforma_ver_cliente` ganha `pagamento_inicial`: o modo, a situação (Pix gerado, boleto,
  cartão recusado, pago, escolhida no teste), a cobrança no Asaas, as datas, o final do
  cartão, o fim do teste e os dados fiscais resumidos com o documento mascarado.

## 9. O que o Gabriel configura no Asaas

1. **Webhook** (já existe desde a .90): Cobrança › Conexão cadastra sozinho. Confira que os
   eventos de pagamento chegam (a "Situação da cobrança" da Visão geral).
2. **Avisos do Asaas desligados** na conta (Configurações de notificações): e-mail, SMS e
   WhatsApp para os clientes. O sistema já pede cliente por cliente; a conta também.
3. **Nota fiscal**: ligar a emissão de nota de serviço no Asaas (com o contador: inscrição
   municipal, regime, certificado), e preencher na Conexão o código do serviço e os impostos.
   A nota sai na confirmação do pagamento.
4. **Cartão**: o pagamento com cartão pela API e o checkout transparente precisam estar
   liberados na conta. Para as próximas mensalidades caírem no cartão sem digitar de novo, a
   **tokenização** precisa estar habilitada (no sandbox já vem; em produção, pedir ao Asaas).
   Sem ela, o sistema grava o cartão na assinatura pela mesma chamada, com o cartão digitado.
5. **Chave Pix** cadastrada na conta: sem ela, o QR do Asaas vale só até o fim do dia.
6. Testar tudo no **sandbox** antes da chave de produção (a compra de verdade pela tela contra o
   sandbox não foi feita aqui; os testes usam um Asaas dublado).

## 10. Para quem mexe no código

### Onde o código do upstream foi tocado (marcado `FORK MIA (.96)`)

- `lib/auth/server.ts` (`resolveActiveOrg`), `app/app/layout.tsx`, `app/onboarding/layout.tsx`,
  `app/onboarding/page.tsx`, `app/account-suspended/page.tsx`: o destino da empresa parada e
  o passo antes do "Seu negócio".
- `components/auth/SignupForm.tsx`, `lib/auth/schemas.ts`, `app/actions/auth/signUp.ts`: o
  cadastro da entrada paga.
- `lib/cobranca/sincronizar.ts` (`aplicarRegua`): o gancho do fim do teste.
- `lib/cobranca/sinal.handler.ts`: o aviso do Asaas marca a linha do passo.
- `app/admin/(protected)/cobranca/page.tsx`: a nota na aba Conexão.
- `lib/auth/public-paths.ts`: as duas consultas públicas.
- `lib/audit/actions.ts`, `lib/i18n/dicionario.ts`, `lib/mcp-plataforma/ferramentas/plataforma.ts`.

Do fork: `lib/planos-mia/rodada.ts` (a rodada do passo, depois da da jornada) e o
manual `pagamento-no-inicio` em `lib/assistente/manuais-das-telas.ts`.

### Provas

| arquivo | o que prova |
|---|---|
| `tests/invariants/pagamento-no-inicio.test.ts` | o banco: RLS dos dados fiscais e do passo (admin lê a própria, gestor e vizinho zero, a plataforma lê, anon e a sessão não escrevem), a passagem do cadastro, o gatilho na criação, a LGPD da empresa redigida e o CHECK do final do cartão |
| `tests/unit/dados-fiscais-regras.test.ts` | CPF, CNPJ (inclusive alfanumérico), CEP, UF, WhatsApp, "Falta preencher" |
| `tests/unit/asaas-da-mia.test.ts` | o cliente do Asaas com os dados fiscais e os avisos desligados, Pix, linha digitável, notas, a nota na confirmação |
| `tests/unit/pagamento-inicial-servico.test.ts` | o passo: Pix, boleto, sair do boleto cancela, reserva, conferência, cartão, troca de plano, modo teste |
| `tests/unit/pagamento-inicial-fim-do-teste.test.ts` | o Pix 3 dias antes, o bloqueio na hora, quem segue a régua de hoje |
| `tests/unit/cartao-fora-dos-registros.test.ts` e `pagamento-inicial-cartao-rota.test.ts` | o cartão fora de todo registro |

### Lacunas conhecidas

- A compra pela tela contra o sandbox de verdade do Asaas não foi feita aqui (como na .90).
- O caminho da tokenização desligada em produção (o cartão gravado na assinatura com o cartão
  digitado, sem token) segue a documentação do Asaas e não foi medido.
- O endereço para trocar o cartão de uma assinatura aparece com dois nomes na documentação do
  Asaas (`POST /subscriptions/{id}/updateCreditCard` na referência e `PUT
  /subscriptions/{id}/creditCard` no anúncio de abril de 2025): o sistema tenta o primeiro e,
  no 404, o segundo.
