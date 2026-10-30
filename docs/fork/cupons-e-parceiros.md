# Cupons, parceiros e comissão (fork MIA, .98)

Quem indica clientes ganha um cupom e uma comissão sobre o que esses clientes pagam. O cupom dá
desconto ou dias grátis, e o desconto vai para o Asaas: a cobrança e a nota já saem com o valor
com desconto. Todo mês o sistema fecha a conta de cada parceiro, manda o extrato por e-mail e a
Time faz o Pix por fora.

O protótipo clicável foi aprovado pelo Gabriel em 27/10/2026
(`Projeto sistema MIA/Produto/Prototipo-cupons-e-parceiros-2026-10-27.html`, versão 9, com os
comentários incorporados; valem as opções que ele "adota"). O sistema-base não tem cupom de
assinatura nem parceiro: a comissão que existe lá é a de atendente de salão, outra coisa.

Tudo nasce desligado por natureza: com a cobrança desligada, as telas e o MCP respondem 404 ou
recusam, e nenhuma linha é lida do Asaas. Schema nas migrations **9130 a 9132**; código em
`lib/cupons/`, `lib/parceiros/`, `lib/setup-de-implantacao/` e `lib/asaas-mia/pagamentos.ts`.

---

## 1. O caminho, ponta a ponta

1. O parceiro divulga `app.iamia.com.br/precos?cupom=CODIGO`. O cupom fica no navegador por 30
   dias (cookie `mia_cupom`, comum: a página é desenhada no servidor e precisa dele já na primeira
   resposta) e aparece em preços, no cadastro e no pagamento: selo com "Tirar o cupom", ou o campo
   "Tenho um cupom". Os cartões de preço já saem com o desconto; plano fora do cupom diz "o cupom
   não vale neste plano".
2. As mensagens de erro são as do protótipo, em `lib/cupons/regras.ts`: inexistente, pausado,
   vencido, esgotado, fora do plano (com "Vale para: ...").
3. O cadastro confere o cupom de novo na action (a tela é adulterável) e guarda o código em
   `mia_cupom_do_cadastro`: a conta existe antes da empresa. Quando a empresa nasce (confirmação
   do e-mail, aprovação da Time ou recuperação), o gatilho ADIADO
   `trg_mia_cupom_nasce_com_a_empresa` aplica o cupom. Cupom que deixou de valer nesse meio tempo
   só some: a empresa nasce sem ele, nunca é recusada por isso.
4. No passo "Pagamento", antes de pagar, dá para pôr e tirar o cupom. Depois de pago, só a Time
   troca, na ficha da empresa.

**A régua é uma só:** `fn_mia_aplicar_cupom` (9130), com a linha do cupom travada, para duas
empresas não levarem o último uso. Um cupom por cliente (`mia_cupom_da_empresa`, uma linha por
empresa). Não vale em plano escondido. O cliente fica com o **retrato do combinado** do dia em que
entrou: mudar ou pausar o cupom depois não mexe nele. Cupom usado nunca se apaga (FK `restrict`).

Por que um gatilho adiado (`deferrable initially deferred`): o gatilho da entrada paga do upstream
(`trg_trial_na_criacao_da_org`, 0679) decide o teste e suspende a empresa dentro dele, com uma
variável local. Pendurar o cupom ao lado, rodando no fim da transação, não redefine nada do upstream
e já encontra a assinatura criada.

## 2. Os dias grátis

O cupom de dias usa o **mesmo mecanismo do plano com teste** da .96: o modo "teste" do passo
Pagamento (cartão ou Pix, sem boleto) e o bloqueio na hora no fim
(`fn_mia_bloquear_fim_do_teste`, 9122). Plano com teste mais cupom de dias: **vale o maior, sem
somar**. Entrada paga mais cupom de dias: a empresa entra no teste na hora e é liberada; os dias
contam de agora, porque ela ainda não usou nada. No plano com teste, contam do começo do teste.
Tirar o cupom antes de pagar devolve a empresa ao plano (`fn_mia_tirar_cupom`).

Com o cupom de dias, o cadastro de um plano de entrada paga é o curto, o do teste: os dados fiscais
ficam para o passo, como no plano com teste.

## 3. O desconto no Asaas, por período

**O que o Asaas oferece** (referência da API, conferida em 30/10/2026): o campo `discount` da
assinatura é desconto por pagamento ANTECIPADO (`value`, `type`, `dueDateLimitDays`) e vale em toda
cobrança dela. Não existe "nas N primeiras cobranças". `maxPayments` e `endDate` limitam a assinatura
inteira, não o desconto. E, depois de vencido, o `discount` deixa de valer: ele não serve para um
preço combinado.

**O que o fork faz** (`lib/cupons/desconto-no-asaas.ts`): conta as mensalidades e acerta os valores.

| o quê | valor | como |
|---|---|---|
| cada cobrança EM ABERTO da assinatura | o da ordem dela: as pagas do cliente desde que o cupom entrou, mais a posição entre as abertas | `PUT /payments/{id}`; a nota AGENDADA da cobrança acompanha (`PUT /invoices/{id}`) |
| a própria assinatura | o da PRÓXIMA ordem, para a próxima cobrança já nascer certa | `PUT /subscriptions/{id}` com `updatePendingPayments: false` |
| cobrança paga | nunca muda | |
| plano fora do cupom (o cliente trocou) | o preço cheio dele; voltando a um plano coberto, o desconto volta na ordem que faltar | |

Depois da N-ésima mensalidade paga, com tudo no preço cheio, o desconto **encerra**
(`desconto_encerrado_em`) e a conferência para de rodar. A comissão é sobre o valor pago, então ela
acompanha sozinha.

**Quem chama:** o gancho no checkout do upstream (`lib/cobranca/checkout.ts`, logo depois de abrir a
assinatura, antes de o link chegar a quem paga: vale para todo caminho), o aviso do Asaas (a troca de
plano do upstream grava o preço cheio com `updatePendingPayments: true`, e o aviso de assinatura
alterada acerta de novo) e a rodada de hora em hora.

A conferência de preço do upstream (`conferirPreco`, #2609) auditaria "preço divergente" a cada
releitura; com o cupom valendo, a diferença é o combinado, então o fork a cala só nesse caso
(`precoDoProvedorEhODoCupom`). Qualquer outro preço continua sendo acusado.

**Lacuna conhecida:** mudar o valor de assinatura com cartão pede a tokenização ligada na conta do
Asaas (a documentação diz isso; o `PUT` da cobrança em aberto não depende dela). Sem ela, a assinatura
recusa, a conferência registra o erro e tenta de novo na rodada seguinte. Nada disso foi medido contra
o sandbox: os testes usam um Asaas dublado.

## 4. O setup de implantação

Venda ÚNICA e OPCIONAL: "Quero que a Time implante para mim", no passo do pagamento; a Time também vende por
link, na ficha da empresa ("Gerar o link do setup"). O preço é **por plano** (`mia_plano_setup`, em Admin › Cobrança › Módulos dos planos; sem preço, o plano não oferece).
O desconto no setup é separado e definido no próprio cupom (nenhum, % ou R$).

Por baixo é uma cobrança AVULSA no Asaas (`externalReference = setup:<empresa>`), que aceita Pix, boleto
e cartão. A tela mostra o Pix na hora e a fatura; pagando a mensalidade com cartão na tela, o setup sai
no mesmo cartão, na mesma requisição (o cartão vive só nela, como na .96). Recusado no setup, a
mensalidade não se desfaz. Desmarcar antes de pagar cancela a cobrança. O desconto que zera o valor vira
**cortesia**: nada é cobrado e não há comissão. **A liberação da empresa nunca depende do setup.**

A nota do setup é pedida na confirmação do pagamento, com o **serviço e os impostos próprios**: a
configuração da nota da Conexão ganhou o bloco "Nota do setup de implantação" (`setup` dentro de
`MIA_NOTA_FISCAL_DO_ASAAS`; o Gabriel usa o item 17.06 a 2%). Sem ele, a nota do setup não sai sozinha, e
a ficha da empresa avisa. Falhas são repetidas até 5 vezes pela rodada.

## 5. A comissão, sobre o líquido

```
líquido  = valor pago (já com o desconto) − imposto − taxa real do Asaas
imposto  = valor pago × alíquota do Simples
taxa     = valor pago − netValue daquela cobrança
comissão = líquido × percentual
```

Vale para a mensalidade e para o setup, com o percentual de cada um. A alíquota é um campo ÚNICO em
Admin › Cobrança › Conexão (`MIA_COMISSAO_DOS_PARCEIROS`). **Sem a alíquota, nada é lançado:** imposto
zero pagaria a mais, e as telas avisam. Cada lançamento grava a conta inteira do dia, então mudar a
alíquota vale para os pagamentos seguintes.

`mia_comissoes` tem uma linha por cobrança e tipo. A comissão **nasce quando a cobrança é PAGA**, lida no
Asaas (nunca pelo corpo do aviso), pelo aviso e pela rodada (`lib/parceiros/comissoes.ts`). Sem o
`netValue` da cobrança, espera.

- **Entram:** as cobranças da assinatura, dentro do prazo, e o ajuste proporcional de uma troca de plano
  para cima (é mensalidade); o setup, uma vez.
- **Não entram:** créditos, Broadcast e e-mail avulso (não são assinatura nem setup); setup vendido sem
  parceiro; cortesia; pagamento anterior a o parceiro ser deste cliente (`parceiro_desde`).
- **O prazo** (6, 12 ou 24 meses, ou enquanto pagar) conta do vencimento da primeira mensalidade paga.
- **Mudar a comissão vale só para os clientes novos:** os termos ficam fixados no primeiro pagamento
  (`termos_fixados_em`). A comissão própria do cupom vence a do parceiro.
- **Estorno ou chargeback** de cobrança já comissionada vira um lançamento NEGATIVO no mês em que foi visto
  e desconta no repasse seguinte. Cobrança estornada que nunca gerou comissão não desconta nada.
- **Parceiro anonimizado** para de gerar comissão.

## 6. O repasse do mês

Os dias 1, 5 e 10 são configuração (Admin › Cobrança › Conexão).

- **Dia 1:** a rodada fecha o mês anterior: as comissões abertas até ele viram um `mia_repasses` por
  parceiro, e o extrato sai por e-mail com a conta inteira (`lib/parceiros/extrato.ts`). A resposta vai ao
  suporte da instalação. **Saldo zero ou negativo não vira repasse:** as linhas ficam abertas e descontam no
  mês seguinte. Idempotente: repasse único por parceiro e mês.
- **Até o dia 5:** o parceiro manda a nota (CNPJ) ou o recibo (CPF) e a Time ANEXA ao repasse (bucket privado
  `mia-repasses`, PDF, XML, PNG ou JPG, até 10 MB, link assinado de 5 minutos). Sem anexo fica "aguardando
  nota" e **não dá para marcar como pago** (o banco também recusa: CHECK `mia_repasses_pago_com_anexo`).
- **Até o dia 10:** a Time faz o Pix por fora e marca como pago (a data e quem). O sistema nunca manda
  dinheiro.
- **A planilha do mês** é um CSV que o Excel abre em pt-BR, cliente a cliente. O e-mail traz o detalhe de
  cada cliente no corpo: o roteador de e-mail não anexa arquivo (desvio do texto do protótipo, que dizia
  "planilha anexa").

**Para o Gabriel ver com o contador:** pagar comissão a pessoa física pode exigir retenção de INSS
e IR no recibo. O sistema não calcula retenção.

## 7. A rodada e os ganchos

`lib/parceiros/rodada.ts`, dentro da rodada da jornada (`lib/planos-mia/rodada.ts`), no cron de hora em hora
da cobrança, e pelo aviso do Asaas (`depoisDoAvisoDoAsaas`), só para a empresa do aviso. As cobranças do cliente
são lidas UMA vez e servem ao desconto, ao setup e à comissão. No máximo 100 empresas por rodada, as lidas há
mais tempo primeiro. Nada lança: a rodada do upstream já respondeu. Sem cron novo.

## 8. O parceiro

Só a Time vê (RLS ligada, sem política). Admin › Parceiros: nome, CPF ou CNPJ (com o dígito conferido; é a chave
do "garantir"), e-mail do extrato, chave Pix, as duas comissões, os cupons e os clientes. O cliente fica ligado ao
parceiro pelo cupom da primeira mensalidade, e isso não muda sozinho. **Trocar o parceiro é na ficha da empresa**
(Admin › Tenants), com a verificação em duas etapas e o Audit Log: o novo recebe só dos pagamentos a partir de
hoje, com a comissão dele, o que já foi lançado fica com o anterior, e o prazo continua contando da primeira
mensalidade do cliente.

**LGPD.** O parceiro é uma pessoa e não é um contato, então as catracas do catálogo de `contacts` não o alcançam;
as duas pontas estão em Admin › Parceiros, com a verificação em duas etapas:

- **Exportação:** "Baixar os dados dele", o JSON com o cadastro, os cupons, as empresas, as comissões e os repasses,
  com um link de cada anexo que vale um dia, para a Time baixar os arquivos e entregar
  (`exportarDadosDoParceiro`, em `lib/lgpd/export-collector.ts`, onde a cerca da LGPD confere as tabelas).
- **Anonimização:** "Anonimizar" apaga o arquivo de cada anexo do armazenamento e, só então, `fn_mia_anonimizar_parceiro`
  apaga nome, documento, e-mail e Pix, pausa o parceiro e tira a referência do anexo. Os valores ficam, como registro
  financeiro. Se um arquivo não sai, nada é apagado e o pedido pode ser repetido. Se a nota for necessária para o
  fiscal, a Time guarda a sua via por fora antes de anonimizar.

A auditoria nunca leva o documento nem o Pix. Na leitura do MCP, os dois saem mascarados.

## 9. As telas

| tela | o que tem |
|---|---|
| Admin › Cupons (`/admin/cupons`) | criar, mudar, pausar e ativar; o que dá, planos, parceiro e comissão, usos, validade, situação |
| Admin › Parceiros (`/admin/parceiros`) | os cartões, o formulário, os clientes, a LGPD |
| Repasses do mês (`/admin/parceiros/repasses`) | a conta por parceiro, o anexo, o marcar como pago, a planilha, os extratos |
| Admin › Cobrança › Conexão | a alíquota e os dias do calendário; a nota do setup |
| Admin › Cobrança › Módulos dos planos | o preço do setup de cada plano |
| Admin › Tenants › a empresa | o cupom e o parceiro, com a troca |
| `/precos`, `/signup`, `/onboarding/pagamento` | o cupom; no pagamento, o setup |

As escritas pedem a verificação em duas etapas (`requirePlatformAdminEscrita`), como as outras telas de cobrança. As
telas do `/admin` não têm manual do assistente; o manual do passo "Pagamento" cita o cupom e o setup.

## 10. Pelo MCP de plataforma

Seis ferramentas novas (a lista vai de 99 a 105), e `plataforma_ver_cliente` ganha `cupom_e_parceiro`. Detalhes em
[`mcp-de-implantacao.md`](mcp-de-implantacao.md), "Cupons, parceiros e comissão (.98)". O MCP não manda dinheiro, não
anexa a nota, não troca o parceiro de um cliente e não anonimiza.

## 11. O que fica para depois, de propósito

Painel do parceiro com login; Pix automático do repasse pelo Asaas; comissão sobre créditos e Broadcast; cupom de
desconto para cliente que já assina (renovação).

## 12. Para quem mexe no código

### Onde o código do upstream foi tocado (marcado `FORK MIA (.98)`)

- `lib/cobranca/checkout.ts`: o desconto na assinatura recém-criada.
- `lib/cobranca/sincronizar.ts` (`conferirPreco`): o preço do cupom não é divergência.
- `lib/cobranca/sinal.handler.ts`: o aviso do Asaas confere o cliente.
- `components/auth/SignupForm.tsx`, `lib/auth/schemas.ts`, `app/actions/auth/signUp.ts`, `app/(public)/signup/page.tsx`:
  o cupom no cadastro.
- `lib/auth/public-paths.ts`: a consulta pública do cupom.
- `components/admin/AdminSidebar.tsx`, `app/admin/(protected)/cobranca/page.tsx`,
  `app/admin/(protected)/tenants/[id]/page.tsx`.
- `lib/audit/actions.ts`, `lib/i18n/dicionario.ts`, `lib/mcp-plataforma/ferramentas.ts`, `lib/mcp-plataforma/operacoes.ts`,
  `lib/mcp-plataforma/ferramentas/plataforma.ts`.

Do fork: `lib/pagamento-inicial/servico.ts` e `tipos.ts`, `components/pagamento-inicial/PassoDoPagamento.tsx`,
`lib/asaas-mia/nota.ts` e `cobrancas.ts`, `components/admin/cobranca/NotaFiscalDoAsaas.tsx`, `lib/planos-mia/rodada.ts`,
`app/precos/page.tsx`, `app/admin/(protected)/cobranca/modulos-dos-planos/page.tsx`.

### Provas

| arquivo | o que prova |
|---|---|
| `tests/invariants/cupons-e-parceiros.test.ts` | o banco: nem anon nem a sessão leem, a régua do cupom, dias grátis (o maior), o gatilho adiado do cadastro, cupom usado não se apaga, sem anexo não vira pago, uma comissão por cobrança, a LGPD do parceiro |
| `tests/unit/cupons-regras.test.ts` | os motivos e as frases, os valores com desconto, a conta do líquido com os números do protótipo, o prazo |
| `tests/unit/cupons-desconto-no-asaas.test.ts` | cada cobrança na ordem dela, a assinatura, a nota agendada, o encerramento, plano fora do cupom, Asaas fora do ar |
| `tests/unit/cupons-no-passo-e-setup.test.ts` | o cupom no passo (com a cobrança refeita), no cadastro; o setup: cobrança avulsa, cortesia, nota com o serviço próprio, o mesmo cartão |
| `tests/unit/parceiros-comissao-e-repasse.test.ts` | a comissão de cada cobrança, o que não entra, o prazo, os termos fixados, os estornos, o fechamento, o anexo, o extrato, a planilha |
| `tests/unit/mcp-de-implantacao-cupons-e-parceiros.test.ts` | as seis ferramentas, a máscara, a idempotência, a recusa sem anexo |

### Lacunas conhecidas

- A compra e o desconto contra o sandbox de verdade do Asaas não foram feitos aqui: os testes usam um Asaas dublado.
- O `value` no `PUT /subscriptions/{id}` não aparece na lista de campos da página da referência consultada em 30/10/2026,
  embora o adaptador do upstream o use em produção na troca de plano. Conferir no sandbox antes da primeira venda com cupom.
